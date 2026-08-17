import Foundation
import HypoLexicon

public struct ActiveRoll: Hashable, Sendable {
    public let uri: ATURI
    public var label: String
    public var stockName: String
    public var exposureIndex: Int?
    public var exposuresTotal: Int?
    public var exposuresUsed: Int
    public var camera: ATURI?
    public var cameraName: String?
    public var lensName: String?
    public var milestones: FilmRollMilestones
    public var developmentLocation: FilmRollDevelopmentLocation?

    public init(
        uri: ATURI,
        label: String,
        stockName: String,
        exposureIndex: Int? = nil,
        exposuresTotal: Int? = nil,
        exposuresUsed: Int = 0,
        camera: ATURI? = nil,
        cameraName: String? = nil,
        lensName: String? = nil,
        milestones: FilmRollMilestones = FilmRollMilestones(),
        developmentLocation: FilmRollDevelopmentLocation? = nil
    ) {
        self.uri = uri
        self.label = label
        self.stockName = stockName
        self.exposureIndex = exposureIndex
        self.exposuresTotal = exposuresTotal
        self.exposuresUsed = exposuresUsed
        self.camera = camera
        self.cameraName = cameraName
        self.lensName = lensName
        self.milestones = milestones
        self.developmentLocation = developmentLocation
    }

    public var nextFrameNumber: Int { exposuresUsed + 1 }
}

/// Read boundary for rolls that are currently available to the field logger.
/// Implementations may hydrate from the user's PDS or return the last valid local cache.
public protocol ActiveRollProviding: Sendable {
    func activeRolls() async throws -> [ActiveRoll]
}

/// The values exposed by the quick-log dials for the selected camera and lens.
/// Composition should derive these from the user's gear records when those records
/// describe narrower ranges than the standard photographic scales.
public struct ExposureControlOptions: Hashable, Sendable {
    public let apertures: [String]
    public let shutterSpeeds: [String]

    public init(
        apertures: [String] = Self.standardApertures,
        shutterSpeeds: [String] = Self.standardShutterSpeeds
    ) {
        self.apertures = Self.normalized(apertures, fallback: Self.standardApertures)
        self.shutterSpeeds = Self.normalized(
            shutterSpeeds,
            fallback: Self.standardShutterSpeeds
        )
    }

    public static let standardApertures = [
        "1", "1.4", "2", "2.8", "4", "5.6", "8", "11", "16", "22", "32",
    ]
    public static let standardShutterSpeeds = [
        "1/1000", "1/500", "1/250", "1/125", "1/60", "1/30", "1/15", "1/8",
        "1/4", "1/2", "1", "2", "4",
    ]

    private static func normalized(_ values: [String], fallback: [String]) -> [String] {
        var seen = Set<String>()
        let values = values.filter { !$0.isEmpty && seen.insert($0).inserted }
        return values.isEmpty ? fallback : values
    }
}

public struct ExposureDraft: Hashable, Sendable {
    public var roll: ATURI
    public var shoot: ATURI?
    public var frameNumber: Int
    public var aperture: String
    public var shutterSpeed: String
    public var camera: ATURI?
    public var lens: ATURI?
    public var shotAtISO: Int?
    public var note: String
    public var multipleExposure: Bool
    public var frameExposureIndex: Int?
    public var meterReadings: [ATURI]
    public var location: AppGraycardDefsGeoLocation?

    public init(
        roll: ATURI,
        frameNumber: Int,
        shoot: ATURI? = nil,
        aperture: String = "5.6",
        shutterSpeed: String = "1/125",
        camera: ATURI? = nil,
        lens: ATURI? = nil,
        shotAtISO: Int? = nil,
        note: String = "",
        multipleExposure: Bool = false,
        frameExposureIndex: Int? = nil,
        meterReadings: [ATURI] = [],
        location: AppGraycardDefsGeoLocation? = nil
    ) {
        self.roll = roll
        self.frameNumber = frameNumber
        self.shoot = shoot
        self.aperture = aperture
        self.shutterSpeed = shutterSpeed
        self.camera = camera
        self.lens = lens
        self.shotAtISO = shotAtISO
        self.note = note
        self.multipleExposure = multipleExposure
        self.frameExposureIndex = frameExposureIndex
        self.meterReadings = meterReadings
        self.location = location
    }

    public func record(createdAt: ATProtoDate) throws -> Data {
        try record(createdAt: createdAt, takenAt: createdAt)
    }

