// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "TimerEngine",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "TimerEngine", targets: ["TimerEngine"])
    ],
    targets: [
        .target(name: "TimerEngine"),
        .testTarget(name: "TimerEngineTests", dependencies: ["TimerEngine"]),
    ],
    swiftLanguageModes: [.v6]
)
