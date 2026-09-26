import Foundation

public enum BayerPattern: String, Codable, CaseIterable, Sendable {
    case rggb
    case bggr
    case grbg
    case gbrg
}

public struct BayerPlane: Hashable, Sendable {
    public let width: Int
    public let height: Int
    public let samples: [UInt16]
    public let pattern: BayerPattern
    public let blackLevel: UInt16
    public let whiteLevel: UInt16

    public init(
        width: Int,
        height: Int,
        samples: [UInt16],
        pattern: BayerPattern,
        blackLevel: UInt16,
        whiteLevel: UInt16
    ) throws {
        guard width >= 2, height >= 2, samples.count == width * height,
            blackLevel < whiteLevel
        else {
            throw MeterError.invalidSensorSample("Bayer plane")
        }
        self.width = width
        self.height = height
        self.samples = samples
        self.pattern = pattern
        self.blackLevel = blackLevel
        self.whiteLevel = whiteLevel
    }

    /// Converts Bayer cells into a half-resolution linear luminance plane.
    ///
    /// This deterministic hook averages both green sites in each 2×2 cell and applies Rec. 709
    /// luminance weights. An incomplete final row or column is omitted. It does not apply a
    /// camera color matrix, lens shading, or flare model; those remain part of per-module
    /// characterization.
    public func linearLuminancePlane() throws -> PixelPlane {
        let outputWidth = width / 2
        let outputHeight = height / 2
        guard outputWidth > 0, outputHeight > 0 else {
            throw MeterError.invalidSensorSample("Bayer plane dimensions")
        }
        var values: [Double] = []
        values.reserveCapacity(outputWidth * outputHeight)
        for outputY in 0..<outputHeight {
            for outputX in 0..<outputWidth {
                let x = outputX * 2
                let y = outputY * 2
                let cell = [
                    normalized(sampleAtX: x, y: y),
                    normalized(sampleAtX: x + 1, y: y),
                    normalized(sampleAtX: x, y: y + 1),
                    normalized(sampleAtX: x + 1, y: y + 1),
                ]
                let channels = channels(for: cell)
                values.append(
                    0.2126 * channels.red + 0.7152 * channels.green
                        + 0.0722 * channels.blue
                )
            }
        }
        return try PixelPlane(width: outputWidth, height: outputHeight, values: values)
    }

    private func normalized(sampleAtX x: Int, y: Int) -> Double {
        let sample = samples[y * width + x]
        let clamped = min(whiteLevel, max(blackLevel, sample))
        return Double(clamped - blackLevel) / Double(whiteLevel - blackLevel)
    }

    private func channels(for cell: [Double]) -> (red: Double, green: Double, blue: Double) {
        switch pattern {
        case .rggb: (cell[0], (cell[1] + cell[2]) / 2, cell[3])
        case .bggr: (cell[3], (cell[1] + cell[2]) / 2, cell[0])
        case .grbg: (cell[1], (cell[0] + cell[3]) / 2, cell[2])
        case .gbrg: (cell[2], (cell[0] + cell[3]) / 2, cell[1])
        }
    }
}

public enum RGBTransferFunction: String, Codable, Sendable {
    case linear
    case sRGB
}

public struct RGBPlane: Hashable, Sendable {
    public let width: Int
    public let height: Int
    /// Interleaved red, green, and blue components, each in the closed interval 0...1.
    public let samples: [Double]
    public let transferFunction: RGBTransferFunction

    public init(
        width: Int,
        height: Int,
        samples: [Double],
        transferFunction: RGBTransferFunction
    ) throws {
        guard width > 0, height > 0, samples.count == width * height * 3,
            samples.allSatisfy({ $0.isFinite && (0...1).contains($0) })
        else {
            throw MeterError.invalidSensorSample("RGB plane")
        }
        self.width = width
        self.height = height
        self.samples = samples
        self.transferFunction = transferFunction
    }

    /// Produces linear Rec. 709 luminance. Processed captures remain approximate until their
    /// device tone pipeline has been characterized.
    public func linearLuminancePlane() throws -> PixelPlane {
        var values: [Double] = []
        values.reserveCapacity(width * height)
        for index in stride(from: 0, to: samples.count, by: 3) {
            let red = try linear(samples[index])
            let green = try linear(samples[index + 1])
            let blue = try linear(samples[index + 2])
            values.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
        }
        return try PixelPlane(width: width, height: height, values: values)
    }

    private func linear(_ component: Double) throws -> Double {
        switch transferFunction {
        case .linear: component
        case .sRGB: try ProcessedFrameEstimator.linearizeSRGB(component)
        }
    }
}
