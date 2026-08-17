import Foundation

/// A positive motion-picture frame rate in frames per second.
public struct FrameRate: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(rawValue > 0 && rawValue.isFinite, "Frame rate must be positive and finite")
        self.rawValue = rawValue
    }

    public init(framesPerSecond: Double) throws {
        try requirePositive(framesPerSecond, "framesPerSecond")
        self.rawValue = framesPerSecond
    }

    public var framesPerSecond: Double { rawValue }
}

/// A rotary shutter angle in degrees, greater than zero and no greater than 360°.
public struct ShutterAngle: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: Double

    public init(rawValue: Double) {
        precondition(
            rawValue > 0 && rawValue <= 360 && rawValue.isFinite, "Shutter angle must be in (0, 360]")
        self.rawValue = rawValue
    }

    public init(degrees: Double) throws {
        try requirePositive(degrees, "degrees")
        guard degrees <= 360 else { throw PhotometryError.invalidRange("shutterAngle") }
        self.rawValue = degrees
    }

    public var degrees: Double { rawValue }
}

public enum CineMath {
    /// Exposure time for a rotary shutter: `t = angle / (360 * frame rate)`.
    public static func exposureDuration(angle: ShutterAngle, frameRate: FrameRate) throws -> ExposureDuration
    {
        try ExposureDuration(seconds: angle.degrees / (360 * frameRate.framesPerSecond))
    }

    /// Rotary shutter angle corresponding to an exposure time and frame rate.
    public static func shutterAngle(duration: ExposureDuration, frameRate: FrameRate) throws -> ShutterAngle {
        try ShutterAngle(degrees: duration.seconds * 360 * frameRate.framesPerSecond)
    }

    /// Frame rate corresponding to an exposure time and rotary shutter angle.
    public static func frameRate(duration: ExposureDuration, angle: ShutterAngle) throws -> FrameRate {
        try FrameRate(framesPerSecond: angle.degrees / (360 * duration.seconds))
    }

    /// EV100 for a cine exposure. Pass a measured T-stop as `aperture` when transmission matters.
    public static func ev100(
        aperture: Aperture,
        angle: ShutterAngle,
        frameRate: FrameRate,
        sensitivity: Sensitivity
    ) throws -> ExposureValue {
        ExposureMath.ev100(
            aperture: aperture,
            duration: try exposureDuration(angle: angle, frameRate: frameRate),
            sensitivity: sensitivity
        )
    }
}
