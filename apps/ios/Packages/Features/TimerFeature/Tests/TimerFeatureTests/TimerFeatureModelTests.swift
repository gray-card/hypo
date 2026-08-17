import DesignSystem
import Foundation
import HypoLexicon
import Testing
import TimerEngine

@testable import TimerFeature

@MainActor
@Test func primaryActionStartsPausesAndResumes() throws {
    let clock = TestClock(Date(timeIntervalSince1970: 1_000))
    let model = TimerFeatureModel(plan: try plan(), now: { clock.date })

    #expect(model.run.status == .ready)
    model.performPrimaryAction()
    #expect(model.run.status == .running)

    clock.date = clock.date.addingTimeInterval(20)
    model.performPrimaryAction()
    #expect(model.run.status == .paused)
    #expect(model.snapshot?.remaining == 40)

    clock.date = clock.date.addingTimeInterval(120)
    model.performPrimaryAction()
    #expect(model.run.status == .running)
    #expect(model.snapshot?.remaining == 40)
}

@MainActor
@Test func refreshCatchesUpAcrossStages() throws {
    let clock = TestClock(Date(timeIntervalSince1970: 2_000))
    let model = TimerFeatureModel(plan: try plan(), now: { clock.date })
    model.performPrimaryAction()

    clock.date = clock.date.addingTimeInterval(75)
    model.refresh()

    #expect(model.run.currentStageIndex == 1)
    #expect(model.snapshot?.remaining == 45)
}

@MainActor
@Test func skipAndExtensionUseTimerEngineTransitions() throws {
    let clock = TestClock(Date(timeIntervalSince1970: 3_000))
    let model = TimerFeatureModel(plan: try plan(), now: { clock.date })
    model.performPrimaryAction()
    model.extendStage()
    #expect(model.snapshot?.remaining == 90)

    model.skipStage()
    #expect(model.run.currentStageIndex == 1)
    #expect(model.snapshot?.stage.name == "Fix")
}

@MainActor
@Test func completionWritesStructuredSessionAndAdvancesRollExactlyOnce() async throws {
    let clock = TestClock(Date(timeIntervalSince1970: 4_000))
    let store = InMemoryTimerFeatureSessionStore()
    let writer = RecordingDevelopmentSessionWriter()
    let advancer = RecordingRollAdvancer()
    let roll = try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/roll")
    let recipe = try developmentRecipe()
    let model = TimerFeatureModel(
        recipe: recipe,
        linkedFilmRolls: [roll],
        store: store,
        completionWriter: writer,
        rollAdvancer: advancer,
        haptics: RecordingHaptics(),
        now: { clock.date }
    )
    model.setActualTemperature(20.4, for: TimerStageID(rawValue: "develop"))
    model.setObservedAgitation("Five inversions every 30 seconds")

    model.performPrimaryAction()
    await model.flushPersistence()
    clock.date = clock.date.addingTimeInterval(125)
    model.refresh()
    await model.flushPersistence()
    model.refresh()
    await model.flushPersistence()

    let writes = await writer.writes
    #expect(writes.count == 1)
    let object = try #require(
        JSONSerialization.jsonObject(with: writes[0].record) as? [String: Any]
    )
    #expect(object["$type"] as? String == "app.graycard.process.developSession")
    #expect(object["recipe"] as? String == recipe.recipeURI?.rawValue)
    #expect(object["process"] as? String == "bw")
    #expect(object["publishedTimeSeconds"] as? Int == 60)
    #expect(object["actualTimeSeconds"] as? Int == 60)
    #expect((object["filmRolls"] as? [String]) == [roll.rawValue])
    let temperature = try #require(object["actualTemperature"] as? [String: Any])
    #expect(temperature["value"] as? Int == 2_040)
    #expect(temperature["scale"] as? Int == 2)
    let steps = try #require(object["steps"] as? [[String: Any]])
    #expect(steps.count == 2)
    #expect(steps[0]["publishedTimeSeconds"] as? Int == 60)
    #expect(steps[0]["actualTimeSeconds"] as? Int == 60)
    #expect(steps[1]["publishedTimeSeconds"] as? Int == 60)
    #expect(steps[1]["actualTimeSeconds"] as? Int == 60)

    let advances = await advancer.requests
    #expect(advances.count == 1)
    #expect(advances[0].roll == roll)
    #expect(advances[0].status == "developed")
    #expect(advances[0].developmentLocation == "home")
}

