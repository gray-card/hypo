import Foundation
import MeterEngine

/// Device telemetry that is useful for reproducing or interpreting a meter capture but is too
/// sensitive and device-specific for the public AT Protocol repository record.
///
/// A private context is never encoded into `app.graycard.meter.reading`. Its stable relationship
/// to that public projection is kept only in the user's private store.
public struct PrivateMeterCaptureContext: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let readingID: UUID
    public let publicReadingURI: String
    /// The meter engine's reading time, retained for linkage to the public projection.
    public let capturedAt: Date
    /// The time Hypo assembled this private context after the public write completed.
    public let contextCollectedAt: Date
    /// The wall-clock estimate for the Core Motion sample, which has its own uptime timestamp.
    public let motionSampledAt: Date?
    public let device: PrivateMeterDeviceContext
    public let camera: PrivateMeterCameraContext
    public let attitude: PrivateMeterAttitude?
    public let gravity: PrivateMeterVector?
    public let userAcceleration: PrivateMeterVector?
    public let rotationRate: PrivateMeterVector?
    public let magneticField: PrivateMeterMagneticField?
    public let headingDegrees: Double?
    public let location: PrivateMeterLocation?

    private enum CodingKeys: String, CodingKey {
        case id
        case readingID
        case publicReadingURI
        case capturedAt
        case contextCollectedAt
        case motionSampledAt
        case device
        case camera
        case attitude
        case gravity
        case userAcceleration
        case rotationRate
        case magneticField
        case headingDegrees
        case location
    }

    public init(
        id: UUID = UUID(),
        readingID: UUID,
        publicReadingURI: String,
        capturedAt: Date,
        contextCollectedAt: Date? = nil,
        motionSampledAt: Date? = nil,
        device: PrivateMeterDeviceContext,
        camera: PrivateMeterCameraContext,
        attitude: PrivateMeterAttitude? = nil,
        gravity: PrivateMeterVector? = nil,
        userAcceleration: PrivateMeterVector? = nil,
        rotationRate: PrivateMeterVector? = nil,
        magneticField: PrivateMeterMagneticField? = nil,
        headingDegrees: Double? = nil,
        location: PrivateMeterLocation? = nil
    ) {
        self.id = id
        self.readingID = readingID
        self.publicReadingURI = publicReadingURI
        self.capturedAt = capturedAt
        self.contextCollectedAt = contextCollectedAt ?? capturedAt
        self.motionSampledAt = motionSampledAt
        self.device = device
        self.camera = camera
        self.attitude = attitude
        self.gravity = gravity
        self.userAcceleration = userAcceleration
        self.rotationRate = rotationRate
        self.magneticField = magneticField
        self.headingDegrees = headingDegrees
        self.location = location
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        readingID = try container.decode(UUID.self, forKey: .readingID)
        publicReadingURI = try container.decode(String.self, forKey: .publicReadingURI)
        capturedAt = try container.decode(Date.self, forKey: .capturedAt)
        contextCollectedAt =
            try container.decodeIfPresent(Date.self, forKey: .contextCollectedAt) ?? capturedAt
        motionSampledAt = try container.decodeIfPresent(Date.self, forKey: .motionSampledAt)
        device = try container.decode(PrivateMeterDeviceContext.self, forKey: .device)
        camera = try container.decode(PrivateMeterCameraContext.self, forKey: .camera)
        attitude = try container.decodeIfPresent(PrivateMeterAttitude.self, forKey: .attitude)
        gravity = try container.decodeIfPresent(PrivateMeterVector.self, forKey: .gravity)
        userAcceleration = try container.decodeIfPresent(
            PrivateMeterVector.self,
            forKey: .userAcceleration
        )
        rotationRate = try container.decodeIfPresent(
            PrivateMeterVector.self,
            forKey: .rotationRate
        )
        magneticField = try container.decodeIfPresent(
            PrivateMeterMagneticField.self,
            forKey: .magneticField
        )
        headingDegrees = try container.decodeIfPresent(Double.self, forKey: .headingDegrees)
        location = try container.decodeIfPresent(PrivateMeterLocation.self, forKey: .location)
    }
}

public struct PrivateMeterDeviceContext: Codable, Hashable, Sendable {
    public let modelIdentifier: String
    public let operatingSystemVersion: String
    public let appVersion: String
    public let deviceOrientation: String?

    public init(
        modelIdentifier: String,
        operatingSystemVersion: String,
        appVersion: String,
        deviceOrientation: String? = nil
    ) {
        self.modelIdentifier = modelIdentifier
        self.operatingSystemVersion = operatingSystemVersion
        self.appVersion = appVersion
        self.deviceOrientation = deviceOrientation
    }
}

public struct PrivateMeterCameraContext: Codable, Hashable, Sendable {
    public let uniqueID: String
    public let name: String
    public let module: String
    public let sensorPath: String
    public let lensPosition: Double?
    public let fieldOfViewDegrees: Double?

