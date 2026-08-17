// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SyncKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SyncKit", targets: ["SyncKit"])
    ],
    dependencies: [
        .package(path: "../ATProtoClient"),
        .package(path: "../HypoLexicon"),
        .package(path: "../PanprotoKit"),
        .package(path: "../PersistenceKit"),
    ],
    targets: [
        .target(
            name: "SyncKit",
            dependencies: [
                .product(name: "ATProtoClient", package: "ATProtoClient"),
                .product(name: "HypoLexicon", package: "HypoLexicon"),
                .product(name: "PanprotoKit", package: "PanprotoKit"),
                .product(name: "PersistenceKit", package: "PersistenceKit"),
            ]
        ),
        .testTarget(
            name: "SyncKitTests",
            dependencies: [
                "SyncKit",
                .product(name: "ATProtoClient", package: "ATProtoClient"),
                .product(name: "PanprotoKit", package: "PanprotoKit"),
                .product(name: "PersistenceKit", package: "PersistenceKit"),
            ]
        ),
    ]
)
