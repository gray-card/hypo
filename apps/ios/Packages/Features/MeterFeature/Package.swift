// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "MeterFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "MeterFeature", targets: ["MeterFeature"])
    ],
    dependencies: [
        .package(path: "../../DesignSystem"),
        .package(path: "../../MeterEngine"),
        .package(path: "../../PhotometryKit"),
    ],
    targets: [
        .target(
            name: "MeterFeature",
            dependencies: ["DesignSystem", "MeterEngine", "PhotometryKit"]
        ),
        .testTarget(
            name: "MeterFeatureTests",
            dependencies: ["MeterFeature", "MeterEngine", "PhotometryKit"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
