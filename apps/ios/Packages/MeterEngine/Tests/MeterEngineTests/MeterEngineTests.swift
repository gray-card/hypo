import Foundation
import PhotometryKit
import Testing

@testable import MeterEngine

private let camera = CameraDescriptor(
    id: "back.tele",
    name: "Simulated telephoto",
    module: .telephoto,
    horizontalFieldOfViewDegrees: 15,
    supportsCustomExposure: true,
    supportsRAWPhoto: true
)

private func profile(
    path: SensorPath = .simulated,
    offset: Double = 0.25,
    range: ClosedRange<Double>? = 5...15
) throws -> CalibrationProfile {
    try CalibrationProfile(
        id: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!,
        identity: CalibrationIdentity(
            deviceModel: "Simulator",
            cameraID: camera.id,
            module: camera.module,
            sensorPath: path
        ),
        reference: .handheldMeter,
        createdAt: Date(timeIntervalSince1970: 100),
        constantOffsetStops: offset,
        validatedEVRange: range
    )
}

@Test("AE metadata produces calibrated reflected EV100")
func calibratedReflectedCapture() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [10])
    let calibration = try profile()
    let engine = DefaultMeterEngine(sensor: sensor, calibration: calibration)
    let reading = try await engine.capture(configuration: MeterConfiguration())

    #expect(abs(reading.ev100.rawValue - 10.25) < 1e-10)
    #expect(reading.geometry == .reflectedAverage)
    #expect(reading.accuracyTier == .calibrated)
    #expect(reading.calibrationID == calibration.id)
    #expect(reading.flags.isEmpty)
    #expect(reading.luminance != nil)
}

@Test("N-sample averaging occurs in linear light")
func linearLightAverage() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [10, 12])
    let engine = DefaultMeterEngine(sensor: sensor, calibration: try profile(offset: 0, range: nil))
    let config = try MeterConfiguration(averagingCount: 2, samplingInterval: .zero)
    let capture = try await engine.captureBatch(configuration: config)
    let reading = capture.reading

    #expect(abs(reading.ev100.rawValue - log2((pow(2, 10) + pow(2, 12)) / 2)) < 1e-10)
    #expect(reading.role == .average)
    #expect(reading.averagedFrom.count == 2)
    #expect(capture.constituents.map(\.id) == reading.averagedFrom)
    #expect(capture.constituents.map(\.ev100.rawValue) == [10, 12])
    #expect(capture.records.map(\.id) == capture.constituents.map(\.id) + [reading.id])
}

@Test("Single-sample capture keeps its original reading behavior")
func singleCaptureBatch() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [10])
    let engine = DefaultMeterEngine(sensor: sensor)
    let capture = try await engine.captureBatch(configuration: MeterConfiguration())

    #expect(capture.constituents.isEmpty)
    #expect(capture.records == [capture.reading])
    #expect(capture.reading.role == .member)
    #expect(capture.reading.averagedFrom.isEmpty)
}

@Test("A mismatched calibration is never silently applied")
func calibrationMismatch() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [10])
    let engine = DefaultMeterEngine(sensor: sensor, calibration: try profile(path: .rawPatch))
    let reading = try await engine.capture(configuration: MeterConfiguration())

    #expect(abs(reading.ev100.rawValue - 10) < 1e-10)
    #expect(reading.flags.contains(.calibrationMismatch))
    #expect(reading.calibrationID == nil)
    #expect(reading.accuracyTier == .unknown)
}

@Test("Uncalibrated samples are serialized and do not disturb active calibration")
func atomicUncalibratedCapture() async throws {
    let sensitivity = try Sensitivity(iso: 100)
    let aperture = try Aperture(4)
    let sample = SensorSample(
        capturedAt: Date(timeIntervalSince1970: 500),
        camera: camera,
        sensorPath: .simulated,
        exposure: ExposureSnapshot(
            sensitivity: sensitivity,
            duration: try ExposureMath.duration(
                forEV100: ExposureValue(10),
                aperture: aperture,
                sensitivity: sensitivity
            ),
            aperture: aperture
        )
    )
    let sensor = CaptureConcurrencyProbeSensor(sample: sample)
    let calibration = try profile(offset: 1, range: nil)
    let engine = DefaultMeterEngine(sensor: sensor, calibration: calibration)
    let configuration = try MeterConfiguration()

    async let normalCapture = engine.captureBatch(configuration: configuration)
    async let calibrationCapture = engine.captureUncalibrated(configuration: configuration)
    let (normal, uncalibrated) = try await (normalCapture, calibrationCapture)

    #expect(normal.reading.ev100.rawValue == 11)
    #expect(normal.reading.calibrationID == calibration.id)
    #expect(uncalibrated.reading.ev100.rawValue == 10)
    #expect(uncalibrated.reading.calibrationID == nil)
    #expect(await sensor.maximumConcurrentCaptures == 1)

    let after = try await engine.capture(configuration: configuration)
    #expect(after.ev100.rawValue == 11)
    #expect(after.calibrationID == calibration.id)
}

