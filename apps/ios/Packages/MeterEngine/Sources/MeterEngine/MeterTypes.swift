import Foundation
import PhotometryKit

public enum CameraAuthorization: String, Codable, Sendable {
    case notDetermined
    case authorized
    case denied
    case restricted
}

public enum CameraModule: String, Codable, CaseIterable, Sendable {
    case front
    case ultraWide
    case wide
    case telephoto
    case external
    case unknown
}

public enum SensorPath: String, Codable, Sendable {
    case aeMetadata
    case rawPatch
    case processedPatch
    case ambientSensor
    case manual
    case simulated
}

public enum AccuracyTier: String, Codable, Sendable {
    case calibrated
    case characterized
    case approximate
    case unknown
}

public enum IncidentReceptor: String, Codable, Sendable {
    case flat
    case dome

    public var conventionalConstant: Double {
        switch self {
        case .flat: 250
        case .dome: 330
        }
    }
}

public enum MeterMode: Hashable, Codable, Sendable {
    case reflectedAverage
    case reflectedSpot(nominalAngleDegrees: Double)
    case incident(receptor: IncidentReceptor)
}

public enum MeasurementGeometry: String, Codable, Sendable {
    case reflectedAverage = "reflected-average"
    case reflectedSpot = "reflected-spot"
    case incidentFlat = "incident-flat"
    case incidentDome = "incident-dome"
}

public enum MeterFlag: String, Codable, Comparable, Sendable {
    case approximate
    case calibrationMissing
    case calibrationMismatch
    case flareRisk
    case outOfRange
    case patchClipped
    case rawFallback

    public static func < (lhs: MeterFlag, rhs: MeterFlag) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

public enum ReadingRole: String, Codable, Sendable {
    case member
    case average
    case shadow
    case highlight
    case midtone
}

public struct CameraDescriptor: Hashable, Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let module: CameraModule
    public let horizontalFieldOfViewDegrees: Double?
    public let supportsCustomExposure: Bool
    public let supportsRAWPhoto: Bool

    public init(
        id: String,
        name: String,
        module: CameraModule,
        horizontalFieldOfViewDegrees: Double? = nil,
        supportsCustomExposure: Bool = false,
        supportsRAWPhoto: Bool = false
    ) {
        self.id = id
        self.name = name
        self.module = module
        self.horizontalFieldOfViewDegrees = horizontalFieldOfViewDegrees
        self.supportsCustomExposure = supportsCustomExposure
        self.supportsRAWPhoto = supportsRAWPhoto
    }
}

public struct ExposureSnapshot: Hashable, Codable, Sendable {
    public let sensitivity: Sensitivity
    public let duration: ExposureDuration
    public let aperture: Aperture

    public init(sensitivity: Sensitivity, duration: ExposureDuration, aperture: Aperture) {
        self.sensitivity = sensitivity
        self.duration = duration
        self.aperture = aperture
    }

    public var ev100: ExposureValue {
        ExposureMath.ev100(aperture: aperture, duration: duration, sensitivity: sensitivity)
    }
}

public struct SensorSample: Hashable, Codable, Sendable {
    public let capturedAt: Date
    public let camera: CameraDescriptor
    public let sensorPath: SensorPath
    public let exposure: ExposureSnapshot?
    public let illuminanceLux: Double?
    public let luminanceCandelaPerSquareMetre: Double?
    public let achievedSpotAngleDegrees: Double?
    public let flags: Set<MeterFlag>

    public init(
        capturedAt: Date,
        camera: CameraDescriptor,
        sensorPath: SensorPath,
        exposure: ExposureSnapshot? = nil,
        illuminanceLux: Double? = nil,
        luminanceCandelaPerSquareMetre: Double? = nil,
        achievedSpotAngleDegrees: Double? = nil,
        flags: Set<MeterFlag> = []
    ) {
        self.capturedAt = capturedAt
        self.camera = camera
        self.sensorPath = sensorPath
        self.exposure = exposure
        self.illuminanceLux = illuminanceLux
        self.luminanceCandelaPerSquareMetre = luminanceCandelaPerSquareMetre
        self.achievedSpotAngleDegrees = achievedSpotAngleDegrees
        self.flags = flags
    }
}

