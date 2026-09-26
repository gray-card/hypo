// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "CatalogKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "CatalogKit", targets: ["CatalogKit"])
    ],
    targets: [
        .target(
            name: "CatalogKit",
            resources: [.copy("Resources/Catalog")]
        ),
        .testTarget(name: "CatalogKitTests", dependencies: ["CatalogKit"]),
    ],
    swiftLanguageModes: [.v6]
)