@Test("Incident dome readings use the configured C constant")
func incidentDome() async throws {
    let sample = SensorSample(
        capturedAt: Date(timeIntervalSince1970: 1),
        camera: camera,
        sensorPath: .simulated,
        illuminanceLux: 3_300
    )
    let sensor = SimulatedMeterDevice(cameras: [camera], trace: [sample])
    let engine = DefaultMeterEngine(sensor: sensor)
    let config = try MeterConfiguration(mode: .incident(receptor: .dome), samplingInterval: .zero)
    let reading = try await engine.capture(configuration: config)

    #expect(abs(reading.ev100.rawValue - log2(1_000)) < 1e-10)
    #expect(reading.geometry == .incidentDome)
    #expect(reading.calibrationConstant == 330)
    #expect(reading.flags.contains(.calibrationMissing))
}

@Test("Calibration builder averages reference offsets and schedules drift checks")
func calibrationBuilder() throws {
    let created = Date(timeIntervalSince1970: 100)
    let result = try CalibrationBuilder.constantOffsetProfile(
        identity: CalibrationIdentity(
            deviceModel: "Phone",
            cameraID: camera.id,
            module: .telephoto,
            sensorPath: .rawPatch
        ),
        reference: .handheldMeter,
        observations: [
            CalibrationObservation(measuredEV100: ExposureValue(9), referenceEV100: ExposureValue(10)),
            CalibrationObservation(measuredEV100: ExposureValue(12), referenceEV100: ExposureValue(12.5)),
        ],
        createdAt: created,
        driftCheckInterval: 50
    )

    #expect(result.constantOffsetStops == 0.75)
    #expect(result.validatedEVRange == 9...12)
    #expect(result.needsDriftCheck(at: created.addingTimeInterval(49)) == false)
    #expect(result.needsDriftCheck(at: created.addingTimeInterval(50)))
}

@Test("Calibration response curves interpolate and clamp at their endpoints")
func calibrationCurve() throws {
    let result = try CalibrationProfile(
        identity: CalibrationIdentity(
            deviceModel: "Phone",
            cameraID: camera.id,
            module: camera.module,
            sensorPath: .simulated
        ),
        reference: .knownTarget,
        createdAt: .distantPast,
        constantOffsetStops: 0.1,
        correctionCurve: [
            try CalibrationPoint(rawEV100: 5, correctionStops: 0.5),
            try CalibrationPoint(rawEV100: 15, correctionStops: -0.5),
        ]
    )

    #expect(abs(result.corrected(ExposureValue(10)).rawValue - 10.1) < 1e-10)
    #expect(abs(result.corrected(ExposureValue(2)).rawValue - 2.6) < 1e-10)
    #expect(abs(result.corrected(ExposureValue(20)).rawValue - 19.6) < 1e-10)
}

@Test("Spot patches report actual angular resolution and clipping")
func spotPatchGeometry() throws {
    let plane = try PixelPlane(width: 10, height: 10, values: Array(repeating: 0.25, count: 100))
    let center = try SpotPatchIntegrator.integrate(
        plane: plane,
        normalizedX: 0.5,
        normalizedY: 0.5,
        requestedAngleDegrees: 1,
        horizontalFieldOfViewDegrees: 20
    )
    let edge = try SpotPatchIntegrator.integrate(
        plane: plane,
        normalizedX: 0,
        normalizedY: 0,
        requestedAngleDegrees: 4,
        horizontalFieldOfViewDegrees: 20
    )

    #expect(center.achievedAngleDegrees == 2)
    #expect(center.meanLinearSignal == 0.25)
    #expect(center.sampledPixelCount > 0)
    #expect(edge.flags.contains(.patchClipped))
}

