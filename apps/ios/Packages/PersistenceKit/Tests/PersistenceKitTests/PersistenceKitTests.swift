import XCTest
@testable import PersistenceKit

final class PersistenceKitTests: XCTestCase {
    private func json(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func temporaryStoreURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PersistenceKitTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("store.json")
    }

    func testInMemoryStoreAppliesMixedTransactionAndPublishesChange() async throws {
        let store = InMemoryPersistenceStore()
        let stream = await store.changes()
        let operation = OutboxOperation(
            kind: .put,
            repo: "did:plc:test",
            collection: "app.example.record",
            rkey: "one",
            uri: "at://did:plc:test/app.example.record/one",
            record: try json(["name": "local"]),
            swapRecord: "cid-old"
        )
        let record = CachedRecord(
            uri: operation.uri!,
            cid: "cid-old",
            collection: operation.collection,
            rkey: "one",
            value: operation.record!,
            pendingOperationID: operation.id
        )

        async let firstChange = stream.first(where: { _ in true })
        try await store.apply([.upsertRecord(record), .enqueue(operation)])
        let change = await firstChange

        XCTAssertEqual(change?.revision, 1)
        XCTAssertEqual(change?.mutations, [.upsertRecord, .enqueue])
        let snapshot = await store.snapshot()
        XCTAssertEqual(snapshot.records, [record])
        XCTAssertEqual(snapshot.outbox, [operation])
        XCTAssertEqual(snapshot.outbox[0].swapRecord, "cid-old")
    }

    func testFileStoreSurvivesRelaunchWithOutboxConflictAndComplementCustody() async throws {
        let url = try temporaryStoreURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let create = OutboxOperation(
            kind: .create,
            repo: "did:plc:test",
            collection: "app.example.record",
            tempURI: "outbox://one",
            record: try json(["$type": "app.example.record", "ref": "outbox://other"])
        )
        let conflict = ParkedConflict(
            operation: create,
            reason: "InvalidSwap",
            remoteCID: "cid-remote",
            remoteRecord: try json(["name": "remote"])
        )
        let complementA = PanprotoComplement(
            recordURI: "at://did:plc:test/app.example.record/one",
            nativeCID: "cid-a",
            chainID: "chain-1",
            payload: Data([0, 1, 2, 3])
        )
        let complementB = PanprotoComplement(
            recordURI: complementA.recordURI,
            nativeCID: "cid-b",
            chainID: "chain-1",
            payload: Data([4, 5, 6])
        )

        var store: FilePersistenceStore? = try FilePersistenceStore(fileURL: url)
        try await store?.apply([
            .enqueue(create),
            .parkConflict(conflict),
            .saveComplement(complementA),
            .saveComplement(complementB),
        ])
        store = nil

        let relaunched = try FilePersistenceStore(fileURL: url)
        let snapshot = await relaunched.snapshot()
        XCTAssertEqual(snapshot.outbox, [create])
        XCTAssertEqual(snapshot.conflicts, [conflict])
        XCTAssertEqual(snapshot.complements, [complementA, complementB])
        let restoredComplement = try await relaunched.complement(
            recordURI: complementA.recordURI,
            nativeCID: "cid-a",
            chainID: "chain-1"
        )
        XCTAssertEqual(restoredComplement?.payload, complementA.payload)
    }

    func testComplementKeysKeepChainsAndNativeCIDsSeparate() async throws {
        let store = InMemoryPersistenceStore()
        let uri = "at://did:plc:test/app.example.record/one"
        let complements = [
            PanprotoComplement(recordURI: uri, nativeCID: "cid-1", chainID: "chain-a", payload: Data([1])),
            PanprotoComplement(recordURI: uri, nativeCID: "cid-1", chainID: "chain-b", payload: Data([2])),
            PanprotoComplement(recordURI: uri, nativeCID: "cid-2", chainID: "chain-a", payload: Data([3])),
        ]
        try await store.apply(complements.map(PersistenceMutation.saveComplement))
        let beforeRemoval = await store.snapshot()
        XCTAssertEqual(beforeRemoval.complements.count, 3)

        try await store.apply([.removeComplements(recordURI: uri, nativeCID: "cid-1")])
        let remaining = (await store.snapshot()).complements
        XCTAssertEqual(remaining, [complements[2]])
    }

