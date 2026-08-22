#if canImport(CoreImage) && canImport(CoreGraphics)
    import CoreGraphics
    import CoreImage
    import Foundation

    enum PlatformFrameDecoder {
        private static let maximumLongEdge = 2_048.0

        /// Decodes either a processed image or a DNG through Core Image into a bounded sRGB
        /// buffer, then converts that buffer to linear Rec. 709 luminance. DNG decoding here is
        /// deliberately treated as an uncharacterized rendered-RAW path; it does not expose
        /// native Bayer cells, black levels, or a camera color matrix.
        static func linearLuminancePlane(from frame: CapturedFrame) throws -> PixelPlane {
            let options: [CIImageOption: Any] = [.applyOrientationProperty: true]
            guard var image = CIImage(data: frame.payload.data, options: options) else {
                throw MeterError.invalidSensorSample("encoded frame cannot be decoded")
            }
            let sourceExtent = image.extent.integral
            guard sourceExtent.width > 0, sourceExtent.height > 0,
                sourceExtent.width.isFinite, sourceExtent.height.isFinite
            else {
                throw MeterError.invalidSensorSample("decoded frame dimensions")
            }

            image = image.transformed(
                by: CGAffineTransform(
                    translationX: -sourceExtent.minX,
                    y: -sourceExtent.minY
                ))
            let longEdge = max(sourceExtent.width, sourceExtent.height)
            if longEdge > maximumLongEdge {
                let scale = maximumLongEdge / longEdge
                image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            }

            let extent = image.extent.integral
            let width = max(1, Int(extent.width))
            let height = max(1, Int(extent.height))
            let rowBytes = width * 4
            var rgba = [UInt8](repeating: 0, count: rowBytes * height)
            guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
                throw MeterError.capabilityUnavailable("sRGB frame decoding")
            }
            let context = CIContext(options: [.cacheIntermediates: false])
            rgba.withUnsafeMutableBytes { bytes in
                guard let baseAddress = bytes.baseAddress else { return }
                context.render(
                    image,
                    toBitmap: baseAddress,
                    rowBytes: rowBytes,
                    bounds: CGRect(x: 0, y: 0, width: width, height: height),
                    format: .RGBA8,
                    colorSpace: colorSpace
                )
            }

            var luminance = [Double](repeating: 0, count: width * height)
            for outputY in 0..<height {
                // Core Image's bitmap origin is lower-left; PixelPlane coordinates follow the
                // top-left origin used by the reticle and the rest of the feature layer.
                let sourceY = height - outputY - 1
                for x in 0..<width {
                    let byteIndex = sourceY * rowBytes + x * 4
                    let red = try ProcessedFrameEstimator.linearizeSRGB(
                        Double(rgba[byteIndex]) / 255
                    )
                    let green = try ProcessedFrameEstimator.linearizeSRGB(
                        Double(rgba[byteIndex + 1]) / 255
                    )
                    let blue = try ProcessedFrameEstimator.linearizeSRGB(
                        Double(rgba[byteIndex + 2]) / 255
                    )
                    luminance[outputY * width + x] =
                        0.2126 * red + 0.7152 * green + 0.0722 * blue
                }
            }
            return try PixelPlane(width: width, height: height, values: luminance)
        }
    }
#endif
