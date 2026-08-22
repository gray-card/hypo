import Foundation
import HypoLexicon
import PersistenceKit
import SyncKit
import Testing

@testable import LoggerFeature

@Test func lifecycleMergePreservesUnknownFieldsAndOmitsClearedOptionalFields() throws {
    let update = FilmRollLifecycleUpdate(
        roll: try rollURI(),
        milestones: FilmRollMilestones(
            loadedAt: try ATProtoDate("2026-08-01T10:00:00Z"),
            partialAt: try ATProtoDate("2026-08-01T11:00:00Z")
        ),
        developmentLocation: nil,
        updatedAt: try ATProtoDate("2026-08-01T12:00:00Z")
    )

    let merged = try FilmRollLifecycleRecordMerger.merge(
        record: filmRollRecord(
            extra:
                #", "developmentLocation":"lab", "sentToLabAt":"2026-08-01T11:30:00Z", "futureExtension":{"density":1.3}"#
        ),
        update: update
    )
    let object = try #require(JSONSerialization.jsonObject(with: merged) as? [String: Any])

    #expect(object["loadedAt"] as? String == "2026-08-01T10:00:00Z")
    #expect(object["partialAt"] as? String == "2026-08-01T11:00:00Z")
    #expect(object["sentToLabAt"] == nil)
    #expect(object["developmentLocation"] == nil)
    #expect(object["status"] as? String == "partial")
    let extensionObject = try #require(object["futureExtension"] as? [String: Any])
    #expect(extensionObject["density"] as? Double == 1.3)
}

@Test func lifecycleMergeRejectsDatesThatRunBackward() throws {
    let update = FilmRollLifecycleUpdate(
        roll: try rollURI(),
        milestones: FilmRollMilestones(
            loadedAt: try ATProtoDate("2026-08-02T00:00:00Z"),
            developedAt: try ATProtoDate("2026-08-01T00:00:00Z")
        ),
        developmentLocation: .home,
        updatedAt: try ATProtoDate("2026-08-03T00:00:00Z")
    )

    #expect(throws: LoggerError.self) {
        try FilmRollLifecycleRecordMerger.merge(record: filmRollRecord(), update: update)
    }
}

@Test func cachedCIDQueuesLifecycleUpdateWithoutNetworkHydration() async throws {
    let uri = try rollURI()
    let cached = CachedRecord(
        uri: uri.rawValue,
        cid: "bafy-current",
        collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
        rkey: "roll",
        value: filmRollRecord(),
        cachedAt: Date(timeIntervalSince1970: 1_700_000_000)
    )
    let store = InMemoryPersistenceStore(snapshot: PersistenceSnapshot(records: [cached]))
    let engine = SyncEngine(store: store, transport: FailingTransport())
    let hydrator = CountingHydrator()
    let writer = QueuedFilmRollLifecycleWriter(
        repo: "did:plc:test",
        engine: engine,
        store: store,
        hydrator: hydrator
    )
    let update = FilmRollLifecycleUpdate(
        roll: uri,
        milestones: FilmRollMilestones(
            loadedAt: try ATProtoDate("2026-08-01T10:00:00Z"),
            partialAt: try ATProtoDate("2026-08-01T11:00:00Z")
        ),
        developmentLocation: nil,
        updatedAt: try ATProtoDate("2026-08-01T12:00:00Z")
    )

    try await writer.updateFilmRollLifecycle(update)

    #expect(await hydrator.getCount == 0)
    let snapshot = await store.snapshot()
    let operation = try #require(snapshot.outbox.first)
    #expect(operation.kind == .put)
    #expect(operation.uri == uri.rawValue)
    #expect(operation.swapRecord == "bafy-current")
    let optimistic = try #require(snapshot.records.first { $0.uri == uri.rawValue })
    let object = try #require(
        JSONSerialization.jsonObject(with: optimistic.value) as? [String: Any]
    )
    #expect(object["partialAt"] as? String == "2026-08-01T11:00:00Z")
}

@Test func lifecycleWriterRefusesToStackAChangeOnPendingRollState() async throws {
    let uri = try rollURI()
    let pendingID = UUID()
    let record = filmRollRecord()
    let cached = CachedRecord(
        uri: uri.rawValue,
        cid: "bafy-current",
        collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
        rkey: "roll",
        value: record,
        pendingOperationID: pendingID
    )
    let pending = OutboxOperation(
        id: pendingID,
        kind: .put,
        repo: "did:plc:test",
        collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
        rkey: "roll",
        uri: uri.rawValue,
        record: record,
        swapRecord: "bafy-current"
    )
    let store = InMemoryPersistenceStore(
        snapshot: PersistenceSnapshot(records: [cached], outbox: [pending])
    )
    let writer = QueuedFilmRollLifecycleWriter(
        repo: "did:plc:test",
        engine: SyncEngine(store: store, transport: FailingTransport()),
        store: store,
        hydrator: CountingHydrator()
    )
    let update = FilmRollLifecycleUpdate(
        roll: uri,
        milestones: FilmRollMilestones(
            loadedAt: try ATProtoDate("2026-08-01T10:00:00Z"),
            partialAt: try ATProtoDate("2026-08-01T11:00:00Z")
        ),
        developmentLocation: nil,
        updatedAt: try ATProtoDate("2026-08-01T12:00:00Z")
    )

    await #expect(throws: LoggerError.self) {
        try await writer.updateFilmRollLifecycle(update)
    }
    #expect(await store.snapshot().outbox.count == 1)
}

private actor FailingTransport: SyncTransport {
    func execute(_: OutboxOperation) async throws -> RemoteWriteResult {
        throw SyncTransportError.transient(message: "offline")
    }
}

private actor CountingHydrator: RecordHydrating {
    private(set) var getCount = 0

    func get(_: RecordHydrationRequest) async throws -> HydratedRepositoryRecord {
        getCount += 1
        throw SyncTransportError.transient(message: "offline")
    }

    func list(_: RecordListHydrationRequest) async throws -> HydratedRepositoryPage {
        throw SyncTransportError.transient(message: "offline")
    }
}

private func rollURI() throws -> ATURI {
    try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/roll")
}

private func filmRollRecord(extra: String = "") -> Data {
    Data(
        """
        {"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:test/app.graycard.catalog.filmStock/tri-x","status":"loaded","loadedAt":"2026-08-01T10:00:00Z","createdAt":"2026-08-01T09:00:00Z"\(extra)}
        """.utf8
    )
}
