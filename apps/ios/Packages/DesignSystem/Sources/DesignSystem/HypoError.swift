import Foundation

/// Stable error categories used by feature models and the application shell.
public enum HypoError: Error, Equatable, Sendable {
    case authenticationExpired
    case networkUnavailable
    case conflict(recordURI: String)
    case validation(message: String)
    case permissionDenied(capability: String)
    case unsupported(message: String)
    case unexpected
}

/// User-facing copy and recovery guidance for a ``HypoError``.
public struct HypoErrorPresentation: Equatable, Sendable {
    public enum RecoveryAction: Equatable, Sendable {
        case signIn
        case retry
        case reviewConflict(recordURI: String)
        case openSettings
        case dismiss
    }

    public let title: String
    public let message: String
    public let recoveryLabel: String?
    public let recoveryAction: RecoveryAction

    public init(
        title: String,
        message: String,
        recoveryLabel: String?,
        recoveryAction: RecoveryAction
    ) {
        self.title = title
        self.message = message
        self.recoveryLabel = recoveryLabel
        self.recoveryAction = recoveryAction
    }
}

/// The single application-wide mapping from typed failures to user-facing copy.
public enum HypoErrorPresenter {
    public static func presentation(for error: HypoError) -> HypoErrorPresentation {
        switch error {
        case .authenticationExpired:
            HypoErrorPresentation(
                title: "Sign in again",
                message: "Your session has expired. Local changes remain on this iPhone.",
                recoveryLabel: "Sign in",
                recoveryAction: .signIn
            )
        case .networkUnavailable:
            HypoErrorPresentation(
                title: "You’re offline",
                message: "Hypo will keep this change on your iPhone and sync it when the connection returns.",
                recoveryLabel: "Try again",
                recoveryAction: .retry
            )
        case .conflict(let recordURI):
            HypoErrorPresentation(
                title: "Review this change",
                message: "This record changed elsewhere before Hypo could sync your edit.",
                recoveryLabel: "Review",
                recoveryAction: .reviewConflict(recordURI: recordURI)
            )
        case .validation(let message):
            HypoErrorPresentation(
                title: "Check this record",
                message: message,
                recoveryLabel: nil,
                recoveryAction: .dismiss
            )
        case .permissionDenied(let capability):
            HypoErrorPresentation(
                title: "Allow " + capability,
                message: "Hypo needs permission to use " + capability.lowercased() + " for this feature.",
                recoveryLabel: "Open Settings",
                recoveryAction: .openSettings
            )
        case .unsupported(let message):
            HypoErrorPresentation(
                title: "Not available on this device",
                message: message,
                recoveryLabel: nil,
                recoveryAction: .dismiss
            )
        case .unexpected:
            HypoErrorPresentation(
                title: "Hypo couldn’t finish that",
                message: "Your saved records were not changed. Try again.",
                recoveryLabel: "Try again",
                recoveryAction: .retry
            )
        }
    }
}
