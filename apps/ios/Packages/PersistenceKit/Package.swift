// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PersistenceKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "PersistenceKit", targets: ["PersistenceKit"])
    ],
    targets: [
        .target(name: "PersistenceKit"),
        .testTarget(name: "PersistenceKitTests", dependencies: ["PersistenceKit"]),
    ]
)
