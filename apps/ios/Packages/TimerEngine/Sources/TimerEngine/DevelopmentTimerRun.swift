import Foundation

/// A serializable timer state machine driven exclusively by absolute dates.
///
/// Absolute `Date` arithmetic lets a restored run catch up after suspension or
/// relaunch without accumulating tick drift. It also makes daylight-saving
/// transitions irrelevant: elapsed time is measured on the UTC timeline.
public struct DevelopmentTimerRun: Codable, Hashable, Sendable {
    public let id: UUID
    public let plan: TimerPlan
    public private(set) var status: TimerRunStatus
    public private(set) var currentStageIndex: Int
    public private(set) var stageStartedAt: Date?
    public private(set) var pausedElapsed: TimeInterval?
    public private(set) var extensionsByStage: [Int: TimeInterval]
    public private(set) var lastObservedAt: Date?
    public private(set) var completedAt: Date?

    public init(id: UUID = UUID(), plan: TimerPlan) {
        self.id = id
        self.plan = plan
        status = .ready
        currentStageIndex = 0
        stageStartedAt = nil
        pausedElapsed = nil
        extensionsByStage = [:]
        lastObservedAt = nil
        completedAt = nil
    }

    public var currentStage: TimerStage {
        plan.stages[currentStageIndex]
    }

    public mutating func start(at date: Date) throws(TimerError) {
        guard status == .ready else {
            throw .invalidTransition(from: status, action: "start")
        }
        status = .running
        stageStartedAt = date
        lastObservedAt = date
    }

    public mutating func pause(at date: Date) throws(TimerError) {
        guard status == .running else {
            throw .invalidTransition(from: status, action: "pause")
        }
        try advance(to: date)
        guard status == .running, let startedAt = stageStartedAt else { return }
        pausedElapsed = min(max(0, date.timeIntervalSince(startedAt)), currentDuration)
        stageStartedAt = nil
        status = .paused
        lastObservedAt = date
    }

    public mutating func resume(at date: Date) throws(TimerError) {
        guard status == .paused, let elapsed = pausedElapsed else {
            throw .invalidTransition(from: status, action: "resume")
        }
        try ensureMonotonic(date)
        stageStartedAt = date.addingTimeInterval(-elapsed)
        pausedElapsed = nil
        status = .running
        lastObservedAt = date
    }

    public mutating func skip(at date: Date) throws(TimerError) {
        guard status == .running || status == .paused else {
            throw .invalidTransition(from: status, action: "skip")
        }
        if status == .running {
            try advance(to: date)
            if status == .completed { return }
        } else {
            try ensureMonotonic(date)
        }
        moveToNextStage(at: date)
        lastObservedAt = date
    }

    public mutating func extendCurrentStage(by interval: TimeInterval, at date: Date) throws(TimerError) {
        guard interval.isFinite, interval > 0 else {
            throw .invalidDuration(interval)
        }
        guard status == .running || status == .paused else {
            throw .invalidTransition(from: status, action: "extend")
        }
        if status == .running {
            try advance(to: date)
            if status == .completed {
                throw .invalidTransition(from: status, action: "extend")
            }
        } else {
            try ensureMonotonic(date)
        }
        extensionsByStage[currentStageIndex, default: 0] += interval
        lastObservedAt = date
    }

    public mutating func cancel(at date: Date) throws(TimerError) {
        guard status == .ready || status == .running || status == .paused else {
            throw .invalidTransition(from: status, action: "cancel")
        }
        try ensureMonotonic(date)
        status = .cancelled
        stageStartedAt = nil
        pausedElapsed = nil
        lastObservedAt = date
    }

    /// Advances across every elapsed stage and preserves overflow at boundaries.
    public mutating func advance(to date: Date) throws(TimerError) {
        guard status == .running else {
            if let lastObservedAt, date < lastObservedAt {
                throw .invalidTimeOrder(previous: lastObservedAt, next: date)
            }
            return
        }
        try ensureMonotonic(date)

        while status == .running, let startedAt = stageStartedAt {
            let duration = currentDuration
            let elapsed = max(0, date.timeIntervalSince(startedAt))
            guard elapsed >= duration else { break }
            moveToNextStage(at: startedAt.addingTimeInterval(duration))
        }
        lastObservedAt = date
    }

    public mutating func snapshot(at date: Date) throws(TimerError) -> TimerSnapshot {
        if status == .running {
            try advance(to: date)
        } else {
            try ensureMonotonic(date)
        }

        let duration = currentDuration
        let elapsed: TimeInterval
        switch status {
        case .ready:
            elapsed = 0
        case .paused:
            elapsed = min(max(0, pausedElapsed ?? 0), duration)
        case .running:
            elapsed = min(max(0, date.timeIntervalSince(stageStartedAt ?? date)), duration)
        case .completed:
            elapsed = duration
        case .cancelled:
            elapsed = min(max(0, pausedElapsed ?? 0), duration)
        }
        let remaining = max(0, duration - elapsed)
        let progress = duration > 0 ? min(1, max(0, elapsed / duration)) : 1
        let next =
            currentStageIndex + 1 < plan.stages.count
            ? plan.stages[currentStageIndex + 1]
            : nil
        let endsAt =
            status == .running
            ? stageStartedAt?.addingTimeInterval(duration)
            : nil

        return TimerSnapshot(
            status: status,
            stageIndex: currentStageIndex,
            stage: currentStage,
            elapsed: elapsed,
            remaining: remaining,
            progress: progress,
            stageStartedAt: stageStartedAt,
            stageEndsAt: endsAt,
            nextStage: next,
            agitation: AgitationScheduler.status(
                for: currentStage.agitation,
                elapsed: elapsed,
                stageDuration: duration
            )
        )
    }

    private var currentDuration: TimeInterval {
        currentStage.duration + extensionsByStage[currentStageIndex, default: 0]
    }

    private mutating func moveToNextStage(at date: Date) {
        if currentStageIndex + 1 < plan.stages.count {
            currentStageIndex += 1
            stageStartedAt = date
            pausedElapsed = nil
            status = .running
        } else {
            status = .completed
            stageStartedAt = nil
            pausedElapsed = nil
            completedAt = date
        }
    }

    private func ensureMonotonic(_ date: Date) throws(TimerError) {
        if let lastObservedAt, date < lastObservedAt {
            throw .invalidTimeOrder(previous: lastObservedAt, next: date)
        }
    }
}
