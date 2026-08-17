// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "SyncStatusFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SyncStatusFeature", targets: ["SyncStatusFeature"])
    ],
    dependencies: [
        .package(path: "../../DesignSystem"),
        .package(path: "../../PersistenceKit"),
        .package(path: "../../SyncKit"),
    ],
    targets: [
        .target(
            name: "SyncStatusFeature",
            dependencies: ["DesignSystem", "PersistenceKit", "SyncKit"]
        ),
        .testTarget(
            name: "SyncStatusFeatureTests",
            dependencies: ["PersistenceKit", "SyncKit", "SyncStatusFeature"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
