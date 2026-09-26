// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "SettingsFeature",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "SettingsFeature", targets: ["SettingsFeature"])
    ],
    dependencies: [
        .package(path: "../../ATProtoClient"),
        .package(path: "../../DesignSystem"),
        .package(path: "../../DiagnosticsKit"),
        .package(path: "../../HypoLexicon"),
        .package(path: "../../MeterEngine"),
        .package(path: "../../PhotometryKit"),
        .package(path: "../MeterFeature"),
    ],
    targets: [
        .target(
            name: "SettingsFeature",
            dependencies: [
                "ATProtoClient", "DesignSystem", "DiagnosticsKit", "HypoLexicon", "MeterEngine",
                "MeterFeature", "PhotometryKit",
            ]
        ),
        .testTarget(
            name: "SettingsFeatureTests",
            dependencies: [
                "SettingsFeature", "DiagnosticsKit", "HypoLexicon", "MeterEngine", "MeterFeature",
                "PhotometryKit",
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
