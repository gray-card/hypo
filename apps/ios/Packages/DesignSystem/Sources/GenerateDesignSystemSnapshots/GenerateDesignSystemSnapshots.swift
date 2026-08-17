#if os(macOS)
    import AppKit
    import DesignSystem
    import DesignSystemSnapshotSupport
    import SwiftUI

    @main
    struct GenerateDesignSystemSnapshots {
        @MainActor
        static func main() throws {
            let outputDirectory = try requestedOutputDirectory()
            try FileManager.default.createDirectory(
                at: outputDirectory,
                withIntermediateDirectories: true
            )

            let referenceRenderer = ComponentGalleryReferenceRenderer()
            var manifestEntries: [String] = []

            for scene in HypoComponentGalleryScene.snapshots {
                let svgName = scene.id + ".svg"
                let pngName = scene.id + ".png"
                try referenceRenderer.svg(for: scene).write(
                    to: outputDirectory.appendingPathComponent(svgName),
                    atomically: true,
                    encoding: .utf8
                )
                try pngData(for: scene).write(to: outputDirectory.appendingPathComponent(pngName))
                manifestEntries.append(
                    """
                        {"id":"\(scene.id)","reference":"\(svgName)","platform":"\(pngName)","referenceFingerprint":"\(referenceRenderer.fingerprint(for: scene))"}
                    """
                )
            }

            let manifest = """
                {"format":1,"scenes":[
                \(manifestEntries.joined(separator: ",\n"))
                ]}
                """
            try manifest.write(
                to: outputDirectory.appendingPathComponent("manifest.json"),
                atomically: true,
                encoding: .utf8
            )
            print(
                "Wrote \(HypoComponentGalleryScene.snapshots.count) component-gallery scenes to \(outputDirectory.path)"
            )
        }

        private static func requestedOutputDirectory() throws -> URL {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard arguments.count == 2, arguments[0] == "--output" else {
                throw SnapshotGenerationError.usage
            }
            return URL(fileURLWithPath: arguments[1], isDirectory: true)
        }

        @MainActor
        private static func pngData(for scene: HypoComponentGalleryScene) throws -> Data {
            let renderer = ImageRenderer(content: HypoComponentGallery(scene: scene))
            renderer.proposedSize = ProposedViewSize(scene.viewport)
            renderer.scale = 2
            renderer.isOpaque = true

            guard let image = renderer.cgImage else {
                throw SnapshotGenerationError.renderFailed(scene.id)
            }
            let representation = NSBitmapImageRep(cgImage: image)
            guard let data = representation.representation(using: .png, properties: [:]) else {
                throw SnapshotGenerationError.encodingFailed(scene.id)
            }
            return data
        }
    }

    private enum SnapshotGenerationError: Error, CustomStringConvertible {
        case usage
        case renderFailed(String)
        case encodingFailed(String)

        var description: String {
            switch self {
            case .usage:
                "Usage: generate-design-system-snapshots --output <directory>"
            case .renderFailed(let scene):
                "SwiftUI could not render component-gallery scene \(scene)."
            case .encodingFailed(let scene):
                "AppKit could not encode component-gallery scene \(scene) as PNG."
            }
        }
    }
#else
    @main
    struct GenerateDesignSystemSnapshots {
        static func main() {
            fatalError("Component-gallery snapshots require macOS.")
        }
    }
#endif
