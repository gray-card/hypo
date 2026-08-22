import Foundation
import PhotometryKit

public enum ReadingAverager {
    /// Averages measurements in linear light rather than directly averaging logarithmic EV values.
    public static func average(_ readings: [Reading]) throws -> Reading {
        guard let first = readings.first else {
            throw MeterError.invalidConfiguration("readings to average")
        }
        guard readings.allSatisfy({ $0.geometry == first.geometry }) else {
            throw MeterError.invalidConfiguration("mixed measurement geometries")
        }
        let meanFactor =
            readings.reduce(0) { $0 + pow(2, $1.ev100.rawValue) }
            / Double(readings.count)
        let ev = ExposureValue(log2(meanFactor))
        let calibration = try MeterCalibration(
            incidentConstant: first.calibrationConstant,
            reflectedConstant: first.calibrationConstant
        )
        let illuminance: Illuminance?
        let luminance: Luminance?
        switch first.geometry {
        case .incidentFlat, .incidentDome:
            illuminance = try ExposureMath.illuminance(fromEV100: ev, calibration: calibration)
            luminance = nil
        case .reflectedAverage, .reflectedSpot:
            illuminance = nil
            luminance = try ExposureMath.luminance(fromEV100: ev, calibration: calibration)
        }
        return Reading(
            takenAt: readings.map(\.takenAt).max() ?? first.takenAt,
            geometry: first.geometry,
            ev100: ev,
            illuminance: illuminance,
            luminance: luminance,
            exposure: first.exposure,
            camera: first.camera,
            sensorPath: first.sensorPath,
            accuracyTier: readings.allSatisfy({ $0.accuracyTier == .calibrated })
                ? .calibrated : .approximate,
            calibrationID: readings.allSatisfy({ $0.calibrationID == first.calibrationID })
                ? first.calibrationID : nil,
            calibrationConstant: first.calibrationConstant,
            nominalSpotAngleDegrees: readings.compactMap(\.nominalSpotAngleDegrees).max(),
            achievedSpotAngleDegrees: readings.compactMap(\.achievedSpotAngleDegrees).max(),
            flags: readings.reduce(into: Set<MeterFlag>()) { $0.formUnion($1.flags) },
            role: .average,
            averagedFrom: readings.map(\.id)
        )
    }
}

