import Foundation
import PhotometryKit

public enum CalibrationReference: String, Codable, Sendable {
    case sunny16 = "sunny-16"
    case handheldMeter = "handheld-meter"
    case knownTarget = "known-target"
    case factory
    case manufacturerSpecification = "manufacturer-specification"
}

public struct CalibrationIdentity: Hashable, Codable, Sendable {
    public let deviceModel: String
    public let cameraID: String
    public let module: CameraModule
    public let sensorPath: SensorPath

    public init(deviceModel: String, cameraID: String, module: CameraModule, sensorPath: SensorPath) {
        self.deviceModel = deviceModel
        self.cameraID = cameraID
        self.module = module
        self.sensorPath = sensorPath
    }
}

public struct CalibrationPoint: Hashable, Codable, Sendable {
    public let rawEV100: Double
    public let correctionStops: Double

    public init(rawEV100: Double, correctionStops: Double) throws {
        guard rawEV100.isFinite, correctionStops.isFinite else {
            throw MeterError.invalidConfiguration("calibration point")
        }
        self.rawEV100 = rawEV100
        self.correctionStops = correctionStops
    }
}

public struct CalibrationProfile: Hashable, Codable, Identifiable, Sendable {
    public let id: UUID
    public let identity: CalibrationIdentity
    public let reference: CalibrationReference
    public let createdAt: Date
    public let nextDriftCheckAt: Date?
    public let constantOffsetStops: Double
    public let correctionCurve: [CalibrationPoint]
    public let incidentConstant: Double
    public let reflectedConstant: Double
    public let validatedEVRange: ClosedRange<Double>?

    public init(
        id: UUID = UUID(),
        identity: CalibrationIdentity,
        reference: CalibrationReference,
        createdAt: Date,
        nextDriftCheckAt: Date? = nil,
        constantOffsetStops: Double,
        correctionCurve: [CalibrationPoint] = [],
        incidentConstant: Double = 250,
        reflectedConstant: Double = 12.5,
        validatedEVRange: ClosedRange<Double>? = nil
    ) throws {
        guard constantOffsetStops.isFinite, incidentConstant > 0, reflectedConstant > 0,
            incidentConstant.isFinite, reflectedConstant.isFinite
        else {
            throw MeterError.invalidConfiguration("calibration constants")
        }
        let sorted = correctionCurve.sorted { $0.rawEV100 < $1.rawEV100 }
        guard zip(sorted, sorted.dropFirst()).allSatisfy({ $0.rawEV100 < $1.rawEV100 }) else {
            throw MeterError.invalidConfiguration("duplicate calibration curve input")
        }
        self.id = id
        self.identity = identity
        self.reference = reference
        self.createdAt = createdAt
        self.nextDriftCheckAt = nextDriftCheckAt
        self.constantOffsetStops = constantOffsetStops
        self.correctionCurve = sorted
        self.incidentConstant = incidentConstant
        self.reflectedConstant = reflectedConstant
        self.validatedEVRange = validatedEVRange
    }

    public var photometryCalibration: MeterCalibration {
        try! MeterCalibration(
            incidentConstant: incidentConstant,
            reflectedConstant: reflectedConstant
        )
    }

    public func matches(camera: CameraDescriptor, sensorPath: SensorPath) -> Bool {
        identity.cameraID == camera.id && identity.module == camera.module
            && identity.sensorPath == sensorPath
    }

    public func corrected(_ raw: ExposureValue) -> ExposureValue {
        ExposureValue(raw.rawValue + constantOffsetStops + curveCorrection(at: raw.rawValue))
    }

    public func needsDriftCheck(at date: Date) -> Bool {
        nextDriftCheckAt.map { date >= $0 } ?? false
    }

    private func curveCorrection(at ev: Double) -> Double {
        guard !correctionCurve.isEmpty else { return 0 }
        guard correctionCurve.count > 1 else { return correctionCurve[0].correctionStops }

        let upperIndex = correctionCurve.firstIndex { $0.rawEV100 >= ev }
        let lower: CalibrationPoint
        let upper: CalibrationPoint
        if let upperIndex {
            if upperIndex == 0 { return correctionCurve[0].correctionStops }
            lower = correctionCurve[upperIndex - 1]
            upper = correctionCurve[upperIndex]
        } else {
            return correctionCurve[correctionCurve.count - 1].correctionStops
        }
        let fraction = (ev - lower.rawEV100) / (upper.rawEV100 - lower.rawEV100)
        return lower.correctionStops
            + fraction * (upper.correctionStops - lower.correctionStops)
    }
}

public struct CalibrationObservation: Hashable, Codable, Sendable {
    public let measuredEV100: ExposureValue
    public let referenceEV100: ExposureValue

    public init(measuredEV100: ExposureValue, referenceEV100: ExposureValue) {
        self.measuredEV100 = measuredEV100
        self.referenceEV100 = referenceEV100
    }
}

public enum CalibrationBuilder {
    /// Produces a constant-offset profile from one or more reference comparisons.
    /// Multiple comparisons are averaged in stop space because each difference is logarithmic.
    public static func constantOffsetProfile(
        identity: CalibrationIdentity,
        reference: CalibrationReference,
        observations: [CalibrationObservation],
        createdAt: Date,
        driftCheckInterval: TimeInterval? = 180 * 24 * 60 * 60,
        incidentConstant: Double = 250,
        reflectedConstant: Double = 12.5
    ) throws -> CalibrationProfile {
        guard !observations.isEmpty else {
            throw MeterError.invalidConfiguration("calibration observations")
        }
        let offset =
            observations.reduce(0) {
                $0 + ($1.referenceEV100.rawValue - $1.measuredEV100.rawValue)
            } / Double(observations.count)
        let rawValues = observations.map(\.measuredEV100.rawValue)
        return try CalibrationProfile(
            identity: identity,
            reference: reference,
            createdAt: createdAt,
            nextDriftCheckAt: driftCheckInterval.map { createdAt.addingTimeInterval($0) },
            constantOffsetStops: offset,
            incidentConstant: incidentConstant,
            reflectedConstant: reflectedConstant,
            validatedEVRange: (rawValues.min() ?? 0)...(rawValues.max() ?? 0)
        )
    }
}
