import Foundation
import PanprotoKit
import PersistenceKit
import XCTest
@testable import SyncKit

private struct FixedCurrentRecordValidator: PanprotoCurrentRecordValidating {
    let classification: PanprotoCurrentRecordClassification

    func classify(
        _ record: Data,
        collection: String
    ) async -> PanprotoCurrentRecordClassification {
        classification
    }
}

private actor PipelineHydratorSpy: RecordHydrating {
    let record: HydratedRepositoryRecord
    private(set) var getRequests: [RecordHydrationRequest] = []
    private(set) var listRequests: [RecordListHydrationRequest] = []

    init(record: HydratedRepositoryRecord) {
        self.record = record
    }

    func get(_ request: RecordHydrationRequest) -> HydratedRepositoryRecord {
        getRequests.append(request)
        return record
    }

    func list(_ request: RecordListHydrationRequest) -> HydratedRepositoryPage {
        listRequests.append(request)
        return HydratedRepositoryPage(records: [record])
    }

    func getCount() -> Int { getRequests.count }
}

private actor PipelineTransportSpy: SyncTransport {
    private(set) var operations: [OutboxOperation] = []

    func execute(_ operation: OutboxOperation) -> RemoteWriteResult {
        operations.append(operation)
        return RemoteWriteResult(
            uri: operation.uri ?? "at://\(operation.repo)/\(operation.collection)/created",
            cid: "cid-after-write",
            record: operation.record
        )
    }

    func capturedOperations() -> [OutboxOperation] { operations }
}

private actor PipelineMigratorSpy: PanprotoRecordMigrating {
    struct Counts: Equatable {
        var interpretations = 0
        var forwardLifts = 0
        var gets = 0
        var puts = 0
    }

    let projected: Data
    let restored: Data
    let complement: Data
    let putFault: PanprotoFault?
    private var counts = Counts()

    init(
        projected: Data,
        restored: Data,
        complement: Data = Data([1, 2, 3]),
        putFault: PanprotoFault? = nil
    ) {
        self.projected = projected
        self.restored = restored
        self.complement = complement
        self.putFault = putFault
    }

    func interpretRelease(
        of record: Data,
        releasesNewestFirst: [PanprotoSchemaRelease]
    ) throws(PanprotoFault) -> PanprotoReleaseInterpretation {
        counts.interpretations += 1
        guard let release = releasesNewestFirst.first else { throw .noCompatibleSchemaVersion }
        return PanprotoReleaseInterpretation(release: release, evidence: .compatibleUnlabeled)
    }

    func forwardLift(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) throws(PanprotoFault) -> Data {
        counts.forwardLifts += 1
        return projected
    }

    func get(
        _ record: Data,
        using migration: PanprotoMigrationArtifact
    ) throws(PanprotoFault) -> PanprotoRecordProjection {
        counts.gets += 1
        return PanprotoRecordProjection(
            record: projected,
            complement: PanprotoOpaqueComplement(rawValue: complement)
        )
    }

    func put(
        editedView: Data,
        complement: PanprotoOpaqueComplement,
        using migration: PanprotoMigrationArtifact
    ) throws(PanprotoFault) -> Data {
        counts.puts += 1
        if let putFault { throw putFault }
        return restored
    }

    func capturedCounts() -> Counts { counts }
}

