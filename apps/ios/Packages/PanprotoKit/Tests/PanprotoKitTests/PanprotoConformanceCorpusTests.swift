import Foundation
import Testing

@testable import PanprotoKit

@Test func sharedTypeScriptAndSwiftPanprotoCorpusAgrees() async throws {
    let root = try repositoryRoot()
    let manifest = try jsonDictionary(
        at: root.appending(path: "fixtures/panproto-conformance/manifest.json")
    )
    let oracle = try jsonDictionary(
        at: root.appending(path: "fixtures/panproto-conformance/oracle.json")
    )

    #expect(try requiredInteger(manifest, "formatVersion") == 1)
    #expect(try requiredString(manifest, "panprotoVersion") == PanprotoAdoption.version)
    #expect(try requiredInteger(oracle, "formatVersion") == 1)
    #expect(try requiredString(oracle, "panprotoVersion") == PanprotoAdoption.version)

    let manifestCases = try #require(manifest["cases"] as? [NSDictionary])
    let oracleCases = try #require(oracle["cases"] as? [NSDictionary])
    let oracleByID = try Dictionary(
        uniqueKeysWithValues: oracleCases.map { (try requiredString($0, "id"), $0) }
    )
    #expect(Set(try manifestCases.map { try requiredString($0, "id") }) == Set(oracleByID.keys))

    let chainPath = try requiredString(manifest, "identityChain")
    let identityChain = try Data(contentsOf: root.appending(path: chainPath))
    let inspector = PanprotoSchemaInspector()
    let migrator = PanprotoRecordMigrator()

    for testCase in manifestCases {
        let id = try requiredString(testCase, "id")
        let expected = try #require(oracleByID[id], "Missing TypeScript oracle case \(id)")
        let record = try Data(
            contentsOf: root.appending(path: try requiredString(testCase, "record"))
        )
        let lexicon = try Data(
            contentsOf: root.appending(path: try requiredString(testCase, "lexicon"))
        )

        let violations = try await inspector.validateRecord(record, againstLexicon: lexicon)
        #expect(violations.isEmpty, "\(id): \(violations.joined(separator: "; "))")
        let inputObject = try jsonObject(record)
        let expectedValidated = try requiredDictionary(expected, "validated")
        #expect(inputObject == expectedValidated)

        guard let identityRecordPath = testCase["identityRecord"] as? String else {
            #expect(testCase["identityLimitation"] as? String == expected["identityLimitation"] as? String)
            #expect(expected["lift"] == nil)
            #expect(expected["get"] == nil)
            #expect(expected["put"] == nil)
            continue
        }

        let identityRecord = try Data(contentsOf: root.appending(path: identityRecordPath))
        let definition = try await inspector.serializedDefinition(fromLexicon: lexicon)
        let release = PanprotoSchemaRelease(label: "current", definition: definition)
        let migration = PanprotoMigrationArtifact(
            chainID: "shared-identity-\(id)",
            source: release,
            target: release,
            fullChainJSON: identityChain
        )

        let lifted = try await migrator.forwardLift(identityRecord, using: migration)
        let projection = try await migrator.get(identityRecord, using: migration)
        let restored = try await migrator.put(
            editedView: projection.record,
            complement: projection.complement,
            using: migration
        )

        let liftedObject = try jsonObject(lifted)
        let projectedObject = try jsonObject(projection.record)
        let restoredObject = try jsonObject(restored)
        let expectedLift = try requiredDictionary(expected, "lift")
        let expectedGet = try requiredDictionary(expected, "get")
        let expectedPut = try requiredDictionary(expected, "put")
        #expect(liftedObject == expectedLift)
        #expect(projectedObject == expectedGet)
        #expect(restoredObject == expectedPut)
    }
}

private func repositoryRoot() throws -> URL {
    var candidate = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let fileManager = FileManager.default
    while candidate.path != "/" {
        let manifest = candidate.appending(path: "fixtures/panproto-conformance/manifest.json")
        if fileManager.fileExists(atPath: manifest.path) {
            return candidate
        }
        candidate.deleteLastPathComponent()
    }
    throw CorpusFailure.repositoryRootNotFound
}

private func jsonDictionary(at url: URL) throws -> NSDictionary {
    try jsonObject(Data(contentsOf: url))
}

private func jsonObject(_ data: Data) throws -> NSDictionary {
    try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
}

private func requiredString(_ dictionary: NSDictionary, _ key: String) throws -> String {
    try #require(dictionary[key] as? String, "Missing string field \(key)")
}

private func requiredInteger(_ dictionary: NSDictionary, _ key: String) throws -> Int {
    try #require(dictionary[key] as? Int, "Missing integer field \(key)")
}

private func requiredDictionary(_ dictionary: NSDictionary, _ key: String) throws -> NSDictionary {
    try #require(dictionary[key] as? NSDictionary, "Missing object field \(key)")
}

private enum CorpusFailure: Error {
    case repositoryRootNotFound
}
