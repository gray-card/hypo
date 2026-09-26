import Foundation
import TimerEngine

/// The platform-facing state shared by local notifications and the Live Activity.
public struct TimerPlatformPresentation: Equatable, Sendable {
    public let runID: UUID
    public let recipeName: String
    public let status: TimerRunStatus
    public let stageIndex: Int
    public let stageCount: Int
    public let stageName: String
    public let nextStageName: String?
    public let stageStartedAt: Date?
    public let stageEndsAt: Date?
    public let remainingWhenPaused: TimeInterval?
    public let isAgitating: Bool
    public let nextAgitationAt: Date?
    public let boundaries: [TimerStageBoundary]

    public init(
        run: DevelopmentTimerRun,
        snapshot: TimerSnapshot,
        recipeName: String,
        now: Date
    ) {
        runID = run.id
        self.recipeName = recipeName
        status = snapshot.status
        stageIndex = snapshot.stageIndex
        stageCount = run.plan.stages.count
        stageName = snapshot.stage.name
        nextStageName = snapshot.nextStage?.name
        stageStartedAt = snapshot.stageStartedAt
        stageEndsAt = snapshot.stageEndsAt
        remainingWhenPaused = snapshot.status == .paused ? snapshot.remaining : nil
        isAgitating = snapshot.agitation.isActive
        nextAgitationAt = Self.nextAgitationDate(snapshot: snapshot)
        boundaries = Self.stageBoundaries(run: run, snapshot: snapshot, now: now)
    }

    public func agitationTransition(
        from previous: TimerPlatformPresentation?
    ) -> TimerAgitationTransition? {
        guard status == .running else { return nil }
        guard let previous else { return isAgitating ? .began : nil }
        guard previous.runID == runID else { return isAgitating ? .began : nil }
        if previous.status != .running || previous.stageIndex != stageIndex {
            return isAgitating ? .began : nil
        }
        guard previous.isAgitating != isAgitating else { return nil }
        return isAgitating ? .began : .ended
    }

    private static func stageBoundaries(
        run: DevelopmentTimerRun,
        snapshot: TimerSnapshot,
        now: Date
    ) -> [TimerStageBoundary] {
        guard snapshot.status == .running, let currentEnd = snapshot.stageEndsAt else { return [] }

        var boundaries: [TimerStageBoundary] = []
        var boundaryDate = currentEnd
        for index in snapshot.stageIndex..<run.plan.stages.count {
            let nextIndex = index + 1
            boundaries.append(
                TimerStageBoundary(
                    completedStageIndex: index,
                    completedStageName: run.plan.stages[index].name,
                    nextStageName: nextIndex < run.plan.stages.count
                        ? run.plan.stages[nextIndex].name : nil,
                    date: boundaryDate
                )
            )
            guard nextIndex < run.plan.stages.count else { break }
            let duration =
                run.plan.stages[nextIndex].duration
                + run.extensionsByStage[nextIndex, default: 0]
            boundaryDate = boundaryDate.addingTimeInterval(duration)
        }
        return boundaries.filter { $0.date > now }
    }

    private static func nextAgitationDate(snapshot: TimerSnapshot) -> Date? {
        guard snapshot.status == .running, let stageStartedAt = snapshot.stageStartedAt else {
            return nil
        }
        let remaining = snapshot.remaining
        guard remaining > 0 else { return nil }

        let delay: TimeInterval?
        switch snapshot.stage.agitation {
        case .none, .continuous:
            delay = nil
        case .periodic(let initial, let every, _):
            let elapsed = snapshot.elapsed
            if elapsed < initial {
                delay = every - elapsed
            } else {
                let nextCycle = floor(elapsed / every) + 1
                delay = nextCycle * every - elapsed
            }
        }

        guard let delay, delay > 0, delay < remaining else { return nil }
        return stageStartedAt.addingTimeInterval(snapshot.elapsed + delay)
    }
}

public enum TimerAgitationTransition: Equatable, Sendable {
    case began
    case ended
}

/// One absolute stage boundary that must remain observable if the app is suspended or killed.
public struct TimerStageBoundary: Equatable, Sendable {
    public let completedStageIndex: Int
    public let completedStageName: String
    public let nextStageName: String?
    public let date: Date

    public init(
        completedStageIndex: Int,
        completedStageName: String,
        nextStageName: String?,
        date: Date
    ) {
        self.completedStageIndex = completedStageIndex
        self.completedStageName = completedStageName
        self.nextStageName = nextStageName
        self.date = date
    }
}

/// Boundary between the timer state machine and iOS notifications, cues, and Live Activities.
@MainActor
public protocol TimerPlatformPresenting: AnyObject {
    func synchronize(_ presentation: TimerPlatformPresentation)
    func invalidate(runID: UUID)
}

/// A deterministic no-op used by tests and platforms without Live Activities.
@MainActor
public final class NoopTimerPlatformPresenter: TimerPlatformPresenting {
    public init() {}

    public func synchronize(_: TimerPlatformPresentation) {}
    public func invalidate(runID _: UUID) {}
}
