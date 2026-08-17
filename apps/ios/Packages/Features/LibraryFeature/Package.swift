// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "LibraryFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "LibraryFeature", targets: ["LibraryFeature"])
    ],
    dependencies: [
        .package(path: "../../ATProtoClient"),
        .package(path: "../../CatalogKit"),
        .package(path: "../../DesignSystem"),
        .package(path: "../../HypoLexicon"),
        .package(path: "../../PersistenceKit"),
        .package(path: "../../SyncKit"),
        .package(path: "../LoggerFeature"),
    ],
    targets: [
        .target(
            name: "LibraryFeature",
            dependencies: [
                "CatalogKit",
                "DesignSystem",
                "HypoLexicon",
                "PersistenceKit",
                "SyncKit",
                "LoggerFeature",
            ]
        ),
        .testTarget(
            name: "LibraryFeatureTests",
            dependencies: [
                "LibraryFeature",
                "ATProtoClient",
                "CatalogKit",
                "HypoLexicon",
                "LoggerFeature",
                "PersistenceKit",
                "SyncKit",
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
