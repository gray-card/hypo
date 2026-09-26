import Foundation

/// A tabulated reciprocity-failure sample in seconds.
public struct ReciprocityPoint: Hashable, Codable, Sendable {
    public let meteredSeconds: Double
    public let correctedSeconds: Double

    public init(meteredSeconds: Double, correctedSeconds: Double) throws {
        try requirePositive(meteredSeconds, "meteredSeconds")
        try requirePositive(correctedSeconds, "correctedSeconds")
        self.meteredSeconds = meteredSeconds
        self.correctedSeconds = correctedSeconds
    }
}

/// A reciprocity-failure correction model.
///
/// Power-law and Schwarzschild coefficients are empirical film-specific values. Table
/// interpolation occurs in log-time space, which preserves multiplicative exposure behavior.
public enum ReciprocityModel: Hashable, Codable, Sendable {
    case none
    case power(exponent: Double)
    case schwarzschild(coefficient: Double)
    case table([ReciprocityPoint])

    public static func validatedPower(exponent: Double) throws -> ReciprocityModel {
        try requirePositive(exponent, "exponent")
        return .power(exponent: exponent)
    }

    public static func validatedSchwarzschild(coefficient: Double) throws -> ReciprocityModel {
        try requirePositive(coefficient, "coefficient")
        return .schwarzschild(coefficient: coefficient)
    }

    public static func validatedTable(_ points: [ReciprocityPoint]) throws -> ReciprocityModel {
        guard points.count >= 2 else { throw PhotometryError.insufficientTablePoints }
        let sorted = points.sorted { $0.meteredSeconds < $1.meteredSeconds }
        guard zip(sorted, sorted.dropFirst()).allSatisfy({ $0.meteredSeconds < $1.meteredSeconds }) else {
            throw PhotometryError.invalidRange("reciprocityTable")
        }
        return .table(sorted)
    }

    /// Corrects a meter-indicated duration. Power models are normalized at one second.
    public func corrected(_ duration: ExposureDuration) throws -> ExposureDuration {
        let metered = duration.seconds
        let corrected: Double
        switch self {
        case .none:
            corrected = metered
        case let .power(exponent):
            try requirePositive(exponent, "exponent")
            corrected = Foundation.pow(metered, exponent)
        case let .schwarzschild(coefficient):
            try requirePositive(coefficient, "coefficient")
            corrected = Foundation.pow(metered, 1 / coefficient)
        case let .table(points):
            guard points.count >= 2 else { throw PhotometryError.insufficientTablePoints }
            corrected = interpolate(
                metered: metered, points: points.sorted { $0.meteredSeconds < $1.meteredSeconds })
        }
        return try ExposureDuration(seconds: corrected)
    }

    /// The additional exposure represented by the correction.
    public func correctionStops(for duration: ExposureDuration) throws -> Stops {
        let result = try corrected(duration)
        return try Stops(exposureFactor: result.seconds / duration.seconds)
    }
}

private func interpolate(metered: Double, points: [ReciprocityPoint]) -> Double {
    let upperIndex = points.firstIndex { $0.meteredSeconds >= metered }
    let pair: (ReciprocityPoint, ReciprocityPoint)
    if let upperIndex {
        if upperIndex == 0 {
            pair = (points[0], points[1])
        } else {
            pair = (points[upperIndex - 1], points[upperIndex])
        }
    } else {
        pair = (points[points.count - 2], points[points.count - 1])
    }
    let x = Foundation.log2(metered)
    let x0 = Foundation.log2(pair.0.meteredSeconds)
    let x1 = Foundation.log2(pair.1.meteredSeconds)
    let y0 = Foundation.log2(pair.0.correctedSeconds)
    let y1 = Foundation.log2(pair.1.correctedSeconds)
    let fraction = (x - x0) / (x1 - x0)
    return Foundation.pow(2, y0 + fraction * (y1 - y0))
}
