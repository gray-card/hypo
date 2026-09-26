import Foundation
import Testing

@testable import HypoLexicon

@Test func dateConstructedForATProtoRoundTripsThroughJSON() throws {
    let original = Date(timeIntervalSince1970: 2_000_000_000.125)
    let encoded = try JSONEncoder().encode(ATProtoDate(original))
    let decoded = try JSONDecoder().decode(ATProtoDate.self, from: encoded)

    #expect(abs(decoded.date.timeIntervalSince1970 - original.timeIntervalSince1970) < 0.001)
    #expect(decoded.rawValue.hasSuffix("Z"))
}

@Test func generatedLayerCoversEveryRootLexiconRecord() {
    #expect(GeneratedLexiconMetadata.schemaCount == 59)
    #expect(GeneratedLexiconMetadata.recordCount == 55)
    #expect(GeneratedRecordNSID.all.count == 55)
    #expect(Set(GeneratedRecordNSID.all).count == GeneratedRecordNSID.all.count)
}

@Test func rootCameraAndSetupFixturesRoundTripThroughGeneratedModels() throws {
    let cameraData = try rootFixture(named: "camera.json")
    let camera = try JSONDecoder().decode(AppGraycardInstanceCameraMain.self, from: cameraData)
    #expect(camera.nickname == "Panproto conformance camera")
    #expect(camera.type.collection == GeneratedRecordNSID.catalogCameraType)
    try expectStableRoundTrip(camera, source: cameraData)
    #expect(
        try GeneratedLexiconValidator.validate(camera, as: GeneratedRecordNSID.instanceCamera)
            .isEmpty
    )

    let setupData = try rootFixture(named: "setup.json")
    let setup = try JSONDecoder().decode(AppGraycardSetupMain.self, from: setupData)
    #expect(setup.name == "Panproto conformance setup")
    try expectStableRoundTrip(setup, source: setupData)
    #expect(try GeneratedLexiconValidator.validate(setup, as: GeneratedRecordNSID.setup).isEmpty)
}

@Test func representativeConformanceRecordsRoundTripAndValidate() throws {
    try checkFixture(
        "catalog-dev-recipe",
        as: AppGraycardCatalogDevRecipeMain.self,
        nsid: GeneratedRecordNSID.catalogDevRecipe
    )
    try checkFixture(
        "process-develop-session",
        as: AppGraycardProcessDevelopSessionMain.self,
        nsid: GeneratedRecordNSID.processDevelopSession
    )
    try checkFixture(
        "meter-reading",
        as: AppGraycardMeterReadingMain.self,
        nsid: GeneratedRecordNSID.meterReading
    )
    try checkFixture(
        "meter-calibration",
        as: AppGraycardMeterCalibrationMain.self,
        nsid: GeneratedRecordNSID.meterCalibration
    )
    try checkFixture(
        "instance-film-roll",
        as: AppGraycardInstanceFilmRollMain.self,
        nsid: GeneratedRecordNSID.instanceFilmRoll
    )
}

@Test func knownValuesRemainOpenToFutureWireValues() throws {
    let future = try JSONDecoder().decode(
        AppGraycardDefsFilmProcess.self,
        from: Data(#""future-process""#.utf8)
    )
    #expect(future.rawValue == "future-process")
    #expect(AppGraycardDefsFilmProcess.bw.rawValue == "bw")
    #expect(AppGraycardDefsChemistryRole.wash.rawValue == "wash")
    #expect(AppGraycardDefsChemistryRole.wash != AppGraycardDefsChemistryRole.washAid)
    #expect(try JSONEncoder().encode(future) == Data(#""future-process""#.utf8))
}

@Test func developmentSessionRetainsStepNamesAndDistinguishesWaterWash() throws {
    let source = try Data(
        contentsOf: #require(
            Bundle.module.url(forResource: "process-develop-session", withExtension: "json")
        )
    )
    let session = try JSONDecoder().decode(AppGraycardProcessDevelopSessionMain.self, from: source)
    let wash = try #require(session.steps?.last)

    #expect(wash.name == "Wash")
    #expect(wash.roles == [.wash])
    #expect(!wash.roles.contains(.washAid))
}

@Test func generatedValidatorEnforcesConstraintsAndLifecycleChronology() throws {
    let malformedCamera = Data(
        #"{"$type":"app.graycard.instance.camera","type":"not-an-at-uri","nickname":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","createdAt":"not-a-date"}"#
            .utf8
    )
    let cameraIssues = try GeneratedLexiconValidator.validate(
        malformedCamera,
        as: GeneratedRecordNSID.instanceCamera
    )
    #expect(cameraIssues.contains { $0.path == "$.type" && $0.message == "Expected AT URI" })
    #expect(cameraIssues.contains { $0.path == "$.nickname" && $0.message.contains("UTF-8 bytes") })
    #expect(cameraIssues.contains { $0.path == "$.createdAt" && $0.message == "Expected datetime" })

    let reversedRoll = Data(
        #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:example/app.graycard.catalog.filmStock/tri-x","loadedAt":"2026-08-03T00:00:00Z","developedAt":"2026-08-02T00:00:00Z","createdAt":"2026-08-01T00:00:00Z"}"#
            .utf8
    )
    let lifecycleIssues = try GeneratedLexiconValidator.validate(
        reversedRoll,
        as: GeneratedRecordNSID.instanceFilmRoll
    )
    #expect(
        lifecycleIssues.contains { $0.message.contains("loadedAt") && $0.message.contains("developedAt") })
}

private func checkFixture<T: Codable & Equatable>(
    _ name: String,
    as type: T.Type,
    nsid: NSID
) throws {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json"))
    let source = try Data(contentsOf: url)
    let record = try JSONDecoder().decode(type, from: source)
    try expectStableRoundTrip(record, source: source)
    #expect(try GeneratedLexiconValidator.validate(record, as: nsid).isEmpty)
}

private func expectStableRoundTrip<T: Codable & Equatable>(_ record: T, source: Data) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let first = try encoder.encode(record)
    let decoded = try JSONDecoder().decode(T.self, from: first)
    let second = try encoder.encode(decoded)
    #expect(decoded == record)
    #expect(second == first)

    let sourceValue = try JSONDecoder().decode(JSONValue.self, from: source)
    let outputValue = try JSONDecoder().decode(JSONValue.self, from: first)
    #expect(outputValue == sourceValue)
}

private func rootFixture(named name: String) throws -> Data {
    let fileManager = FileManager.default
    var cursor = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    while cursor.path != "/" {
        let fixture = cursor.appending(path: "fixtures/records/\(name)")
        if fileManager.fileExists(atPath: fixture.path) {
            return try Data(contentsOf: fixture)
        }
        cursor.deleteLastPathComponent()
    }
    throw CocoaError(.fileNoSuchFile)
}