@Test("Processed-frame inversion and flare heuristic remain explicit")
func processedFrameAndFlare() throws {
    #expect(abs(try ProcessedFrameEstimator.linearizeSRGB(0.04045) - 0.00313080495) < 1e-9)
    #expect(try FlareHeuristic.flags(patchSignal: 1, surroundingSignal: 16).contains(.flareRisk))
    #expect(try FlareHeuristic.flags(patchSignal: 1, surroundingSignal: 8).isEmpty)
}

@Test("Frame spot estimation is exposure anchored and uncharacterized by default")
func frameSpotEstimate() throws {
    let request = try SpotCaptureRequest(nominalAngleDegrees: 1)
    let plane = try PixelPlane(
        width: 40,
        height: 30,
        values: Array(repeating: 0.18, count: 1_200)
    )
    let estimate = try SpotFrameEstimator.estimate(
        plane: plane,
        request: request,
        horizontalFieldOfViewDegrees: 40,
        referenceEV100: ExposureValue(10)
    )

    #expect(abs(estimate.uncalibratedEV100.rawValue - 10) < 1e-12)
    #expect(estimate.requestedAngleDegrees == 1)
    #expect(estimate.achievedAngleDegrees == 1)
    #expect(estimate.sampledPixelCount > 0)
    #expect(estimate.flags.contains(.approximate))

    let characterized = try SpotFrameEstimator.estimate(
        plane: plane,
        request: request,
        horizontalFieldOfViewDegrees: 40,
        referenceEV100: ExposureValue(10),
        isCharacterized: true
    )
    #expect(!characterized.flags.contains(.approximate))
}

@Test("Frame spot estimation retains flare and clipping caveats")
func frameSpotCaveats() throws {
    var values = Array(repeating: 1.0, count: 40 * 40)
    for y in 15...24 {
        for x in 15...24 { values[y * 40 + x] = 0.03125 }
    }
    let estimate = try SpotFrameEstimator.estimate(
        plane: PixelPlane(width: 40, height: 40, values: values),
        request: SpotCaptureRequest(
            normalizedX: 0.5,
            normalizedY: 0.5,
            nominalAngleDegrees: 4,
            preferRAW: false
        ),
        horizontalFieldOfViewDegrees: 40,
        referenceEV100: ExposureValue(10)
    )
    #expect(estimate.flags.contains(.flareRisk))
    #expect(estimate.flags.contains(.approximate))
    #expect(!estimate.flags.contains(.patchClipped))
}

@Test("Spot capture preserves achieved geometry and calibration provenance")
func simulatedSpotCapture() async throws {
    let measurement = SpotMeasurement(
        capturedAt: Date(timeIntervalSince1970: 123),
        camera: camera,
        sensorPath: .rawPatch,
        uncalibratedEV100: ExposureValue(12),
        nominalAngleDegrees: 1,
        achievedAngleDegrees: 1.3,
        frameFallbackReason: .rawDecodingUnavailable,
        flags: [.flareRisk]
    )
    let sensor = SimulatedMeterDevice(
        cameras: [camera],
        trace: [],
        spotTrace: [measurement]
    )
    let engine = DefaultMeterEngine(sensor: sensor, calibration: try profile(path: .rawPatch))
    let config = try MeterConfiguration(
        mode: .reflectedSpot(nominalAngleDegrees: 1),
        samplingInterval: .zero
    )
    let reading = try await engine.capture(configuration: config)

    #expect(reading.ev100.rawValue == 12.25)
    #expect(reading.nominalSpotAngleDegrees == 1)
    #expect(reading.achievedSpotAngleDegrees == 1.3)
    #expect(reading.flags.contains(.flareRisk))
    #expect(measurement.frameFallbackReason == .rawDecodingUnavailable)
    #expect(reading.sensorPath == .rawPatch)
}