    public init(
        uniqueID: String,
        name: String,
        module: String,
        sensorPath: String,
        lensPosition: Double? = nil,
        fieldOfViewDegrees: Double? = nil
    ) {
        self.uniqueID = uniqueID
        self.name = name
        self.module = module
        self.sensorPath = sensorPath
        self.lensPosition = lensPosition
        self.fieldOfViewDegrees = fieldOfViewDegrees
    }
}

public struct PrivateMeterVector: Codable, Hashable, Sendable {
    public let x: Double
    public let y: Double
    public let z: Double

    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
}

public struct PrivateMeterAttitude: Codable, Hashable, Sendable {
    public let rollRadians: Double
    public let pitchRadians: Double
    public let yawRadians: Double
    public let quaternionX: Double
    public let quaternionY: Double
    public let quaternionZ: Double
    public let quaternionW: Double

    public init(
        rollRadians: Double,
        pitchRadians: Double,
        yawRadians: Double,
        quaternionX: Double,
        quaternionY: Double,
        quaternionZ: Double,
        quaternionW: Double
    ) {
        self.rollRadians = rollRadians
        self.pitchRadians = pitchRadians
        self.yawRadians = yawRadians
        self.quaternionX = quaternionX
        self.quaternionY = quaternionY
        self.quaternionZ = quaternionZ
        self.quaternionW = quaternionW
    }
}

public struct PrivateMeterMagneticField: Codable, Hashable, Sendable {
    public let microtesla: PrivateMeterVector
    public let accuracy: String

    public init(microtesla: PrivateMeterVector, accuracy: String) {
        self.microtesla = microtesla
        self.accuracy = accuracy
    }
}

public struct PrivateMeterLocation: Codable, Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let altitudeMetres: Double
    public let horizontalAccuracyMetres: Double
    public let verticalAccuracyMetres: Double
    public let speedMetresPerSecond: Double?
    public let speedAccuracyMetresPerSecond: Double?
    public let courseDegrees: Double?
    public let courseAccuracyDegrees: Double?
    public let floor: Int?
    public let isSimulated: Bool?
    public let isProducedByAccessory: Bool?
    public let capturedAt: Date

    public init(
        latitude: Double,
        longitude: Double,
        altitudeMetres: Double,
        horizontalAccuracyMetres: Double,
        verticalAccuracyMetres: Double,
        speedMetresPerSecond: Double? = nil,
        speedAccuracyMetresPerSecond: Double? = nil,
        courseDegrees: Double? = nil,
        courseAccuracyDegrees: Double? = nil,
        floor: Int? = nil,
        isSimulated: Bool? = nil,
        isProducedByAccessory: Bool? = nil,
        capturedAt: Date
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.altitudeMetres = altitudeMetres
        self.horizontalAccuracyMetres = horizontalAccuracyMetres
        self.verticalAccuracyMetres = verticalAccuracyMetres
        self.speedMetresPerSecond = speedMetresPerSecond
        self.speedAccuracyMetresPerSecond = speedAccuracyMetresPerSecond
        self.courseDegrees = courseDegrees
        self.courseAccuracyDegrees = courseAccuracyDegrees
        self.floor = floor
        self.isSimulated = isSimulated
        self.isProducedByAccessory = isProducedByAccessory
        self.capturedAt = capturedAt
    }
}

public struct PrivateMeterCaptureSettings: Codable, Equatable, Sendable {
    public var captureEnabled: Bool
    public var preciseLocationEnabled: Bool
    public var privateCloudSyncEnabled: Bool
    public var privateCloudAccountIdentifier: String?

    public init(
        captureEnabled: Bool = false,
        preciseLocationEnabled: Bool = false,
        privateCloudSyncEnabled: Bool = false,
        privateCloudAccountIdentifier: String? = nil
    ) {
        self.captureEnabled = captureEnabled
        self.preciseLocationEnabled = preciseLocationEnabled
        self.privateCloudSyncEnabled = privateCloudSyncEnabled
        self.privateCloudAccountIdentifier = privateCloudAccountIdentifier
    }
}

public protocol PrivateMeterCaptureContextCollecting: Sendable {
    func context(
        for reading: Reading,
        publicReadingURI: String,
        includePreciseLocation: Bool
    ) async throws -> PrivateMeterCaptureContext
}

