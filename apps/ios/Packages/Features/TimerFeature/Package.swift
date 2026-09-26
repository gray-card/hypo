// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "TimerFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "TimerFeature", targets: ["TimerFeature"])
    ],
    dependencies: [
        .package(path: "../../CatalogKit"),
        .package(path: "../../DesignSystem"),
        .package(path: "../../HypoLexicon"),
        .package(path: "../../TimerEngine"),
    ],
    targets: [
        .target(
            name: "TimerFeature",
            dependencies: ["CatalogKit", "DesignSystem", "HypoLexicon", "TimerEngine"]
        ),
        .testTarget(
            name: "TimerFeatureTests",
            dependencies: ["TimerFeature", "HypoLexicon", "TimerEngine"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