public actor DefaultMeterEngine: MeterService {
    private let sensor: any MeterSensor
    private var calibration: CalibrationProfile?
    private var captureInProgress = false
    private var captureWaiters: [CheckedContinuation<Void, Never>] = []

    public init(sensor: any MeterSensor, calibration: CalibrationProfile? = nil) {
        self.sensor = sensor
        self.calibration = calibration
    }

    public func setCalibration(_ profile: CalibrationProfile?) {
        calibration = profile
    }

    public func authorizationStatus() async -> CameraAuthorization {
        await sensor.authorizationStatus()
    }

    public func requestAuthorization() async -> Bool {
        await sensor.requestAuthorization()
    }

    public func discoverCameras() async throws -> [CameraDescriptor] {
        try await sensor.discoverCameras()
    }

    public func selectCamera(id: String) async throws {
        try await sensor.selectCamera(id: id)
    }

    public func readings(configuration: MeterConfiguration) async throws
        -> AsyncThrowingStream<Reading, any Error>
    {
        let sensor = self.sensor
        let calibration = self.calibration
        let upstream = try await sensor.samples(interval: configuration.samplingInterval)
        return AsyncThrowingStream { continuation in
            let task = Task {
                var window: [Reading] = []
                do {
                    for try await sample in upstream {
                        try Task.checkCancellation()
                        let reading = try Self.makeReading(
                            sample: sample,
                            configuration: configuration,
                            calibration: calibration
                        )
                        window.append(reading)
                        if window.count > configuration.averagingCount { window.removeFirst() }
                        if configuration.averagingCount == 1 {
                            continuation.yield(reading)
                        } else if window.count == configuration.averagingCount {
                            continuation.yield(try ReadingAverager.average(window))
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func capture(configuration: MeterConfiguration) async throws -> Reading {
        try await captureBatch(configuration: configuration).reading
    }

    public func captureBatch(configuration: MeterConfiguration) async throws -> MeterCapture {
        await acquireCaptureSlot()
        defer { releaseCaptureSlot() }
        let calibration = calibration
        return try await performCapture(configuration: configuration, calibration: calibration)
    }

    /// Captures the sensor's uncorrected value without changing the active calibration profile.
    /// Deliberate captures are serialized, so a Settings calibration sample cannot interleave its
    /// sensor transaction with a normal MeterFeature capture.
    public func captureUncalibrated(configuration: MeterConfiguration) async throws -> MeterCapture {
        await acquireCaptureSlot()
        defer { releaseCaptureSlot() }
        return try await performCapture(configuration: configuration, calibration: nil)
    }

    private func performCapture(
        configuration: MeterConfiguration,
        calibration: CalibrationProfile?
    ) async throws -> MeterCapture {
        switch configuration.mode {
        case let .reflectedSpot(nominalAngleDegrees):
            let request = try SpotCaptureRequest(
                normalizedX: configuration.spotPointX,
                normalizedY: configuration.spotPointY,
                nominalAngleDegrees: nominalAngleDegrees
            )
            try await sensor.lockExposure(nil)
            do {
                var captures: [Reading] = []
                for _ in 0..<configuration.averagingCount {
                    captures.append(
                        try Self.makeSpotReading(
                            measurement: await sensor.captureSpot(request),
                            configuration: configuration,
                            calibration: calibration
                        ))
                }
                try await sensor.unlockExposure()
                if captures.count == 1 {
                    return try MeterCapture(reading: captures[0])
                }
                return try MeterCapture(
                    reading: ReadingAverager.average(captures),
                    constituents: captures
                )
            } catch {
                try? await sensor.unlockExposure()
                throw error
            }

        case .reflectedAverage, .incident:
            let stream = try await sensor.samples(interval: configuration.samplingInterval)
            var captures: [Reading] = []
            for try await sample in stream {
                captures.append(
                    try Self.makeReading(
                        sample: sample,
                        configuration: configuration,
                        calibration: calibration
                    ))
                if captures.count == configuration.averagingCount { break }
            }
            guard !captures.isEmpty else { throw MeterError.traceExhausted }
            if captures.count == 1 {
                return try MeterCapture(reading: captures[0])
            }
            return try MeterCapture(
                reading: ReadingAverager.average(captures),
                constituents: captures
            )
        }
    }

    private func acquireCaptureSlot() async {
        guard captureInProgress else {
            captureInProgress = true
            return
        }
        await withCheckedContinuation { continuation in
            captureWaiters.append(continuation)
        }
    }

    private func releaseCaptureSlot() {
        guard !captureWaiters.isEmpty else {
            captureInProgress = false
            return
        }
        captureWaiters.removeFirst().resume()
    }

    private static func makeReading(
        sample: SensorSample,
        configuration: MeterConfiguration,
        calibration: CalibrationProfile?
    ) throws -> Reading {
        switch configuration.mode {
        case .reflectedAverage:
            let rawEV: ExposureValue
            if let exposure = sample.exposure {
                rawEV = exposure.ev100
            } else if let luminance = sample.luminanceCandelaPerSquareMetre {
                rawEV = try ExposureMath.ev100(
                    from: Luminance(candelaPerSquareMetre: luminance))
            } else {
                throw MeterError.invalidSensorSample("reflected reading has no exposure or luminance")
            }
            return try reflectedReading(
                rawEV: rawEV,
                sample: sample,
                geometry: .reflectedAverage,
                nominalAngle: nil,
                achievedAngle: nil,
                configuration: configuration,
                calibration: calibration
            )

        case let .reflectedSpot(nominalAngle):
            guard let luminance = sample.luminanceCandelaPerSquareMetre else {
                throw MeterError.capabilityUnavailable(
                    "continuous spot readings require spot luminance samples")
            }
            let rawEV = try ExposureMath.ev100(
                from: Luminance(candelaPerSquareMetre: luminance))
            return try reflectedReading(
                rawEV: rawEV,
                sample: sample,
                geometry: .reflectedSpot,
                nominalAngle: nominalAngle,
                achievedAngle: sample.achievedSpotAngleDegrees,
                configuration: configuration,
                calibration: calibration
            )

        case let .incident(receptor):
            let defaultCalibration = try MeterCalibration(
                incidentConstant: receptor.conventionalConstant,
                reflectedConstant: 12.5
            )
            var flags = sample.flags
            let rawEV: ExposureValue
            if let illuminance = sample.illuminanceLux {
                rawEV = try ExposureMath.ev100(
                    from: Illuminance(lux: illuminance),
                    calibration: defaultCalibration
                )
            } else if let exposure = sample.exposure {
                rawEV = exposure.ev100
                flags.insert(.approximate)
            } else {
                throw MeterError.invalidSensorSample("incident reading has no illuminance estimate")
            }
            let application = applyCalibration(
                rawEV: rawEV,
                camera: sample.camera,
                sensorPath: sample.sensorPath,
                profile: calibration,
                baseFlags: flags
            )
            let matchingCalibration =
                calibration?.matches(
                    camera: sample.camera, sensorPath: sample.sensorPath) == true ? calibration : nil
            let meterCalibration = matchingCalibration?.photometryCalibration ?? defaultCalibration
            flags = application.flags
            flagRange(
                application.ev.rawValue,
                validated: matchingCalibration?.validatedEVRange,
                configured: configuration.calibratedEVRange,
                flags: &flags
            )
            return Reading(
                takenAt: sample.capturedAt,
                geometry: receptor == .dome ? .incidentDome : .incidentFlat,
                ev100: application.ev,
                illuminance: try ExposureMath.illuminance(
                    fromEV100: application.ev, calibration: meterCalibration),
                exposure: sample.exposure,
                camera: sample.camera,
                sensorPath: sample.sensorPath,
                accuracyTier: accuracyTier(profile: matchingCalibration, flags: flags),
                calibrationID: application.calibrationID,
                calibrationConstant: meterCalibration.incidentConstant,
                flags: flags
            )
        }
    }

    private static func makeSpotReading(
        measurement: SpotMeasurement,
        configuration: MeterConfiguration,
        calibration: CalibrationProfile?
    ) throws -> Reading {
        let sample = SensorSample(
            capturedAt: measurement.capturedAt,
            camera: measurement.camera,
            sensorPath: measurement.sensorPath,
            achievedSpotAngleDegrees: measurement.achievedAngleDegrees,
            flags: measurement.flags
        )
        return try reflectedReading(
            rawEV: measurement.uncalibratedEV100,
            sample: sample,
            geometry: .reflectedSpot,
            nominalAngle: measurement.nominalAngleDegrees,
            achievedAngle: measurement.achievedAngleDegrees,
            configuration: configuration,
            calibration: calibration
        )
    }

    private static func reflectedReading(
        rawEV: ExposureValue,
        sample: SensorSample,
        geometry: MeasurementGeometry,
        nominalAngle: Double?,
        achievedAngle: Double?,
        configuration: MeterConfiguration,
        calibration: CalibrationProfile?
    ) throws -> Reading {
        let application = applyCalibration(
            rawEV: rawEV,
            camera: sample.camera,
            sensorPath: sample.sensorPath,
            profile: calibration,
            baseFlags: sample.flags
        )
        let matchingCalibration =
            calibration?.matches(
                camera: sample.camera, sensorPath: sample.sensorPath) == true ? calibration : nil
        let meterCalibration = matchingCalibration?.photometryCalibration ?? .conventional
        var flags = application.flags
        flagRange(
            application.ev.rawValue,
            validated: matchingCalibration?.validatedEVRange,
            configured: configuration.calibratedEVRange,
            flags: &flags
        )
        return Reading(
            takenAt: sample.capturedAt,
            geometry: geometry,
            ev100: application.ev,
            luminance: try ExposureMath.luminance(
                fromEV100: application.ev, calibration: meterCalibration),
            exposure: sample.exposure,
            camera: sample.camera,
            sensorPath: sample.sensorPath,
            accuracyTier: accuracyTier(profile: matchingCalibration, flags: flags),
            calibrationID: application.calibrationID,
            calibrationConstant: meterCalibration.reflectedConstant,
            nominalSpotAngleDegrees: nominalAngle,
            achievedSpotAngleDegrees: achievedAngle,
            flags: flags
        )
    }

    private static func applyCalibration(
        rawEV: ExposureValue,
        camera: CameraDescriptor,
        sensorPath: SensorPath,
        profile: CalibrationProfile?,
        baseFlags: Set<MeterFlag>
    ) -> (ev: ExposureValue, calibrationID: UUID?, flags: Set<MeterFlag>) {
        var flags = baseFlags
        guard let profile else {
            flags.insert(.calibrationMissing)
            return (rawEV, nil, flags)
        }
        guard profile.matches(camera: camera, sensorPath: sensorPath) else {
            flags.insert(.calibrationMismatch)
            return (rawEV, nil, flags)
        }
        return (profile.corrected(rawEV), profile.id, flags)
    }

    private static func accuracyTier(
        profile: CalibrationProfile?,
        flags: Set<MeterFlag>
    ) -> AccuracyTier {
        if flags.contains(.approximate) { return .approximate }
        if flags.contains(.calibrationMismatch) || flags.contains(.calibrationMissing) {
            return .unknown
        }
        return profile == nil ? .unknown : .calibrated
    }

    private static func flagRange(
        _ ev: Double,
        validated: ClosedRange<Double>?,
        configured: ClosedRange<Double>,
        flags: inout Set<MeterFlag>
    ) {
        if !configured.contains(ev) || (validated.map { !$0.contains(ev) } ?? false) {
            flags.insert(.outOfRange)
        }
    }
}
