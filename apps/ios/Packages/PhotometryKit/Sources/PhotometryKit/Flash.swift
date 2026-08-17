import Foundation

/// A flash guide number for metres at ISO 100.
public struct GuideNumber: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(rawValue > 0 && rawValue.isFinite, "Guide number must be positive and finite")
        self.rawValue = rawValue
    }

    public init(metresAtISO100: Double) throws {
        try requirePositive(metresAtISO100, "guideNumber")
        self.rawValue = metresAtISO100
    }

    public var metresAtISO100: Double { rawValue }
}

public enum FlashMath {
    /// Effective guide number at a selected ISO, using the square-root sensitivity rule.
    public static func guideNumber(_ guideNumber: GuideNumber, at sensitivity: Sensitivity) throws
        -> GuideNumber
    {
        try GuideNumber(metresAtISO100: guideNumber.metresAtISO100 * (sensitivity.iso / 100).squareRoot())
    }

    /// Aperture from guide number and subject distance: `N = GN / distance`.
    public static func aperture(
        guideNumber: GuideNumber,
        distanceMetres: Double,
        sensitivity: Sensitivity = Sensitivity(rawValue: 100)
    ) throws -> Aperture {
        try requirePositive(distanceMetres, "distanceMetres")
        let effective = try self.guideNumber(guideNumber, at: sensitivity)
        return try Aperture(effective.metresAtISO100 / distanceMetres)
    }

    /// Subject distance from guide number and aperture.
    public static func distanceMetres(
        guideNumber: GuideNumber,
        aperture: Aperture,
        sensitivity: Sensitivity = Sensitivity(rawValue: 100)
    ) throws -> Double {
        try self.guideNumber(guideNumber, at: sensitivity).metresAtISO100 / aperture.rawValue
    }

    /// Combines co-located flashes aimed at the same subject. Light adds, so squared guide numbers add.
    public static func combinedGuideNumber(_ guideNumbers: [GuideNumber]) throws -> GuideNumber {
        guard !guideNumbers.isEmpty else { throw PhotometryError.invalidRange("guideNumbers") }
        let squaredSum = guideNumbers.reduce(0) { $0 + $1.metresAtISO100 * $1.metresAtISO100 }
        return try GuideNumber(metresAtISO100: squaredSum.squareRoot())
    }

    /// Manual-power fraction needed for a stop change relative to full power.
    /// A result of 0.25 means quarter power.
    public static func powerFraction(forReduction reduction: Stops) throws -> Double {
        try requireNonnegative(reduction.rawValue, "reduction")
        return Foundation.pow(2, -reduction.rawValue)
    }

    /// Difference in stops between two positive flash-power fractions.
    public static func reductionStops(forPowerFraction fraction: Double) throws -> Stops {
        try requirePositive(fraction, "powerFraction")
        guard fraction <= 1 else { throw PhotometryError.invalidRange("powerFraction") }
        return Stops(-Foundation.log2(fraction))
    }

    /// Illuminance falloff between two distances under the inverse-square law.
    public static func relativeIlluminance(fromMetres: Double, toMetres: Double) throws -> Double {
        try requirePositive(fromMetres, "fromMetres")
        try requirePositive(toMetres, "toMetres")
        return Foundation.pow(fromMetres / toMetres, 2)
    }
}
