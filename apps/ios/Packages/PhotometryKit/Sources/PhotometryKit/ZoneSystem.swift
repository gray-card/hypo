import Foundation

/// A Zone System placement from Zone 0 through Zone X. Zone V is meter grey.
public struct Zone: RawRepresentable, Hashable, Codable, Sendable, Comparable {
    public let rawValue: Int

    public init(rawValue: Int) {
        precondition((0...10).contains(rawValue), "Zone must be between 0 and 10")
        self.rawValue = rawValue
    }

    public init(_ value: Int) throws {
        guard (0...10).contains(value) else { throw PhotometryError.invalidRange("zone") }
        self.rawValue = value
    }

    public static let middleGray = Zone(rawValue: 5)
    public static func < (lhs: Zone, rhs: Zone) -> Bool { lhs.rawValue < rhs.rawValue }
}

public enum ZoneMath {
    /// Exposure compensation needed to place a metered tone on a zone. Zone III is -2 stops.
    public static func exposureCompensation(to zone: Zone) -> Stops {
        Stops(Double(zone.rawValue - Zone.middleGray.rawValue))
    }

    /// EV to set on the camera after placing a meter reading on a chosen zone.
    public static func placedExposureValue(reading: ExposureValue, on zone: Zone) -> ExposureValue {
        reading - exposureCompensation(to: zone)
    }

    /// Brightness ratio for a contrast range expressed in stops.
    public static func contrastRatio(for range: Stops) throws -> Double {
        try requireNonnegative(range.rawValue, "contrastRange")
        return range.exposureFactor
    }

    /// Contrast range in stops for a highlight-to-shadow luminance ratio.
    public static func contrastRange(forRatio ratio: Double) throws -> Stops {
        try requirePositive(ratio, "contrastRatio")
        guard ratio >= 1 else { throw PhotometryError.invalidRange("contrastRatio") }
        return Stops(Foundation.log2(ratio))
    }

    /// Number of stops by which a scene exceeds a medium's usable range.
    public static func excessContrast(sceneRange: Stops, mediumRange: Stops) -> Stops {
        Stops(max(0, sceneRange.rawValue - mediumRange.rawValue))
    }
}
