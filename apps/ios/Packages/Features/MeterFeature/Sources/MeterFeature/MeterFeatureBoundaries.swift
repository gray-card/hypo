import Foundation
import MeterEngine

public protocol HeldReadingStoring: Sendable {
    func loadHeldReadings() async throws -> [Reading]
    func saveHeldReadings(_ readings: [Reading]) async throws
}

public struct MeterReadingNormalizedPoint: Codable, Hashable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        precondition((0...1).contains(x) && (0...1).contains(y))
        self.x = x
        self.y = y
    }
}

/// Everything MeterFeature knows when a deliberate measurement completes.
/// The app composition layer maps this semantic request to app.graycard.meter.reading.
public struct MeterReadingWriteRequest: Hashable, Sendable {
    public let reading: Reading
    public let spotPoint: MeterReadingNormalizedPoint?
    public let deviceModelName: String
    public let requestedAt: Date

    public init(
        reading: Reading,
        spotPoint: MeterReadingNormalizedPoint?,
        deviceModelName: String,
        requestedAt: Date
    ) {
        precondition(reading.geometry == .reflectedSpot || spotPoint == nil)
        self.reading = reading
        self.spotPoint = spotPoint
        self.deviceModelName = deviceModelName
        self.requestedAt = requestedAt
    }
}

/// One deliberate capture and every semantic meter-reading record it requires.
///
/// `records` is dependency ordered: averaging members precede the aggregate that references
/// them. Writers reserve stable record keys from each reading UUID, resolve `averagedFrom` to the
/// member AT-URIs, and atomically accept the entire request into durable sync storage.
public struct MeterReadingBatchWriteRequest: Hashable, Sendable {
    public let capture: MeterCapture
    public let spotPoint: MeterReadingNormalizedPoint?
    public let deviceModelName: String
    public let requestedAt: Date

    public init(
        capture: MeterCapture,
        spotPoint: MeterReadingNormalizedPoint?,
        deviceModelName: String,
        requestedAt: Date
    ) {
        precondition(capture.reading.geometry == .reflectedSpot || spotPoint == nil)
        self.capture = capture
        self.spotPoint = spotPoint
        self.deviceModelName = deviceModelName
        self.requestedAt = requestedAt
    }

    public var records: [MeterReadingWriteRequest] {
        capture.records.map {
            MeterReadingWriteRequest(
                reading: $0,
                spotPoint: spotPoint,
                deviceModelName: deviceModelName,
                requestedAt: requestedAt
            )
        }
    }

    public var primaryReadingID: UUID { capture.reading.id }
}

public struct MeterReadingRecordReference: Codable, Hashable, Sendable {
    /// The canonical AT-URI reserved for the queued or remotely committed record.
    public let uri: String

    public init(uri: String) throws {
        let components = uri.dropFirst("at://".count).split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard uri.hasPrefix("at://"), !uri.contains(where: { $0.isWhitespace }),
            components.count == 3,
            components.allSatisfy({ !$0.isEmpty }),
            components[1] == "app.graycard.meter.reading"
        else {
            throw MeterFeatureBoundaryError.persistence("The meter writer returned an invalid AT-URI.")
        }
        self.uri = uri
    }

    private enum CodingKeys: String, CodingKey {
        case uri
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(uri: container.decode(String.self, forKey: .uri))
    }
}

public struct MeterReadingPersistenceReceipt: Hashable, Sendable {
    public let reference: MeterReadingRecordReference
    public let acceptedAt: Date

    public init(reference: MeterReadingRecordReference, acceptedAt: Date) {
        self.reference = reference
        self.acceptedAt = acceptedAt
    }
}

public struct MeterReadingBatchPersistenceReceipt: Hashable, Sendable {
    /// One durable receipt for every record in the accepted batch, keyed by reading UUID.
    public let records: [UUID: MeterReadingPersistenceReceipt]

    public init(records: [UUID: MeterReadingPersistenceReceipt]) {
        self.records = records
    }
}

public protocol MeterReadingSemanticWriting: Sendable {
    /// Returns only after every semantic record has been atomically accepted by durable sync
    /// storage. If any record cannot be accepted, the writer throws without accepting any record.
    /// Repeating the same request must be idempotent and return the same stable record URIs.
    func storeMeterReadings(_ request: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
}

public struct UnavailableMeterReadingWriter: MeterReadingSemanticWriting {
    public init() {}

    public func storeMeterReadings(_: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
    {
        throw MeterFeatureBoundaryError.persistence("Meter reading storage is not configured.")
    }
}

public struct StoredMeterReading: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID { reading.id }

    public let reading: Reading
    public let reference: MeterReadingRecordReference
    public let spotPoint: MeterReadingNormalizedPoint?
    public let deviceModelName: String
    public let acceptedAt: Date

