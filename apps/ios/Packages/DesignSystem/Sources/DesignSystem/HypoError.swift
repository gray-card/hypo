import Foundation
import OSLog

/// Stable failure categories that can cross feature boundaries without carrying implementation
/// details into the interface.
public enum HypoError: Error, Equatable, Sendable {
    case authenticationRequired
    case authenticationExpired
    case networkUnavailable
    case conflict(recordURI: String)
    case validation(message: String)
    case cameraPermissionDenied
    case locationPermissionDenied
    case locationUnavailable
    case cameraUnavailable
    case measurementUnavailable
    case calibrationUnavailable
    case calibrationStorageUnavailable
    case meterHistoryUnavailable
    case meterSaveRequiresSignIn
    case meterSaveUnavailable
    case meterPromotionUnavailable
    case privateDataUnavailable
    case privateCloudUnavailable(localCopyExists: Bool)
    case libraryUnavailable
    case librarySaveRequiresSignIn
    case librarySaveUnavailable
    case frameHistoryUnavailable
    case exposureSaveUnavailable
    case recipeUnavailable
    case timerStorageUnavailable
    case developmentSaveRequiresSignIn
    case developmentSaveUnavailable
    case syncStatusUnavailable
    case localStorageUnavailable
    case permissionDenied(capability: String)
    case unsupported(message: String)
    case unexpected
}

/// User-facing copy and recovery guidance for a ``HypoError``.
public struct HypoErrorPresentation: Equatable, Identifiable, Sendable {
    public enum Severity: Equatable, Sendable {
        case warning
        case error
    }

    public enum RecoveryAction: Equatable, Sendable {
        case signIn
        case retry
        case reviewConflict(recordURI: String)
        case openSettings
        case openDiagnostics
        case dismiss
    }

    public let code: String
    public let title: String
    public let message: String
    public let severity: Severity
    public let recoveryLabel: String?
    public let recoveryAction: RecoveryAction

    public var id: String { code }

    public init(
        code: String = "HYPO-UNEXPECTED",
        title: String,
        message: String,
        severity: Severity = .error,
        recoveryLabel: String?,
        recoveryAction: RecoveryAction
    ) {
        self.code = code
        self.title = title
        self.message = message
        self.severity = severity
        self.recoveryLabel = recoveryLabel
        self.recoveryAction = recoveryAction
    }
}

