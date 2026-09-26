import Foundation
import MeterEngine

public actor FileMeterFeatureStateStore: HeldReadingStoring, CalibrationProfileStoring,
    MeterReadingLogStoring
{
    private struct Envelope: Codable, Sendable {
        var version = 1
        var heldReadings: [Reading] = []
        var calibration = CalibrationProfileState()
        var readingLog: [StoredMeterReading] = []

        private enum CodingKeys: String, CodingKey {
            case version
            case heldReadings
            case calibration
            case readingLog
        }

        init() {}

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
            heldReadings =
                try container.decodeIfPresent([Reading].self, forKey: .heldReadings) ?? []
            calibration =
                try container.decodeIfPresent(CalibrationProfileState.self, forKey: .calibration)
                ?? CalibrationProfileState()
            readingLog =
                try container.decodeIfPresent([StoredMeterReading].self, forKey: .readingLog) ?? []
        }
    }

    private let fileURL: URL
    private var cached: Envelope?

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func loadHeldReadings() throws -> [Reading] {
        try loadEnvelope().heldReadings
    }

    public func saveHeldReadings(_ readings: [Reading]) throws {
        var envelope = try loadEnvelope()
        envelope.heldReadings = readings
        try saveEnvelope(envelope)
    }

    public func loadCalibrationProfileState() throws -> CalibrationProfileState {
        try loadEnvelope().calibration
    }

    public func saveCalibrationProfileState(_ state: CalibrationProfileState) throws {
        var envelope = try loadEnvelope()
        envelope.calibration = state
        try saveEnvelope(envelope)
    }

    public func loadMeterReadingLog() throws -> [StoredMeterReading] {
        try loadEnvelope().readingLog
    }

    public func saveMeterReadingLog(_ readings: [StoredMeterReading]) throws {
        var envelope = try loadEnvelope()
        envelope.readingLog = readings
        try saveEnvelope(envelope)
    }

    private func loadEnvelope() throws -> Envelope {
        if let cached { return cached }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            let envelope = Envelope()
            cached = envelope
            return envelope
        }
        let data = try Data(contentsOf: fileURL)
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.version == 1 else {
            throw MeterFeatureBoundaryError.statePersistence(
                "Unsupported meter state version \(envelope.version)."
            )
        }
        cached = envelope
        return envelope
    }

    private func saveEnvelope(_ envelope: Envelope) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(envelope).write(to: fileURL, options: [.atomic])
        cached = envelope
    }
}
