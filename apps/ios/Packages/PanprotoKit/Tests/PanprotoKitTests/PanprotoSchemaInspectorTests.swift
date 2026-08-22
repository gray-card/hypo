import Foundation
import Testing

@testable import PanprotoKit

private let testLexicon = Data(
    #"{"lexicon":1,"id":"app.test.record","defs":{"main":{"type":"record","key":"tid","record":{"type":"object","required":["name"],"properties":{"name":{"type":"string","maxLength":80},"schemaVersion":{"type":"string","maxLength":20}}}}}}"#
        .utf8
)

private let newestTestLexicon = Data(
    #"{"lexicon":1,"id":"app.test.record","defs":{"main":{"type":"record","key":"tid","record":{"type":"object","required":["name","rating"],"properties":{"name":{"type":"string","maxLength":80},"rating":{"type":"integer","minimum":1,"maximum":5},"schemaVersion":{"type":"string","maxLength":20}}}}}}"#
        .utf8
)

@Test func usesReleasedBindingVersion() {
    #expect(PanprotoAdoption.version == "0.70.1")
}

@Test func inspectsAnATProtoLexiconThroughTheOfficialEngine() async throws {
    let report = try await PanprotoSchemaInspector().inspectLexicon(testLexicon)
    #expect(report.protocolName == "atproto")
    #expect(report.vertexCount > 0)
    #expect(report.isValid)
}

