// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "SystemIntegrationKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SystemIntegrationKit", targets: ["SystemIntegrationKit"])
    ],
    targets: [
        .target(name: "SystemIntegrationKit"),
        .testTarget(
            name: "SystemIntegrationKitTests",
            dependencies: ["SystemIntegrationKit"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