public struct SpotCaptureRequest: Hashable, Codable, Sendable {
    public let normalizedX: Double
    public let normalizedY: Double
    public let nominalAngleDegrees: Double
    public let preferRAW: Bool

    public init(
        normalizedX: Double = 0.5,
        normalizedY: Double = 0.5,
        nominalAngleDegrees: Double = 1,
        preferRAW: Bool = true
    ) throws {
        guard (0...1).contains(normalizedX), (0...1).contains(normalizedY),
            nominalAngleDegrees > 0, nominalAngleDegrees.isFinite
        else {
            throw MeterError.invalidConfiguration("spot capture geometry")
        }
        self.normalizedX = normalizedX
        self.normalizedY = normalizedY
        self.nominalAngleDegrees = nominalAngleDegrees
        self.preferRAW = preferRAW
    }
}

public struct CustomExposure: Hashable, Codable, Sendable {
    public let duration: ExposureDuration
    public let sensitivity: Sensitivity

    public init(duration: ExposureDuration, sensitivity: Sensitivity) {
        self.duration = duration
        self.sensitivity = sensitivity
    }
}

public struct SpotMeasurement: Hashable, Codable, Sendable {
    public let capturedAt: Date
    public let camera: CameraDescriptor
    public let sensorPath: SensorPath
    public let uncalibratedEV100: ExposureValue
    public let nominalAngleDegrees: Double
    public let achievedAngleDegrees: Double
    public let normalizedX: Double
    public let normalizedY: Double
    public let frameFallbackReason: FrameFallbackReason?
    public let flags: Set<MeterFlag>

    public init(
        capturedAt: Date,
        camera: CameraDescriptor,
        sensorPath: SensorPath,
        uncalibratedEV100: ExposureValue,
        nominalAngleDegrees: Double,
        achievedAngleDegrees: Double,
        normalizedX: Double = 0.5,
        normalizedY: Double = 0.5,
        frameFallbackReason: FrameFallbackReason? = nil,
        flags: Set<MeterFlag> = []
    ) {
        self.capturedAt = capturedAt
        self.camera = camera
        self.sensorPath = sensorPath
        self.uncalibratedEV100 = uncalibratedEV100
        self.nominalAngleDegrees = nominalAngleDegrees
        self.achievedAngleDegrees = achievedAngleDegrees
        self.normalizedX = normalizedX
        self.normalizedY = normalizedY
        self.frameFallbackReason = frameFallbackReason
        self.flags = flags
    }
}

public struct Reading: Hashable, Codable, Identifiable, Sendable {
    public let id: UUID
    public let takenAt: Date
    public let geometry: MeasurementGeometry
    public let ev100: ExposureValue
    public let illuminance: Illuminance?
    public let luminance: Luminance?
    public let exposure: ExposureSnapshot?
    public let camera: CameraDescriptor
    public let sensorPath: SensorPath
    public let accuracyTier: AccuracyTier
    public let calibrationID: UUID?
    public let calibrationConstant: Double
    public let nominalSpotAngleDegrees: Double?
    public let achievedSpotAngleDegrees: Double?
    public let flags: Set<MeterFlag>
    public let role: ReadingRole
    public let averagedFrom: [UUID]

    public init(
        id: UUID = UUID(),
        takenAt: Date,
        geometry: MeasurementGeometry,
        ev100: ExposureValue,
        illuminance: Illuminance? = nil,
        luminance: Luminance? = nil,
        exposure: ExposureSnapshot? = nil,
        camera: CameraDescriptor,
        sensorPath: SensorPath,
        accuracyTier: AccuracyTier,
        calibrationID: UUID? = nil,
        calibrationConstant: Double,
        nominalSpotAngleDegrees: Double? = nil,
        achievedSpotAngleDegrees: Double? = nil,
        flags: Set<MeterFlag> = [],
        role: ReadingRole = .member,
        averagedFrom: [UUID] = []
    ) {
        self.id = id
        self.takenAt = takenAt
        self.geometry = geometry
        self.ev100 = ev100
        self.illuminance = illuminance
        self.luminance = luminance
        self.exposure = exposure
        self.camera = camera
        self.sensorPath = sensorPath
        self.accuracyTier = accuracyTier
        self.calibrationID = calibrationID
        self.calibrationConstant = calibrationConstant
        self.nominalSpotAngleDegrees = nominalSpotAngleDegrees
        self.achievedSpotAngleDegrees = achievedSpotAngleDegrees
        self.flags = flags
        self.role = role
        self.averagedFrom = averagedFrom
    }
}

