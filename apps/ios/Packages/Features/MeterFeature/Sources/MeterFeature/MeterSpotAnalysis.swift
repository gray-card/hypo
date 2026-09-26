import Foundation
import MeterEngine
import PhotometryKit

/// A local analysis of a bank of reflected spot readings.
///
/// Each measurement remains an independent `Reading`. This value derives comparison data for the
/// interface and does not rewrite a reading's public role, zone, or exposure solution.
public struct MeterSpotAnalysis: Hashable, Sendable {
    public struct Point: Hashable, Identifiable, Sendable {
        public let reading: Reading
        public let deltaFromAverageStops: Stops
        public let deltaFromReferenceStops: Stops
        public let placedZone: Double

        public var id: UUID { reading.id }
    }

    public let points: [Point]
    public let referenceReadingID: UUID
    public let referenceZone: Zone
    public let averageEV100: ExposureValue
    public let darkestReadingID: UUID
    public let brightestReadingID: UUID
    public let contrastRange: Stops
    public let placedExposureEV100: ExposureValue

    public init?(
        readings: [Reading],
        referenceReadingID requestedReferenceID: UUID?,
        referenceZone: Zone
    ) {
        var seen = Set<UUID>()
        let spots = readings.filter {
            $0.geometry == .reflectedSpot && seen.insert($0.id).inserted
        }
        guard let first = spots.first else { return nil }

        let reference =
            spots.first { $0.id == requestedReferenceID }
            ?? first
        guard
            let darkest = spots.min(by: { $0.ev100.rawValue < $1.ev100.rawValue }),
            let brightest = spots.max(by: { $0.ev100.rawValue < $1.ev100.rawValue }),
            let average = try? MultiSpotMemory(readings: spots).average()
        else { return nil }

        self.referenceReadingID = reference.id
        self.referenceZone = referenceZone
        self.averageEV100 = average.ev100
        self.darkestReadingID = darkest.id
        self.brightestReadingID = brightest.id
        self.contrastRange = Stops(brightest.ev100.rawValue - darkest.ev100.rawValue)
        self.placedExposureEV100 = ZoneMath.placedExposureValue(
            reading: reference.ev100,
            on: referenceZone
        )
        self.points = spots.map { reading in
            let referenceDelta = reading.ev100 - reference.ev100
            return Point(
                reading: reading,
                deltaFromAverageStops: reading.ev100 - average.ev100,
                deltaFromReferenceStops: referenceDelta,
                placedZone: Double(referenceZone.rawValue) + referenceDelta.rawValue
            )
        }
    }
}

public enum MeterZoneLabel {
    private static let numerals = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

    public static func numeral(for zone: Int) -> String {
        guard numerals.indices.contains(zone) else { return String(zone) }
        return numerals[zone]
    }

    public static func description(for position: Double) -> String {
        if position < 0 {
            return "Below Zone 0 by \(formatted(-position)) stops"
        }
        if position > 10 {
            return "Above Zone X by \(formatted(position - 10)) stops"
        }
        let nearest = Int(position.rounded())
        let offset = position - Double(nearest)
        guard abs(offset) >= 0.05 else { return "Zone \(numeral(for: nearest))" }
        return "Zone \(numeral(for: nearest)) \(signed(offset))"
    }

    public static func signed(_ value: Double) -> String {
        String(format: "%+.1f", value)
    }

    private static func formatted(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}