final class PanprotoProductionPipelineTests: XCTestCase {
    private let repo = "did:plc:panproto-production"
    private let collection = "app.graycard.instance.camera"
    private let uri = "at://did:plc:panproto-production/app.graycard.instance.camera/one"
    private let native = Data(#"{"$type":"app.graycard.instance.camera","old":"native"}"#.utf8)
    private let view = Data(#"{"$type":"app.graycard.instance.camera","name":"view"}"#.utf8)
    private let editedView = Data(
        #"{"$type":"app.graycard.instance.camera","name":"edited view"}"#.utf8
    )
    private let restored = Data(
        #"{"$type":"app.graycard.instance.camera","old":"edited native"}"#.utf8
    )

    func testGeneratedFastPathDetectsAnExplicitForeignLexiconRelease() async {
        let validator = HypoCurrentRecordValidator(currentReleaseLabel: "lexicons-v1")
        let current = Data(
            #"{"$type":"app.graycard.setup","registry":"https://graycard.app","name":"Home","schemaVersion":"lexicons-v1","createdAt":"2026-08-14T12:00:00Z"}"#
                .utf8
        )
        let foreign = Data(
            #"{"$type":"app.graycard.setup","registry":"https://graycard.app","name":"Home","schemaVersion":"lexicons-v0","createdAt":"2026-08-14T12:00:00Z"}"#
                .utf8
        )

        let currentClassification = await validator.classify(
            current,
            collection: "app.graycard.setup"
        )
        XCTAssertEqual(currentClassification, .current)
        guard
            case .requiresMigration(let issues) = await validator.classify(
                foreign,
                collection: "app.graycard.setup"
            )
        else {
            return XCTFail("Expected the explicit foreign release to require migration")
        }
        XCTAssertTrue(issues.joined().contains("lexicons-v0"))
    }

    func testProductionCompositionDetectsLiftsGetsAndPersistsComplement() async throws {
        let dependencies = makeDependencies()

        let hydrated = try await dependencies.composition.hydrator.get(
            RecordHydrationRequest(
                repo: repo,
                collection: collection,
                rkey: "one"
            )
        )

        XCTAssertEqual(hydrated.value, view)
        let counts = await dependencies.migrator.capturedCounts()
        XCTAssertEqual(
            counts,
            .init(interpretations: 1, forwardLifts: 1, gets: 1, puts: 0)
        )
        let complement = try await dependencies.store.complement(
            recordURI: uri,
            nativeCID: "cid-native",
            chainID: "camera-v0-to-v1"
        )
        XCTAssertEqual(complement?.payload, Data([1, 2, 3]))
    }

    func testProductionCompositionRestoresExactComplementBeforeNativeCASPut() async throws {
        let dependencies = makeDependencies()
        _ = try await dependencies.composition.hydrator.get(
            RecordHydrationRequest(repo: repo, collection: collection, rkey: "one")
        )
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: editedView,
            swapRecord: "cid-native"
        )

        let result = try await dependencies.composition.transport.execute(operation)

        XCTAssertEqual(result.record, editedView)
        let sent = await dependencies.transport.capturedOperations()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].record, restored)
        XCTAssertEqual(sent[0].swapRecord, "cid-native")
        let counts = await dependencies.migrator.capturedCounts()
        XCTAssertEqual(
            counts,
            .init(interpretations: 1, forwardLifts: 1, gets: 1, puts: 1)
        )
        // Exact durable custody avoids a second network hydration during the edit.
        let hydrationCount = await dependencies.hydrator.getCount()
        XCTAssertEqual(hydrationCount, 1)
    }

    func testUnsupportedRecordIsTypedInsteadOfPassingRawBytesToFeatureDecoder() async throws {
        let record = remoteRecord()
        let nativeHydrator = PipelineHydratorSpy(record: record)
        let transport = PipelineTransportSpy()
        let composition = PanprotoProductionComposition(
            nativeHydrator: nativeHydrator,
            transport: transport,
            store: InMemoryPersistenceStore(),
            registry: PanprotoMigrationRegistry(
                currentReleaseLabel: "lexicons-v1",
                registrations: []
            ),
            validator: FixedCurrentRecordValidator(
                classification: .requiresMigration(issues: ["$.name: Required value is missing"])
            )
        )

        do {
            _ = try await composition.hydrator.get(
                RecordHydrationRequest(repo: repo, collection: collection, rkey: "one")
            )
            XCTFail("Expected an unsupported-version failure")
        } catch let error as PanprotoRecordPipelineError {
            XCTAssertEqual(
                error,
                .unsupportedVersion(
                    collection: collection,
                    validationIssues: ["$.name: Required value is missing"]
                )
            )
        }
    }

    func testTypedPutFailureBecomesParkablePermanentSyncError() async throws {
        let dependencies = makeDependencies(
            putFault: .malformedComplement(message: "fixture is corrupt")
        )
        _ = try await dependencies.composition.hydrator.get(
            RecordHydrationRequest(repo: repo, collection: collection, rkey: "one")
        )
        let operation = OutboxOperation(
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: editedView,
            swapRecord: "cid-native"
        )

        do {
            _ = try await dependencies.composition.transport.execute(operation)
            XCTFail("Expected a permanent migration failure")
        } catch let error as SyncTransportError {
            guard case .permanent(let message) = error else {
                return XCTFail("Expected permanent failure, received \(error)")
            }
            XCTAssertTrue(message.contains("saved migration complement could not be read"))
        }
        let sent = await dependencies.transport.capturedOperations()
        XCTAssertEqual(sent.count, 0)
    }

    func testTypedPutFailureIsActuallyParkedByTheProductionSyncEngine() async throws {
        let dependencies = makeDependencies(
            putFault: .malformedComplement(message: "fixture is corrupt")
        )
        _ = try await dependencies.composition.hydrator.get(
            RecordHydrationRequest(repo: repo, collection: collection, rkey: "one")
        )
        try await dependencies.store.apply([
            .upsertRecord(
                CachedRecord(
                    uri: uri,
                    cid: "cid-native",
                    collection: collection,
                    rkey: "one",
                    value: view
                )
            )
        ])
        let engine = SyncEngine(
            store: dependencies.store,
            transport: dependencies.composition.transport
        )
        _ = try await engine.enqueuePut(
            repo: repo,
            collection: collection,
            rkey: "one",
            uri: uri,
            record: editedView,
            swapRecord: "cid-native"
        )

        let report = await engine.flush()

        XCTAssertEqual(report.conflictsParked, 1)
        let snapshot = await dependencies.store.snapshot()
        XCTAssertEqual(snapshot.outbox.count, 0)
        XCTAssertEqual(snapshot.conflicts.count, 1)
        XCTAssertTrue(snapshot.conflicts[0].reason.contains("migration complement"))
    }

    private func makeDependencies(
        putFault: PanprotoFault? = nil
    ) -> (
        composition: PanprotoProductionComposition,
        hydrator: PipelineHydratorSpy,
        transport: PipelineTransportSpy,
        store: InMemoryPersistenceStore,
        migrator: PipelineMigratorSpy
    ) {
        let nativeHydrator = PipelineHydratorSpy(record: remoteRecord())
        let transport = PipelineTransportSpy()
        let store = InMemoryPersistenceStore()
        let migrator = PipelineMigratorSpy(
            projected: view,
            restored: restored,
            putFault: putFault
        )
        let old = PanprotoSchemaRelease(label: "lexicons-v0", definition: Data([0]))
        let current = PanprotoSchemaRelease(label: "lexicons-v1", definition: Data([1]))
        let registry = PanprotoMigrationRegistry(
            currentReleaseLabel: "lexicons-v1",
            registrations: [
                PanprotoMigrationRegistration(
                    collection: collection,
                    artifact: PanprotoMigrationArtifact(
                        chainID: "camera-v0-to-v1",
                        source: old,
                        target: current,
                        fullChainJSON: Data([2])
                    )
                )
            ]
        )
        let composition = PanprotoProductionComposition(
            nativeHydrator: nativeHydrator,
            transport: transport,
            store: store,
            registry: registry,
            validator: FixedCurrentRecordValidator(
                classification: .requiresMigration(issues: ["old release"])
            ),
            migrator: migrator
        )
        return (composition, nativeHydrator, transport, store, migrator)
    }

    private func remoteRecord() -> HydratedRepositoryRecord {
        HydratedRepositoryRecord(
            uri: uri,
            cid: "cid-native",
            collection: collection,
            rkey: "one",
            value: native
        )
    }
}
