import Foundation

/// Errors raised when a photometric quantity or model is outside its physical domain.
public enum PhotometryError: Error, Equatable, Sendable {
    case nonFiniteValue
    case valueMustBePositive(String)
    case valueMustBeNonnegative(String)
    case invalidRange(String)
    case insufficientTablePoints
}

@inline(__always)
func requireFinite(_ value: Double) throws {
    guard value.isFinite else { throw PhotometryError.nonFiniteValue }
}

@inline(__always)
func requirePositive(_ value: Double, _ name: String) throws {
    try requireFinite(value)
    guard value > 0 else { throw PhotometryError.valueMustBePositive(name) }
}

@inline(__always)
func requireNonnegative(_ value: Double, _ name: String) throws {
    try requireFinite(value)
    guard value >= 0 else { throw PhotometryError.valueMustBeNonnegative(name) }
}

/// A base-two exposure difference. One stop is a factor of two in exposure.
public struct Stops: RawRepresentable, Hashable, Codable, Sendable, Comparable, AdditiveArithmetic {
    public var rawValue: Double

    public init(rawValue: Double) {
        self.rawValue = rawValue
    }

    public init(_ value: Double) {
        self.rawValue = value
    }

    /// The multiplicative exposure factor represented by this stop difference.
    public var exposureFactor: Double { Foundation.pow(2, rawValue) }

    /// Creates a stop difference from a positive exposure factor.
    public init(exposureFactor: Double) throws {
        try requirePositive(exposureFactor, "exposureFactor")
        self.rawValue = Foundation.log2(exposureFactor)
    }

    public static let zero = Stops(0)

    public static func + (lhs: Stops, rhs: Stops) -> Stops { Stops(lhs.rawValue + rhs.rawValue) }
    public static func - (lhs: Stops, rhs: Stops) -> Stops { Stops(lhs.rawValue - rhs.rawValue) }
    public static func < (lhs: Stops, rhs: Stops) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// A logarithmic exposure value, normally expressed at ISO 100 (EV100).
public struct ExposureValue: RawRepresentable, Hashable, Codable, Sendable, Comparable {
    public var rawValue: Double

    public init(rawValue: Double) {
        self.rawValue = rawValue
    }

    public init(_ value: Double) {
        self.rawValue = value
    }

    public static func < (lhs: ExposureValue, rhs: ExposureValue) -> Bool { lhs.rawValue < rhs.rawValue }

    public static func + (lhs: ExposureValue, rhs: Stops) -> ExposureValue {
        ExposureValue(lhs.rawValue + rhs.rawValue)
    }

    public static func - (lhs: ExposureValue, rhs: Stops) -> ExposureValue {
        ExposureValue(lhs.rawValue - rhs.rawValue)
    }

    public static func - (lhs: ExposureValue, rhs: ExposureValue) -> Stops {
        Stops(lhs.rawValue - rhs.rawValue)
    }
}

/// A standard photographic stop grid.
public enum StopStep: Int, CaseIterable, Codable, Sendable {
    case whole = 1
    case half = 2
    case third = 3

    /// The size of one click in stops.
    public var stops: Stops { Stops(1 / Double(rawValue)) }

    /// Rounds a stop value to the nearest click on this grid.
    public func rounded(_ value: Stops) -> Stops {
        let increment = stops.rawValue
        return Stops((value.rawValue / increment).rounded() * increment)
    }
}

/// Incident illuminance stored canonically in lux.
public struct Illuminance: Hashable, Codable, Sendable {
    public enum Unit: String, Codable, Sendable {
        case lux
        case footCandle
    }

    /// Exact international-foot conversion: one foot-candle is 10.7639104167 lux.
    public static let luxPerFootCandle = 10.763_910_416_709_722

    public let lux: Double

    public init(lux: Double) throws {
        try requireNonnegative(lux, "lux")
        self.lux = lux
    }

    public init(_ value: Double, unit: Unit) throws {
        switch unit {
        case .lux: try self.init(lux: value)
        case .footCandle: try self.init(lux: value * Self.luxPerFootCandle)
        }
    }

    public func value(in unit: Unit) -> Double {
        switch unit {
        case .lux: lux
        case .footCandle: lux / Self.luxPerFootCandle
        }
    }
}

/// Reflected luminance stored canonically in candelas per square metre.
public struct Luminance: Hashable, Codable, Sendable {
    public enum Unit: String, Codable, Sendable {
        case candelaPerSquareMetre
        case footLambert
    }

    /// One foot-lambert equals 1/pi candela per square foot, or 3.4262591 cd/m².
    public static let candelaPerSquareMetrePerFootLambert = 3.426_259_099_635_390_5

    public let candelaPerSquareMetre: Double

    public init(candelaPerSquareMetre: Double) throws {
        try requireNonnegative(candelaPerSquareMetre, "candelaPerSquareMetre")
        self.candelaPerSquareMetre = candelaPerSquareMetre
    }

    public init(_ value: Double, unit: Unit) throws {
        switch unit {
        case .candelaPerSquareMetre: try self.init(candelaPerSquareMetre: value)
        case .footLambert:
            try self.init(candelaPerSquareMetre: value * Self.candelaPerSquareMetrePerFootLambert)
        }
    }

    public func value(in unit: Unit) -> Double {
        switch unit {
        case .candelaPerSquareMetre: candelaPerSquareMetre
        case .footLambert: candelaPerSquareMetre / Self.candelaPerSquareMetrePerFootLambert
        }
    }
}

/// A positive f-number or T-number.
public struct Aperture: RawRepresentable, Hashable, Codable, Sendable, Comparable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(rawValue > 0 && rawValue.isFinite, "Aperture must be positive and finite")
        self.rawValue = rawValue
    }

    public init(_ value: Double) throws {
        try requirePositive(value, "aperture")
        self.rawValue = value
    }

    public static func < (lhs: Aperture, rhs: Aperture) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// A positive exposure duration in seconds.
public struct ExposureDuration: RawRepresentable, Hashable, Codable, Sendable, Comparable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(rawValue > 0 && rawValue.isFinite, "Exposure duration must be positive and finite")
        self.rawValue = rawValue
    }

    public init(seconds: Double) throws {
        try requirePositive(seconds, "seconds")
        self.rawValue = seconds
    }

    public var seconds: Double { rawValue }
    public static func < (lhs: ExposureDuration, rhs: ExposureDuration) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// A positive arithmetic ISO speed.
public struct Sensitivity: RawRepresentable, Hashable, Codable, Sendable, Comparable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(rawValue > 0 && rawValue.isFinite, "ISO speed must be positive and finite")
        self.rawValue = rawValue
    }

    public init(iso: Double) throws {
        try requirePositive(iso, "iso")
        self.rawValue = iso
    }

    public var iso: Double { rawValue }
    public static func < (lhs: Sensitivity, rhs: Sensitivity) -> Bool { lhs.rawValue < rhs.rawValue }
}
