import Foundation

public enum FrameCapturePreference: String, Codable, Sendable {
    case preferRAW
    case requireRAW
    case processedOnly
}

public enum ProcessedFrameCodec: String, Codable, CaseIterable, Sendable {
    case heif
    case jpeg
}

public struct FrameCaptureCapabilities: Hashable, Codable, Sendable {
    public let rawPixelFormatTypes: [UInt32]
    public let processedCodecs: [ProcessedFrameCodec]

    public init(
        rawPixelFormatTypes: [UInt32] = [],
        processedCodecs: [ProcessedFrameCodec] = []
    ) {
        self.rawPixelFormatTypes = rawPixelFormatTypes
        self.processedCodecs = processedCodecs
    }

    public var supportsRAW: Bool { !rawPixelFormatTypes.isEmpty }
    public var supportsProcessed: Bool { !processedCodecs.isEmpty }
}

public enum FrameCapturePath: Hashable, Codable, Sendable {
    case rawDNG(pixelFormatType: UInt32)
    case processed(codec: ProcessedFrameCodec)

    public var sensorPath: SensorPath {
        switch self {
        case .rawDNG: .rawPatch
        case .processed: .processedPatch
        }
    }
}

public enum FrameFallbackReason: String, Hashable, Codable, Sendable {
    case rawUnavailable
    case rawDecodingUnavailable
}

public struct NegotiatedFrameCapture: Hashable, Codable, Sendable {
    public let path: FrameCapturePath
    public let fallbackReason: FrameFallbackReason?

    public init(path: FrameCapturePath, fallbackReason: FrameFallbackReason? = nil) {
        self.path = path
        self.fallbackReason = fallbackReason
    }
}

public enum FrameCaptureNegotiator {
    /// Selects a capture path without hiding a RAW-to-processed fallback.
    ///
    /// The capability order comes from the capture device. JPEG is preferred when the caller
    /// requests processed capture because it has the broadest deterministic decoding path.
    public static func negotiate(
        preference: FrameCapturePreference,
        capabilities: FrameCaptureCapabilities
    ) throws -> NegotiatedFrameCapture {
        func processed() throws -> FrameCapturePath {
            if capabilities.processedCodecs.contains(.jpeg) {
                return .processed(codec: .jpeg)
            }
            if capabilities.processedCodecs.contains(.heif) {
                return .processed(codec: .heif)
            }
            throw MeterError.capabilityUnavailable("processed photo capture")
        }

        switch preference {
        case .requireRAW:
            guard let pixelFormat = capabilities.rawPixelFormatTypes.first else {
                throw MeterError.capabilityUnavailable("RAW photo capture")
            }
            return NegotiatedFrameCapture(path: .rawDNG(pixelFormatType: pixelFormat))

        case .preferRAW:
            if let pixelFormat = capabilities.rawPixelFormatTypes.first {
                return NegotiatedFrameCapture(path: .rawDNG(pixelFormatType: pixelFormat))
            }
            return try NegotiatedFrameCapture(
                path: processed(),
                fallbackReason: .rawUnavailable
            )

        case .processedOnly:
            return try NegotiatedFrameCapture(path: processed())
        }
    }
}

public struct CapturedFrameDimensions: Hashable, Codable, Sendable {
    public let width: Int
    public let height: Int

    public init(width: Int, height: Int) throws {
        guard width > 0, height > 0 else {
            throw MeterError.invalidSensorSample("captured frame dimensions")
        }
        self.width = width
        self.height = height
    }
}

public enum CapturedFramePayload: Hashable, Sendable {
    /// A DNG container produced by AVFoundation. Bayer interpretation requires its metadata.
    case rawDNG(Data)
    /// A platform-encoded processed image. The codec is repeated in provenance for inspection.
    case processedImage(Data, codec: ProcessedFrameCodec)

    public var data: Data {
        switch self {
        case let .rawDNG(data), let .processedImage(data, _): data
        }
    }
}

public enum FrameCharacterization: Hashable, Codable, Sendable {
    case uncharacterized
    case characterized(profileID: UUID)
}

public struct CapturedFrameProvenance: Hashable, Codable, Sendable {
    public let capturedAt: Date
    public let camera: CameraDescriptor
    public let negotiation: NegotiatedFrameCapture
    public let dimensions: CapturedFrameDimensions?
    /// Exposure recorded by the still-photo payload. This is preferred over sampling the live
    /// device after capture because still-photo processing may use a different exposure.
    public let exposure: ExposureSnapshot?
    public let characterization: FrameCharacterization

    public init(
        capturedAt: Date,
        camera: CameraDescriptor,
        negotiation: NegotiatedFrameCapture,
        dimensions: CapturedFrameDimensions?,
        exposure: ExposureSnapshot? = nil,
        characterization: FrameCharacterization = .uncharacterized
    ) {
        self.capturedAt = capturedAt
        self.camera = camera
        self.negotiation = negotiation
        self.dimensions = dimensions
        self.exposure = exposure
        self.characterization = characterization
    }

    public var sensorPath: SensorPath { negotiation.path.sensorPath }

    /// An uncharacterized frame remains useful for testing and later analysis, but it must not
    /// be presented as a calibrated meter reading.
    public var isEligibleForCalibratedReading: Bool {
        if case .characterized = characterization { return true }
        return false
    }
}

public struct CapturedFrame: Hashable, Sendable {
    public let payload: CapturedFramePayload
    public let provenance: CapturedFrameProvenance

    public init(payload: CapturedFramePayload, provenance: CapturedFrameProvenance) throws {
        guard !payload.data.isEmpty else {
            throw MeterError.invalidSensorSample("empty captured frame")
        }
        switch (payload, provenance.negotiation.path) {
        case (.rawDNG, .rawDNG), (.processedImage, .processed): break
        default: throw MeterError.invalidSensorSample("frame payload and provenance disagree")
        }
        if case let .processedImage(_, payloadCodec) = payload,
            case let .processed(provenanceCodec) = provenance.negotiation.path,
            payloadCodec != provenanceCodec
        {
            throw MeterError.invalidSensorSample("processed frame codecs disagree")
        }
        self.payload = payload
        self.provenance = provenance
    }
}

public protocol MeterFrameCapturing: Sendable {
    func frameCaptureCapabilities() async throws -> FrameCaptureCapabilities
    func captureFrame(preference: FrameCapturePreference) async throws -> CapturedFrame
}
