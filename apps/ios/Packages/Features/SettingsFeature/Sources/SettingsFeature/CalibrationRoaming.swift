import Foundation
import HypoLexicon
import MeterEngine

public struct SettingsCalibrationRemoteRecord: Hashable, Sendable {
    public let uri: String
    public let value: Data

    public init(uri: String, value: Data) {
        self.uri = uri
        self.value = value
    }
}

public struct SettingsCalibrationDeviceContext: Hashable, Sendable {
    public let deviceModel: String
    public let cameras: [CameraDescriptor]
    public let activeIdentity: CalibrationIdentity?

    public init(
        deviceModel: String,
        cameras: [CameraDescriptor],
        activeIdentity: CalibrationIdentity? = nil
    ) {
        self.deviceModel = deviceModel
        self.cameras = cameras.sorted { $0.id < $1.id }
        self.activeIdentity = activeIdentity
    }
}

public struct SettingsCalibrationReconciliation: Hashable, Sendable {
    public let state: SettingsCalibrationState
    public let skippedMalformedRecordCount: Int

    public init(state: SettingsCalibrationState, skippedMalformedRecordCount: Int) {
        self.state = state
        self.skippedMalformedRecordCount = skippedMalformedRecordCount
    }
}

public enum SettingsCalibrationRecordProjection {
    /// Matches a wire record to a local profile using the fields represented by the lexicon.
    /// Record identity and AVFoundation's device-local camera ID are intentionally excluded.
    public static func isSemanticallyEquivalent(
        _ record: SettingsCalibrationRemoteRecord,
        to profile: CalibrationProfile
    ) -> Bool {
        let camera = CameraDescriptor(
            id: profile.identity.cameraID,
            name: profile.identity.cameraID,
            module: profile.identity.module
        )
        let context = SettingsCalibrationDeviceContext(
            deviceModel: profile.identity.deviceModel,
            cameras: [camera]
        )
        guard
            let decoded = try? SettingsCalibrationRemoteDecoder.decode(
                record,
                device: context,
                driftCheckInterval: nil
            )
        else {
            return false
        }
        return SettingsCalibrationRemoteDecoder.semanticKey(decoded.profile)
            == SettingsCalibrationRemoteDecoder.semanticKey(profile)
    }
}

enum SettingsCalibrationRemoteDecoder {
    static let collection = "app.graycard.meter.calibration"

    struct Decoded: Sendable {
        let profile: CalibrationProfile
        let matchesActiveIdentity: Bool
    }

    static func decode(
        _ remote: SettingsCalibrationRemoteRecord,
        device: SettingsCalibrationDeviceContext,
        driftCheckInterval: TimeInterval?
    ) throws -> Decoded {
        let uriComponents = remote.uri.split(separator: "/")
        guard remote.uri.hasPrefix("at://"), uriComponents.count == 4,
            uriComponents[2] == Substring(collection), !uriComponents[1].isEmpty,
            !uriComponents[3].isEmpty
        else {
            throw SettingsCalibrationRemoteRecordError.invalidURI
        }
        guard
            try GeneratedLexiconValidator.validate(
                remote.value,
                as: GeneratedRecordNSID.meterCalibration
            ).isEmpty
        else {
            throw SettingsCalibrationRemoteRecordError.schemaViolation
        }
        let record = try JSONDecoder().decode(AppGraycardMeterCalibrationMain.self, from: remote.value)
        guard record.recordType == collection,
            let deviceModel = normalized(record.deviceModel),
            let moduleValue = record.cameraModule?.rawValue,
            let module = cameraModule(moduleValue),
            let sensorPathValue = record.sensorPath?.rawValue,
            let sensorPath = sensorPath(sensorPathValue),
            let referenceValue = record.reference?.rawValue,
            let reference = reference(referenceValue),
            let offset = try record.offsetStops.map({ try measure($0, unit: "stops") })
        else {
            throw SettingsCalibrationRemoteRecordError.missingRequiredField
        }

        let activeCamera = device.activeIdentity.flatMap { active -> CameraDescriptor? in
            guard active.deviceModel == deviceModel, active.module == module else { return nil }
            return device.cameras.first { $0.id == active.cameraID }
        }
        let matchingCamera =
            activeCamera
            ?? (deviceModel == device.deviceModel
                ? device.cameras.filter { $0.module == module }.min { $0.id < $1.id }
                : nil)
        let cameraID = matchingCamera?.id ?? remoteCameraID(deviceModel: deviceModel, module: module)
        let identity = CalibrationIdentity(
            deviceModel: deviceModel,
            cameraID: cameraID,
            module: module,
            sensorPath: sensorPath
        )
        let reflectedConstant =
            try record.constantK.map {
                try measure($0, unit: "cd·s/(m2·ISO)")
            } ?? 12.5
        let incidentConstant =
            try (record.constantCFlat ?? record.constantCDome).map {
                try measure($0, unit: "lx·s/ISO")
            } ?? 250
        let validRange = try validatedRange(minimum: record.validEvMin, maximum: record.validEvMax)
        let curve = try (record.curve ?? []).map { point -> CalibrationPoint in
            let raw = try measure(point.engineEv, unit: "EV")
            let corrected = try measure(point.correctedEv, unit: "EV")
            return try CalibrationPoint(
                rawEV100: raw,
                correctionStops: corrected - raw - offset
            )
        }
        let profile = try CalibrationProfile(
            id: stableID(for: remote.uri),
            identity: identity,
            reference: reference,
            createdAt: record.createdAt.date,
            nextDriftCheckAt: driftCheckInterval.map { record.createdAt.date.addingTimeInterval($0) },
            constantOffsetStops: offset,
            correctionCurve: curve,
            incidentConstant: incidentConstant,
            reflectedConstant: reflectedConstant,
            validatedEVRange: validRange
        )
        return Decoded(
            profile: profile,
            matchesActiveIdentity: device.activeIdentity == identity
        )
    }