    public func record(
        createdAt: ATProtoDate,
        takenAt: ATProtoDate?,
        updatedAt: ATProtoDate? = nil
    ) throws -> Data {
        guard frameNumber >= 0 else { throw LoggerError.invalidFrameNumber(frameNumber) }
        guard !aperture.isEmpty, aperture.utf8.count <= 16 else {
            throw LoggerError.invalidAperture(aperture)
        }
        guard !shutterSpeed.isEmpty, shutterSpeed.utf8.count <= 16 else {
            throw LoggerError.invalidShutterSpeed(shutterSpeed)
        }
        guard note.utf8.count <= 1_000 else { throw LoggerError.noteTooLong }
        guard shotAtISO.map({ $0 >= 1 }) ?? true else { throw LoggerError.invalidISO(shotAtISO ?? 0) }
        guard meterReadings.count <= 16 else { throw LoggerError.tooManyMeterReadings }
        if multipleExposure, let index = frameExposureIndex, index < 1 {
            throw LoggerError.invalidMultipleExposureIndex(index)
        }

        let record = ExposureWireRecord(
            type: GraycardNSID.exposure.rawValue,
            shoot: shoot,
            roll: roll,
            frameNumber: frameNumber,
            multipleExposure: multipleExposure ? true : nil,
            frameExposureIndex: multipleExposure ? (frameExposureIndex ?? 1) : nil,
            camera: camera,
            lens: lens,
            aperture: aperture,
            shutterSpeed: shutterSpeed,
            meterReadings: meterReadings.isEmpty ? nil : meterReadings,
            shotAtISO: shotAtISO,
            location: location,
            takenAt: takenAt,
            note: note.isEmpty ? nil : note,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(record)
    }
}

private struct ExposureWireRecord: Codable {
    let type: String
    let shoot: ATURI?
    let roll: ATURI
    let frameNumber: Int
    let multipleExposure: Bool?
    let frameExposureIndex: Int?
    let camera: ATURI?
    let lens: ATURI?
    let aperture: String
    let shutterSpeed: String
    let meterReadings: [ATURI]?
    let shotAtISO: Int?
    let location: AppGraycardDefsGeoLocation?
    let takenAt: ATProtoDate?
    let note: String?
    let createdAt: ATProtoDate
    let updatedAt: ATProtoDate?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case shoot
        case roll
        case frameNumber
        case multipleExposure
        case frameExposureIndex
        case camera
        case lens
        case aperture
        case shutterSpeed
        case meterReadings
        case shotAtISO = "shotAtIso"
        case location
        case takenAt
        case note
        case createdAt
        case updatedAt
    }
}

public struct ShootAssociation: Identifiable, Hashable, Sendable {
    public let uri: ATURI
    public var label: String

    public init(uri: ATURI, label: String) {
        self.uri = uri
        self.label = label
    }

    public var id: ATURI { uri }
}

/// Permission and sensor boundary for the logger's per-shoot location opt-in.
/// The model never calls either method until the person explicitly enables
/// location capture for the currently selected shoot.
public protocol ShootLocationProviding: Sendable {
    func requestWhenInUseAuthorization() async -> Bool
    func currentLocation() async throws -> AppGraycardDefsGeoLocation
}

public enum FilmRollDevelopmentLocation: String, CaseIterable, Codable, Hashable, Sendable {
    case home
    case lab
    case other
}

public enum FilmRollLifecycleAction: String, CaseIterable, Identifiable, Hashable, Sendable {
    case loaded
    case firstExposure
    case finished
    case unloaded
    case sentToLab
    case developmentStarted
    case developedAtHome
    case receivedFromLab
    case scanned
    case archived

    public var id: String { rawValue }

    public func applying(
        to milestones: FilmRollMilestones,
        at date: ATProtoDate
    ) -> FilmRollLifecycleChange {
        var updated = milestones
        var location: FilmRollDevelopmentLocation?
        switch self {
        case .loaded:
            updated.loadedAt = date
        case .firstExposure:
            updated.partialAt = date
        case .finished:
            updated.exposedAt = date
        case .unloaded:
            updated.unloadedAt = date
        case .sentToLab:
            updated.sentToLabAt = date
            location = .lab
        case .developmentStarted:
            updated.developmentStartedAt = date
        case .developedAtHome:
            updated.developedAt = date
            location = .home
        case .receivedFromLab:
            updated.receivedFromLabAt = date
            location = .lab
        case .scanned:
            updated.scannedAt = date
        case .archived:
            updated.archivedAt = date
        }
        return FilmRollLifecycleChange(milestones: updated, developmentLocation: location)
    }

    public func date(in milestones: FilmRollMilestones) -> ATProtoDate? {
        switch self {
        case .loaded: milestones.loadedAt
        case .firstExposure: milestones.partialAt
        case .finished: milestones.exposedAt
        case .unloaded: milestones.unloadedAt
        case .sentToLab: milestones.sentToLabAt
        case .developmentStarted: milestones.developmentStartedAt
        case .developedAtHome: milestones.developedAt
        case .receivedFromLab: milestones.receivedFromLabAt
        case .scanned: milestones.scannedAt
        case .archived: milestones.archivedAt
        }
    }
}

public struct FilmRollLifecycleChange: Hashable, Sendable {
    public var milestones: FilmRollMilestones
    public var developmentLocation: FilmRollDevelopmentLocation?

