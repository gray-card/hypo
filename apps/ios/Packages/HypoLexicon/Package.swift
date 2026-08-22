// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "HypoLexicon",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "HypoLexicon", targets: ["HypoLexicon"])
    ],
    targets: [
        .target(
            name: "HypoLexicon",
            resources: [
                .process("Generated/LexiconSchemas.json"),
                .process("Generated/LexiconSourceManifest.json"),
            ]
        ),
        .testTarget(
            name: "HypoLexiconTests",
            dependencies: ["HypoLexicon"],
            resources: [.process("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