    static func semanticKey(_ profile: CalibrationProfile) -> SemanticKey {
        SemanticKey(
            deviceModel: profile.identity.deviceModel,
            module: profile.identity.module,
            sensorPath: profile.identity.sensorPath,
            reference: profile.reference,
            createdAtMillis: quantizeDate(profile.createdAt),
            offset: quantize(profile.constantOffsetStops),
            curve: profile.correctionCurve.map {
                SemanticCurvePoint(raw: quantize($0.rawEV100), correction: quantize($0.correctionStops))
            },
            incidentConstant: quantize(profile.incidentConstant),
            reflectedConstant: quantize(profile.reflectedConstant),
            validMinimum: profile.validatedEVRange.map { quantize($0.lowerBound) },
            validMaximum: profile.validatedEVRange.map { quantize($0.upperBound) }
        )
    }

    struct SemanticKey: Hashable, Sendable {
        let deviceModel: String
        let module: CameraModule
        let sensorPath: SensorPath
        let reference: CalibrationReference
        let createdAtMillis: Int64
        let offset: Int64
        let curve: [SemanticCurvePoint]
        let incidentConstant: Int64
        let reflectedConstant: Int64
        let validMinimum: Int64?
        let validMaximum: Int64?
    }

    struct SemanticCurvePoint: Hashable, Sendable {
        let raw: Int64
        let correction: Int64
    }

    private static func validatedRange(
        minimum: AppGraycardDefsMeasure?,
        maximum: AppGraycardDefsMeasure?
    ) throws -> ClosedRange<Double>? {
        switch (minimum, maximum) {
        case (nil, nil):
            return nil
        case let (minimum?, maximum?):
            let lower = try measure(minimum, unit: "EV")
            let upper = try measure(maximum, unit: "EV")
            guard lower <= upper else { throw SettingsCalibrationRemoteRecordError.invalidRange }
            return lower...upper
        default:
            throw SettingsCalibrationRemoteRecordError.invalidRange
        }
    }

    private static func measure(_ value: AppGraycardDefsMeasure, unit: String) throws -> Double {
        guard value.unit == unit, (0...12).contains(value.scale ?? 0) else {
            throw SettingsCalibrationRemoteRecordError.invalidMeasure
        }
        let result = Double(value.value) * pow(10, -Double(value.scale ?? 0))
        guard result.isFinite else { throw SettingsCalibrationRemoteRecordError.invalidMeasure }
        return result
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    private static func cameraModule(_ value: String) -> CameraModule? {
        switch value {
        case "front": .front
        case "ultra-wide": .ultraWide
        case "wide": .wide
        case "telephoto": .telephoto
        default: nil
        }
    }

    private static func sensorPath(_ value: String) -> SensorPath? {
        switch value {
        case "ae-metadata": .aeMetadata
        case "raw-patch": .rawPatch
        case "processed-patch": .processedPatch
        case "ambient-sensor", "dedicated-cell": .ambientSensor
        default: nil
        }
    }

    private static func reference(_ value: String) -> CalibrationReference? {
        switch value {
        case "sunny-16": .sunny16
        case "reference-meter": .handheldMeter
        case "known-illuminant": .knownTarget
        case "factory": .factory
        case "manufacturer-spec": .manufacturerSpecification
        default: nil
        }
    }

    private static func remoteCameraID(deviceModel: String, module: CameraModule) -> String {
        "remote:\(deviceModel):\(module.rawValue)"
    }

    private static func quantize(_ value: Double) -> Int64 {
        Int64((value * 10_000).rounded())
    }

    private static func quantizeDate(_ value: Date) -> Int64 {
        Int64((value.timeIntervalSince1970 * 1_000).rounded())
    }

    private static func stableID(for value: String) -> UUID {
        let high = fnv1a(value.utf8, seed: 1_469_598_103_934_665_603)
        let low = fnv1a(value.utf8.reversed(), seed: 10_995_116_282_11)
        let joined = String(format: "%016llx%016llx", high, low)
        let uuid =
            "\(joined.prefix(8))-\(joined.dropFirst(8).prefix(4))-4"
            + "\(joined.dropFirst(13).prefix(3))-a\(joined.dropFirst(17).prefix(3))-"
            + "\(joined.suffix(12))"
        return UUID(uuidString: uuid)!
    }

    private static func fnv1a<S: Sequence>(_ bytes: S, seed: UInt64) -> UInt64
    where S.Element == UInt8 {
        bytes.reduce(seed) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
    }
}

private enum SettingsCalibrationRemoteRecordError: Error {
    case invalidURI
    case schemaViolation
    case missingRequiredField
    case invalidMeasure
    case invalidRange
}
