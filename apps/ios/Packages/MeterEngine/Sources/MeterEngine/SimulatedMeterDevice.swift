import Foundation
import PhotometryKit

public actor SimulatedMeterDevice: MeterSensor, MeterFrameCapturing {
    public enum Playback: Hashable, Codable, Sendable {
        case once
        case loop
    }

    private let cameras: [CameraDescriptor]
    private let trace: [SensorSample]
    private let spotTrace: [SpotMeasurement]
    private let playback: Playback
    private let frameTrace: [CapturedFrame]
    private var selectedCameraID: String?
    private var spotIndex = 0
    private var frameIndex = 0

    public init(
        cameras: [CameraDescriptor],
        trace: [SensorSample],
        spotTrace: [SpotMeasurement] = [],
        frameTrace: [CapturedFrame] = [],
        playback: Playback = .once
    ) {
        self.cameras = cameras
        self.trace = trace
        self.spotTrace = spotTrace
        self.frameTrace = frameTrace
        self.playback = playback
        self.selectedCameraID = cameras.first?.id
    }

    public func authorizationStatus() async -> CameraAuthorization { .authorized }

    public func requestAuthorization() async -> Bool { true }

    public func discoverCameras() async throws -> [CameraDescriptor] { cameras }

    public func selectCamera(id: String) async throws {
        guard cameras.contains(where: { $0.id == id }) else {
            throw MeterError.cameraNotFound(id)
        }
        selectedCameraID = id
    }

    public func samples(interval: Duration) async throws -> AsyncThrowingStream<SensorSample, any Error> {
        let selectedCameraID = self.selectedCameraID
        let selectedTrace = trace.filter { selectedCameraID == nil || $0.camera.id == selectedCameraID }
        let playback = self.playback
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    repeat {
                        for sample in selectedTrace {
                            try Task.checkCancellation()
                            continuation.yield(sample)
                            if interval > .zero { try await Task.sleep(for: interval) }
                        }
                    } while playback == .loop && !selectedTrace.isEmpty
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func captureSpot(_ request: SpotCaptureRequest) async throws -> SpotMeasurement {
        guard !spotTrace.isEmpty else {
            throw MeterError.capabilityUnavailable("simulated spot trace")
        }
        guard spotIndex < spotTrace.count || playback == .loop else {
            throw MeterError.traceExhausted
        }
        let measurement = spotTrace[spotIndex % spotTrace.count]
        spotIndex += 1
        return measurement
    }

    public func lockExposure(_ exposure: CustomExposure?) async throws {}

    public func unlockExposure() async throws {}

    public func stop() async {}

    public func frameCaptureCapabilities() async throws -> FrameCaptureCapabilities {
        var rawFormats: [UInt32] = []
        var processedCodecs: [ProcessedFrameCodec] = []
        for frame in frameTrace {
            switch frame.provenance.negotiation.path {
            case let .rawDNG(pixelFormatType):
                if !rawFormats.contains(pixelFormatType) { rawFormats.append(pixelFormatType) }
            case let .processed(codec):
                if !processedCodecs.contains(codec) { processedCodecs.append(codec) }
            }
        }
        return FrameCaptureCapabilities(
            rawPixelFormatTypes: rawFormats,
            processedCodecs: processedCodecs
        )
    }

    public func captureFrame(preference: FrameCapturePreference) async throws -> CapturedFrame {
        let negotiation = try FrameCaptureNegotiator.negotiate(
            preference: preference,
            capabilities: try await frameCaptureCapabilities()
        )
        let matchingFrames = frameTrace.filter { frame in
            switch (frame.provenance.negotiation.path, negotiation.path) {
            case (.rawDNG, .rawDNG): true
            case let (.processed(lhs), .processed(rhs)): lhs == rhs
            default: false
            }
        }
        guard !matchingFrames.isEmpty else { throw MeterError.traceExhausted }
        guard frameIndex < matchingFrames.count || playback == .loop else {
            throw MeterError.traceExhausted
        }
        let source = matchingFrames[frameIndex % matchingFrames.count]
        frameIndex += 1
        return try CapturedFrame(
            payload: source.payload,
            provenance: CapturedFrameProvenance(
                capturedAt: source.provenance.capturedAt,
                camera: source.provenance.camera,
                negotiation: NegotiatedFrameCapture(
                    path: negotiation.path,
                    fallbackReason: negotiation.fallbackReason
                ),
                dimensions: source.provenance.dimensions,
                characterization: source.provenance.characterization
            )
        )
    }

    public static func reflectedEVTrace(
        camera: CameraDescriptor,
        ev100Values: [Double],
        startingAt: Date = Date(timeIntervalSince1970: 0)
    ) throws -> SimulatedMeterDevice {
        let iso = try Sensitivity(iso: 100)
        let aperture = try Aperture(4)
        let samples = try ev100Values.enumerated().map { index, ev in
            let duration = try ExposureMath.duration(
                forEV100: ExposureValue(ev),
                aperture: aperture,
                sensitivity: iso
            )
            return SensorSample(
                capturedAt: startingAt.addingTimeInterval(Double(index)),
                camera: camera,
                sensorPath: .simulated,
                exposure: ExposureSnapshot(
                    sensitivity: iso,
                    duration: duration,
                    aperture: aperture
                )
            )
        }
        return SimulatedMeterDevice(cameras: [camera], trace: samples)
    }
}