@Test("Multi-spot memory limits entries and reports contrast")
func multiSpotMemory() throws {
    func reading(_ ev: Double) -> Reading {
        Reading(
            takenAt: .distantPast,
            geometry: .reflectedSpot,
            ev100: ExposureValue(ev),
            camera: camera,
            sensorPath: .simulated,
            accuracyTier: .characterized,
            calibrationConstant: 12.5
        )
    }
    var memory = try MultiSpotMemory(readings: [reading(8), reading(13)])
    #expect(memory.contrastRange == Stops(5))
    #expect(try memory.average().role == .average)
    for value in 0..<7 { try memory.add(reading(Double(value + 9))) }
    #expect(memory.readings.count == 9)
    #expect(throws: MeterError.self) { try memory.add(reading(20)) }
}

@Test("Continuous trace emits rolling-window averages")
func continuousTrace() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [8, 10, 12])
    let engine = DefaultMeterEngine(sensor: sensor, calibration: try profile(offset: 0, range: nil))
    let config = try MeterConfiguration(averagingCount: 2, samplingInterval: .zero)
    let stream = try await engine.readings(configuration: config)
    var values: [Double] = []
    for try await reading in stream { values.append(reading.ev100.rawValue) }

    #expect(values.count == 2)
    #expect(abs(values[0] - log2((pow(2, 8) + pow(2, 10)) / 2)) < 1e-10)
    #expect(abs(values[1] - log2((pow(2, 10) + pow(2, 12)) / 2)) < 1e-10)
}

@Test("Readings outside characterized range are labeled")
func outOfRange() async throws {
    let sensor = try SimulatedMeterDevice.reflectedEVTrace(camera: camera, ev100Values: [18])
    let engine = DefaultMeterEngine(sensor: sensor, calibration: try profile())
    let reading = try await engine.capture(configuration: MeterConfiguration())
    #expect(reading.flags.contains(.outOfRange))
}

@Test("Frame negotiation preserves RAW fallback provenance")
func frameCaptureNegotiation() throws {
    let both = FrameCaptureCapabilities(
        rawPixelFormatTypes: [1_234],
        processedCodecs: [.heif, .jpeg]
    )
    #expect(
        try FrameCaptureNegotiator.negotiate(preference: .preferRAW, capabilities: both)
            == NegotiatedFrameCapture(path: .rawDNG(pixelFormatType: 1_234))
    )
    #expect(
        try FrameCaptureNegotiator.negotiate(preference: .processedOnly, capabilities: both)
            == NegotiatedFrameCapture(path: .processed(codec: .jpeg))
    )

    let processed = FrameCaptureCapabilities(processedCodecs: [.heif])
    #expect(
        try FrameCaptureNegotiator.negotiate(preference: .preferRAW, capabilities: processed)
            == NegotiatedFrameCapture(
                path: .processed(codec: .heif), fallbackReason: .rawUnavailable)
    )
    #expect(throws: MeterError.self) {
        try FrameCaptureNegotiator.negotiate(preference: .requireRAW, capabilities: processed)
    }
}

@Test("Captured frames require payload and provenance to agree")
func capturedFrameValidation() throws {
    let exposure = ExposureSnapshot(
        sensitivity: try Sensitivity(iso: 100),
        duration: try ExposureDuration(seconds: 1 / 125),
        aperture: try Aperture(8)
    )
    let provenance = CapturedFrameProvenance(
        capturedAt: .distantPast,
        camera: camera,
        negotiation: NegotiatedFrameCapture(path: .processed(codec: .jpeg)),
        dimensions: try CapturedFrameDimensions(width: 12, height: 8),
        exposure: exposure
    )
    let frame = try CapturedFrame(
        payload: .processedImage(Data([1, 2, 3]), codec: .jpeg),
        provenance: provenance
    )
    #expect(frame.provenance.sensorPath == .processedPatch)
    #expect(frame.provenance.exposure == exposure)
    #expect(!frame.provenance.isEligibleForCalibratedReading)
    #expect(throws: MeterError.self) {
        try CapturedFrame(payload: .rawDNG(Data([1])), provenance: provenance)
    }
    #expect(throws: MeterError.self) {
        try CapturedFrame(
            payload: .processedImage(Data([1]), codec: .heif),
            provenance: provenance
        )
    }
}