/// The complete result of one deliberate meter capture.
///
/// A single-sample capture has no `constituents`; `reading` is the sample itself. An averaged
/// capture carries every member sample alongside the aggregate so persistence clients can create
/// the member records before creating an aggregate that references them.
public struct MeterCapture: Hashable, Codable, Sendable {
    public let reading: Reading
    public let constituents: [Reading]

    public init(reading: Reading, constituents: [Reading] = []) throws {
        if reading.role == .average {
            let constituentIDs = constituents.map(\.id)
            guard constituents.count > 1,
                Set(constituentIDs).count == constituentIDs.count,
                constituentIDs == reading.averagedFrom,
                constituents.allSatisfy({ $0.role == .member && $0.averagedFrom.isEmpty })
            else {
                throw MeterError.invalidConfiguration(
                    "an averaged capture must contain each member reading in reference order"
                )
            }
        } else {
            guard constituents.isEmpty, reading.averagedFrom.isEmpty else {
                throw MeterError.invalidConfiguration(
                    "a single capture cannot contain averaging members"
                )
            }
        }
        self.reading = reading
        self.constituents = constituents
    }

    /// Every semantic record required to preserve the capture, in dependency order.
    public var records: [Reading] {
        constituents + [reading]
    }
}

public struct MeterConfiguration: Hashable, Codable, Sendable {
    public var mode: MeterMode
    public var averagingCount: Int
    public var samplingInterval: Duration
    public var calibratedEVRange: ClosedRange<Double>
    public var spotPointX: Double
    public var spotPointY: Double

    public init(
        mode: MeterMode = .reflectedAverage,
        averagingCount: Int = 1,
        samplingInterval: Duration = .milliseconds(100),
        calibratedEVRange: ClosedRange<Double> = -5...22.9,
        spotPointX: Double = 0.5,
        spotPointY: Double = 0.5
    ) throws {
        guard averagingCount > 0, (0...1).contains(spotPointX), (0...1).contains(spotPointY) else {
            throw MeterError.invalidConfiguration("averaging count or spot point")
        }
        self.mode = mode
        self.averagingCount = averagingCount
        self.samplingInterval = samplingInterval
        self.calibratedEVRange = calibratedEVRange
        self.spotPointX = spotPointX
        self.spotPointY = spotPointY
    }
}

public enum MeterError: Error, Equatable, Sendable {
    case authorizationDenied
    case cameraNotFound(String)
    case invalidConfiguration(String)
    case invalidSensorSample(String)
    case capabilityUnavailable(String)
    case traceExhausted
}

public protocol MeterSensor: Sendable {
    func authorizationStatus() async -> CameraAuthorization
    func requestAuthorization() async -> Bool
    func discoverCameras() async throws -> [CameraDescriptor]
    func selectCamera(id: String) async throws
    func samples(interval: Duration) async throws -> AsyncThrowingStream<SensorSample, any Error>
    func lockExposure(_ exposure: CustomExposure?) async throws
    func unlockExposure() async throws
    func captureSpot(_ request: SpotCaptureRequest) async throws -> SpotMeasurement
    func stop() async
}

public protocol MeterService: Sendable {
    func authorizationStatus() async -> CameraAuthorization
    func requestAuthorization() async -> Bool
    func readings(configuration: MeterConfiguration) async throws
        -> AsyncThrowingStream<Reading, any Error>
    func capture(configuration: MeterConfiguration) async throws -> Reading
    func captureBatch(configuration: MeterConfiguration) async throws -> MeterCapture
}

public extension MeterService {
    /// Non-camera test and preview services may opt into the already-authorized default.
    func authorizationStatus() async -> CameraAuthorization { .authorized }
    func requestAuthorization() async -> Bool { true }

    /// Source-compatible default for services that only produce a single reading per capture.
    /// Services that support averaging must return the complete capture explicitly.
    func captureBatch(configuration: MeterConfiguration) async throws -> MeterCapture {
        let reading = try await capture(configuration: configuration)
        return try MeterCapture(reading: reading)
    }
}
