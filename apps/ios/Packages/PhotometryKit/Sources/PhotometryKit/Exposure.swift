import Foundation

/// Calibration constants for ISO 2720-style exposure-meter equations.
///
/// ISO 2720 specifies acceptable ranges rather than one universal constant. The defaults
/// here, `C = 250` for incident meters and `K = 12.5` for reflected meters, are conventional
/// values and remain configurable for calibrated instruments.
public struct MeterCalibration: Hashable, Codable, Sendable {
    public var incidentConstant: Double
    public var reflectedConstant: Double

    public init(incidentConstant: Double = 250, reflectedConstant: Double = 12.5) throws {
        try requirePositive(incidentConstant, "incidentConstant")
        try requirePositive(reflectedConstant, "reflectedConstant")
        self.incidentConstant = incidentConstant
        self.reflectedConstant = reflectedConstant
    }

    public static let conventional = try! MeterCalibration()
}

public enum ExposureMath {
    /// Converts incident illuminance to EV100 using `EV100 = log2(E * 100 / C)`.
    public static func ev100(
        from illuminance: Illuminance,
        calibration: MeterCalibration = .conventional
    ) throws -> ExposureValue {
        try requirePositive(illuminance.lux, "illuminance")
        return ExposureValue(Foundation.log2(illuminance.lux * 100 / calibration.incidentConstant))
    }

    /// Converts EV100 to incident illuminance using the ISO 2720 incident-meter equation.
    public static func illuminance(
        fromEV100 ev100: ExposureValue,
        calibration: MeterCalibration = .conventional
    ) throws -> Illuminance {
        try Illuminance(lux: calibration.incidentConstant / 100 * Foundation.pow(2, ev100.rawValue))
    }

    /// Converts reflected luminance to EV100 using `EV100 = log2(L * 100 / K)`.
    public static func ev100(
        from luminance: Luminance,
        calibration: MeterCalibration = .conventional
    ) throws -> ExposureValue {
        try requirePositive(luminance.candelaPerSquareMetre, "luminance")
        return ExposureValue(
            Foundation.log2(luminance.candelaPerSquareMetre * 100 / calibration.reflectedConstant)
        )
    }

    /// Converts EV100 to reflected luminance using the ISO 2720 reflected-meter equation.
    public static func luminance(
        fromEV100 ev100: ExposureValue,
        calibration: MeterCalibration = .conventional
    ) throws -> Luminance {
        try Luminance(
            candelaPerSquareMetre: calibration.reflectedConstant / 100 * Foundation.pow(2, ev100.rawValue)
        )
    }

    /// Returns EV100 for a complete exposure triangle.
    public static func ev100(
        aperture: Aperture,
        duration: ExposureDuration,
        sensitivity: Sensitivity
    ) -> ExposureValue {
        let cameraEV = Foundation.log2(aperture.rawValue * aperture.rawValue / duration.seconds)
        return ExposureValue(cameraEV - Foundation.log2(sensitivity.iso / 100))
    }

    /// Solves f-number for EV100, exposure duration, and ISO speed.
    public static func aperture(
        forEV100 ev100: ExposureValue,
        duration: ExposureDuration,
        sensitivity: Sensitivity
    ) throws -> Aperture {
        let cameraEV = ev100.rawValue + Foundation.log2(sensitivity.iso / 100)
        return try Aperture((duration.seconds * Foundation.pow(2, cameraEV)).squareRoot())
    }

    /// Solves exposure duration for EV100, f-number, and ISO speed.
    public static func duration(
        forEV100 ev100: ExposureValue,
        aperture: Aperture,
        sensitivity: Sensitivity
    ) throws -> ExposureDuration {
        let cameraEV = ev100.rawValue + Foundation.log2(sensitivity.iso / 100)
        return try ExposureDuration(
            seconds: aperture.rawValue * aperture.rawValue / Foundation.pow(2, cameraEV))
    }

    /// Solves ISO speed for EV100, f-number, and exposure duration.
    public static func sensitivity(
        forEV100 ev100: ExposureValue,
        aperture: Aperture,
        duration: ExposureDuration
    ) throws -> Sensitivity {
        let cameraEV = Foundation.log2(aperture.rawValue * aperture.rawValue / duration.seconds)
        return try Sensitivity(iso: 100 * Foundation.pow(2, cameraEV - ev100.rawValue))
    }

    /// Moves an aperture by an exposure-stop difference. Positive stops admit more light.
    public static func shifted(_ aperture: Aperture, by stops: Stops) throws -> Aperture {
        try Aperture(aperture.rawValue / Foundation.pow(2, stops.rawValue / 2))
    }

    /// Moves a shutter duration by an exposure-stop difference. Positive stops lengthen time.
    public static func shifted(_ duration: ExposureDuration, by stops: Stops) throws -> ExposureDuration {
        try ExposureDuration(seconds: duration.seconds * stops.exposureFactor)
    }

    /// Moves ISO by a stop difference. Positive stops increase sensitivity.
    public static func shifted(_ sensitivity: Sensitivity, by stops: Stops) throws -> Sensitivity {
        try Sensitivity(iso: sensitivity.iso * stops.exposureFactor)
    }

    /// Quantizes an aperture to a whole-, half-, or third-stop grid anchored at f/1.
    public static func rounded(_ aperture: Aperture, to step: StopStep) throws -> Aperture {
        let stops = Stops(2 * Foundation.log2(aperture.rawValue))
        return try Aperture(Foundation.pow(2, step.rounded(stops).rawValue / 2))
    }

    /// Quantizes exposure time to a stop grid anchored at one second.
    public static func rounded(_ duration: ExposureDuration, to step: StopStep) throws -> ExposureDuration {
        let stops = Stops(Foundation.log2(duration.seconds))
        return try ExposureDuration(seconds: step.rounded(stops).exposureFactor)
    }

    /// Quantizes ISO speed to a stop grid anchored at ISO 100.
    public static func rounded(_ sensitivity: Sensitivity, to step: StopStep) throws -> Sensitivity {
        let stops = Stops(Foundation.log2(sensitivity.iso / 100))
        return try Sensitivity(iso: 100 * step.rounded(stops).exposureFactor)
    }
}
