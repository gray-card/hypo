// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PhotometryKit",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "PhotometryKit", targets: ["PhotometryKit"])
    ],
    targets: [
        .target(name: "PhotometryKit"),
        .testTarget(name: "PhotometryKitTests", dependencies: ["PhotometryKit"]),
    ]
)
