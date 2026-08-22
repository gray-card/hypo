import Foundation
import HypoLexicon
import Testing
import TimerEngine

@testable import TimerFeature

@Test func fileSessionStoreRoundTripsAndClearsAtomically() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = FileTimerFeatureSessionStore(
        fileURL: directory.appending(path: "TimerSession.json")
    )
    let session = TimerFeatureSessionState(
        generation: 7,
        run: DevelopmentTimerRun(plan: TimerFeatureDefaults.blackAndWhitePlan()),
        recipe: TimerFeatureDefaults.blackAndWhiteRecipe()
    )

    try await store.save(session)
    #expect(try await store.load() == session)

    let relaunched = FileTimerFeatureSessionStore(
        fileURL: directory.appending(path: "TimerSession.json")
    )
    #expect(try await relaunched.load() == session)
    try await relaunched.clear()
    #expect(try await relaunched.load() == nil)
}

@Test func recipeDecoderPreservesSourceAndMultiRoleMonobath() throws {
    let record = AppGraycardCatalogDevRecipeMain(
        developerMake: "CineStill",
        developerName: "Df96",
        filmMake: "Kodak",
        filmName: "Tri-X 400",
        process: .monobath,
        temps: [AppGraycardCatalogDevRecipeTempPoint(tempC10: 200, timeSec: 180)],
        source: "Manufacturer instructions",
        dilution: "stock",
        notes: "Monobath (develop and fix in one)."
    )
    let uri = try ATURI("at://did:plc:test/app.graycard.catalog.devRecipe/df96")
    let selections = try DevelopmentRecipeDecoder.selections(
        record: JSONEncoder().encode(record),
        uri: uri,
        origin: .personalDataServer,
        sourceLabel: "Your PDS"
    )

    let selection = try #require(selections.first)
    #expect(selection.recipeURI == uri)
    #expect(selection.provenance.origin == .personalDataServer)
    #expect(selection.plan.stages.first?.duration == 180)
    #expect(selection.stages.first?.targetTemperatureCelsius == 20)
    #expect(selection.stages.first?.chemistryRoles == ["film-developer", "fixer"])
    #expect(selection.stages.map(\.name) == ["Develop + fix", "Wash"])
    #expect(selection.stages[1].isManual)
    #expect(selection.stages[1].publishedDuration == nil)
    #expect(selection.stages[1].chemistryRoles == ["wash"])
}

@Test func recipeDecoderCarriesPublishedTemperatureSeriesForConservativeAdjustment() throws {
    let record = AppGraycardCatalogDevRecipeMain(
        developerMake: "Fixture",
        developerName: "Developer",
        filmMake: "Fixture",
        filmName: "Film",
        process: .bw,
        temps: [
            AppGraycardCatalogDevRecipeTempPoint(tempC10: 200, timeSec: 600),
            AppGraycardCatalogDevRecipeTempPoint(tempC10: 220, timeSec: 480),
        ],
        source: "Fixture manufacturer instructions",
        interpolationAllowed: true
    )

    let selection = try #require(
        DevelopmentRecipeDecoder.selections(
            record: JSONEncoder().encode(record),
            uri: nil,
            origin: .catalog,
            sourceLabel: "Fixture catalog"
        ).first
    )
    #expect(selection.temperaturePoints.count == 2)
    #expect(selection.adjustableTemperatureRange == 20...22)

    let adjusted = try selection.adjusted(to: 21)
    #expect(adjusted.selectedTemperatureCelsius == 21)
    #expect(abs((adjusted.selectedDevelopmentDuration ?? 0) - sqrt(600 * 480)) < 0.001)
    #expect(adjusted.usesInterpolatedTemperature)
    #expect(throws: TimerFeatureError.self) {
        try selection.adjusted(to: 23)
    }
}

