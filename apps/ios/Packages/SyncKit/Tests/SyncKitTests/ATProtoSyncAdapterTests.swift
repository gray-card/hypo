import ATProtoClient
import Foundation
import PanprotoKit
import PersistenceKit
import XCTest
@testable import SyncKit

private enum RepositoryFailure: Error, Sendable {
    case invalidSwap(String?)
    case http(status: Int, error: String?, message: String?)
    case url(URLError.Code)

    func raise(operation: String) throws -> Never {
        switch self {
        case .invalidSwap(let message):
            throw InvalidSwapConflict(operation: operation, message: message)
        case let .http(status, error, message):
            throw ATProtoHTTPError(statusCode: status, error: error, message: message)
        case .url(let code):
            throw URLError(code)
        }
    }
}

private actor RecordingRepository: ATProtoRepositoryAccessing {
    var putResults: [Result<ATProtoRepositoryWriteReceipt, RepositoryFailure>] = []
    var deleteResults: [Result<Void, RepositoryFailure>] = []
    var getResults: [Result<RepositoryRecord, RepositoryFailure>] = []
    var listResults: [Result<ATProtoRepositoryPage, RepositoryFailure>] = []

    private(set) var putRequests: [PutRecordRequest] = []
    private(set) var deleteRequests: [DeleteRecordRequest] = []
    private(set) var getRequests: [GetRecordRequest] = []
    private(set) var listRequests: [ListRecordsRequest] = []

    init(
        puts: [Result<ATProtoRepositoryWriteReceipt, RepositoryFailure>] = [],
        deletes: [Result<Void, RepositoryFailure>] = [],
        gets: [Result<RepositoryRecord, RepositoryFailure>] = [],
        lists: [Result<ATProtoRepositoryPage, RepositoryFailure>] = []
    ) {
        putResults = puts
        deleteResults = deletes
        getResults = gets
        listResults = lists
    }

    func putRecord(
        _ request: PutRecordRequest,
        session: OAuthSession
    ) throws -> ATProtoRepositoryWriteReceipt {
        putRequests.append(request)
        return try consume(&putResults, operation: "put")
    }

    func deleteRecord(_ request: DeleteRecordRequest, session: OAuthSession) throws {
        deleteRequests.append(request)
        let _: Void = try consume(&deleteResults, operation: "delete")
    }

    func getRecord(_ request: GetRecordRequest, session: OAuthSession) throws -> RepositoryRecord {
        getRequests.append(request)
        return try consume(&getResults, operation: "get")
    }

    func listRecords(
        _ request: ListRecordsRequest,
        session: OAuthSession
    ) throws -> ATProtoRepositoryPage {
        listRequests.append(request)
        return try consume(&listResults, operation: "list")
    }

    func capturedPuts() -> [PutRecordRequest] { putRequests }
    func capturedDeletes() -> [DeleteRecordRequest] { deleteRequests }
    func capturedGets() -> [GetRecordRequest] { getRequests }
    func capturedLists() -> [ListRecordsRequest] { listRequests }

    private func consume<Value>(
        _ values: inout [Result<Value, RepositoryFailure>],
        operation: String
    ) throws -> Value {
        guard !values.isEmpty else {
            throw ATProtoHTTPError(statusCode: 500, error: "Unscripted", message: operation)
        }
        switch values.removeFirst() {
        case .success(let value): return value
        case .failure(let error): try error.raise(operation: operation)
        }
    }
}

private struct StubPanprotoMigrator: PanprotoRecordMigrating {
    var projection: PanprotoRecordProjection

    func interpretRelease(
        of record: Data,
        releasesNewestFirst: [PanprotoSchemaRelease]
    ) async throws(PanprotoFault) -> PanprotoReleaseInterpretation {
        guard let release = releasesNewestFirst.first else {
            throw .noCompatibleSchemaVersion
        }
        return PanprotoReleaseInterpretation(release: release, evidence: .compatibleUnlabeled)
    }

