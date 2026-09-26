// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .executable(
            name: "generate-design-system-snapshots",
            targets: ["GenerateDesignSystemSnapshots"]
        ),
    ],
    targets: [
        .target(name: "DesignSystem"),
        .target(name: "DesignSystemSnapshotSupport", dependencies: ["DesignSystem"]),
        .executableTarget(
            name: "GenerateDesignSystemSnapshots",
            dependencies: ["DesignSystem", "DesignSystemSnapshotSupport"]
        ),
        .testTarget(
            name: "DesignSystemTests",
            dependencies: ["DesignSystem", "DesignSystemSnapshotSupport"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
