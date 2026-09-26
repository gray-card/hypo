// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "LoggerFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "LoggerFeature", targets: ["LoggerFeature"])
    ],
    dependencies: [
        .package(path: "../../DesignSystem"),
        .package(path: "../../HypoLexicon"),
        .package(path: "../../PersistenceKit"),
        .package(path: "../../SyncKit"),
    ],
    targets: [
        .target(
            name: "LoggerFeature",
            dependencies: [
                "DesignSystem",
                "HypoLexicon",
                "PersistenceKit",
                "SyncKit",
            ]
        ),
        .testTarget(
            name: "LoggerFeatureTests",
            dependencies: [
                "LoggerFeature",
                "HypoLexicon",
                "PersistenceKit",
                "SyncKit",
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