    func forwardLift(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data {
        projection.record
    }

    func get(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> PanprotoRecordProjection {
        projection
    }

    func put(
        editedView: Data,
        complement: PanprotoOpaqueComplement,
        using migration: PanprotoMigrationArtifact
    ) async throws(PanprotoFault) -> Data {
        editedView
    }
}

final class ATProtoSyncAdapterTests: XCTestCase {
    private let repo = "did:plc:test"
    private let collection = "app.example.record"
    private let session = OAuthSession(
        id: OAuthSessionID(rawValue: "session-1"),
        issuer: URL(string: "https://auth.example")!,
        subject: "did:plc:test",
        accessToken: "access-token"
    )

    private func transport(_ repository: RecordingRepository) -> ATProtoSyncTransport {
        ATProtoSyncTransport(
            repository: repository,
            sessionProvider: FixedSyncOAuthSessionProvider(session)
        )
    }

    private func recordData(_ name: String) -> Data {
        Data("{\"$type\":\"app.example.record\",\"name\":\"\(name)\"}".utf8)
    }

    private func recordValue(_ name: String) -> JSONValue {
        .object([
            "$type": .string("app.example.record"),
            "name": .string(name),
        ])
    }

    func testCreateUsesOperationStableRKeyAndRecoversIdenticalDuplicate() async throws {
        let id = UUID(uuidString: "F5C2B392-08F4-4D0E-A7A4-1AB0ED14237E")!
        let uri = "at://\(repo)/\(collection)/f5c2b392-08f4-4d0e-a7a4-1ab0ed14237e"
        let repository = RecordingRepository(
            puts: [
                .success(ATProtoRepositoryWriteReceipt(uri: uri, cid: "cid-1")),
                .failure(.invalidSwap("rkey exists")),
            ],
            gets: [
                .success(RepositoryRecord(uri: uri, cid: "cid-1", value: recordValue("one")))
            ]
        )
        let operation = OutboxOperation(
            id: id,
            kind: .create,
            repo: repo,
            collection: collection,
            record: recordData("one")
        )
        let adapter = transport(repository)

        let first = try await adapter.execute(operation)
        let retried = try await adapter.execute(operation)

        XCTAssertEqual(first.uri, uri)
        XCTAssertEqual(retried, first)
        let creates = await repository.capturedPuts()
        XCTAssertEqual(
            creates.map(\.rkey),
            [
                "f5c2b392-08f4-4d0e-a7a4-1ab0ed14237e",
                "f5c2b392-08f4-4d0e-a7a4-1ab0ed14237e",
            ])
        XCTAssertEqual(creates.map(\.swapRecord), [.noRecord, .noRecord])
        XCTAssertEqual(creates.map(\.swapCommit), [.absent, .absent])
        XCTAssertEqual(creates.first?.record, recordValue("one"))
    }

    func testDuplicateStableRKeyWithDifferentRecordBecomesConflict() async throws {
        let id = UUID(uuidString: "F5C2B392-08F4-4D0E-A7A4-1AB0ED14237E")!
        let uri = "at://\(repo)/\(collection)/f5c2b392-08f4-4d0e-a7a4-1ab0ed14237e"
        let repository = RecordingRepository(
            puts: [.failure(.invalidSwap("rkey exists"))],
            gets: [
                .success(RepositoryRecord(uri: uri, cid: "cid-remote", value: recordValue("remote")))
            ]
        )
        let operation = OutboxOperation(
            id: id,
            kind: .create,
            repo: repo,
            collection: collection,
            record: recordData("local")
        )

        do {
            _ = try await transport(repository).execute(operation)
            XCTFail("Expected a conflicting stable rkey")
        } catch let error as SyncTransportError {
            guard case let .conflict(remoteCID, remoteRecord, message) = error else {
                return XCTFail("Expected conflict, received \(error)")
            }
            XCTAssertEqual(remoteCID, "cid-remote")
            XCTAssertEqual(
                try ATProtoJSONValueCodec.decodeRecord(XCTUnwrap(remoteRecord)), recordValue("remote"))
            XCTAssertEqual(message, "rkey exists")
        }
    }

    func testPutAndDeletePreserveExactPersistedCASStates() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let repository = RecordingRepository(
            puts: [
                .success(ATProtoRepositoryWriteReceipt(uri: uri, cid: "cid-1")),
                .success(ATProtoRepositoryWriteReceipt(uri: uri, cid: "cid-2")),
            ],
            deletes: [.success(()), .success(())]
        )
        let adapter = transport(repository)
        _ = try await adapter.execute(
            OutboxOperation(
                kind: .put,
                repo: repo,
                collection: collection,
                rkey: "one",
                uri: uri,
                record: recordData("one"),
                swapRecord: nil
            ))
        _ = try await adapter.execute(
            OutboxOperation(
                kind: .put,
                repo: repo,
                collection: collection,
                rkey: "one",
                uri: uri,
                record: recordData("two"),
                swapRecord: "cid-1"
            ))
        _ = try await adapter.execute(
            OutboxOperation(
                kind: .delete,
                repo: repo,
                collection: collection,
                rkey: "one",
                uri: uri,
                swapRecord: nil
            ))
        _ = try await adapter.execute(
            OutboxOperation(
                kind: .delete,
                repo: repo,
                collection: collection,
                rkey: "one",
                uri: uri,
                swapRecord: "cid-2"
            ))

        let puts = await repository.capturedPuts()
        XCTAssertEqual(puts.map(\.swapRecord), [.absent, .cid("cid-1")])
        XCTAssertEqual(puts.map(\.swapCommit), [.absent, .absent])
        let deletes = await repository.capturedDeletes()
        XCTAssertEqual(deletes.map(\.swapRecord), [.absent, .cid("cid-2")])
        XCTAssertEqual(deletes.map(\.swapCommit), [.absent, .absent])
    }

    func testInvalidSwapMapsTypedConflictWithHydratedRemoteEvidence() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let repository = RecordingRepository(
            puts: [.failure(.invalidSwap("stale CID"))],
            gets: [
                .success(
                    RepositoryRecord(
                        uri: uri,
                        cid: "cid-remote",
                        value: recordValue("remote")
                    ))
            ]
        )
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: recordData("local"),
            swapRecord: "cid-old"
        )

