import XCTest
import PersistenceKit
@testable import SyncKit

private actor ScriptedTransport: SyncTransport {
    private var outcomes: [Result<RemoteWriteResult, SyncTransportError>]
    private(set) var operations: [OutboxOperation] = []
    private let delayNanoseconds: UInt64

    init(
        _ outcomes: [Result<RemoteWriteResult, SyncTransportError>],
        delayNanoseconds: UInt64 = 0
    ) {
        self.outcomes = outcomes
        self.delayNanoseconds = delayNanoseconds
    }

    func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult {
        operations.append(operation)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        guard !outcomes.isEmpty else {
            throw SyncTransportError.permanent(message: "No scripted response")
        }
        return try outcomes.removeFirst().get()
    }

    func callCount() -> Int { operations.count }
    func calls() -> [OutboxOperation] { operations }
}

final class SyncKitTests: XCTestCase {
    private let repo = "did:plc:test"
    private let collection = "app.example.record"

    private func json(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func object(_ data: Data?) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: Any])
    }

    private func temporaryStoreURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SyncKitTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("store.json")
    }

    func testOfflineMixedOperationsPersistAndFlushInOrderAfterRetry() async throws {
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(records: [
                CachedRecord(
                    uri: "at://\(repo)/\(collection)/put",
                    cid: "cid-put-old",
                    collection: collection,
                    rkey: "put",
                    value: try json(["value": "old"])
                ),
                CachedRecord(
                    uri: "at://\(repo)/\(collection)/delete",
                    cid: "cid-delete-old",
                    collection: collection,
                    rkey: "delete",
                    value: try json(["value": "delete me"])
                ),
            ]))
        let transport = ScriptedTransport([
            .failure(.transient(message: "offline")),
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/created", cid: "cid-created")),
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/put", cid: "cid-put-new")),
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/delete")),
        ])
        let engine = SyncEngine(
            store: store,
            transport: transport,
            retryPolicy: RetryPolicy(initialDelay: 10, maximumAttempts: 3)
        )
        let start = Date(timeIntervalSince1970: 1_000)
        let tempURI = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["value": "created"]),
            now: start
        )
        try await engine.enqueuePut(
            repo: repo,
            collection: collection,
            rkey: "put",
            uri: "at://\(repo)/\(collection)/put",
            record: json(["value": "new"]),
            now: start.addingTimeInterval(1)
        )
        try await engine.enqueueDelete(
            repo: repo,
            collection: collection,
            rkey: "delete",
            uri: "at://\(repo)/\(collection)/delete",
            now: start.addingTimeInterval(2)
        )

        let offlineReport = await engine.flush(now: start.addingTimeInterval(3))
        XCTAssertEqual(offlineReport.attempted, 1)
        XCTAssertEqual(offlineReport.retryScheduled, 1)
        let offlineCallCount = await transport.callCount()
        XCTAssertEqual(offlineCallCount, 1)
        var snapshot = await store.snapshot()
        XCTAssertEqual(snapshot.outbox.count, 3)
        XCTAssertEqual(snapshot.outbox[0].state, .waitingForRetry)
        XCTAssertNotNil(snapshot.records.first { $0.uri == tempURI })
        XCTAssertNil(snapshot.records.first { $0.rkey == "delete" })

        let earlyReport = await engine.flush(now: start.addingTimeInterval(9))
        XCTAssertEqual(earlyReport.attempted, 0)
        let earlyCallCount = await transport.callCount()
        XCTAssertEqual(earlyCallCount, 1)

        let onlineReport = await engine.flush(now: start.addingTimeInterval(13))
        XCTAssertEqual(onlineReport.succeeded, 3)
        XCTAssertEqual(onlineReport.reconciliations[tempURI], "at://\(repo)/\(collection)/created")
        snapshot = await store.snapshot()
        XCTAssertTrue(snapshot.outbox.isEmpty)
        XCTAssertNil(snapshot.records.first { $0.uri == tempURI })
        XCTAssertEqual(snapshot.records.first { $0.rkey == "created" }?.cid, "cid-created")
        XCTAssertEqual(snapshot.records.first { $0.rkey == "put" }?.cid, "cid-put-new")
        XCTAssertNil(snapshot.records.first { $0.rkey == "delete" })
        let operationKinds = await transport.calls().map(\.kind)
        XCTAssertEqual(operationKinds, [.create, .create, .put, .delete])
    }

    func testTempURIReconciliationPatchesCacheAndLaterOutboxJSON() async throws {
        let store = InMemoryPersistenceStore()
        let transport = ScriptedTransport([
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/a", cid: "cid-a")),
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/b", cid: "cid-b")),
        ])
        let engine = SyncEngine(store: store, transport: transport)
        let tempA = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["name": "A"])
        )
        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["name": "B", "parent": tempA])
        )
        let observer = CachedRecord(
            uri: "at://\(repo)/\(collection)/observer",
            cid: "cid-observer",
            collection: collection,
            rkey: "observer",
            value: try json(["nested": ["ref": tempA]])
        )
        try await store.apply([.upsertRecord(observer)])

        let report = await engine.flush()
        XCTAssertEqual(report.succeeded, 2)
        let calls = await transport.calls()
        XCTAssertEqual(try object(calls[1].record)["parent"] as? String, "at://\(repo)/\(collection)/a")
        let snapshot = await store.snapshot()
        let observerAfter = try XCTUnwrap(snapshot.records.first { $0.rkey == "observer" })
        let nested = try XCTUnwrap(try object(observerAfter.value)["nested"] as? [String: Any])
        XCTAssertEqual(nested["ref"] as? String, "at://\(repo)/\(collection)/a")
    }

    func testPutAgainstPendingCreateReceivesRemoteURIAndCAS() async throws {
        let store = InMemoryPersistenceStore()
        let transport = ScriptedTransport([
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/one", cid: "cid-created")),
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/one", cid: "cid-updated")),
        ])
        let engine = SyncEngine(store: store, transport: transport)
        let temp = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["version": 1])
        )
        try await engine.enqueuePut(
            repo: repo,
            collection: collection,
            rkey: "temporary",
            uri: temp,
            record: json(["version": 2])
        )

        let report = await engine.flush()
        XCTAssertEqual(report.succeeded, 2)
        let calls = await transport.calls()
        let put = try XCTUnwrap(calls.last)
        XCTAssertEqual(put.uri, "at://\(repo)/\(collection)/one")
        XCTAssertEqual(put.rkey, "one")
        XCTAssertEqual(put.swapRecord, "cid-created")
        let snapshot = await store.snapshot()
        let record = try XCTUnwrap(snapshot.records.first)
        XCTAssertEqual(record.cid, "cid-updated")
        XCTAssertEqual(try object(record.value)["version"] as? Int, 2)
    }

    func testConflictIsParkedWithRemoteEvidenceAndCASMetadata() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let original = CachedRecord(
            uri: uri,
            cid: "cid-local",
            collection: collection,
            rkey: "one",
            value: try json(["value": "base"])
        )
        let store = InMemoryPersistenceStore(snapshot: PersistenceSnapshot(records: [original]))
        let remote = try json(["value": "remote"])
        let transport = ScriptedTransport([
            .failure(.conflict(remoteCID: "cid-remote", remoteRecord: remote, message: "InvalidSwap"))
        ])
        let engine = SyncEngine(store: store, transport: transport)
        try await engine.enqueuePut(
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: json(["value": "local edit"])
        )

        let report = await engine.flush()
        XCTAssertEqual(report.conflictsParked, 1)
        let snapshot = await store.snapshot()
        XCTAssertTrue(snapshot.outbox.isEmpty)
        let conflict = try XCTUnwrap(snapshot.conflicts.first)
        XCTAssertEqual(conflict.reason, "InvalidSwap")
        XCTAssertEqual(conflict.remoteCID, "cid-remote")
        XCTAssertEqual(conflict.remoteRecord, remote)
        XCTAssertEqual(conflict.operation.swapRecord, "cid-local")
    }

    func testDeferredAccountOperationStaysQueuedWhileLaterAccountOperationFlushes() async throws {
        let otherRepo = "did:plc:other"
        let store = InMemoryPersistenceStore()
        let transport = ScriptedTransport([
            .failure(.deferred(message: "wrong account")),
            .success(
                RemoteWriteResult(
                    uri: "at://\(repo)/\(collection)/current",
                    cid: "cid-current"
                )
            ),
        ])
        let engine = SyncEngine(store: store, transport: transport)
        _ = try await engine.enqueueCreate(
            repo: otherRepo,
            collection: collection,
            rkey: "other",
            record: json(["value": "other"])
        )
        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            rkey: "current",
            record: json(["value": "current"])
        )

        let report = await engine.flush()

        XCTAssertEqual(report.attempted, 2)
        XCTAssertEqual(report.deferred, 1)
        XCTAssertEqual(report.succeeded, 1)
        XCTAssertEqual(report.conflictsParked, 0)
        let snapshot = await store.snapshot()
        XCTAssertEqual(snapshot.outbox.count, 1)
        XCTAssertEqual(snapshot.outbox[0].repo, otherRepo)
        XCTAssertEqual(snapshot.outbox[0].state, .queued)
        XCTAssertEqual(snapshot.outbox[0].attemptCount, 0)
        XCTAssertTrue(snapshot.conflicts.isEmpty)
        XCTAssertNotNil(snapshot.records.first { $0.rkey == "current" })
    }

    func testConcurrentFlushCallsShareOneExecution() async throws {
        let store = InMemoryPersistenceStore()
        let transport = ScriptedTransport(
            [
                .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/one", cid: "cid-one"))
            ], delayNanoseconds: 50_000_000)
        let engine = SyncEngine(store: store, transport: transport)
        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["value": 1])
        )

        async let first = engine.flush()
        async let second = engine.flush()
        let reports = await [first, second]
        XCTAssertEqual(reports[0], reports[1])
        XCTAssertEqual(reports[0].succeeded, 1)
        let callCount = await transport.callCount()
        XCTAssertEqual(callCount, 1)
    }

    func testFileBackedOutboxFlushesAfterRelaunch() async throws {
        let url = try temporaryStoreURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        var firstStore: FilePersistenceStore? = try FilePersistenceStore(fileURL: url)
        var firstEngine: SyncEngine? = SyncEngine(
            store: try XCTUnwrap(firstStore),
            transport: ScriptedTransport([])
        )
        let temp = try await firstEngine?.enqueueCreate(
            repo: repo,
            collection: collection,
            record: json(["value": "offline"])
        )
        XCTAssertNotNil(temp)
        firstEngine = nil
        firstStore = nil

        let relaunchedStore = try FilePersistenceStore(fileURL: url)
        let transport = ScriptedTransport([
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/restored", cid: "cid-restored"))
        ])
        let relaunchedEngine = SyncEngine(store: relaunchedStore, transport: transport)
        let report = await relaunchedEngine.flush()
        XCTAssertEqual(report.succeeded, 1)
        let snapshot = await relaunchedStore.snapshot()
        XCTAssertTrue(snapshot.outbox.isEmpty)
        XCTAssertEqual(snapshot.records.first?.uri, "at://\(repo)/\(collection)/restored")
        XCTAssertEqual(snapshot.records.first?.cid, "cid-restored")
    }

    func testChangeSequenceReportsLifecycle() async throws {
        let store = InMemoryPersistenceStore()
        let transport = ScriptedTransport([
            .success(RemoteWriteResult(uri: "at://\(repo)/\(collection)/one", cid: "cid-one"))
        ])
        let engine = SyncEngine(store: store, transport: transport)
        let stream = await engine.changes()
        let collector = Task { () -> [SyncChange] in
            var changes: [SyncChange] = []
            for await change in stream {
                changes.append(change)
                if changes.count == 4 { break }
            }
            return changes
        }

        let temp = try await engine.enqueueCreate(
            repo: repo, collection: collection, record: json(["value": 1]))
        _ = await engine.flush()
        let changes = await collector.value
        XCTAssertEqual(changes.count, 4)
        guard case .enqueued = changes[0] else { return XCTFail("Expected enqueue") }
        guard case .began = changes[1] else { return XCTFail("Expected begin") }
        guard case .succeeded = changes[2] else { return XCTFail("Expected success") }
        XCTAssertEqual(changes[3], .reconciled(tempURI: temp, remoteURI: "at://\(repo)/\(collection)/one"))
    }

    func testStateMachineAndBackoffGoldenValues() throws {
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            state: .queued
        )
        let flushing = try OutboxStateMachine.transition(
            operation,
            to: .flushing,
            now: Date(timeIntervalSince1970: 10),
            leaseID: UUID()
        )
        XCTAssertEqual(flushing.state, .flushing)
        let deferred = try OutboxStateMachine.transition(flushing, to: .queued, now: Date())
        XCTAssertEqual(deferred.state, .queued)

        let policy = RetryPolicy(initialDelay: 2, multiplier: 3, maximumDelay: 20, maximumAttempts: 5)
        XCTAssertEqual(policy.delay(afterAttempt: 1), 2)
        XCTAssertEqual(policy.delay(afterAttempt: 2), 6)
        XCTAssertEqual(policy.delay(afterAttempt: 3), 18)
        XCTAssertEqual(policy.delay(afterAttempt: 4), 20)
    }
}