    public init(
        milestones: FilmRollMilestones,
        developmentLocation: FilmRollDevelopmentLocation? = nil
    ) {
        self.milestones = milestones
        self.developmentLocation = developmentLocation
    }
}

/// A semantic update boundary. Implementations merge these fields into the current roll so
/// an edit never drops fields or Panproto complements that this feature does not understand.
public struct FilmRollLifecycleUpdate: Hashable, Sendable {
    public let roll: ATURI
    public let milestones: FilmRollMilestones
    public let developmentLocation: FilmRollDevelopmentLocation?
    public let updatedAt: ATProtoDate

    public init(
        roll: ATURI,
        milestones: FilmRollMilestones,
        developmentLocation: FilmRollDevelopmentLocation?,
        updatedAt: ATProtoDate
    ) {
        self.roll = roll
        self.milestones = milestones
        self.developmentLocation = developmentLocation
        self.updatedAt = updatedAt
    }
}

public protocol FilmRollLifecycleWriting: Sendable {
    func updateFilmRollLifecycle(_ update: FilmRollLifecycleUpdate) async throws
}

public struct ExposureDetail: Identifiable, Hashable, Sendable {
    public let uri: ATURI
    public var draft: ExposureDraft
    public let createdAt: ATProtoDate
    public var takenAt: ATProtoDate?

    public init(
        uri: ATURI,
        draft: ExposureDraft,
        createdAt: ATProtoDate,
        takenAt: ATProtoDate? = nil
    ) {
        self.uri = uri
        self.draft = draft
        self.createdAt = createdAt
        self.takenAt = takenAt
    }

    public var id: ATURI { uri }

    public func updatedRecord(at date: ATProtoDate) throws -> Data {
        try draft.record(createdAt: createdAt, takenAt: takenAt, updatedAt: date)
    }
}

public struct FrameSummary: Identifiable, Hashable, Sendable {
    public let frameNumber: Int
    public let exposureCount: Int
    public let latestTakenAt: ATProtoDate?
    public let aperture: String?
    public let shutterSpeed: String?

    public init(
        frameNumber: Int,
        exposureCount: Int,
        latestTakenAt: ATProtoDate? = nil,
        aperture: String? = nil,
        shutterSpeed: String? = nil
    ) {
        self.frameNumber = frameNumber
        self.exposureCount = exposureCount
        self.latestTakenAt = latestTakenAt
        self.aperture = aperture
        self.shutterSpeed = shutterSpeed
    }

    public var id: Int { frameNumber }
}

/// The frame-detail boundary supports both single and multiple exposures on one physical frame.
/// Implementations are responsible for preserving unknown fields when applying an update.
public protocol FrameDetailStoring: Sendable {
    func frames(roll: ATURI) async throws -> [FrameSummary]
    func exposures(roll: ATURI, frameNumber: Int) async throws -> [ExposureDetail]
    func updateExposure(uri: ATURI, record: Data) async throws
}

public extension FrameDetailStoring {
    /// Keeps existing detail-only stores source-compatible. Production composition
    /// should implement this method to expose the roll's complete frame index.
    func frames(roll _: ATURI) async throws -> [FrameSummary] { [] }
}

public enum LoggerError: Error, Equatable, Sendable {
    case invalidFrameNumber(Int)
    case invalidAperture(String)
    case invalidShutterSpeed(String)
    case invalidISO(Int)
    case invalidMultipleExposureIndex(Int)
    case tooManyMeterReadings
    case noteTooLong
    case lifecycle([ConsumableLifecycleIssue])
    case frameDetailsUnavailable
    case locationUnavailable(String)
    case read(String)
    case write(String)

    public var message: String {
        switch self {
        case let .invalidFrameNumber(number): "Frame \(number) is not valid."
        case let .invalidAperture(value): "Aperture \(value) is not valid."
        case let .invalidShutterSpeed(value): "Shutter speed \(value) is not valid."
        case let .invalidISO(value): "EI \(value) is not valid."
        case let .invalidMultipleExposureIndex(index):
            "Multiple-exposure index \(index) is not valid."
        case .tooManyMeterReadings: "An exposure can include at most 16 meter readings."
        case .noteTooLong: "The note can contain at most 1,000 bytes."
        case let .lifecycle(issues):
            issues.first?.message ?? "The roll dates are out of order."
        case .frameDetailsUnavailable: "Frame details are not available for this roll."
        case let .locationUnavailable(detail): "Could not add the shoot location: \(detail)"
        case let .read(detail): "Could not load the frame: \(detail)"
        case let .write(detail): "Could not save the change: \(detail)"
        }
    }
}

public protocol ExposureWriting: Sendable {
    func createExposure(record: Data) async throws
}

public struct DiscardingExposureWriter: ExposureWriting {
    public init() {}

    public func createExposure(record _: Data) async throws {}
}
