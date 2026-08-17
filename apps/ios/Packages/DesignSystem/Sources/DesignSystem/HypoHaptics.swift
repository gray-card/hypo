#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

/// Semantic feedback events used by Hypo controls and workflows.
public enum HypoHapticCue: String, CaseIterable, Sendable {
    case selectionChanged
    case dialDetent
    case actionSucceeded
    case warning
    case failure
    case timerStage
    case timerCompleted
}

/// Platform-neutral feedback patterns. Keeping the mapping separate makes fallback behavior testable.
public enum HypoHapticPattern: Equatable, Sendable {
    case selection
    case lightImpact
    case mediumImpact
    case success
    case warning
    case error
}

extension HypoHapticCue {
    public var pattern: HypoHapticPattern {
        switch self {
        case .selectionChanged:
            .selection
        case .dialDetent, .timerStage:
            .lightImpact
        case .actionSucceeded, .timerCompleted:
            .success
        case .warning:
            .warning
        case .failure:
            .error
        }
    }
}

/// A feedback player that uses the best haptic API available on the current platform.
@MainActor
public protocol HypoHapticPlaying: AnyObject {
    func play(_ cue: HypoHapticCue)
}

/// The system haptic player. Calls safely become no-ops on platforms without haptic support.
@MainActor
public final class SystemHypoHaptics: HypoHapticPlaying {
    public static let shared = SystemHypoHaptics()

    public init() {}

    public func play(_ cue: HypoHapticCue) {
        #if canImport(UIKit)
            switch cue.pattern {
            case .selection:
                UISelectionFeedbackGenerator().selectionChanged()
            case .lightImpact:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case .mediumImpact:
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case .success:
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case .warning:
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case .error:
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        #elseif canImport(AppKit)
            switch cue.pattern {
            case .selection, .lightImpact:
                NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
            case .mediumImpact, .success, .warning, .error:
                NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now)
            }
        #else
            _ = cue
        #endif
    }
}
