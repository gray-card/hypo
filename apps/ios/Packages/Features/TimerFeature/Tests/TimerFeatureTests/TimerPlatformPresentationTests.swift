import Foundation
import Testing
import TimerEngine

@testable import TimerFeature

@MainActor
@Test func runningPresentationCarriesEveryFutureStageBoundary() throws {
    let startedAt = Date(timeIntervalSince1970: 10_000)
    var run = DevelopmentTimerRun(plan: try notificationPlan())
    try run.start(at: startedAt)
    let now = startedAt.addingTimeInterval(20)
    let snapshot = try run.snapshot(at: now)

    let presentation = TimerPlatformPresentation(
        run: run,
        snapshot: snapshot,
        recipeName: "C-41",
        now: now
    )

    #expect(presentation.boundaries.count == 3)
    #expect(presentation.boundaries.map(\.nextStageName) == ["Bleach", "Fix", nil])
    #expect(
        presentation.boundaries.map(\.date) == [
            startedAt.addingTimeInterval(60),
            startedAt.addingTimeInterval(90),
            startedAt.addingTimeInterval(135),
        ])
}

@MainActor
@Test func pausingRemovesScheduledBoundariesAndFreezesRemainingTime() throws {
    let startedAt = Date(timeIntervalSince1970: 20_000)
    var run = DevelopmentTimerRun(plan: try notificationPlan())
    try run.start(at: startedAt)
    let pausedAt = startedAt.addingTimeInterval(17)
    try run.pause(at: pausedAt)

    let presentation = TimerPlatformPresentation(
        run: run,
        snapshot: try run.snapshot(at: pausedAt.addingTimeInterval(40)),
        recipeName: "C-41",
        now: pausedAt.addingTimeInterval(40)
    )

    #expect(presentation.boundaries.isEmpty)
    #expect(presentation.stageEndsAt == nil)
    #expect(presentation.remainingWhenPaused == 43)
}

@MainActor
@Test func agitationTransitionsAreDerivedFromAbsoluteStageTime() throws {
    let startedAt = Date(timeIntervalSince1970: 30_000)
    var run = DevelopmentTimerRun(plan: try notificationPlan())
    try run.start(at: startedAt)

    let initial = TimerPlatformPresentation(
        run: run,
        snapshot: try run.snapshot(at: startedAt),
        recipeName: "C-41",
        now: startedAt
    )
    let resting = TimerPlatformPresentation(
        run: run,
        snapshot: try run.snapshot(at: startedAt.addingTimeInterval(11)),
        recipeName: "C-41",
        now: startedAt.addingTimeInterval(11)
    )
    let nextAgitation = TimerPlatformPresentation(
        run: run,
        snapshot: try run.snapshot(at: startedAt.addingTimeInterval(30)),
        recipeName: "C-41",
        now: startedAt.addingTimeInterval(30)
    )

    #expect(initial.isAgitating)
    #expect(initial.nextAgitationAt == startedAt.addingTimeInterval(30))
    #expect(initial.agitationTransition(from: nil) == .began)
    #expect(resting.agitationTransition(from: initial) == .ended)
    #expect(resting.nextAgitationAt == startedAt.addingTimeInterval(30))
    #expect(nextAgitation.agitationTransition(from: resting) == .began)
    #expect(nextAgitation.nextAgitationAt == nil)
}

@MainActor
@Test func modelReconciliationIsExplicitAndDoesNotChangeTimerState() throws {
    let presenter = RecordingTimerPlatformPresenter()
    let clock = PlatformTestClock(Date(timeIntervalSince1970: 40_000))
    let model = TimerFeatureModel(
        plan: try notificationPlan(),
        platformPresenter: presenter,
        now: { clock.date }
    )
    presenter.presentations = []

    model.performPrimaryAction()
    let running = model.run
    model.reconcilePlatformPresentation()

    #expect(model.run == running)
    #expect(presenter.presentations.last?.status == .running)
    #expect(presenter.presentations.last?.runID == running.id)
}

private func notificationPlan() throws -> TimerPlan {
    try TimerPlan(
        id: "notification-plan",
        name: "C-41",
        stages: [
            try TimerStage(
                id: TimerStageID(rawValue: "develop"),
                name: "Develop",
                duration: 60,
                agitation: .periodic(initial: 10, every: 30, for: 5)
            ),
            try TimerStage(
                id: TimerStageID(rawValue: "bleach"),
                name: "Bleach",
                duration: 30
            ),
            try TimerStage(
                id: TimerStageID(rawValue: "fix"),
                name: "Fix",
                duration: 45
            ),
        ]
    )
}

@MainActor
private final class RecordingTimerPlatformPresenter: TimerPlatformPresenting {
    var presentations: [TimerPlatformPresentation] = []
    var invalidatedRunIDs: [UUID] = []

    func synchronize(_ presentation: TimerPlatformPresentation) {
        presentations.append(presentation)
    }

    func invalidate(runID: UUID) {
        invalidatedRunIDs.append(runID)
    }
}

@MainActor
private final class PlatformTestClock: @unchecked Sendable {
    var date: Date

    init(_ date: Date) {
        self.date = date
    }
}