        do {
            _ = try await transport(repository).execute(operation)
            XCTFail("Expected InvalidSwap mapping")
        } catch let error as SyncTransportError {
            guard case let .conflict(remoteCID, remoteRecord, message) = error else {
                return XCTFail("Expected conflict, received \(error)")
            }
            XCTAssertEqual(remoteCID, "cid-remote")
            XCTAssertEqual(
                try ATProtoJSONValueCodec.decodeRecord(XCTUnwrap(remoteRecord)), recordValue("remote"))
            XCTAssertEqual(message, "stale CID")
        }
        let gets = await repository.capturedGets()
        XCTAssertEqual(gets.first?.rkey, "one")
    }

    func testJSONCodecRejectsNonRecordAndHTTPClassificationIsDeterministic() async throws {
        let repository = RecordingRepository(
            puts: [
                .failure(.http(status: 503, error: "Unavailable", message: "later")),
                .failure(.http(status: 400, error: "InvalidRequest", message: "bad")),
            ]
        )
        let adapter = transport(repository)
        let base = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: "at://\(repo)/\(collection)/one",
            record: recordData("one")
        )

        do {
            _ = try await adapter.execute(base)
            XCTFail("Expected transient classification")
        } catch let error as SyncTransportError {
            XCTAssertEqual(error, .transient(message: "Unavailable: later"))
        }
        do {
            _ = try await adapter.execute(base)
            XCTFail("Expected permanent classification")
        } catch let error as SyncTransportError {
            XCTAssertEqual(error, .permanent(message: "InvalidRequest: bad"))
        }

        var arrayRecord = base
        arrayRecord.record = Data("[1,2]".utf8)
        do {
            _ = try await adapter.execute(arrayRecord)
            XCTFail("Expected top-level array rejection")
        } catch let error as SyncTransportError {
            guard case .permanent = error else {
                return XCTFail("Expected permanent malformed-record failure")
            }
        }
    }

    func testHydratorBuildsGetAndListRequestsAndCanonicalRecords() async throws {
        let oneURI = "at://\(repo)/\(collection)/one"
        let twoURI = "at://\(repo)/\(collection)/two"
        let repository = RecordingRepository(
            gets: [
                .success(RepositoryRecord(uri: oneURI, cid: "cid-1", value: recordValue("one")))
            ],
            lists: [
                .success(
                    ATProtoRepositoryPage(
                        cursor: "next",
                        records: [
                            RepositoryRecord(uri: oneURI, cid: "cid-1", value: recordValue("one")),
                            RepositoryRecord(uri: twoURI, cid: "cid-2", value: recordValue("two")),
                        ]
                    ))
            ]
        )
        let hydrator = ATProtoRecordHydrator(
            repository: repository,
            sessionProvider: FixedSyncOAuthSessionProvider(session)
        )

        let one = try await hydrator.get(
            RecordHydrationRequest(
                repo: repo,
                collection: collection,
                rkey: "one",
                cid: "cid-1"
            ))
        XCTAssertEqual(one.uri, oneURI)
        XCTAssertEqual(one.rkey, "one")
        XCTAssertEqual(try ATProtoJSONValueCodec.decodeRecord(one.value), recordValue("one"))

        let page = try await hydrator.list(
            RecordListHydrationRequest(
                repo: repo,
                collection: collection,
                limit: 50,
                cursor: "before",
                reverse: true
            ))
        XCTAssertEqual(page.cursor, "next")
        XCTAssertEqual(page.records.map(\.rkey), ["one", "two"])
        let gets = await repository.capturedGets()
        XCTAssertEqual(gets.first?.cid, "cid-1")
        let lists = await repository.capturedLists()
        XCTAssertEqual(lists.first?.limit, 50)
        XCTAssertEqual(lists.first?.cursor, "before")
        XCTAssertEqual(lists.first?.reverse, true)
    }

    func testPanprotoCoordinatorReturnsViewAndComplementCustodyMutation() async throws {
        let uri = "at://\(repo)/\(collection)/one"
        let native = HydratedRepositoryRecord(
            uri: uri,
            cid: "cid-native",
            collection: collection,
            rkey: "one",
            value: recordData("native")
        )
        let projected = recordData("projected")
        let coordinator = PanprotoHydrationCoordinator(
            migrator: StubPanprotoMigrator(
                projection: PanprotoRecordProjection(
                    record: projected,
                    complement: PanprotoOpaqueComplement(rawValue: Data([1, 2, 3]))
                ))
        )
        let source = PanprotoSchemaRelease(label: "v1", definition: Data())
        let target = PanprotoSchemaRelease(label: "v2", definition: Data())
        let migration = PanprotoMigrationArtifact(
            chainID: "developer-to-chemistry",
            source: source,
            target: target,
            fullChainJSON: Data()
        )
        let now = Date(timeIntervalSince1970: 1_700_000_000)

        let result = try await coordinator.project(native, using: migration, now: now)

        XCTAssertEqual(result.record.value, projected)
        XCTAssertEqual(result.record.cid, "cid-native")
        XCTAssertEqual(result.complementCustodyMutations.count, 1)
        guard case .saveComplement(let complement) = result.complementCustodyMutations[0] else {
            return XCTFail("Expected saveComplement custody mutation")
        }
        XCTAssertEqual(complement.recordURI, uri)
        XCTAssertEqual(complement.nativeCID, "cid-native")
        XCTAssertEqual(complement.chainID, "developer-to-chemistry")
        XCTAssertEqual(complement.payload, Data([1, 2, 3]))
        XCTAssertEqual(complement.createdAt, now)
    }

    func testPanprotoCoordinatorRefusesComplementWithoutNativeCID() async throws {
        let coordinator = PanprotoHydrationCoordinator(
            migrator: StubPanprotoMigrator(
                projection: PanprotoRecordProjection(
                    record: recordData("view"),
                    complement: PanprotoOpaqueComplement(rawValue: Data())
                ))
        )
        let native = HydratedRepositoryRecord(
            uri: "at://\(repo)/\(collection)/one",
            cid: nil,
            collection: collection,
            rkey: "one",
            value: recordData("native")
        )
        let release = PanprotoSchemaRelease(label: "v1", definition: Data())
        let migration = PanprotoMigrationArtifact(
            chainID: "chain",
            source: release,
            target: release,
            fullChainJSON: Data()
        )

        do {
            _ = try await coordinator.project(native, using: migration)
            XCTFail("Expected missing-CID refusal")
        } catch let error as PanprotoHydrationCoordinationError {
            XCTAssertEqual(
                error,
                .missingNativeCID(recordURI: "at://\(repo)/\(collection)/one")
            )
        }
    }
}
