import Foundation

/// Agitation timing for one process stage.
public enum AgitationSchedule: Codable, Hashable, Sendable {
    case none
    case continuous
    case periodic(initial: TimeInterval, every: TimeInterval, for: TimeInterval)

    func validate() throws(TimerError) {
        switch self {
        case .none, .continuous:
            return
        case .periodic(let initial, let interval, let activeDuration):
            guard initial.isFinite, initial >= 0 else {
                throw .invalidDuration(initial)
            }
            guard interval.isFinite, interval > 0 else {
                throw .invalidDuration(interval)
            }
            guard activeDuration.isFinite, activeDuration > 0, activeDuration <= interval else {
                throw .invalidDuration(activeDuration)
            }
        }
    }
}

/// Whether the user should agitate now and when the next state change occurs.
public struct AgitationStatus: Codable, Hashable, Sendable {
    public let isActive: Bool
    public let nextTransitionAfter: TimeInterval?

    public init(isActive: Bool, nextTransitionAfter: TimeInterval?) {
        self.isActive = isActive
        self.nextTransitionAfter = nextTransitionAfter
    }
}

/// Computes agitation state from stage-relative elapsed time without scheduling timers.
public enum AgitationScheduler {
    public static func status(
        for schedule: AgitationSchedule,
        elapsed: TimeInterval,
        stageDuration: TimeInterval
    ) -> AgitationStatus {
        let elapsed = min(max(0, elapsed), max(0, stageDuration))

        switch schedule {
        case .none:
            return AgitationStatus(isActive: false, nextTransitionAfter: nil)
        case .continuous:
            return AgitationStatus(isActive: elapsed < stageDuration, nextTransitionAfter: nil)
        case .periodic(let initial, let interval, let activeDuration):
            if elapsed < initial {
                return AgitationStatus(
                    isActive: true,
                    nextTransitionAfter: min(initial - elapsed, stageDuration - elapsed)
                )
            }

            let cycle = floor(elapsed / interval)
            let cycleStart = cycle * interval
            let offset = elapsed - cycleStart
            let active = cycle >= 1 && offset < activeDuration
            let transition: TimeInterval
            if active {
                transition = activeDuration - offset
            } else {
                transition = ((cycle + 1) * interval) - elapsed
            }
            let bounded = min(max(0, transition), max(0, stageDuration - elapsed))
            return AgitationStatus(
                isActive: active,
                nextTransitionAfter: bounded > 0 ? bounded : nil
            )
        }
    }
}