@MainActor
@Test func restoredRunCatchesUpAndCompletesExactlyOnce() async throws {
    let clock = TestClock(Date(timeIntervalSince1970: 5_000))
    let store = InMemoryTimerFeatureSessionStore()
    let writer = RecordingDevelopmentSessionWriter()
    let advancer = RecordingRollAdvancer()
    let recipe = try developmentRecipe()
    let original = TimerFeatureModel(
        recipe: recipe,
        store: store,
        completionWriter: writer,
        rollAdvancer: advancer,
        haptics: RecordingHaptics(),
        now: { clock.date }
    )
    original.performPrimaryAction()
    await original.flushPersistence()

    clock.date = clock.date.addingTimeInterval(125)
    let restored = try #require(
        await TimerFeatureModel.restore(
            store: store,
            completionWriter: writer,
            rollAdvancer: advancer,
            haptics: RecordingHaptics(),
            now: { clock.date }
        )
    )
    await restored.flushPersistence()
    #expect(restored.run.status == .completed)
    #expect(await writer.writes.count == 1)

    let relaunchedAgain = try #require(
        await TimerFeatureModel.restore(
            store: store,
            completionWriter: writer,
            rollAdvancer: advancer,
            haptics: RecordingHaptics(),
            now: { clock.date.addingTimeInterval(20) }
        )
    )
    await relaunchedAgain.flushPersistence()
    #expect(await writer.writes.count == 1)
}

@MainActor
@Test func recipeProviderPreservesCatalogAndPersonalProvenance() async throws {
    let catalog = try developmentRecipe(origin: .catalog, planID: "catalog")
    let personal = try developmentRecipe(origin: .personalDataServer, planID: "personal")
    let model = TimerFeatureModel(
        recipe: TimerFeatureDefaults.blackAndWhiteRecipe(),
        recipeProvider: FixtureRecipeProvider(recipes: [catalog, personal]),
        store: InMemoryTimerFeatureSessionStore(),
        completionWriter: RecordingDevelopmentSessionWriter(),
        rollAdvancer: RecordingRollAdvancer(),
        haptics: RecordingHaptics()
    )

    await model.loadRecipes()

    #expect(
        model.availableRecipes.map(\.provenance.origin).prefix(2) == [
            .personalDataServer, .catalog,
        ])
    model.selectRecipe(id: personal.id)
    #expect(model.selectedRecipe.provenance.origin == .personalDataServer)
    await model.flushPersistence()
}

@MainActor
@Test func manualBathsGateCompletionAndPersistObservedRatherThanInventedMetadata() async throws {
    let clock = TestClock(Date(timeIntervalSince1970: 7_000))
    let writer = RecordingDevelopmentSessionWriter()
    let record = AppGraycardCatalogDevRecipeMain(
        developerMake: "Fixture",
        developerName: "Developer",
        filmMake: "Fixture",
        filmName: "Film",
        process: .bw,
        temps: [AppGraycardCatalogDevRecipeTempPoint(tempC10: 200, timeSec: 1)],
        source: "Fixture manufacturer instructions"
    )
    let recipe = try #require(
        DevelopmentRecipeDecoder.selections(
            record: JSONEncoder().encode(record),
            uri: try ATURI("at://did:plc:catalog/app.graycard.catalog.devRecipe/manual-flow"),
            origin: .catalog,
            sourceLabel: "Fixture catalog"
        ).first
    )
    let model = TimerFeatureModel(
        recipe: recipe,
        store: InMemoryTimerFeatureSessionStore(),
        completionWriter: writer,
        rollAdvancer: RecordingRollAdvancer(),
        haptics: RecordingHaptics(),
        now: { clock.date }
    )

    model.performPrimaryAction()
    clock.date = clock.date.addingTimeInterval(2)
    model.refresh()
    await model.flushPersistence()

    #expect(model.run.status == .completed)
    #expect(model.activeManualStage?.name == "Stop or rinse")
    #expect(await writer.writes.isEmpty)

    let fix = try #require(model.manualStages.first { $0.name == "Fix" })
    model.completeManualStage(fix.id)
    #expect(model.manualStageState(for: fix) == .pending)

    let stop = try #require(model.activeManualStage)
    model.setActualDuration(20, for: stop.id)
    model.setActualTemperature(20.2, for: stop.id)
    model.setObservedAgitation("continuous rinse", for: stop.id)
    model.completeManualStage(stop.id)
    await model.flushPersistence()
    #expect(await writer.writes.isEmpty)
    #expect(model.activeManualStage?.name == "Fix")

    model.completeManualStage(try #require(model.activeManualStage).id)
    await model.flushPersistence()
    #expect(model.activeManualStage?.name == "Wash")
    model.completeManualStage(try #require(model.activeManualStage).id)
    await model.flushPersistence()

    #expect(model.isProcessComplete)
    let writes = await writer.writes
    #expect(writes.count == 1)
    let object = try #require(
        JSONSerialization.jsonObject(with: writes[0].record) as? [String: Any]
    )
    let steps = try #require(object["steps"] as? [[String: Any]])
    #expect(steps.count == 4)
    #expect(object["agitation"] == nil)
    #expect(object["agitationScheme"] == nil)
    #expect(steps[1]["publishedTimeSeconds"] == nil)
    #expect(steps[1]["name"] as? String == "Stop or rinse")
    #expect(steps[1]["actualTimeSeconds"] as? Int == 20)
    #expect(
        steps[1]["agitation"] as? String
            == "Selected: not specified; observed: continuous rinse"
    )
    let actualTemperature = try #require(steps[1]["actualTemperature"] as? [String: Any])
    #expect(actualTemperature["value"] as? Int == 2_020)
    #expect(steps[3]["name"] as? String == "Wash")
    #expect(steps[3]["roles"] as? [String] == ["wash"])
}

