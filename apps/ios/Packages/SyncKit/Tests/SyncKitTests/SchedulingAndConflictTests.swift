import Foundation
import PersistenceKit
import XCTest
@testable import SyncKit

private actor SchedulingTransport: SyncTransport {
    private var results: [Result<RemoteWriteResult, SyncTransportError>]
    private let delayNanoseconds: UInt64
    private(set) var operations: [OutboxOperation] = []

    init(
        _ results: [Result<RemoteWriteResult, SyncTransportError>],
        delayNanoseconds: UInt64 = 0
    ) {
        self.results = results
        self.delayNanoseconds = delayNanoseconds
    }

    func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult {
        operations.append(operation)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        guard !results.isEmpty else {
            throw SyncTransportError.permanent(message: "No scripted response")
        }
        return try results.removeFirst().get()
    }

    func callCount() -> Int { operations.count }
    func calls() -> [OutboxOperation] { operations }
}

private actor TestConnectivityMonitor: SyncConnectivityMonitoring {
    private var handler: (@Sendable (Bool) -> Void)?

    func start(handler: @escaping @Sendable (Bool) -> Void) {
        self.handler = handler
    }

    func cancel() {
        handler = nil
    }

    func send(isOnline: Bool) {
        handler?(isOnline)
    }
}

private actor TestBackgroundTask: SyncBackgroundRefreshTask {
    private var expirationHandler: (@Sendable () -> Void)?
    private(set) var completions: [Bool] = []

    func setExpirationHandler(_ handler: (@Sendable () -> Void)?) {
        expirationHandler = handler
    }

    func setTaskCompleted(success: Bool) {
        completions.append(success)
    }

    func expire() {
        expirationHandler?()
    }

    func hasExpirationHandler() -> Bool { expirationHandler != nil }
    func recordedCompletions() -> [Bool] { completions }
}

private actor BackgroundFlushScheduler: SyncFlushScheduling {
    let delayNanoseconds: UInt64

    init(delayNanoseconds: UInt64 = 0) {
        self.delayNanoseconds = delayNanoseconds
    }

    func applicationDidEnterForeground(now: Date) -> FlushReport { FlushReport() }

    func connectivityDidChange(isOnline: Bool, now: Date) -> FlushReport? { nil }

    func operationDidEnqueue(now: Date) -> FlushReport? { nil }

    func performBackgroundRefresh(now: Date) async -> FlushReport {
        if delayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: delayNanoseconds)
        }
        var report = FlushReport()
        report.attempted = 1
        report.succeeded = 1
        return report
    }
}

final class SchedulingAndConflictTests: XCTestCase {
    private let repo = "did:plc:test"
    private let collection = "app.example.record"

    private func json(_ value: String) -> Data {
        Data("{\"value\":\"\(value)\"}".utf8)
    }