@Test func legacySavedRecipeDerivesItsExactPointWithoutEnablingInterpolation() throws {
    let session = TimerFeatureSessionState(
        run: DevelopmentTimerRun(plan: TimerFeatureDefaults.blackAndWhitePlan()),
        recipe: TimerFeatureDefaults.blackAndWhiteRecipe()
    )
    var object = try #require(
        JSONSerialization.jsonObject(with: JSONEncoder().encode(session)) as? [String: Any]
    )
    var recipe = try #require(object["recipe"] as? [String: Any])
    recipe.removeValue(forKey: "temperaturePoints")
    recipe.removeValue(forKey: "interpolationAllowed")
    recipe.removeValue(forKey: "generalTemperatureEstimate")
    object["recipe"] = recipe

    let decoded = try JSONDecoder().decode(
        TimerFeatureSessionState.self,
        from: JSONSerialization.data(withJSONObject: object)
    )
    #expect(decoded.recipe.interpolationAllowed == false)
    #expect(decoded.recipe.generalTemperatureEstimate == nil)
    #expect(decoded.recipe.temperaturePoints.count == 1)
    #expect(
        decoded.recipe.temperaturePoints.first?.temperatureCelsius
            == decoded.recipe.selectedTemperatureCelsius
    )
}

@Test func blackAndWhiteRecipeRetainsManualAftercareWithoutInventedTimes() throws {
    let record = recipeRecord(
        process: .bw,
        agitation: AppGraycardCatalogDevRecipeAgitation(
            note: "Continuous for the first minute, then four inversions every 30 seconds"
        ),
        notes: "Use a stop bath or water rinse, then fix, wash, and use a wetting agent."
    )

    let selection = try decoded(record)

    #expect(selection.plan.stages.count == 1)
    #expect(
        selection.stages.map(\.name) == [
            "Develop", "Stop or rinse", "Fix", "Wash", "Wetting agent",
        ])
    #expect(selection.stages.dropFirst().allSatisfy { $0.isManual })
    #expect(selection.stages.dropFirst().allSatisfy { $0.publishedDuration == nil })
    #expect(selection.stages[3].chemistryRoles == ["wash"])
    #expect(selection.stages.last?.isOptional == true)
    #expect(selection.stages.first?.selectedAgitation == nil)
    #expect(selection.plan.stages.first?.agitation == AgitationSchedule.none)
    #expect(
        selection.stages.first?.selectedAgitationDescription
            == "Continuous for the first minute, then four inversions every 30 seconds"
    )
}

@Test func c41RecipeUsesExplicitBlixAndOptionalStabilizerAsManualStages() throws {
    let record = recipeRecord(
        process: .c41,
        notes: "Followed by Blix 8min, wash, optional stabilizer."
    )

    let selection = try decoded(record)

    #expect(
        selection.stages.map(\.name) == [
            "Color developer", "Blix", "Wash", "Stabilizer",
        ])
    #expect(selection.stages[0].chemistryRoles == ["color-developer"])
    #expect(selection.stages[1].chemistryRoles == ["bleach", "fixer"])
    #expect(selection.stages[1].publishedDuration == nil)
    #expect(selection.stages[3].isOptional)
}

@Test func standardC41RecipeKeepsSeparateBleachAndFixStages() throws {
    let selection = try decoded(
        recipeRecord(process: .c41, notes: "Standard C-41 process.")
    )

    #expect(
        selection.stages.map(\.name) == [
            "Color developer", "Bleach", "Fix", "Wash", "Final rinse",
        ])
    #expect(selection.stages[1].chemistryRoles == ["bleach"])
    #expect(selection.stages[2].chemistryRoles == ["fixer"])
}