@MainActor
@Test func availableFilmRollsNeverSelectARollImplicitly() throws {
    let model = TimerFeatureModel(plan: try plan())
    let first = try filmRollOption("first", title: "HP5 Plus · Roll 12")
    let second = try filmRollOption("second", title: "Portra 400 · Roll 13")

    model.setAvailableFilmRolls([first, second])

    #expect(model.availableFilmRolls == [first, second])
    #expect(model.linkedFilmRolls.isEmpty)
    #expect(model.filmRollSelectionSummary == "No film rolls")
}

@MainActor
@Test func filmRollSelectionSupportsMultipleRollsAndAnExplicitNoRollChoice() async throws {
    let store = InMemoryTimerFeatureSessionStore()
    let model = TimerFeatureModel(
        recipe: try developmentRecipe(),
        store: store,
        completionWriter: RecordingDevelopmentSessionWriter(),
        rollAdvancer: RecordingRollAdvancer(),
        haptics: RecordingHaptics()
    )
    let first = try filmRollOption("first", title: "HP5 Plus · Roll 12")
    let second = try filmRollOption("second", title: "Portra 400 · Roll 13")
    model.setAvailableFilmRolls([first, second])

    model.toggleFilmRollLink(second.uri)
    model.toggleFilmRollLink(first.uri)
    await model.flushPersistence()

    #expect(model.linkedFilmRolls == [first.uri, second.uri])
    #expect(model.filmRollSelectionSummary == "2 film rolls")
    #expect((await store.load())?.linkedFilmRolls == [first.uri, second.uri])

    model.clearFilmRollLinks()
    await model.flushPersistence()

    #expect(model.linkedFilmRolls.isEmpty)
    #expect((await store.load())?.linkedFilmRolls.isEmpty == true)
}

@MainActor
@Test func refreshingAvailableFilmRollsRemovesUnavailableReadySelections() async throws {
    let store = InMemoryTimerFeatureSessionStore()
    let model = TimerFeatureModel(
        recipe: try developmentRecipe(),
        store: store,
        completionWriter: RecordingDevelopmentSessionWriter(),
        rollAdvancer: RecordingRollAdvancer(),
        haptics: RecordingHaptics()
    )
    let first = try filmRollOption("first", title: "HP5 Plus · Roll 12")
    let second = try filmRollOption("second", title: "Portra 400 · Roll 13")
    model.setAvailableFilmRolls([first, second])
    model.toggleFilmRollLink(first.uri)
    model.toggleFilmRollLink(second.uri)

    model.setAvailableFilmRolls([second])
    await model.flushPersistence()

    #expect(model.linkedFilmRolls == [second.uri])
    #expect(model.filmRollSelectionSummary == second.title)
}

@MainActor
@Test func startedTimerFreezesFilmRollLinksAcrossInteractionAndRefresh() throws {
    let clock = TestClock(Date(timeIntervalSince1970: 8_000))
    let haptics = RecordingHaptics()
    let model = TimerFeatureModel(
        recipe: try developmentRecipe(),
        store: InMemoryTimerFeatureSessionStore(),
        completionWriter: RecordingDevelopmentSessionWriter(),
        rollAdvancer: RecordingRollAdvancer(),
        haptics: haptics,
        now: { clock.date }
    )
    let selected = try filmRollOption("selected", title: "Tri-X · Roll 4")
    let other = try filmRollOption("other", title: "Delta 100 · Roll 5")
    model.setAvailableFilmRolls([selected, other])
    model.toggleFilmRollLink(selected.uri)
    model.performPrimaryAction()

    model.toggleFilmRollLink(other.uri)
    model.clearFilmRollLinks()
    model.setAvailableFilmRolls([other])

    #expect(model.canEditFilmRollLinks == false)
    #expect(model.linkedFilmRolls == [selected.uri])
    #expect(model.availableFilmRolls == [other])
    #expect(model.errorMessage == "Film rolls cannot be changed after the timer starts.")
    #expect(haptics.cues.suffix(2) == [.warning, .warning])
}