    func testFailedTransactionDoesNotPartiallyCommit() async throws {
        let store = InMemoryPersistenceStore()
        let operation = OutboxOperation(
            kind: .delete,
            repo: "did:plc:test",
            collection: "app.example.record",
            rkey: "one",
            uri: "at://did:plc:test/app.example.record/one",
            swapRecord: "cid-old"
        )
        do {
            try await store.apply([
                .enqueue(operation),
                .updateOutbox(
                    OutboxOperation(
                        kind: .delete,
                        repo: "did:plc:test",
                        collection: "app.example.record"
                    )),
            ])
            XCTFail("Expected missing operation failure")
        } catch let error as PersistenceError {
            guard case .missingOutboxOperation = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }

        let snapshot = await store.snapshot()
        XCTAssertEqual(snapshot.revision, 0)
        XCTAssertTrue(snapshot.outbox.isEmpty)
    }

    func testFileStoreRejectsUnknownVersion() async throws {
        let url = try temporaryStoreURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try Data("{\"version\":999,\"state\":{}}".utf8).write(to: url)
        XCTAssertThrowsError(try FilePersistenceStore(fileURL: url)) { error in
            XCTAssertEqual(
                error as? PersistenceError,
                .unsupportedStoreVersion(found: 999, supported: FilePersistenceStore.currentVersion)
            )
        }
    }

    func testSwiftDataStorePersistsEveryDomainValueAcrossRelaunch() async throws {
        let url = try temporaryStoreURL()
            .deletingLastPathComponent()
            .appendingPathComponent("store.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let operation = OutboxOperation(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            kind: .put,
            repo: "did:plc:test",
            collection: "app.example.record",
            rkey: "one",
            uri: "at://did:plc:test/app.example.record/one",
            record: try json(["name": "local"]),
            swapRecord: "cid-old",
            createdAt: Date(timeIntervalSince1970: 100)
        )
        let record = CachedRecord(
            uri: operation.uri!,
            cid: "cid-old",
            collection: operation.collection,
            rkey: operation.rkey!,
            value: operation.record!,
            cachedAt: Date(timeIntervalSince1970: 101),
            pendingOperationID: operation.id
        )
        let conflict = ParkedConflict(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
            operation: operation,
            reason: "InvalidSwap",
            remoteCID: "cid-remote",
            remoteRecord: try json(["name": "remote"]),
            parkedAt: Date(timeIntervalSince1970: 102)
        )
        let complement = PanprotoComplement(
            recordURI: operation.uri!,
            nativeCID: "cid-old",
            chainID: "chain-1",
            payload: Data([0, 1, 2, 3]),
            createdAt: Date(timeIntervalSince1970: 103)
        )

        var store: SwiftDataPersistenceStore? = try SwiftDataPersistenceStore(storeURL: url)
        try await store?.apply([
            .upsertRecord(record),
            .enqueue(operation),
            .parkConflict(conflict),
            .saveComplement(complement),
        ])
        let firstSnapshot = try await store?.snapshot()
        XCTAssertEqual(firstSnapshot?.revision, 1)
        store = nil

        let relaunched = try SwiftDataPersistenceStore(storeURL: url)
        let snapshot = try await relaunched.snapshot()
        XCTAssertEqual(snapshot.revision, 1)
        XCTAssertEqual(snapshot.records, [record])
        XCTAssertEqual(snapshot.outbox, [operation])
        XCTAssertEqual(snapshot.conflicts, [conflict])
        XCTAssertEqual(snapshot.complements, [complement])
        XCTAssertEqual(SwiftDataPersistenceStore.currentSchemaVersion, "1.0.0")
    }

    func testSwiftDataStoreRejectsFailedTransactionWithoutPartialCommit() async throws {
        let url = try temporaryStoreURL()
            .deletingLastPathComponent()
            .appendingPathComponent("store.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try SwiftDataPersistenceStore(storeURL: url)
        let operation = OutboxOperation(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!,
            kind: .delete,
            repo: "did:plc:test",
            collection: "app.example.record",
            rkey: "one"
        )

        do {
            try await store.apply([
                .enqueue(operation),
                .enqueue(operation),
            ])
            XCTFail("Expected duplicate operation failure")
        } catch let error as PersistenceError {
            XCTAssertEqual(error, .duplicateOutboxOperation(operation.id))
        }

        let snapshot = try await store.snapshot()
        XCTAssertEqual(snapshot.revision, 0)
        XCTAssertTrue(snapshot.outbox.isEmpty)
    }
}
