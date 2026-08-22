#if canImport(AVFoundation)
    @preconcurrency import AVFoundation
    import Foundation
    import ImageIO
    import PhotometryKit

    /// The single AVFoundation boundary used by MeterEngine.
    ///
    /// This adapter exposes auto-exposure metadata for reflected-average metering and captures
    /// full-resolution still frames for spot metering. Its rendered RAW and processed-frame
    /// measurements remain explicitly approximate until physical-device characterization.
    public actor AVFoundationMeterSensor: MeterSensor, MeterFrameCapturing {
        private var selectedDevice: AVCaptureDevice?
        private var session: AVCaptureSession?
        private var photoOutput: AVCapturePhotoOutput?
        private var photoDelegates: [Int64: FrameCapturePhotoDelegate] = [:]

        public init() {}

        public func authorizationStatus() async -> CameraAuthorization {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .notDetermined: .notDetermined
            case .authorized: .authorized
            case .denied: .denied
            case .restricted: .restricted
            @unknown default: .restricted
            }
        }

        public func requestAuthorization() async -> Bool {
            await AVCaptureDevice.requestAccess(for: .video)
        }

        public func discoverCameras() async throws -> [CameraDescriptor] {
            #if os(iOS)
                let deviceTypes: [AVCaptureDevice.DeviceType] = [
                    .builtInUltraWideCamera,
                    .builtInWideAngleCamera,
                    .builtInTelephotoCamera,
                    .builtInTrueDepthCamera,
                ]
                let discovery = AVCaptureDevice.DiscoverySession(
                    deviceTypes: deviceTypes,
                    mediaType: .video,
                    position: .unspecified
                )
            #else
                let discovery = AVCaptureDevice.DiscoverySession(
                    deviceTypes: [.external],
                    mediaType: .video,
                    position: .unspecified
                )
            #endif
            return discovery.devices.map { Self.descriptor($0) }
        }

        public func selectCamera(id: String) async throws {
            guard await authorizationStatus() == .authorized else {
                throw MeterError.authorizationDenied
            }
            guard let device = AVCaptureDevice(uniqueID: id) else {
                throw MeterError.cameraNotFound(id)
            }
            selectedDevice = device
            try configureSession(device: device)
        }

        public func samples(interval: Duration) async throws -> AsyncThrowingStream<SensorSample, any Error> {
            guard await authorizationStatus() == .authorized else {
                throw MeterError.authorizationDenied
            }
            if selectedDevice == nil {
                guard let first = try await discoverCameras().first else {
                    throw MeterError.capabilityUnavailable("camera")
                }
                try await selectCamera(id: first.id)
            }
            session?.startRunning()
            return AsyncThrowingStream { continuation in
                let task = Task { [weak self] in
                    do {
                        while !Task.isCancelled {
                            guard let self else { break }
                            if let sample = try await self.currentSample() {
                                continuation.yield(sample)
                            }
                            try await Task.sleep(for: interval)
                        }
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
            guard await authorizationStatus() == .authorized else {
                throw MeterError.authorizationDenied
            }
            if selectedDevice == nil {
                guard let first = try await discoverCameras().first else {
                    throw MeterError.capabilityUnavailable("camera")
                }
                try await selectCamera(id: first.id)
            }

            var frame = try await captureFrame(
                preference: request.preferRAW ? .preferRAW : .processedOnly
            )
            var fallbackReason = frame.provenance.negotiation.fallbackReason
            var flags: Set<MeterFlag> = []
            if fallbackReason != nil {
                flags.insert(.rawFallback)
            }

            let plane: PixelPlane
            do {
                plane = try PlatformFrameDecoder.linearLuminancePlane(from: frame)
            } catch {
                guard request.preferRAW,
                    case .rawDNG = frame.provenance.negotiation.path
                else {
                    throw error
                }
                frame = try await captureFrame(preference: .processedOnly)
                fallbackReason = .rawDecodingUnavailable
                flags.insert(.rawFallback)
                plane = try PlatformFrameDecoder.linearLuminancePlane(from: frame)
            }

            guard let landscapeFieldOfView = frame.provenance.camera.horizontalFieldOfViewDegrees,
                landscapeFieldOfView > 0
            else {
                throw MeterError.capabilityUnavailable("camera field of view")
            }
            let fieldOfView = Self.orientedHorizontalFieldOfView(
                landscapeDegrees: landscapeFieldOfView,
                plane: plane
            )
            let exposure: ExposureSnapshot?
            if let capturedExposure = frame.provenance.exposure {
                exposure = capturedExposure
            } else {
                exposure = try currentSample()?.exposure
            }
            guard let exposure else {
                throw MeterError.invalidSensorSample("spot frame has no exposure metadata")
            }
            let estimate = try SpotFrameEstimator.estimate(
                plane: plane,
                request: request,
                horizontalFieldOfViewDegrees: fieldOfView,
                referenceEV100: exposure.ev100
            )
            flags.formUnion(estimate.flags)
            return SpotMeasurement(
                capturedAt: frame.provenance.capturedAt,
                camera: frame.provenance.camera,
                sensorPath: frame.provenance.sensorPath,
                uncalibratedEV100: estimate.uncalibratedEV100,
                nominalAngleDegrees: estimate.requestedAngleDegrees,
                achievedAngleDegrees: estimate.achievedAngleDegrees,
                normalizedX: request.normalizedX,
                normalizedY: request.normalizedY,
                frameFallbackReason: fallbackReason,
                flags: flags
            )
        }

        public func frameCaptureCapabilities() async throws -> FrameCaptureCapabilities {
            guard let photoOutput else {
                throw MeterError.capabilityUnavailable("configured photo output")
            }
            let codecs = photoOutput.availablePhotoCodecTypes.compactMap { codec in
                switch codec {
                case .jpeg: ProcessedFrameCodec.jpeg
                case .hevc: ProcessedFrameCodec.heif
                default: nil
                }
            }
            #if os(iOS) || targetEnvironment(macCatalyst)
                let rawPixelFormats = photoOutput.availableRawPhotoPixelFormatTypes
            #else
                let rawPixelFormats: [UInt32] = []
            #endif
            return FrameCaptureCapabilities(
                rawPixelFormatTypes: rawPixelFormats,
                processedCodecs: Array(Set(codecs))
            )
        }

        /// Captures one encoded DNG, JPEG, or HEIF payload with inspectable path provenance.
        /// Decoding and photometric interpretation remain separate so an uncharacterized device
        /// cannot accidentally produce a reading described as calibrated.
        public func captureFrame(preference: FrameCapturePreference) async throws -> CapturedFrame {
            guard await authorizationStatus() == .authorized else {
                throw MeterError.authorizationDenied
            }
            if selectedDevice == nil {
                guard let first = try await discoverCameras().first else {
                    throw MeterError.capabilityUnavailable("camera")
                }
                try await selectCamera(id: first.id)
            }
            guard let selectedDevice, let photoOutput else {
                throw MeterError.capabilityUnavailable("configured photo output")
            }
            let negotiation = try FrameCaptureNegotiator.negotiate(
                preference: preference,
                capabilities: try await frameCaptureCapabilities()
            )
            let settings: AVCapturePhotoSettings
            switch negotiation.path {
            case let .rawDNG(pixelFormatType):
                #if os(iOS) || targetEnvironment(macCatalyst)
                    settings = AVCapturePhotoSettings(rawPixelFormatType: pixelFormatType)
                #else
                    throw MeterError.capabilityUnavailable("RAW photo capture")
                #endif
            case let .processed(codec):
                let avCodec: AVVideoCodecType = codec == .jpeg ? .jpeg : .hevc
                settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: avCodec])
            }
            session?.startRunning()
            #if os(iOS) || targetEnvironment(macCatalyst)
                let supportsRAW = !photoOutput.availableRawPhotoPixelFormatTypes.isEmpty
            #else
                let supportsRAW = false
            #endif
            let camera = Self.descriptor(selectedDevice, supportsRAWPhoto: supportsRAW)
            return try await withCheckedThrowingContinuation { continuation in
                let id = settings.uniqueID
                let delegate = FrameCapturePhotoDelegate(
                    camera: camera,
                    negotiation: negotiation
                ) { [weak self] result in
                    continuation.resume(with: result)
                    Task { await self?.removePhotoDelegate(id: id) }
                }
                photoDelegates[id] = delegate
                photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
        }

        public func lockExposure(_ exposure: CustomExposure?) async throws {
            #if os(iOS) || targetEnvironment(macCatalyst)
                guard await authorizationStatus() == .authorized else {
                    throw MeterError.authorizationDenied
                }
                if selectedDevice == nil {
                    guard let first = try await discoverCameras().first else {
                        throw MeterError.capabilityUnavailable("camera")
                    }
                    try await selectCamera(id: first.id)
                }
                guard let selectedDevice else {
                    throw MeterError.capabilityUnavailable("selected camera")
                }
                guard selectedDevice.isExposureModeSupported(.locked) else {
                    throw MeterError.capabilityUnavailable("exposure lock")
                }
                if let exposure {
                    guard selectedDevice.isExposureModeSupported(.custom) else {
                        throw MeterError.capabilityUnavailable("custom exposure")
                    }
                    try selectedDevice.lockForConfiguration()
                    defer { selectedDevice.unlockForConfiguration() }
                    let duration = CMTime(
                        seconds: exposure.duration.seconds, preferredTimescale: 1_000_000_000)
                    selectedDevice.setExposureModeCustom(
                        duration: duration,
                        iso: Float(exposure.sensitivity.iso),
                        completionHandler: nil
                    )
                } else {
                    if selectedDevice.isExposureModeSupported(.continuousAutoExposure) {
                        try selectedDevice.lockForConfiguration()
                        selectedDevice.exposureMode = .continuousAutoExposure
                        selectedDevice.unlockForConfiguration()
                    }
                    session?.startRunning()
                    try await waitForUsableExposure(on: selectedDevice)
                    try selectedDevice.lockForConfiguration()
                    defer { selectedDevice.unlockForConfiguration() }
                    selectedDevice.exposureMode = .locked
                }
            #else
                throw MeterError.capabilityUnavailable("exposure lock is unavailable on macOS cameras")
            #endif
        }

        public func unlockExposure() async throws {
            #if os(iOS) || targetEnvironment(macCatalyst)
                guard let selectedDevice else { throw MeterError.capabilityUnavailable("selected camera") }
                guard selectedDevice.isExposureModeSupported(.continuousAutoExposure) else {
                    throw MeterError.capabilityUnavailable("continuous auto exposure")
                }
                try selectedDevice.lockForConfiguration()
                defer { selectedDevice.unlockForConfiguration() }
                selectedDevice.exposureMode = .continuousAutoExposure
            #else
                throw MeterError.capabilityUnavailable("exposure unlock is unavailable on macOS cameras")
            #endif
        }

        public func stop() async {
            session?.stopRunning()
        }

        private func configureSession(device: AVCaptureDevice) throws {
            let newSession = AVCaptureSession()
            newSession.beginConfiguration()
            defer { newSession.commitConfiguration() }
            let input = try AVCaptureDeviceInput(device: device)
            guard newSession.canAddInput(input) else {
                throw MeterError.capabilityUnavailable("camera input")
            }
            newSession.addInput(input)
            let newPhotoOutput = AVCapturePhotoOutput()
            guard newSession.canAddOutput(newPhotoOutput) else {
                throw MeterError.capabilityUnavailable("photo output")
            }
            newSession.addOutput(newPhotoOutput)
            session?.stopRunning()
            session = newSession
            photoOutput = newPhotoOutput
        }

        private func removePhotoDelegate(id: Int64) {
            photoDelegates[id] = nil
        }

        #if os(iOS) || targetEnvironment(macCatalyst)
            private func waitForUsableExposure(on device: AVCaptureDevice) async throws {
                for attempt in 0..<20 {
                    try Task.checkCancellation()
                    let hasUsableValues =
                        device.iso > 0 && device.exposureDuration.seconds > 0
                        && device.lensAperture > 0
                    if attempt > 0, hasUsableValues, !device.isAdjustingExposure { return }
                    try await Task.sleep(for: .milliseconds(50))
                }
                throw MeterError.capabilityUnavailable("settled camera exposure")
            }
        #endif

        private func currentSample() throws -> SensorSample? {
            #if os(iOS) || targetEnvironment(macCatalyst)
                guard let selectedDevice else { return nil }
                let iso = Double(selectedDevice.iso)
                let seconds = selectedDevice.exposureDuration.seconds
                let aperture = Double(selectedDevice.lensAperture)
                guard iso > 0, seconds > 0, aperture > 0 else { return nil }
                let supportsRAW = photoOutput?.availableRawPhotoPixelFormatTypes.isEmpty == false
                return SensorSample(
                    capturedAt: Date(),
                    camera: Self.descriptor(selectedDevice, supportsRAWPhoto: supportsRAW),
                    sensorPath: .aeMetadata,
                    exposure: ExposureSnapshot(
                        sensitivity: try Sensitivity(iso: iso),
                        duration: try ExposureDuration(seconds: seconds),
                        aperture: try Aperture(aperture)
                    )
                )
            #else
                throw MeterError.capabilityUnavailable("AE metadata is unavailable on macOS cameras")
            #endif
        }

        private nonisolated static func descriptor(
            _ device: AVCaptureDevice,
            supportsRAWPhoto: Bool = false
        ) -> CameraDescriptor {
            let module: CameraModule
            #if os(iOS)
                if device.position == .front {
                    module = .front
                } else {
                    switch device.deviceType {
                    case .builtInUltraWideCamera: module = .ultraWide
                    case .builtInWideAngleCamera: module = .wide
                    case .builtInTelephotoCamera: module = .telephoto
                    default: module = .unknown
                    }
                }
            #else
                module = .external
            #endif
            #if os(iOS) || targetEnvironment(macCatalyst)
                let fieldOfView: Double? = Double(device.activeFormat.videoFieldOfView)
                let supportsCustomExposure = device.isExposureModeSupported(.custom)
            #else
                let fieldOfView: Double? = nil
                let supportsCustomExposure = false
            #endif
            return CameraDescriptor(
                id: device.uniqueID,
                name: device.localizedName,
                module: module,
                horizontalFieldOfViewDegrees: fieldOfView,
                supportsCustomExposure: supportsCustomExposure,
                supportsRAWPhoto: supportsRAWPhoto
            )
        }

        private nonisolated static func orientedHorizontalFieldOfView(
            landscapeDegrees: Double,
            plane: PixelPlane
        ) -> Double {
            guard plane.height > plane.width else { return landscapeDegrees }
            let landscapeAspect = Double(plane.height) / Double(plane.width)
            let landscapeRadians = landscapeDegrees * .pi / 180
            let portraitHorizontalRadians = 2 * atan(tan(landscapeRadians / 2) / landscapeAspect)
            return portraitHorizontalRadians * 180 / .pi
        }
    }

    private final class FrameCapturePhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate,
        @unchecked Sendable
    {
        private let camera: CameraDescriptor
        private let negotiation: NegotiatedFrameCapture
        private let completion: @Sendable (Result<CapturedFrame, any Error>) -> Void
        private let completionLock = NSLock()
        private var hasCompleted = false

        init(
            camera: CameraDescriptor,
            negotiation: NegotiatedFrameCapture,
            completion: @escaping @Sendable (Result<CapturedFrame, any Error>) -> Void
        ) {
            self.camera = camera
            self.negotiation = negotiation
            self.completion = completion
        }

        func photoOutput(
            _ output: AVCapturePhotoOutput,
            didFinishProcessingPhoto photo: AVCapturePhoto,
            error: (any Error)?
        ) {
            if let error {
                complete(.failure(error))
                return
            }
            guard let data = photo.fileDataRepresentation(), !data.isEmpty else {
                complete(.failure(MeterError.invalidSensorSample("encoded photo payload")))
                return
            }
            do {
                let dimensions: CapturedFrameDimensions?
                if let pixelBuffer = photo.pixelBuffer {
                    dimensions = try CapturedFrameDimensions(
                        width: CVPixelBufferGetWidth(pixelBuffer),
                        height: CVPixelBufferGetHeight(pixelBuffer)
                    )
                } else {
                    dimensions = nil
                }
                let payload: CapturedFramePayload
                switch negotiation.path {
                case .rawDNG:
                    #if os(iOS) || targetEnvironment(macCatalyst)
                        guard photo.isRawPhoto else {
                            throw MeterError.invalidSensorSample("expected RAW photo payload")
                        }
                        payload = .rawDNG(data)
                    #else
                        throw MeterError.capabilityUnavailable("RAW photo capture")
                    #endif
                case let .processed(codec):
                    #if os(iOS) || targetEnvironment(macCatalyst)
                        guard !photo.isRawPhoto else {
                            throw MeterError.invalidSensorSample("expected processed photo payload")
                        }
                    #endif
                    payload = .processedImage(data, codec: codec)
                }
                #if os(iOS) || targetEnvironment(macCatalyst)
                    let exposure = try Self.exposure(from: photo.metadata)
                #else
                    let exposure: ExposureSnapshot? = nil
                #endif
                complete(
                    .success(
                        try CapturedFrame(
                            payload: payload,
                            provenance: CapturedFrameProvenance(
                                capturedAt: Date(),
                                camera: camera,
                                negotiation: negotiation,
                                dimensions: dimensions,
                                exposure: exposure,
                                characterization: .uncharacterized
                            )
                        )))
            } catch {
                complete(.failure(error))
            }
        }

        func photoOutput(
            _ output: AVCapturePhotoOutput,
            didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
            error: (any Error)?
        ) {
            if let error { complete(.failure(error)) }
        }

        private func complete(_ result: Result<CapturedFrame, any Error>) {
            completionLock.lock()
            guard !hasCompleted else {
                completionLock.unlock()
                return
            }
            hasCompleted = true
            completionLock.unlock()
            completion(result)
        }

        private static func exposure(from metadata: [String: Any]) throws -> ExposureSnapshot? {
            guard
                let exif = metadata[kCGImagePropertyExifDictionary as String]
                    as? [String: Any]
            else {
                return nil
            }
            guard
                let seconds = (exif[kCGImagePropertyExifExposureTime as String] as? NSNumber)?
                    .doubleValue,
                let aperture = (exif[kCGImagePropertyExifFNumber as String] as? NSNumber)?
                    .doubleValue,
                let isoValues = exif[kCGImagePropertyExifISOSpeedRatings as String] as? [NSNumber],
                let iso = isoValues.first?.doubleValue,
                seconds > 0, aperture > 0, iso > 0
            else {
                return nil
            }
            return ExposureSnapshot(
                sensitivity: try Sensitivity(iso: iso),
                duration: try ExposureDuration(seconds: seconds),
                aperture: try Aperture(aperture)
            )
        }
    }
#endif