@Test func e6ThreeBathRecipePreservesCombinedBathRolesWithoutGuessedDurations() throws {
    let record = recipeRecord(
        process: .e6,
        notes: "Creative Slide 3-bath E-6 process with a final rinse."
    )

    let selection = try decoded(record)

    #expect(
        selection.stages.map(\.name) == [
            "First developer", "Reversal + color developer", "Blix", "Wash", "Final rinse",
        ])
    #expect(selection.stages[1].chemistryRoles == ["reversal-bath", "color-developer"])
    #expect(selection.stages[2].chemistryRoles == ["bleach", "fixer"])
    #expect(selection.stages.dropFirst().allSatisfy { $0.publishedDuration == nil })
}

@Test func filmRollMergePreservesUnknownFieldsAndDoesNotRegressLaterStatus() throws {
    let original = Data(
        """
        {
          "$type":"app.graycard.instance.filmRoll",
          "stock":"at://did:plc:catalog/app.graycard.catalog.filmStock/tri-x",
          "status":"scanned",
          "createdAt":"2026-08-01T12:00:00.000Z",
          "scannedAt":"2026-08-03T12:00:00.000Z",
          "com.example.future":{"retained":true}
        }
        """.utf8
    )
    let request = FilmRollDevelopmentAdvanceRequest(
        roll: try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/roll"),
        developmentSession: try ATURI(
            "at://did:plc:test/app.graycard.process.developSession/session"
        ),
        developmentStartedAt: try ATProtoDate("2026-08-02T10:00:00.000Z"),
        developedAt: try ATProtoDate("2026-08-02T10:10:00.000Z"),
        idempotencyKey: "session:roll"
    )

    let merged = try FilmRollDevelopmentRecordMerger.merge(record: original, request: request)
    let object = try #require(
        JSONSerialization.jsonObject(with: merged) as? [String: Any]
    )
    #expect(object["status"] as? String == "scanned")
    #expect(object["developmentStartedAt"] as? String == "2026-08-02T10:00:00.000Z")
    #expect(object["developedAt"] as? String == "2026-08-02T10:10:00.000Z")
    let future = try #require(object["com.example.future"] as? [String: Any])
    #expect(future["retained"] as? Bool == true)
}

@Test func filmRollMergeRejectsChronologyConflict() throws {
    let original = Data(
        """
        {
          "$type":"app.graycard.instance.filmRoll",
          "stock":"at://did:plc:catalog/app.graycard.catalog.filmStock/tri-x",
          "createdAt":"2026-08-01T12:00:00.000Z",
          "unloadedAt":"2026-08-04T12:00:00.000Z"
        }
        """.utf8
    )
    let request = FilmRollDevelopmentAdvanceRequest(
        roll: try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/roll"),
        developmentSession: try ATURI(
            "at://did:plc:test/app.graycard.process.developSession/session"
        ),
        developmentStartedAt: try ATProtoDate("2026-08-02T10:00:00.000Z"),
        developedAt: try ATProtoDate("2026-08-02T10:10:00.000Z"),
        idempotencyKey: "session:roll"
    )

    #expect(throws: FilmRollDevelopmentMergeError.self) {
        try FilmRollDevelopmentRecordMerger.merge(record: original, request: request)
    }
}

private func recipeRecord(
    process: AppGraycardDefsFilmProcess,
    agitation: AppGraycardCatalogDevRecipeAgitation? = nil,
    notes: String? = nil
) -> AppGraycardCatalogDevRecipeMain {
    AppGraycardCatalogDevRecipeMain(
        developerMake: "Fixture",
        developerName: "Process chemistry",
        filmMake: "Fixture",
        filmName: "Test film",
        process: process,
        temps: [AppGraycardCatalogDevRecipeTempPoint(tempC10: 200, timeSec: 180)],
        source: "Fixture manufacturer instructions",
        agitation: agitation,
        notes: notes
    )
}

private func decoded(
    _ record: AppGraycardCatalogDevRecipeMain
) throws -> DevelopmentRecipeSelection {
    try #require(
        DevelopmentRecipeDecoder.selections(
            record: JSONEncoder().encode(record),
            uri: nil,
            origin: .catalog,
            sourceLabel: "Fixture catalog"
        ).first
    )
}
