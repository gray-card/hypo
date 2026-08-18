import Foundation

/// A manufacturer- or recipe-supplied development time at one temperature.
public struct TemperatureTimePoint: Codable, Hashable, Sendable {
    public let temperatureCelsius: Double
    public let duration: TimeInterval

    public init(temperatureCelsius: Double, duration: TimeInterval) throws(TemperatureCompensationError) {
        guard temperatureCelsius.isFinite else {
            throw .invalidTemperature(temperatureCelsius)
        }
        guard duration.isFinite, duration > 0 else {
            throw .invalidDuration(duration)
        }
        self.temperatureCelsius = temperatureCelsius
        self.duration = duration
    }
}

public enum TemperatureInterpolation: String, Codable, Hashable, Sendable {
    /// Linear interpolation in seconds.
    case linear
    /// Linear interpolation in log-duration, appropriate for multiplicative time changes.
    case logarithmic
}

public enum TemperatureCompensationError: Error, Equatable, Sendable {
    case insufficientPoints
    case duplicateTemperature(Double)
    case invalidTemperature(Double)
    case invalidDuration(TimeInterval)
    case interpolationDisabled(requested: Double)
    case outsidePublishedRange(requested: Double, minimum: Double, maximum: Double)
}

/// Resolves a development duration from published temperature/time points.
public enum TemperatureCompensator {
    public static func duration(
        at temperatureCelsius: Double,
        points: [TemperatureTimePoint],
        interpolationAllowed: Bool,
        interpolation: TemperatureInterpolation = .logarithmic
    ) throws(TemperatureCompensationError) -> TimeInterval {
        guard temperatureCelsius.isFinite else {
            throw .invalidTemperature(temperatureCelsius)
        }
        let sorted = points.sorted { $0.temperatureCelsius < $1.temperatureCelsius }
        guard !sorted.isEmpty else { throw .insufficientPoints }
        for pair in zip(sorted, sorted.dropFirst())
        where pair.0.temperatureCelsius == pair.1.temperatureCelsius {
            throw .duplicateTemperature(pair.0.temperatureCelsius)
        }
        if let exact = sorted.first(where: {
            abs($0.temperatureCelsius - temperatureCelsius) < 0.000_001
        }) {
            return exact.duration
        }
        guard interpolationAllowed else {
            throw .interpolationDisabled(requested: temperatureCelsius)
        }
        guard sorted.count >= 2 else { throw .insufficientPoints }
        guard
            let minimum = sorted.first?.temperatureCelsius,
            let maximum = sorted.last?.temperatureCelsius,
            temperatureCelsius > minimum,
            temperatureCelsius < maximum
        else {
            throw .outsidePublishedRange(
                requested: temperatureCelsius,
                minimum: sorted.first?.temperatureCelsius ?? temperatureCelsius,
                maximum: sorted.last?.temperatureCelsius ?? temperatureCelsius
            )
        }
        guard
            let upperIndex = sorted.firstIndex(where: {
                $0.temperatureCelsius > temperatureCelsius
            })
        else {
            throw .outsidePublishedRange(
                requested: temperatureCelsius,
                minimum: minimum,
                maximum: maximum
            )
        }
        let lower = sorted[upperIndex - 1]
        let upper = sorted[upperIndex]
        let fraction =
            (temperatureCelsius - lower.temperatureCelsius)
            / (upper.temperatureCelsius - lower.temperatureCelsius)

        switch interpolation {
        case .linear:
            return lower.duration + fraction * (upper.duration - lower.duration)
        case .logarithmic:
            let logDuration =
                log(lower.duration)
                + fraction * (log(upper.duration) - log(lower.duration))
            return exp(logDuration)
        }
    }
}

/// An approximate black-and-white development time derived from Ilford's general
/// 18–27 °C time/temperature compensation chart.
public struct GeneralBlackAndWhiteTemperatureEstimate: Codable, Hashable, Sendable {
    public let duration: TimeInterval
    public let unroundedDuration: TimeInterval
    public let referenceDuration: TimeInterval
    public let referenceTemperatureCelsius: Double
    public let targetTemperatureCelsius: Double
    public let roundingIncrement: TimeInterval

    public var isBelowRecommendedMinimum: Bool { duration < 5 * 60 }
    public var hasLargeTemperatureChange: Bool {
        abs(targetTemperatureCelsius - referenceTemperatureCelsius) >= 4
    }
}

public enum GeneralBlackAndWhiteTemperatureEstimateError: Error, Equatable, Sendable {
    case invalidTemperature(Double)
    case invalidDuration(TimeInterval)
    case outsideChartRange(requested: Double, minimum: Double, maximum: Double)
}

/// Produces a general black-and-white estimate without presenting it as recipe data.
///
/// Ilford's chart follows an approximately 10-percent-per-degree relation and rounds to
/// 15-second increments. The chart covers 18–27 °C; values outside that range fail rather
/// than extending the estimate beyond its source.
public enum GeneralBlackAndWhiteTemperatureEstimator {
    public static let supportedRange: ClosedRange<Double> = 18...27
    public static let roundingIncrement: TimeInterval = 15

    public static func estimate(
        referenceDuration: TimeInterval,
        referenceTemperatureCelsius: Double,
        targetTemperatureCelsius: Double
    ) throws(GeneralBlackAndWhiteTemperatureEstimateError)
        -> GeneralBlackAndWhiteTemperatureEstimate
    {
        guard referenceDuration.isFinite, referenceDuration > 0 else {
            throw .invalidDuration(referenceDuration)
        }
        for temperature in [referenceTemperatureCelsius, targetTemperatureCelsius]
        where !temperature.isFinite {
            throw .invalidTemperature(temperature)
        }
        for temperature in [referenceTemperatureCelsius, targetTemperatureCelsius]
        where !supportedRange.contains(temperature) {
            throw .outsideChartRange(
                requested: temperature,
                minimum: supportedRange.lowerBound,
                maximum: supportedRange.upperBound
            )
        }

        let unroundedDuration =
            referenceDuration
            * pow(1.1, referenceTemperatureCelsius - targetTemperatureCelsius)
        let duration = max(
            roundingIncrement,
            (unroundedDuration / roundingIncrement).rounded() * roundingIncrement
        )
        return GeneralBlackAndWhiteTemperatureEstimate(
            duration: duration,
            unroundedDuration: unroundedDuration,
            referenceDuration: referenceDuration,
            referenceTemperatureCelsius: referenceTemperatureCelsius,
            targetTemperatureCelsius: targetTemperatureCelsius,
            roundingIncrement: roundingIncrement
        )
    }
}