@Test("Bayer conversion accounts for layout and black level")
func bayerConversion() throws {
    // Normalized RGGB cell: R=1, G=(0.5+0.5)/2, B=0 after black subtraction.
    let plane = try BayerPlane(
        width: 2,
        height: 2,
        samples: [1_100, 600, 600, 100],
        pattern: .rggb,
        blackLevel: 100,
        whiteLevel: 1_100
    ).linearLuminancePlane()
    #expect(plane.width == 1)
    #expect(plane.height == 1)
    #expect(abs(plane.values[0] - (0.2126 + 0.7152 * 0.5)) < 1e-12)

    let layouts: [(BayerPattern, [UInt16])] = [
        (.bggr, [100, 600, 600, 1_100]),
        (.grbg, [600, 1_100, 100, 600]),
        (.gbrg, [600, 100, 1_100, 600]),
    ]
    for (pattern, samples) in layouts {
        let converted = try BayerPlane(
            width: 2,
            height: 2,
            samples: samples,
            pattern: pattern,
            blackLevel: 100,
            whiteLevel: 1_100
        ).linearLuminancePlane()
        #expect(abs(converted.values[0] - plane.values[0]) < 1e-12)
    }
}

@Test("Processed RGB conversion linearizes before computing luminance")
func rgbConversion() throws {
    let encoded = try RGBPlane(
        width: 1,
        height: 1,
        samples: [1, 0.5, 0],
        transferFunction: .sRGB
    ).linearLuminancePlane()
    let expectedGreen = try ProcessedFrameEstimator.linearizeSRGB(0.5)
    #expect(abs(encoded.values[0] - (0.2126 + 0.7152 * expectedGreen)) < 1e-12)

    let linear = try RGBPlane(
        width: 1,
        height: 1,
        samples: [1, 0.5, 0],
        transferFunction: .linear
    ).linearLuminancePlane()
    #expect(abs(linear.values[0] - (0.2126 + 0.7152 * 0.5)) < 1e-12)
}

@Test("Simulated frame capture follows the same fallback policy")
func simulatedFrameCapture() async throws {
    let source = try CapturedFrame(
        payload: .processedImage(Data([0xFF, 0xD8, 0xFF]), codec: .jpeg),
        provenance: CapturedFrameProvenance(
            capturedAt: Date(timeIntervalSince1970: 400),
            camera: camera,
            negotiation: NegotiatedFrameCapture(path: .processed(codec: .jpeg)),
            dimensions: try CapturedFrameDimensions(width: 10, height: 10)
        )
    )
    let sensor = SimulatedMeterDevice(
        cameras: [camera],
        trace: [],
        frameTrace: [source]
    )
    let captured = try await sensor.captureFrame(preference: .preferRAW)
    #expect(captured.provenance.negotiation.fallbackReason == .rawUnavailable)
    #expect(captured.provenance.sensorPath == .processedPatch)
}

private actor CaptureConcurrencyProbeSensor: MeterSensor {
    let sample: SensorSample
    private var concurrentCaptures = 0
    private(set) var maximumConcurrentCaptures = 0

    init(sample: SensorSample) {
        self.sample = sample
    }

    func authorizationStatus() async -> CameraAuthorization { .authorized }
    func requestAuthorization() async -> Bool { true }
    func discoverCameras() async throws -> [CameraDescriptor] { [sample.camera] }
    func selectCamera(id _: String) async throws {}

    func samples(interval _: Duration) async throws
        -> AsyncThrowingStream<SensorSample, any Error>
    {
        let sample = sample
        return AsyncThrowingStream { continuation in
            let task = Task.detached { [weak self] in
                guard let self else {
                    continuation.finish()
                    return
                }
                await self.beginCapture()
                do {
                    try await Task.sleep(for: .milliseconds(30))
                    continuation.yield(sample)
                    await self.endCapture()
                    continuation.finish()
                } catch {
                    await self.endCapture()
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func lockExposure(_: CustomExposure?) async throws {}
    func unlockExposure() async throws {}

    func captureSpot(_: SpotCaptureRequest) async throws -> SpotMeasurement {
        throw MeterError.capabilityUnavailable("spot capture")
    }

    func stop() async {}

    private func beginCapture() {
        concurrentCaptures += 1
        maximumConcurrentCaptures = max(maximumConcurrentCaptures, concurrentCaptures)
    }

    private func endCapture() {
        concurrentCaptures -= 1
    }
}