    public init(
        reading: Reading,
        reference: MeterReadingRecordReference,
        spotPoint: MeterReadingNormalizedPoint?,
        deviceModelName: String,
        acceptedAt: Date
    ) {
        self.reading = reading
        self.reference = reference
        self.spotPoint = spotPoint
        self.deviceModelName = deviceModelName
        self.acceptedAt = acceptedAt
    }
}

public protocol MeterReadingLogStoring: Sendable {
    func loadMeterReadingLog() async throws -> [StoredMeterReading]
    func saveMeterReadingLog(_ readings: [StoredMeterReading]) async throws
}

public actor InMemoryMeterReadingLogStore: MeterReadingLogStoring {
    private var readings: [StoredMeterReading]

    public init(readings: [StoredMeterReading] = []) {
        self.readings = readings
    }

    public func loadMeterReadingLog() -> [StoredMeterReading] { readings }

    public func saveMeterReadingLog(_ readings: [StoredMeterReading]) {
        self.readings = readings
    }
}

public actor InMemoryHeldReadingStore: HeldReadingStoring {
    private var readings: [Reading]

    public init(readings: [Reading] = []) {
        self.readings = readings
    }

    public func loadHeldReadings() -> [Reading] { readings }

    public func saveHeldReadings(_ readings: [Reading]) {
        self.readings = readings
    }
}

/// A request for Logger to persist meter-reading records and attach their AT-URIs to an exposure.
/// MeterFeature intentionally does not create or mutate the exposure itself.
public struct LoggerExposureMeterPromotionRequest: Hashable, Sendable {
    public let readings: [Reading]
    public let preferredReadingID: UUID
    /// Stable records that the promoter should attach rather than create again.
    public let recordReferences: [UUID: MeterReadingRecordReference]
    public let requestedAt: Date

    public init(
        readings: [Reading],
        preferredReadingID: UUID,
        recordReferences: [UUID: MeterReadingRecordReference] = [:],
        requestedAt: Date
    ) {
        precondition(readings.contains(where: { $0.id == preferredReadingID }))
        precondition(Set(recordReferences.keys).isSubset(of: Set(readings.map(\.id))))
        self.readings = readings
        self.preferredReadingID = preferredReadingID
        self.recordReferences = recordReferences
        self.requestedAt = requestedAt
    }
}

public protocol LoggerExposureMeterPromoting: Sendable {
    func promoteMeterReadings(_ request: LoggerExposureMeterPromotionRequest) async throws
}

public struct DiscardingLoggerExposureMeterPromoter: LoggerExposureMeterPromoting {
    public init() {}

    public func promoteMeterReadings(_: LoggerExposureMeterPromotionRequest) async throws {}
}

public struct CalibrationProfileState: Codable, Hashable, Sendable {
    public var profiles: [CalibrationProfile]
    public var selectedID: UUID?

    public init(profiles: [CalibrationProfile] = [], selectedID: UUID? = nil) {
        self.profiles = profiles
        self.selectedID = selectedID
    }
}

public protocol CalibrationProfileStoring: Sendable {
    func loadCalibrationProfileState() async throws -> CalibrationProfileState
    func saveCalibrationProfileState(_ state: CalibrationProfileState) async throws
}

public actor InMemoryCalibrationProfileStore: CalibrationProfileStoring {
    private var state: CalibrationProfileState

    public init(state: CalibrationProfileState = CalibrationProfileState()) {
        self.state = state
    }

    public func loadCalibrationProfileState() -> CalibrationProfileState { state }

    public func saveCalibrationProfileState(_ state: CalibrationProfileState) {
        self.state = state
    }
}

public actor InMemoryMeterFeatureStateStore: HeldReadingStoring, CalibrationProfileStoring,
    MeterReadingLogStoring
{
    private var readings: [Reading]
    private var calibration: CalibrationProfileState
    private var readingLog: [StoredMeterReading]

    public init(
        readings: [Reading] = [],
        calibration: CalibrationProfileState = CalibrationProfileState(),
        readingLog: [StoredMeterReading] = []
    ) {
        self.readings = readings
        self.calibration = calibration
        self.readingLog = readingLog
    }

    public func loadHeldReadings() -> [Reading] { readings }

    public func saveHeldReadings(_ readings: [Reading]) {
        self.readings = readings
    }

    public func loadCalibrationProfileState() -> CalibrationProfileState { calibration }

    public func saveCalibrationProfileState(_ state: CalibrationProfileState) {
        calibration = state
    }

    public func loadMeterReadingLog() -> [StoredMeterReading] { readingLog }

    public func saveMeterReadingLog(_ readings: [StoredMeterReading]) {
        readingLog = readings
    }
}

/// Applies a selected calibration to the same service that produces readings.
public protocol MeterCalibrationApplying: Sendable {
    func applyCalibration(_ profile: CalibrationProfile?) async
}

public struct DiscardingMeterCalibrationApplier: MeterCalibrationApplying {
    public init() {}

    public func applyCalibration(_: CalibrationProfile?) async {}
}

public enum MeterFeatureBoundaryError: Error, Equatable, Sendable {
    case noReading
    case persistence(String)
    case statePersistence(String)
    case promotion(String)
    case calibration(String)

    public var message: String {
        switch self {
        case .noReading: "Measure or select a held reading first."
        case let .persistence(detail): "Could not save the meter reading: \(detail)"
        case let .statePersistence(detail): "Could not save meter history or settings: \(detail)"
        case let .promotion(detail): "Could not send the reading to Logger: \(detail)"
        case let .calibration(detail): "Could not update calibration: \(detail)"
        }
    }
}