    private func stringField(_ field: String, in data: Data?) throws -> String? {
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: Any]
        )
        return object[field] as? String
    }

    private func eventually(_ predicate: @escaping @Sendable () async -> Bool) async -> Bool {
        for _ in 0..<200 {
            if await predicate() { return true }
            await Task.yield()
        }
        return false
    }

    func testForegroundReconnectAndOnlinePostEnqueueHooksFlushAtMostOnce() async throws {
        let store = InMemoryPersistenceStore()
        let transport = SchedulingTransport([
            .success(
                RemoteWriteResult(
                    uri: "at://\(repo)/\(collection)/foreground",
                    cid: "cid-foreground"
                )),
            .success(
                RemoteWriteResult(
                    uri: "at://\(repo)/\(collection)/reconnect",
                    cid: "cid-reconnect"
                )),
            .success(
                RemoteWriteResult(
                    uri: "at://\(repo)/\(collection)/post-enqueue",
                    cid: "cid-post-enqueue"
                )),
        ])
        let engine = SyncEngine(store: store, transport: transport)
        let lifecycle = SyncLifecycleFlushAdapter(scheduler: engine)

        _ = try await engine.enqueueCreate(repo: repo, collection: collection, record: json("one"))
        let foreground = await lifecycle.didEnterForeground()
        XCTAssertEqual(foreground.succeeded, 1)

        _ = try await engine.enqueueCreate(repo: repo, collection: collection, record: json("two"))
        let monitor = TestConnectivityMonitor()
        let reconnect = SyncReconnectAdapter(monitor: monitor, scheduler: engine)
        await reconnect.start()
        await monitor.send(isOnline: false)
        await monitor.send(isOnline: true)
        let reconnected = await eventually { await transport.callCount() == 2 }
        XCTAssertTrue(reconnected)

        _ = try await engine.enqueueCreate(repo: repo, collection: collection, record: json("three"))
        let postEnqueueFlushed = await eventually { await transport.callCount() == 3 }
        XCTAssertTrue(postEnqueueFlushed)
        _ = await lifecycle.didEnqueue()
        let callCount = await transport.callCount()
        let finalSnapshot = await store.snapshot()
        XCTAssertEqual(callCount, 3)
        XCTAssertTrue(finalSnapshot.outbox.isEmpty)
        await reconnect.cancel()
    }

    func testBackgroundRefreshCompletesExactlyOnceForSuccessAndExpiration() async throws {
        let successfulTask = TestBackgroundTask()
        let successfulAdapter = SyncBackgroundRefreshAdapter(
            scheduler: BackgroundFlushScheduler()
        )
        await successfulAdapter.handle(successfulTask)
        let successfulCompletions = await successfulTask.recordedCompletions()
        XCTAssertEqual(successfulCompletions, [true])

        let expiringTask = TestBackgroundTask()
        let expiringAdapter = SyncBackgroundRefreshAdapter(
            scheduler: BackgroundFlushScheduler(delayNanoseconds: 5_000_000_000)
        )
        let handling = Task { await expiringAdapter.handle(expiringTask) }
        let installedExpiration = await eventually { await expiringTask.hasExpirationHandler() }
        XCTAssertTrue(installedExpiration)
        await expiringTask.expire()
        await handling.value
        let expiredCompletions = await expiringTask.recordedCompletions()
        XCTAssertEqual(expiredCompletions, [false])
    }

    func testLiveCrashLeaseIsSkippedThenExpiredLeaseIsRecoveredOnce() async throws {
        let operationID = UUID()
        let leaseID = UUID()
        let uri = "at://\(repo)/\(collection)/leased"
        let operation = OutboxOperation(
            id: operationID,
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "leased",
            uri: uri,
            record: json("local"),
            swapRecord: "cid-old",
            state: .flushing,
            leaseID: leaseID,
            createdAt: Date(timeIntervalSince1970: 100),
            updatedAt: Date(timeIntervalSince1970: 100)
        )
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(outbox: [operation])
        )
        let transport = SchedulingTransport([
            .success(RemoteWriteResult(uri: uri, cid: "cid-new", record: json("local")))
        ])
        let engine = SyncEngine(
            store: store,
            transport: transport,
            leasePolicy: SyncLeasePolicy(crashRecoveryInterval: 30)
        )

        let liveLeaseReport = await engine.flush(now: Date(timeIntervalSince1970: 129))
        let countBeforeExpiry = await transport.callCount()
        XCTAssertEqual(liveLeaseReport.attempted, 0)
        XCTAssertEqual(countBeforeExpiry, 0)
        let recoveredReport = await engine.flush(now: Date(timeIntervalSince1970: 130))
        let countAfterExpiry = await transport.callCount()
        let calls = await transport.calls()
        let replay = try XCTUnwrap(calls.first)
        XCTAssertEqual(recoveredReport.succeeded, 1)
        XCTAssertEqual(countAfterExpiry, 1)
        XCTAssertEqual(replay.id, operationID)
        XCTAssertNotEqual(replay.leaseID, leaseID)
    }

    func testManualRetryClearsBackoffButDoesNotStealLiveLease() async throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let waitingURI = "at://\(repo)/\(collection)/waiting"
        let waiting = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "waiting",
            uri: waitingURI,
            record: json("waiting"),
            state: .waitingForRetry,
            attemptCount: 2,
            nextAttemptAt: now.addingTimeInterval(300),
            lastError: "offline",
            createdAt: now.addingTimeInterval(-20)
        )
        let liveLease = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "leased",
            uri: "at://\(repo)/\(collection)/leased",
            record: json("leased"),
            state: .flushing,
            leaseID: UUID(),
            createdAt: now.addingTimeInterval(-10),
            updatedAt: now
        )
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(outbox: [waiting, liveLease])
        )
        let transport = SchedulingTransport([
            .success(RemoteWriteResult(uri: waitingURI, cid: "cid-waiting"))
        ])
        let engine = SyncEngine(store: store, transport: transport)

        let report = await engine.retryNow(now: now)

        XCTAssertEqual(report.succeeded, 1)
        let calls = await transport.calls()
        XCTAssertEqual(calls.map(\.id), [waiting.id])
        let remaining = await store.snapshot().outbox
        XCTAssertEqual(remaining.map(\.id), [liveLease.id])
        XCTAssertEqual(remaining.first?.leaseID, liveLease.leaseID)
    }

    func testTwoEnginesCannotExecuteTheSameOperationConcurrently() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: json("local"),
            createdAt: Date(timeIntervalSince1970: 100)
        )
        let store = InMemoryPersistenceStore(snapshot: PersistenceSnapshot(outbox: [operation]))
        let transport = SchedulingTransport(
            [.success(RemoteWriteResult(uri: uri, cid: "cid-new", record: json("local")))],
            delayNanoseconds: 50_000_000
        )
        let first = SyncEngine(store: store, transport: transport)
        let second = SyncEngine(store: store, transport: transport)

        async let firstReport = first.flush(now: Date(timeIntervalSince1970: 101))
        async let secondReport = second.flush(now: Date(timeIntervalSince1970: 101))
        let reports = await [firstReport, secondReport]
        let callCount = await transport.callCount()
        let finalSnapshot = await store.snapshot()

        XCTAssertEqual(reports.reduce(0) { $0 + $1.succeeded }, 1)
        XCTAssertEqual(callCount, 1)
        XCTAssertTrue(finalSnapshot.outbox.isEmpty)
    }

    func testDiscardConflictRestoresRemoteEvidence() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: json("local"),
            swapRecord: "cid-old",
            state: .flushing
        )
        let conflict = ParkedConflict(
            operation: operation,
            reason: "InvalidSwap",
            remoteCID: "cid-remote",
            remoteRecord: json("remote")
        )
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(
                records: [
                    CachedRecord(
                        uri: uri,
                        cid: "cid-old",
                        collection: collection,
                        rkey: "one",
                        value: json("local"),
                        pendingOperationID: operation.id
                    )
                ],
                conflicts: [conflict]
            )
        )
        let engine = SyncEngine(store: store, transport: SchedulingTransport([]))

        try await engine.discardConflict(id: conflict.id)

        let snapshot = await store.snapshot()
        XCTAssertTrue(snapshot.conflicts.isEmpty)
        XCTAssertEqual(snapshot.records.first?.cid, "cid-remote")
        XCTAssertEqual(snapshot.records.first?.value, json("remote"))
        XCTAssertNil(snapshot.records.first?.pendingOperationID)
    }

    func testRebaseRequeuesOriginalIdentityAgainstRemoteCID() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: json("local"),
            swapRecord: "cid-old",
            state: .flushing,
            attemptCount: 3,
            leaseID: UUID(),
            lastError: "InvalidSwap"
        )
        let conflict = ParkedConflict(
            operation: operation,
            reason: "InvalidSwap",
            remoteCID: "cid-remote",
            remoteRecord: json("remote")
        )
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(conflicts: [conflict])
        )
        let transport = SchedulingTransport([
            .success(RemoteWriteResult(uri: uri, cid: "cid-merged", record: json("merged")))
        ])
        let engine = SyncEngine(store: store, transport: transport)

        let requeuedID = try await engine.rebaseConflict(id: conflict.id, record: json("merged"))
        XCTAssertEqual(requeuedID, operation.id)
        var snapshot = await store.snapshot()
        let requeued = try XCTUnwrap(snapshot.outbox.first)
        XCTAssertEqual(requeued.state, .queued)
        XCTAssertEqual(requeued.swapRecord, "cid-remote")
        XCTAssertEqual(requeued.attemptCount, 0)
        XCTAssertNil(requeued.leaseID)
        XCTAssertTrue(snapshot.conflicts.isEmpty)
        XCTAssertEqual(snapshot.records.first?.pendingOperationID, operation.id)

        let report = await engine.flush()
        snapshot = await store.snapshot()
        let calls = await transport.calls()
        XCTAssertEqual(report.succeeded, 1)
        XCTAssertTrue(snapshot.outbox.isEmpty)
        XCTAssertEqual(snapshot.records.first?.cid, "cid-merged")
        XCTAssertEqual(calls.first?.swapRecord, "cid-remote")
    }

    func testRebasingCreateRewritesDependentTemporaryReferences() async throws {
        let operation = OutboxOperation(
            id: UUID(uuidString: "F5C2B392-08F4-4D0E-A7A4-1AB0ED14237E")!,
            kind: .create,
            repo: repo,
            collection: collection,
            tempURI: "outbox://create",
            record: json("create"),
            state: .flushing,
            createdAt: Date(timeIntervalSince1970: 100)
        )
        let conflict = ParkedConflict(
            operation: operation,
            reason: "occupied rkey",
            remoteCID: "cid-remote",
            remoteRecord: json("remote")
        )
        let dependent = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "temporary",
            uri: "outbox://create",
            record: Data("{\"parent\":\"outbox://create\"}".utf8),
            createdAt: Date(timeIntervalSince1970: 101)
        )
        let observer = CachedRecord(
            uri: "at://\(repo)/\(collection)/observer",
            cid: "cid-observer",
            collection: collection,
            rkey: "observer",
            value: Data("{\"parent\":\"outbox://create\"}".utf8)
        )
        let store = InMemoryPersistenceStore(
            snapshot: PersistenceSnapshot(
                records: [observer],
                outbox: [dependent],
                conflicts: [conflict]
            )
        )
        let engine = SyncEngine(store: store, transport: SchedulingTransport([]))

        _ = try await engine.rebaseConflict(id: conflict.id)

        let remoteURI =
            "at://\(repo)/\(collection)/f5c2b392-08f4-4d0e-a7a4-1ab0ed14237e"
        let snapshot = await store.snapshot()
        let rebased = try XCTUnwrap(snapshot.outbox.first(where: { $0.id == operation.id }))
        let rewrittenDependent = try XCTUnwrap(
            snapshot.outbox.first(where: { $0.id == dependent.id })
        )
        XCTAssertEqual(rebased.kind, .put)
        XCTAssertEqual(rebased.uri, remoteURI)
        XCTAssertEqual(rewrittenDependent.uri, remoteURI)
        XCTAssertEqual(try stringField("parent", in: rewrittenDependent.record), remoteURI)
        XCTAssertEqual(
            try stringField(
                "parent",
                in: snapshot.records.first(where: { $0.rkey == "observer" })?.value
            ),
            remoteURI
        )
    }
}
