import Foundation
import PhotometryKit

public struct PixelPlane: Hashable, Sendable {
    public let width: Int
    public let height: Int
    public let values: [Double]

    public init(width: Int, height: Int, values: [Double]) throws {
        guard width > 0, height > 0, values.count == width * height,
            values.allSatisfy({ $0.isFinite && $0 >= 0 })
        else {
            throw MeterError.invalidSensorSample("pixel plane")
        }
        self.width = width
        self.height = height
        self.values = values
    }
}

public struct SpotPatchResult: Hashable, Sendable {
    public let meanLinearSignal: Double
    public let sampledPixelCount: Int
    public let requestedAngleDegrees: Double
    public let achievedAngleDegrees: Double
    public let flags: Set<MeterFlag>
}

public enum SpotPatchIntegrator {
    /// Integrates a circular patch in a linear pixel plane.
    ///
    /// The achieved angle cannot be smaller than one horizontal pixel. A patch touching the
    /// image boundary remains measurable but is labeled `patchClipped`.
    public static func integrate(
        plane: PixelPlane,
        normalizedX: Double,
        normalizedY: Double,
        requestedAngleDegrees: Double,
        horizontalFieldOfViewDegrees: Double
    ) throws -> SpotPatchResult {
        guard (0...1).contains(normalizedX), (0...1).contains(normalizedY),
            requestedAngleDegrees > 0, horizontalFieldOfViewDegrees > 0,
            requestedAngleDegrees.isFinite, horizontalFieldOfViewDegrees.isFinite
        else {
            throw MeterError.invalidConfiguration("spot patch geometry")
        }
        let degreesPerPixel = horizontalFieldOfViewDegrees / Double(plane.width)
        let achievedAngle = max(requestedAngleDegrees, degreesPerPixel)
        let radius = max(0.5, achievedAngle / degreesPerPixel / 2)
        let centerX = normalizedX * Double(plane.width - 1)
        let centerY = normalizedY * Double(plane.height - 1)
        var flags: Set<MeterFlag> = []
        if centerX - radius < 0 || centerX + radius > Double(plane.width - 1)
            || centerY - radius < 0 || centerY + radius > Double(plane.height - 1)
        {
            flags.insert(.patchClipped)
        }

        let minX = max(0, Int(floor(centerX - radius)))
        let maxX = min(plane.width - 1, Int(ceil(centerX + radius)))
        let minY = max(0, Int(floor(centerY - radius)))
        let maxY = min(plane.height - 1, Int(ceil(centerY + radius)))
        var sum = 0.0
        var count = 0
        for y in minY...maxY {
            for x in minX...maxX {
                let dx = (Double(x) - centerX) / radius
                let dy = (Double(y) - centerY) / radius
                guard dx * dx + dy * dy <= 1 else { continue }
                sum += plane.values[y * plane.width + x]
                count += 1
            }
        }
        if count == 0 {
            let nearestX = min(plane.width - 1, max(0, Int(centerX.rounded())))
            let nearestY = min(plane.height - 1, max(0, Int(centerY.rounded())))
            sum = plane.values[nearestY * plane.width + nearestX]
            count = 1
        }
        guard count > 0, sum > 0 else {
            throw MeterError.invalidSensorSample("empty or black spot patch")
        }
        return SpotPatchResult(
            meanLinearSignal: sum / Double(count),
            sampledPixelCount: count,
            requestedAngleDegrees: requestedAngleDegrees,
            achievedAngleDegrees: achievedAngle,
            flags: flags
        )
    }
}

public struct SpotSignalMapper: Hashable, Codable, Sendable {
    public let referenceSignal: Double
    public let referenceEV100: ExposureValue

    public init(referenceSignal: Double, referenceEV100: ExposureValue) throws {
        guard referenceSignal > 0, referenceSignal.isFinite else {
            throw MeterError.invalidConfiguration("spot signal reference")
        }
        self.referenceSignal = referenceSignal
        self.referenceEV100 = referenceEV100
    }

    public func ev100(forLinearSignal signal: Double) throws -> ExposureValue {
        guard signal > 0, signal.isFinite else {
            throw MeterError.invalidSensorSample("spot signal")
        }
        return ExposureValue(referenceEV100.rawValue + log2(signal / referenceSignal))
    }
}

public struct SpotFrameEstimate: Hashable, Sendable {
    public let uncalibratedEV100: ExposureValue
    public let requestedAngleDegrees: Double
    public let achievedAngleDegrees: Double
    public let sampledPixelCount: Int
    public let flags: Set<MeterFlag>