@MainActor
@Test func liveModelRestorePreservesComposedRollChoicesAndValidatesStoredSelection() async throws {
    let available = try filmRollOption("available", title: "FP4 Plus · Roll 8")
    let unavailable = try filmRollOption("unavailable", title: "Old roll")
    let recipe = try developmentRecipe()
    let store = InMemoryTimerFeatureSessionStore(
        session: TimerFeatureSessionState(
            run: DevelopmentTimerRun(plan: recipe.plan),
            recipe: recipe,
            linkedFilmRolls: [available.uri, unavailable.uri]
        )
    )
    let model = TimerFeatureModel(
        recipe: recipe,
        store: store,
        completionWriter: RecordingDevelopmentSessionWriter(),
        rollAdvancer: RecordingRollAdvancer(),
        haptics: RecordingHaptics()
    )
    model.setAvailableFilmRolls([available])

    await model.restoreDurableSession()
    await model.flushPersistence()

    #expect(model.availableFilmRolls == [available])
    #expect(model.linkedFilmRolls == [available.uri])
    #expect((await store.load())?.linkedFilmRolls == [available.uri])
}

@MainActor
private final class TestClock: @unchecked Sendable {
    var date: Date

    init(_ date: Date) {
        self.date = date
    }
}

private func plan() throws -> TimerPlan {
    try TimerPlan(
        id: "test",
        name: "Test plan",
        stages: [
            try TimerStage(
                id: TimerStageID(rawValue: "develop"),
                name: "Develop",
                duration: 60
            ),
            try TimerStage(
                id: TimerStageID(rawValue: "fix"),
                name: "Fix",
                duration: 60
            ),
        ]
    )
}

private func developmentRecipe(
    origin: DevelopmentRecipeOrigin = .catalog,
    planID: String = "catalog-test"
) throws -> DevelopmentRecipeSelection {
    let timerPlan = try TimerPlan(
        id: planID,
        name: "Published test recipe",
        stages: [
            try TimerStage(
                id: TimerStageID(rawValue: "develop"),
                name: "Develop",
                duration: 60,
                agitation: .periodic(initial: 10, every: 30, for: 5)
            ),
            try TimerStage(
                id: TimerStageID(rawValue: "fix"),
                name: "Fix",
                duration: 60
            ),
        ]
    )
    return DevelopmentRecipeSelection(
        plan: timerPlan,
        process: "bw",
        stages: [
            DevelopmentRecipeStage(
                timerStage: timerPlan.stages[0],
                chemistryRoles: ["film-developer"],
                dilution: "1+31",
                targetTemperatureCelsius: 20
            ),
            DevelopmentRecipeStage(
                timerStage: timerPlan.stages[1],
                chemistryRoles: ["fixer"],
                targetTemperatureCelsius: 20
            ),
        ],
        recipeURI: try ATURI(
            "at://did:plc:catalog/app.graycard.catalog.devRecipe/\(planID)"
        ),
        provenance: DevelopmentRecipeProvenance(
            origin: origin,
            sourceLabel: origin == .catalog ? "Graycard catalog" : "Your PDS"
        )
    )
}

private func filmRollOption(
    _ recordKey: String,
    title: String
) throws -> DevelopmentFilmRollOption {
    DevelopmentFilmRollOption(
        uri: try ATURI(
            "at://did:plc:test/app.graycard.instance.filmRoll/\(recordKey)"
        ),
        title: title
    )
}

private actor RecordingDevelopmentSessionWriter: DevelopmentSessionWriting {
    struct Write: Sendable {
        let record: Data
        let idempotencyKey: String
    }

    private(set) var writes: [Write] = []

    func writeDevelopmentSession(
        record: Data,
        idempotencyKey: String
    ) async throws -> ATURI {
        writes.append(Write(record: record, idempotencyKey: idempotencyKey))
        return try ATURI(
            "at://did:plc:test/app.graycard.process.developSession/\(idempotencyKey)"
        )
    }
}

private actor RecordingRollAdvancer: FilmRollDevelopmentAdvancing {
    private(set) var requests: [FilmRollDevelopmentAdvanceRequest] = []

    func advanceFilmRoll(_ request: FilmRollDevelopmentAdvanceRequest) async throws {
        requests.append(request)
    }
}

private struct FixtureRecipeProvider: DevelopmentRecipeProviding {
    let recipes: [DevelopmentRecipeSelection]

    func recipes() async throws -> [DevelopmentRecipeSelection] { recipes }
}

@MainActor
private final class RecordingHaptics: HypoHapticPlaying {
    private(set) var cues: [HypoHapticCue] = []

    func play(_ cue: HypoHapticCue) {
        cues.append(cue)
    }
}
