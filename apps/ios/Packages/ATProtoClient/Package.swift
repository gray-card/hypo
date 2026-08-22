// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ATProtoClient",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ATProtoClient", targets: ["ATProtoClient"])
    ],
    targets: [
        .target(name: "ATProtoClient"),
        .testTarget(
            name: "ATProtoClientTests",
            dependencies: ["ATProtoClient"],
            resources: [.process("Fixtures")]
        ),
    ]
)
