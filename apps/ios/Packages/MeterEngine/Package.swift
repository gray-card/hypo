// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MeterEngine",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "MeterEngine", targets: ["MeterEngine"])
    ],
    dependencies: [
        .package(path: "../PhotometryKit")
    ],
    targets: [
        .target(
            name: "MeterEngine",
            dependencies: ["PhotometryKit"]
        ),
        .testTarget(
            name: "MeterEngineTests",
            dependencies: ["MeterEngine", "PhotometryKit"]
        ),
    ]
)
