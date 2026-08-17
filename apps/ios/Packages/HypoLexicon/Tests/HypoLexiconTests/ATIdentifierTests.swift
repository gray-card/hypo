import Foundation
import Testing

@testable import HypoLexicon

@Test func validatesNSIDs() throws {
    #expect(try NSID("app.graycard.meter.reading").rawValue == "app.graycard.meter.reading")
    #expect(try NSID("app.graycard.instance.filmRoll").rawValue == "app.graycard.instance.filmRoll")
    #expect(throws: LexiconValueError.self) { try NSID("app.gray_card.record") }
    #expect(throws: LexiconValueError.self) { try NSID("graycard.record") }
}

@Test func decomposesRecordATURI() throws {
    let uri = try ATURI("at://did:plc:example/app.graycard.meter.reading/3ltest")
    #expect(uri.authority == "did:plc:example")
    #expect(uri.collection?.rawValue == "app.graycard.meter.reading")
    #expect(uri.recordKey == "3ltest")
}

@Test func identifiersUseStringWireRepresentations() throws {
    let uri = try ATURI("at://did:plc:example/app.graycard.meter.reading/3ltest")
    let encodedURI = try JSONEncoder().encode(uri)
    #expect(try JSONDecoder().decode(String.self, from: encodedURI) == uri.rawValue)

    let nsid = try NSID("app.graycard.meter.reading")
    let encodedNSID = try JSONEncoder().encode(nsid)
    #expect(try JSONDecoder().decode(String.self, from: encodedNSID) == nsid.rawValue)
}

@Test func lifecycleDatesAreOptionalAndChronologicallyValidated() throws {
    #expect(ConsumableLifecycleValidator.validate(FilmRollMilestones()).isEmpty)

    let early = try ATProtoDate("2026-08-01T12:00:00Z")
    let late = try ATProtoDate("2026-08-02T12:00:00Z")
    let invalid = FilmRollMilestones(loadedAt: late, developedAt: early)
    let issues = ConsumableLifecycleValidator.validate(invalid)
    #expect(
        issues.contains(
            ConsumableLifecycleIssue(earlierField: "loadedAt", laterField: "developedAt")
        )
    )

    let labScanFirst = FilmRollMilestones(receivedFromLabAt: late, scannedAt: early)
    #expect(ConsumableLifecycleValidator.validate(labScanFirst).isEmpty)
}

@Test func chemistryLifecycleUsesOnlyUnambiguousOrdering() throws {
    let early = try ATProtoDate("2026-08-01T12:00:00.000Z")
    let late = try ATProtoDate("2026-08-02T12:00:00.000Z")
    let invalid = ChemistryMilestones(mixedAt: late, discardedAt: early)
    #expect(
        ConsumableLifecycleValidator.validate(invalid).contains(
            ConsumableLifecycleIssue(earlierField: "mixedAt", laterField: "discardedAt")
        )
    )

    let acquiredAfterMixing = ChemistryMilestones(acquiredAt: late, mixedAt: early)
    #expect(ConsumableLifecycleValidator.validate(acquiredAfterMixing).isEmpty)
}

@Test func JSONValueRoundTripsUnknownRecordFields() throws {
    let source = Data(#"{"$type":"app.graycard.meter.reading","newField":[1,true,null]}"#.utf8)
    let value = try JSONDecoder().decode(JSONValue.self, from: source)
    let encoded = try JSONEncoder().encode(value)
    let decoded = try JSONDecoder().decode(JSONValue.self, from: encoded)
    #expect(decoded == value)
}
