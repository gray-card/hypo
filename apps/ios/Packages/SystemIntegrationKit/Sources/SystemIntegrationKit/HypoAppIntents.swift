#if canImport(AppIntents)
    import AppIntents
    import Foundation

    public enum MeterIntentMode: String, AppEnum, CaseIterable, Sendable {
        case reflected
        case spot
        case incident

        public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Meter mode")
        public static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
            .reflected: "Reflected",
            .spot: "Spot",
            .incident: "Incident",
        ]

        var model: HypoMeterMode { HypoMeterMode(rawValue: rawValue) ?? .reflected }
    }

    public struct LogFrameIntent: AppIntent {
        public static let title: LocalizedStringResource = "Log Frame"
        public static let description = IntentDescription(
            "Opens the field logger with optional aperture and shutter-speed values."
        )
        public static let openAppWhenRun = true

        @Parameter(title: "Aperture", description: "An f-number, such as 5.6.")
        public var aperture: String?

        @Parameter(title: "Shutter speed", description: "A shutter speed, such as 1/125.")
        public var shutterSpeed: String?

        public init() {}

        public init(aperture: String? = nil, shutterSpeed: String? = nil) {
            self.aperture = aperture
            self.shutterSpeed = shutterSpeed
        }

        public func perform() async throws -> some IntentResult {
            HypoSharedSnapshotStore()?.savePendingRoute(
                .log(aperture: aperture, shutterSpeed: shutterSpeed)
            )
            return .result()
        }
    }

    public struct StartTimerIntent: AppIntent {
        public static let title: LocalizedStringResource = "Start Development Timer"
        public static let description = IntentDescription(
            "Opens the development timer and selects a recipe when one is supplied."
        )
        public static let openAppWhenRun = true

        @Parameter(title: "Recipe", description: "The exact name or identifier of a recipe.")
        public var recipe: String?

        public init() {}

        public init(recipe: String? = nil) {
            self.recipe = recipe
        }

        public func perform() async throws -> some IntentResult {
            HypoSharedSnapshotStore()?.savePendingRoute(.timer(recipe: recipe))
            return .result()
        }
    }

    public struct StartMeterIntent: AppIntent {
        public static let title: LocalizedStringResource = "Start Light Meter"
        public static let description = IntentDescription(
            "Opens Hypo's light meter in the selected mode."
        )
        public static let openAppWhenRun = true

        @Parameter(title: "Mode", default: .reflected)
        public var mode: MeterIntentMode

        public init() {}

        public init(mode: MeterIntentMode) {
            self.mode = mode
        }

        public func perform() async throws -> some IntentResult {
            HypoSharedSnapshotStore()?.savePendingRoute(.meter(mode: mode.model))
            return .result()
        }
    }

    public struct GetLatestReadingIntent: AppIntent {
        public static let title: LocalizedStringResource = "Get Latest Meter Reading"
        public static let description = IntentDescription(
            "Returns the most recent meter reading saved by Hypo on this device."
        )
        public static let openAppWhenRun = false

        public init() {}

        public func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
            let summary =
                HypoSharedSnapshotStore()?.load()?.latestReading?.spokenSummary
                ?? "Hypo has no saved meter reading yet."
            return .result(value: summary, dialog: IntentDialog(stringLiteral: summary))
        }
    }

    public struct OpenQuickLogIntent: AppIntent {
        public static let title: LocalizedStringResource = "Open Quick Log"
        public static let openAppWhenRun = true

        public init() {}

        public func perform() async throws -> some IntentResult {
            HypoSharedSnapshotStore()?.savePendingRoute(
                .log(aperture: nil, shutterSpeed: nil)
            )
            return .result()
        }
    }

    public struct HypoAppShortcuts: AppShortcutsProvider {
        public static var appShortcuts: [AppShortcut] {
            AppShortcut(
                intent: LogFrameIntent(),
                phrases: [
                    "Log a frame in \(.applicationName)"
                ],
                shortTitle: "Log frame",
                systemImageName: "square.and.pencil"
            )
            AppShortcut(
                intent: StartTimerIntent(),
                phrases: [
                    "Start a development timer in \(.applicationName)"
                ],
                shortTitle: "Start timer",
                systemImageName: "timer"
            )
            AppShortcut(
                intent: StartMeterIntent(mode: .reflected),
                phrases: [
                    "Start the light meter in \(.applicationName)",
                    "Start the \(\.$mode) meter in \(.applicationName)",
                ],
                shortTitle: "Start meter",
                systemImageName: "camera.metering.center.weighted"
            )
            AppShortcut(
                intent: GetLatestReadingIntent(),
                phrases: ["Get my latest \(.applicationName) reading"],
                shortTitle: "Latest reading",
                systemImageName: "gauge.with.dots.needle.67percent"
            )
        }
    }

    public struct HypoAppIntentsPackage: AppIntentsPackage {}
#endif
