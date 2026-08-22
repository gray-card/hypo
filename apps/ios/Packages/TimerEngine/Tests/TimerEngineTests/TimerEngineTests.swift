import Foundation
import Testing
@testable import TimerEngine

@Suite("Development timer")
struct DevelopmentTimerTests {
    @Test("A restored timer catches up across stage boundaries")
    func relaunchCatchUp() throws {
        var run = DevelopmentTimerRun(plan: try plan())
        let start = Date(timeIntervalSince1970: 1_000)
        try run.start(at: start)

        let snapshot = try run.snapshot(at: start.addingTimeInterval(95))

        #expect(snapshot.stageIndex == 1)
        #expect(snapshot.stage.name == "Stop")
        #expect(snapshot.elapsed == 35)
        #expect(snapshot.remaining == 10)
    }

    @Test("Pause and resume preserve elapsed time")
    func pauseResume() throws {
        var run = DevelopmentTimerRun(plan: try plan())
        let start = Date(timeIntervalSince1970: 2_000)
        try run.start(at: start)
        try run.pause(at: start.addingTimeInterval(20))
        let paused = try run.snapshot(at: start.addingTimeInterval(200))
        #expect(paused.elapsed == 20)

        try run.resume(at: start.addingTimeInterval(300))
        let resumed = try run.snapshot(at: start.addingTimeInterval(310))
        #expect(resumed.elapsed == 30)
        #expect(resumed.remaining == 30)
    }

    @Test("Extension changes the wall-clock deadline")
    func extend() throws {
        var run = DevelopmentTimerRun(plan: try plan())
        let start = Date(timeIntervalSince1970: 3_000)
        try run.start(at: start)
        try run.extendCurrentStage(by: 30, at: start.addingTimeInterval(10))
        let snapshot = try run.snapshot(at: start.addingTimeInterval(70))
        #expect(snapshot.stageIndex == 0)
        #expect(snapshot.remaining == 20)
    }

    @Test("Date arithmetic crosses a daylight-saving transition without drift")
    func daylightSavingTime() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let start = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 1, minute: 59))
        )
        let longStage = try TimerStage(
            id: TimerStageID(rawValue: "wash"),
            name: "Wash",
            duration: 180
        )
        var run = DevelopmentTimerRun(plan: try TimerPlan(id: "dst", name: "DST", stages: [longStage]))
        try run.start(at: start)

        let snapshot = try run.snapshot(at: start.addingTimeInterval(120))
        #expect(snapshot.elapsed == 120)
        #expect(snapshot.remaining == 60)
    }

    @Test("The actor persists every transition and restores it")
    func persistence() async throws {
        let store = InMemoryTimerRunStore()
        let engine = DevelopmentTimerEngine(
            run: DevelopmentTimerRun(plan: try plan()),
            store: store
        )
        let start = Date(timeIntervalSince1970: 4_000)
        _ = try await engine.start(at: start)
        _ = try await engine.pause(at: start.addingTimeInterval(15))

        let restored = try await DevelopmentTimerEngine.restore(from: store)
        let snapshot = try await restored.snapshot(at: start.addingTimeInterval(500))
        #expect(snapshot.status == .paused)
        #expect(snapshot.elapsed == 15)
    }

    private func plan() throws -> TimerPlan {
        try TimerPlan(
            id: "bw",
            name: "Black and white",
            stages: [
                TimerStage(
                    id: TimerStageID(rawValue: "develop"),
                    name: "Develop",
                    duration: 60,
                    agitation: .periodic(initial: 10, every: 30, for: 5)
                ),
                TimerStage(
                    id: TimerStageID(rawValue: "stop"),
                    name: "Stop",
                    duration: 45
                ),
            ]
        )
    }
}

@Suite("Agitation scheduler")
struct AgitationSchedulerTests {
    @Test(arguments: [
        (0.0, true, 10.0),
        (12.0, false, 18.0),
        (31.0, true, 4.0),
        (36.0, false, 24.0),
    ])
    func periodic(elapsed: Double, active: Bool, next: Double) {
        let value = AgitationScheduler.status(
            for: .periodic(initial: 10, every: 30, for: 5),
            elapsed: elapsed,
            stageDuration: 120
        )
        #expect(value.isActive == active)
        #expect(value.nextTransitionAfter == next)
    }
}

@Suite("Temperature compensation")
struct TemperatureCompensationTests {
    @Test("Exact published points do not require interpolation permission")
    func exactPoint() throws {
        let points = try fixtures()
        let duration = try TemperatureCompensator.duration(
            at: 20,
            points: points,
            interpolationAllowed: false
        )
        #expect(duration == 600)
    }

    @Test("Interpolation is refused unless the recipe permits it")
    func disabled() throws {
        let points = try fixtures()
        #expect(throws: TemperatureCompensationError.interpolationDisabled(requested: 21)) {
            try TemperatureCompensator.duration(
                at: 21,
                points: points,
                interpolationAllowed: false
            )
        }
    }

    @Test("Log interpolation preserves multiplicative time changes")
    func logarithmic() throws {
        let duration = try TemperatureCompensator.duration(
            at: 21,
            points: fixtures(),
            interpolationAllowed: true
        )
        #expect(abs(duration - sqrt(600 * 480)) < 0.000_001)
    }

    private func fixtures() throws -> [TemperatureTimePoint] {
        [
            try TemperatureTimePoint(temperatureCelsius: 20, duration: 600),
            try TemperatureTimePoint(temperatureCelsius: 22, duration: 480),
        ]
    }
}

@Suite("General black-and-white temperature estimate")
struct GeneralBlackAndWhiteTemperatureEstimateTests {
    @Test("Matches the Ilford chart relationship and rounding")
    func chartRelationship() throws {
        let warmer = try GeneralBlackAndWhiteTemperatureEstimator.estimate(
            referenceDuration: 8 * 60,
            referenceTemperatureCelsius: 20,
            targetTemperatureCelsius: 24
        )
        #expect(warmer.duration == 5 * 60 + 30)
        #expect(warmer.roundingIncrement == 15)
        #expect(!warmer.isBelowRecommendedMinimum)
        #expect(warmer.hasLargeTemperatureChange)

        let cooler = try GeneralBlackAndWhiteTemperatureEstimator.estimate(
            referenceDuration: 5 * 60,
            referenceTemperatureCelsius: 20,
            targetTemperatureCelsius: 18
        )
        #expect(cooler.duration == 6 * 60)
    }

    @Test("Warns below five minutes and refuses to extend the chart")
    func safetyLimits() throws {
        let short = try GeneralBlackAndWhiteTemperatureEstimator.estimate(
            referenceDuration: 5 * 60,
            referenceTemperatureCelsius: 20,
            targetTemperatureCelsius: 22
        )
        #expect(short.isBelowRecommendedMinimum)
        #expect(throws: GeneralBlackAndWhiteTemperatureEstimateError.self) {
            try GeneralBlackAndWhiteTemperatureEstimator.estimate(
                referenceDuration: 8 * 60,
                referenceTemperatureCelsius: 20,
                targetTemperatureCelsius: 28
            )
        }
    }
}