public protocol PrivateMeterCaptureContextStoring: Sendable {
    /// Returns true when live private data may remain locally, without decrypting payloads. A
    /// corrupt store returns true so deletion stays available even when the data key is missing.
    func containsLocalPrivateData() async -> Bool
    func contexts() async throws -> [PrivateMeterCaptureContext]
    func save(
        _ context: PrivateMeterCaptureContext,
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws
    func delete(
        id: UUID,
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws
    func deleteAll(
        syncToPrivateCloud: Bool,
        expectedCloudAccountIdentifier: String?
    ) async throws
    func privateCloudAccountIdentifier() async throws -> String
    func synchronizePrivateCloud(expectedCloudAccountIdentifier: String?) async throws
    func exportJSON() async throws -> Data
}

extension PrivateMeterCaptureContextStoring {
    public func save(
        _ context: PrivateMeterCaptureContext,
        syncToPrivateCloud: Bool
    ) async throws {
        try await save(
            context,
            syncToPrivateCloud: syncToPrivateCloud,
            expectedCloudAccountIdentifier: nil
        )
    }

    public func delete(id: UUID, syncToPrivateCloud: Bool) async throws {
        try await delete(
            id: id,
            syncToPrivateCloud: syncToPrivateCloud,
            expectedCloudAccountIdentifier: nil
        )
    }

    public func deleteAll(syncToPrivateCloud: Bool) async throws {
        try await deleteAll(
            syncToPrivateCloud: syncToPrivateCloud,
            expectedCloudAccountIdentifier: nil
        )
    }

    public func synchronizePrivateCloud() async throws {
        try await synchronizePrivateCloud(expectedCloudAccountIdentifier: nil)
    }
}

public protocol PrivateMeterCaptureSettingsStoring: Sendable {
    func settings() async throws -> PrivateMeterCaptureSettings
    func save(_ settings: PrivateMeterCaptureSettings) async throws
}

public struct UnavailablePrivateMeterCaptureContextCollector:
    PrivateMeterCaptureContextCollecting
{
    public init() {}

    public func context(
        for _: Reading,
        publicReadingURI _: String,
        includePreciseLocation _: Bool
    ) async throws -> PrivateMeterCaptureContext {
        throw PrivateMeterCaptureError.captureUnavailable
    }
}

public actor InMemoryPrivateMeterCaptureContextStore: PrivateMeterCaptureContextStoring {
    private var saved: [PrivateMeterCaptureContext]

    public init(contexts: [PrivateMeterCaptureContext] = []) {
        saved = contexts
    }

    public func containsLocalPrivateData() -> Bool { !saved.isEmpty }

    public func contexts() -> [PrivateMeterCaptureContext] {
        saved.sorted { $0.capturedAt > $1.capturedAt }
    }

    public func save(
        _ context: PrivateMeterCaptureContext,
        syncToPrivateCloud _: Bool,
        expectedCloudAccountIdentifier _: String?
    ) {
        saved.removeAll { $0.id == context.id }
        saved.append(context)
    }

    public func delete(
        id: UUID,
        syncToPrivateCloud _: Bool,
        expectedCloudAccountIdentifier _: String?
    ) {
        saved.removeAll { $0.id == id }
    }

    public func deleteAll(
        syncToPrivateCloud _: Bool,
        expectedCloudAccountIdentifier _: String?
    ) {
        saved.removeAll()
    }

    public func privateCloudAccountIdentifier() -> String { "in-memory-private-cloud" }

    public func synchronizePrivateCloud(expectedCloudAccountIdentifier _: String?) {}

    public func exportJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(contexts())
    }
}

public actor InMemoryPrivateMeterCaptureSettingsStore: PrivateMeterCaptureSettingsStoring {
    private var value: PrivateMeterCaptureSettings

    public init(settings: PrivateMeterCaptureSettings = PrivateMeterCaptureSettings()) {
        value = settings
    }

    public func settings() -> PrivateMeterCaptureSettings { value }

    public func save(_ settings: PrivateMeterCaptureSettings) {
        value = settings
    }
}

/// A small durable store for the three explicit privacy choices. The telemetry itself lives in
/// `EncryptedPrivateMeterCaptureContextStore`; this file never contains capture data.
public actor FilePrivateMeterCaptureSettingsStore: PrivateMeterCaptureSettingsStoring {
    private let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func settings() throws -> PrivateMeterCaptureSettings {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return PrivateMeterCaptureSettings()
        }
        return try JSONDecoder().decode(
            PrivateMeterCaptureSettings.self,
            from: Data(contentsOf: fileURL)
        )
    }

    public func save(_ settings: PrivateMeterCaptureSettings) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder().encode(settings).write(
            to: fileURL,
            options: privateMeterCaptureWriteOptions
        )
    }
}

var privateMeterCaptureWriteOptions: Data.WritingOptions {
    #if os(iOS) || os(tvOS) || os(watchOS) || os(visionOS)
        [.atomic, .completeFileProtection]
    #else
        [.atomic]
    #endif
}

public enum PrivateMeterCaptureError: Error, Equatable, Sendable {
    case captureUnavailable
    case preciseLocationDenied
    case keyUnavailable
    case corruptLocalStore
    case privateCloudKeyUnavailable
    case privateCloudKeyMismatch
    case privateCloudAccountChanged
    case privateCloudAccountChangedAfterLocalSave
    case privateCloudAccountChangedAfterLocalDeletion
    case privateContextAlreadyDeleted
    case privateCloudSaveFailedAfterLocalSave(String)
    case privateCloudDeletionPending(String)
    case privateCloudUnavailable(String)
}