    public init(
        uncalibratedEV100: ExposureValue,
        requestedAngleDegrees: Double,
        achievedAngleDegrees: Double,
        sampledPixelCount: Int,
        flags: Set<MeterFlag>
    ) {
        self.uncalibratedEV100 = uncalibratedEV100
        self.requestedAngleDegrees = requestedAngleDegrees
        self.achievedAngleDegrees = achievedAngleDegrees
        self.sampledPixelCount = sampledPixelCount
        self.flags = flags
    }
}

public enum SpotFrameEstimator {
    /// Estimates spot EV from a linear-light frame and the exposure used to capture it.
    ///
    /// `referenceSignal` is the rendered value expected for the camera's metered target. It is a
    /// characterization input, not a universal camera constant. The default is useful as an
    /// explicitly approximate starting point; production measurements must retain the
    /// `approximate` flag until the capture path is characterized on physical hardware.
    public static func estimate(
        plane: PixelPlane,
        request: SpotCaptureRequest,
        horizontalFieldOfViewDegrees: Double,
        referenceEV100: ExposureValue,
        referenceSignal: Double = 0.18,
        isCharacterized: Bool = false
    ) throws -> SpotFrameEstimate {
        let patch = try SpotPatchIntegrator.integrate(
            plane: plane,
            normalizedX: request.normalizedX,
            normalizedY: request.normalizedY,
            requestedAngleDegrees: request.nominalAngleDegrees,
            horizontalFieldOfViewDegrees: horizontalFieldOfViewDegrees
        )
        let surroundingSignal = plane.values.reduce(0, +) / Double(plane.values.count)
        var flags = patch.flags
        flags.formUnion(
            try FlareHeuristic.flags(
                patchSignal: patch.meanLinearSignal,
                surroundingSignal: surroundingSignal
            ))
        if !isCharacterized { flags.insert(.approximate) }
        if patch.meanLinearSignal >= 0.99 { flags.insert(.outOfRange) }
        let mapper = try SpotSignalMapper(
            referenceSignal: referenceSignal,
            referenceEV100: referenceEV100
        )
        return SpotFrameEstimate(
            uncalibratedEV100: try mapper.ev100(forLinearSignal: patch.meanLinearSignal),
            requestedAngleDegrees: patch.requestedAngleDegrees,
            achievedAngleDegrees: patch.achievedAngleDegrees,
            sampledPixelCount: patch.sampledPixelCount,
            flags: flags
        )
    }
}

public enum ProcessedFrameEstimator {
    /// Converts a normalized sRGB component to linear light using IEC 61966-2-1's transfer curve.
    public static func linearizeSRGB(_ encoded: Double) throws -> Double {
        guard (0...1).contains(encoded), encoded.isFinite else {
            throw MeterError.invalidSensorSample("sRGB component")
        }
        if encoded <= 0.04045 { return encoded / 12.92 }
        return pow((encoded + 0.055) / 1.055, 2.4)
    }

    public static func linearPlane(fromSRGB plane: PixelPlane) throws -> PixelPlane {
        try PixelPlane(
            width: plane.width,
            height: plane.height,
            values: try plane.values.map(linearizeSRGB)
        )
    }
}

public enum FlareHeuristic {
    /// Marks a dark spot at risk when its surrounding signal exceeds it by the selected stop range.
    public static func flags(
        patchSignal: Double,
        surroundingSignal: Double,
        thresholdStops: Double = 4
    ) throws -> Set<MeterFlag> {
        guard patchSignal > 0, surroundingSignal >= 0, thresholdStops >= 0,
            patchSignal.isFinite, surroundingSignal.isFinite, thresholdStops.isFinite
        else {
            throw MeterError.invalidSensorSample("flare heuristic")
        }
        guard surroundingSignal > 0 else { return [] }
        return log2(surroundingSignal / patchSignal) >= thresholdStops ? [.flareRisk] : []
    }
}

public struct MultiSpotMemory: Hashable, Codable, Sendable {
    public static let capacity = 9
    public private(set) var readings: [Reading]

    public init(readings: [Reading] = []) throws {
        guard readings.count <= Self.capacity,
            readings.allSatisfy({ $0.geometry == .reflectedSpot })
        else {
            throw MeterError.invalidConfiguration("multi-spot memory")
        }
        self.readings = readings
    }

    public mutating func add(_ reading: Reading) throws {
        guard reading.geometry == .reflectedSpot else {
            throw MeterError.invalidConfiguration("non-spot reading")
        }
        guard readings.count < Self.capacity else {
            throw MeterError.capabilityUnavailable("multi-spot memory is full")
        }
        readings.append(reading)
    }

    public mutating func clear() { readings.removeAll() }

    public var contrastRange: Stops? {
        guard let minimum = readings.map(\.ev100.rawValue).min(),
            let maximum = readings.map(\.ev100.rawValue).max()
        else { return nil }
        return Stops(maximum - minimum)
    }

    public func average() throws -> Reading {
        try ReadingAverager.average(readings)
    }
}
