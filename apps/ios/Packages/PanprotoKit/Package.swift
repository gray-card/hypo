// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "PanprotoKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "PanprotoKit", targets: ["PanprotoKit"])
    ],
    dependencies: [
        .package(path: "../HypoLexicon"),
        .package(
            url: "https://github.com/panproto/panproto-swift.git",
            exact: "0.70.1"
        ),
    ],
    targets: [
        .target(
            name: "PanprotoKit",
            dependencies: [
                "HypoLexicon",
                .product(name: "Panproto", package: "panproto-swift"),
                .product(name: "PanprotoStructural", package: "panproto-swift"),
            ]
        ),
        .testTarget(
            name: "PanprotoKitTests",
            dependencies: ["PanprotoKit"],
            resources: [.process("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
