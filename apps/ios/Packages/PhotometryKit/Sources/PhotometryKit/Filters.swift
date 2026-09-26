import Foundation

/// Exposure compensation imposed by a filter, represented as a positive filter factor.
public struct FilterCompensation: Hashable, Codable, Sendable {
    public let factor: Double

    public init(factor: Double) throws {
        try requirePositive(factor, "filterFactor")
        guard factor >= 1 else { throw PhotometryError.invalidRange("filterFactor") }
        self.factor = factor
    }

    /// Creates compensation from light transmission in the interval `(0, 1]`.
    public init(transmission: Double) throws {
        try requirePositive(transmission, "transmission")
        guard transmission <= 1 else { throw PhotometryError.invalidRange("transmission") }
        try self.init(factor: 1 / transmission)
    }

    /// Creates compensation from base-10 optical density (`factor = 10^density`).
    public init(opticalDensity: Double) throws {
        try requireNonnegative(opticalDensity, "opticalDensity")
        try self.init(factor: Foundation.pow(10, opticalDensity))
    }

    public var stops: Stops { Stops(Foundation.log2(factor)) }
    public var transmission: Double { 1 / factor }
    public var opticalDensity: Double { Foundation.log10(factor) }

    /// Applies this filter factor to an exposure duration.
    public func corrected(_ duration: ExposureDuration) throws -> ExposureDuration {
        try ExposureDuration(seconds: duration.seconds * factor)
    }

    /// Combines a filter stack. Factors multiply and stop losses add.
    public static func combined(_ filters: [FilterCompensation]) throws -> FilterCompensation {
        try FilterCompensation(factor: filters.reduce(1) { $0 * $1.factor })
    }
}