@Test func validatesARecordAgainstItsLexicon() async throws {
    let record = Data(#"{"$type":"app.test.record","name":"Darkroom notes"}"#.utf8)
    let violations = try await PanprotoSchemaInspector().validateRecord(
        record,
        againstLexicon: testLexicon
    )
    #expect(violations.isEmpty)
}

@Test func restoresAndInspectsABundledSchemaDefinition() async throws {
    let inspector = PanprotoSchemaInspector()
    let definition = try await inspector.serializedDefinition(fromLexicon: testLexicon)
    let report = try await inspector.inspectDefinition(definition)
    let violations = try await inspector.validateRecord(
        Data(#"{"$type":"app.test.record","name":"Darkroom notes"}"#.utf8),
        againstDefinition: definition
    )

    #expect(report.protocolName == "atproto")
    #expect(report.isValid)
    #expect(violations.isEmpty)
}

@Test func explicitSchemaVersionIsAuthoritative() async throws {
    let inspector = PanprotoSchemaInspector()
    let old = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let newest = PanprotoSchemaRelease(
        label: "v2",
        definition: try await inspector.serializedDefinition(fromLexicon: newestTestLexicon)
    )
    let record = Data(
        #"{"$type":"app.test.record","name":"Darkroom notes","rating":5,"schemaVersion":"v1"}"#
            .utf8
    )

    let interpretation = try await PanprotoRecordMigrator().interpretRelease(
        of: record,
        releasesNewestFirst: [newest, old]
    )

    #expect(interpretation.release.label == "v1")
    #expect(interpretation.evidence == .explicit)
}

@Test func explicitSchemaVersionNeverFallsBackToACompatibleRelease() async throws {
    let inspector = PanprotoSchemaInspector()
    let old = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let newest = PanprotoSchemaRelease(
        label: "v2",
        definition: try await inspector.serializedDefinition(fromLexicon: newestTestLexicon)
    )
    let record = Data(
        #"{"$type":"app.test.record","name":"Darkroom notes","schemaVersion":"v2"}"#.utf8
    )

    do {
        _ = try await PanprotoRecordMigrator().interpretRelease(
            of: record,
            releasesNewestFirst: [newest, old]
        )
        Issue.record("Expected the explicit v2 label to fail against v2")
    } catch .explicitSchemaVersionMismatch(let label, _) {
        #expect(label == "v2")
    }
}

@Test func unlabeledRecordsUseNewestFirstCompatibleInterpretation() async throws {
    let inspector = PanprotoSchemaInspector()
    let old = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let newest = PanprotoSchemaRelease(
        label: "v2",
        definition: try await inspector.serializedDefinition(fromLexicon: newestTestLexicon)
    )
    let record = Data(#"{"$type":"app.test.record","name":"Darkroom notes"}"#.utf8)

    let interpretation = try await PanprotoRecordMigrator().interpretRelease(
        of: record,
        releasesNewestFirst: [newest, old]
    )

    #expect(interpretation.release.label == "v1")
    #expect(interpretation.evidence == .compatibleUnlabeled)
}

@Test func fullChainFixtureSupportsForwardAndReversibleProjection() async throws {
    let inspector = PanprotoSchemaInspector()
    let release = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let migration = PanprotoMigrationArtifact(
        chainID: "app.test.identity.v1",
        source: release,
        target: release,
        fullChainJSON: try identityChainFixture()
    )
    let record = Data(
        #"{"$type":"app.test.record","name":"Darkroom notes","schemaVersion":"v1"}"#.utf8
    )
    let migrator = PanprotoRecordMigrator()

    let first = try await migrator.get(record, using: migration)
    let second = try await migrator.get(record, using: migration)
    let lifted = try await migrator.forwardLift(record, using: migration)
    let restored = try await migrator.put(
        editedView: first.record,
        complement: first.complement,
        using: migration
    )

    #expect(first.complement == second.complement)
    #expect(try jsonObject(first.record) == jsonObject(record))
    #expect(try jsonObject(lifted) == jsonObject(record))
    #expect(try jsonObject(restored) == jsonObject(record))
}

@Test func malformedOpaqueComplementIsAnAppFacingFault() async throws {
    let inspector = PanprotoSchemaInspector()
    let release = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let migration = PanprotoMigrationArtifact(
        chainID: "app.test.identity.v1",
        source: release,
        target: release,
        fullChainJSON: try identityChainFixture()
    )

    do {
        _ = try await PanprotoRecordMigrator().put(
            editedView: Data(#"{"$type":"app.test.record","name":"Darkroom notes"}"#.utf8),
            complement: PanprotoOpaqueComplement(rawValue: Data([0xFF])),
            using: migration
        )
        Issue.record("Expected malformed complement bytes to be refused")
    } catch .malformedComplement {
        // The app can request a fresh projection instead of inspecting an engine error string.
    }
}

/// Removal gate for the Panproto 0.70.1 decimal fingerprint-message compatibility shim.
///
/// When a later binding maps this engine spelling to `PanprotoError.Fault` itself, remove the
/// fallback parser in `PanprotoFault.wrapping(_:)`; this test must continue to pass through the
/// official structured-fault path.
@Test func panproto0701DecimalFingerprintMessageIsNormalized() async throws {
    let inspector = PanprotoSchemaInspector()
    let old = PanprotoSchemaRelease(
        label: "v1",
        definition: try await inspector.serializedDefinition(fromLexicon: testLexicon)
    )
    let newest = PanprotoSchemaRelease(
        label: "v2",
        definition: try await inspector.serializedDefinition(fromLexicon: newestTestLexicon)
    )
    let oldMigration = PanprotoMigrationArtifact(
        chainID: "app.test.identity.v1",
        source: old,
        target: old,
        fullChainJSON: try identityChainFixture()
    )
    let newestMigration = PanprotoMigrationArtifact(
        chainID: "app.test.identity.v2",
        source: newest,
        target: newest,
        fullChainJSON: try identityChainFixture()
    )
    let record = Data(
        #"{"$type":"app.test.record","name":"Darkroom notes","rating":5}"#.utf8
    )
    let migrator = PanprotoRecordMigrator()
    let oldProjection = try await migrator.get(record, using: oldMigration)

    do {
        _ = try await migrator.put(
            editedView: record,
            complement: oldProjection.complement,
            using: newestMigration
        )
        Issue.record("Expected a complement captured against v1 to be refused by v2")
    } catch .complementFingerprintMismatch {
        // Callers can discard the stale custody entry and project again with the correct chain.
    }
}

private func identityChainFixture() throws -> Data {
    let url = try #require(
        Bundle.module.url(forResource: "identity-chain", withExtension: "json")
    )
    return try Data(contentsOf: url)
}

private func jsonObject(_ data: Data) throws -> NSDictionary {
    try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
}