/// The single application-wide mapping from semantic failures to user-facing copy.
public enum HypoErrorPresenter {
    public static func presentation(for error: HypoError) -> HypoErrorPresentation {
        switch error {
        case .authenticationRequired:
            presentation(
                "AUTH-REQUIRED",
                "Sign in required",
                "Sign in from Settings, then try again. Work already saved on this iPhone is unchanged.",
                "Open Settings",
                .signIn
            )
        case .authenticationExpired:
            presentation(
                "AUTH-EXPIRED",
                "Sign in again",
                "Your session has expired. Local changes remain on this iPhone.",
                "Open Settings",
                .signIn
            )
        case .networkUnavailable:
            presentation(
                "NETWORK-OFFLINE",
                "You’re offline",
                "Hypo will keep this change on your iPhone and sync it when the connection returns.",
                "Try Again",
                .retry
            )
        case .conflict(let recordURI):
            presentation(
                "SYNC-CONFLICT",
                "Review this change",
                "This record changed elsewhere before Hypo could sync your edit.",
                "Review",
                .reviewConflict(recordURI: recordURI)
            )
        case .validation(let message):
            presentation("INPUT-INVALID", "Check this entry", message, nil, .dismiss)
        case .cameraPermissionDenied:
            presentation(
                "CAMERA-PERMISSION",
                "Allow camera access",
                "The meter needs the camera to measure light. Allow access in iPhone Settings, then return to Hypo.",
                "Open Settings",
                .openSettings
            )
        case .locationPermissionDenied:
            presentation(
                "LOCATION-PERMISSION",
                "Allow location access",
                "Hypo can add a location only after you allow access in iPhone Settings. You can keep logging without it.",
                "Open Settings",
                .openSettings
            )
        case .locationUnavailable:
            presentation(
                "LOCATION-UNAVAILABLE",
                "Location not added",
                "Move to an open area and try again, or keep logging without a location.",
                "Try Again",
                .retry
            )
        case .cameraUnavailable:
            presentation(
                "CAMERA-UNAVAILABLE",
                "Camera not available",
                "Close any other app using the camera, make sure the lens is uncovered, and try again.",
                "Try Again",
                .retry
            )
        case .measurementUnavailable:
            presentation(
                "METER-MEASURE",
                "Couldn’t measure this scene",
                "Keep the camera uncovered and steady, then try again. No reading was saved.",
                "Try Again",
                .retry
            )
        case .calibrationUnavailable:
            presentation(
                "CALIBRATION-MEASURE",
                "Calibration reading unavailable",
                "Allow camera access, aim at a steady and evenly lit target, then measure again.",
                "Try Again",
                .retry
            )
        case .calibrationStorageUnavailable:
            presentation(
                "CALIBRATION-SAVE",
                "Calibration wasn’t changed",
                "Hypo couldn’t update the saved calibration profiles. The existing selection remains in use.",
                "Try Again",
                .retry
            )
        case .meterHistoryUnavailable:
            presentation(
                "METER-HISTORY",
                "Meter history unavailable",
                "Hypo couldn’t open the saved readings and calibration choices on this iPhone. New measurements may still work.",
                "Try Again",
                .retry
            )
        case .meterSaveRequiresSignIn:
            presentation(
                "METER-SIGN-IN",
                "Reading measured but not saved",
                "The meter works without an account. Sign in from Settings to add readings to your log; this reading remains on screen.",
                "Open Settings",
                .signIn
            )
        case .meterSaveUnavailable:
            presentation(
                "METER-SAVE",
                "Reading measured but not saved",
                "The reading remains on screen. Check available storage and try measuring again.",
                "Try Again",
                .retry
            )
        case .meterPromotionUnavailable:
            presentation(
                "METER-LOGGER",
                "Reading wasn’t added to the next frame",
                "The meter reading remains available. Open Log frames in Sessions and try again.",
                "Try Again",
                .retry
            )
        case .privateDataUnavailable:
            presentation(
                "PRIVATE-DATA",
                "Private meter data unavailable",
                "Public readings are unaffected. Review private-data settings and try again.",
                "Try Again",
                .retry
            )
        case .privateCloudUnavailable(let localCopyExists):
            presentation(
                "PRIVATE-ICLOUD",
                "Private iCloud sync paused",
                localCopyExists
                    ? "The encrypted local copy is safe on this iPhone. Check iCloud and try again."
                    : "No private data was sent. Check iCloud and try again.",
                "Try Again",
                .retry
            )
        case .libraryUnavailable:
            presentation(
                "LIBRARY-LOAD",
                "Library couldn’t refresh",
                "Hypo is showing saved records when available. Check your connection, then pull to refresh.",
                "Try Again",
                .retry
            )
        case .librarySaveRequiresSignIn:
            presentation(
                "LIBRARY-SIGN-IN",
                "Sign in to change your library",
                "Open Settings and connect your account, then repeat this change.",
                "Open Settings",
                .signIn
            )
        case .librarySaveUnavailable:
            presentation(
                "LIBRARY-SAVE",
                "Change not saved",
                "Nothing was added or removed. Check available storage and try again.",
                "Try Again",
                .retry
            )
        case .frameHistoryUnavailable:
            presentation(
                "LOGGER-FRAMES",
                "Frames couldn’t load",
                "The roll and its logged frames are unchanged. Check your connection and try again.",
                "Try Again",
                .retry
            )
        case .exposureSaveUnavailable:
            presentation(
                "LOGGER-SAVE",
                "Frame not saved",
                "The frame number has not advanced. Check available storage and try again.",
                "Try Again",
                .retry
            )
        case .recipeUnavailable:
            presentation(
                "TIMER-RECIPES",
                "Recipes couldn’t refresh",
                "Built-in recipes remain available. Sign in and check your connection to load personal recipes.",
                "Try Again",
                .retry
            )
        case .timerStorageUnavailable:
            presentation(
                "TIMER-SAVE",
                "Timer progress isn’t being saved",
                "The timer continues on screen. Keep Hypo open, check available storage, and try the action again.",
                "Try Again",
                .retry
            )
        case .developmentSaveRequiresSignIn:
            presentation(
                "TIMER-SIGN-IN",
                "Development completed but not recorded",
                "The completed timer remains on this iPhone. Sign in from Settings, then return here to retry saving it.",
                "Open Settings",
                .signIn
            )
        case .developmentSaveUnavailable:
            presentation(
                "TIMER-COMPLETE",
                "Development completed but not recorded",
                "The completed timer remains on this iPhone. Check available storage and your connection, then retry.",
                "Try Again",
                .retry
            )
        case .syncStatusUnavailable:
            presentation(
                "SYNC-STATUS",
                "Sync status unavailable",
                "Hypo couldn’t read the local queue. Your records were not changed. Close this panel and try again.",
                "Try Again",
                .retry
            )
        case .localStorageUnavailable:
            presentation(
                "STORAGE-UNAVAILABLE",
                "Changes won’t survive closing Hypo",
                "Hypo couldn’t open local storage. Free some space and restart the app before recording important work.",
                nil,
                .dismiss
            )
        case .permissionDenied(let capability):
            presentation(
                "PERMISSION-DENIED",
                "Allow \(capability)",
                "Hypo needs permission to use \(capability.lowercased()) for this feature.",
                "Open Settings",
                .openSettings
            )
        case .unsupported(let message):
            presentation("FEATURE-UNAVAILABLE", "Not available on this device", message, nil, .dismiss)
        case .unexpected:
            presentation(
                "UNEXPECTED",
                "Hypo couldn’t finish that",
                "Your saved records were not changed. Try again. If this keeps happening, export local diagnostics from Settings.",
                "Try Again",
                .retry
            )
        }
    }

    private static func presentation(
        _ code: String,
        _ title: String,
        _ message: String,
        _ recoveryLabel: String?,
        _ recoveryAction: HypoErrorPresentation.RecoveryAction
    ) -> HypoErrorPresentation {
        HypoErrorPresentation(
            code: code,
            title: title,
            message: message,
            recoveryLabel: recoveryLabel,
            recoveryAction: recoveryAction
        )
    }
}

/// Sends underlying failures to the unified system log without exposing them in UI copy.
public enum HypoErrorReporter {
    private static let logger = Logger(
        subsystem: "app.graycard.hypo",
        category: "UserFacingFailures"
    )

    public static func record(
        _ error: any Error,
        presentation: HypoErrorPresentation,
        file: StaticString = #fileID,
        line: UInt = #line
    ) {
        let detail = String(reflecting: error)
        logger.error(
            "\(presentation.code, privacy: .public) at \(String(describing: file), privacy: .public):\(line, privacy: .public): \(detail, privacy: .private(mask: .hash))"
        )
    }
}
