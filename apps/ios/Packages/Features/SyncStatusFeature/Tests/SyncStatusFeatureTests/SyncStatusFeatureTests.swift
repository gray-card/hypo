import Foundation
import PersistenceKit
import SyncKit
import Testing

@testable import SyncStatusFeature

private actor StatusServiceStub: SyncStatusServicing {
    var snapshots: [SyncStatusSnapshot]
    var retryReport: FlushReport
    var discarded: [UUID] = []
    var rebased: [UUID] = []

    init(snapshots: [SyncStatusSnapshot], retryReport: FlushReport = FlushReport()) {
        self.snapshots = snapshots
        self.retryReport = retryReport
    }

    func status() throws -> SyncStatusSnapshot {
        guard !snapshots.isEmpty else { return SyncStatusSnapshot() }
        if snapshots.count == 1 { return snapshots[0] }
        return snapshots.removeFirst()
    }

    func retry(now: Date) -> FlushReport { retryReport }

    func discardConflict(id: UUID, now: Date) {
        discarded.append(id)
    }

    func rebaseConflict(id: UUID, now: Date) {
        rebased.append(id)
    }

    func didEnterForeground(now: Date) -> FlushReport { FlushReport() }

    func connectivityDidChange(isOnline: Bool, now: Date) -> FlushReport? { nil }

    func discardedIDs() -> [UUID] { discarded }
    func rebasedIDs() -> [UUID] { rebased }
}

@Suite("Sync status projection")
struct SyncStatusProjectionTests {
    @Test("Queue states and record names remain approachable")
    func projectsPendingQueue() {
        let retryAt = Date(timeIntervalSince1970: 2_000)
        let snapshot = PersistenceSnapshot(outbox: [
            OutboxOperation(
                kind: .create,
                repo: "did:plc:test",
                collection: "app.graycard.instance.filmRoll",
                tempURI: "outbox://roll",
                record: Data("{}".utf8),
                state: .queued,
                createdAt: Date(timeIntervalSince1970: 1_000)
            ),
            OutboxOperation(
                kind: .put,
                repo: "did:plc:test",
                collection: "app.graycard.instance.chemistry",
                rkey: "chemistry",
                uri: "at://did:plc:test/app.graycard.instance.chemistry/chemistry",
                record: Data("{}".utf8),
                state: .waitingForRetry,
                nextAttemptAt: retryAt,
                createdAt: Date(timeIntervalSince1970: 1_001)
            ),
        ])

        let status = SyncStatusProjection.make(from: snapshot)

        #expect(status.pending.map(\.title) == ["New film roll", "Edited chemistry"])
        #expect(status.pending[0].state == .ready)
        #expect(status.pending[1].state == .retryScheduled(retryAt))
        #expect(status.localChangeCount == 2)
    }

    @Test("Conflict projection names stale writes and exposes both saved copies")
    func projectsConflictEvidence() {
        let operation = OutboxOperation(
            kind: .put,
            repo: "did:plc:test",
            collection: "app.graycard.instance.exposure",
            rkey: "frame-1",
            uri: "at://did:plc:test/app.graycard.instance.exposure/frame-1",
            record: Data("{\"value\":\"local\"}".utf8),
            swapRecord: "cid-old",
            state: .flushing
        )
        let conflict = ParkedConflict(
            operation: operation,
            reason: "InvalidSwap",
            remoteCID: "cid-remote",
            remoteRecord: Data("{\"value\":\"remote\"}".utf8)
        )

        let item = SyncStatusProjection.make(
            from: PersistenceSnapshot(conflicts: [conflict])
        ).conflicts[0]

        #expect(item.title == "Edited exposure")
        #expect(item.explanation.contains("changed elsewhere"))
        #expect(item.evidence.local?.contains("local") == true)
        #expect(item.evidence.remote?.contains("remote") == true)
        #expect(item.canRebase)
    }

    @Test("An account-scoped projection never exposes another repository's queue")
    func projectsOnlyTheActiveRepository() {
        let first = OutboxOperation(
            kind: .create,
            repo: "did:plc:first",
            collection: "app.graycard.instance.exposure",
            rkey: "first"
        )
        let second = OutboxOperation(
            kind: .create,
            repo: "did:plc:second",
            collection: "app.graycard.instance.exposure",
            rkey: "second"
        )
        let firstConflict = ParkedConflict(operation: first, reason: "InvalidSwap")
        let secondConflict = ParkedConflict(operation: second, reason: "InvalidSwap")
        let snapshot = PersistenceSnapshot(
            outbox: [first, second],
            conflicts: [firstConflict, secondConflict]
        )

        let signedOut = SyncStatusProjection.make(from: snapshot, scope: .active(nil))
        #expect(signedOut.pending.isEmpty)
        #expect(signedOut.conflicts.isEmpty)

        let firstAccount = SyncStatusProjection.make(
            from: snapshot,
            scope: .active("did:plc:first")
        )
        #expect(firstAccount.pending.map(\.id) == [first.id])
        #expect(firstAccount.conflicts.map(\.id) == [firstConflict.id])
    }
}

@Suite("Sync status model", .serialized)
@MainActor
struct SyncStatusFeatureModelTests {
    @Test @MainActor func transportAvailabilityTracksAuthentication() {
        let model = SyncStatusFeatureModel(
            service: StatusServiceStub(snapshots: []),
            transportAvailability: .signInRequired
        )
        #expect(model.transportAvailability == .signInRequired)
        model.setTransportAvailability(.available)
        #expect(model.transportAvailability == .available)
    }

    private func pendingStatus() -> SyncStatusSnapshot {
        SyncStatusSnapshot(pending: [
            PendingSyncItem(
                id: UUID(),
                title: "New exposure",
                detail: "outbox://one",
                state: .ready,
                createdAt: Date()
            )
        ])
    }

    @Test("A failed manual retry never reports success")
    func retryKeepsHonestStatus() async {
        var report = FlushReport()
        report.attempted = 1
        report.retryScheduled = 1
        let service = StatusServiceStub(
            snapshots: [pendingStatus(), pendingStatus()],
            retryReport: report
        )
        let model = SyncStatusFeatureModel(
            service: service,
            transportAvailability: .signInRequired
        )
        await model.refresh()

        await model.retryNow()

        #expect(model.notice == "Hypo couldn’t sync yet. Your changes are still on this iPhone.")
        #expect(model.localChangeCount == 1)
    }

    @Test("Conflict actions refresh only after the service accepts them")
    func resolutionsRefresh() async {
        let conflictID = UUID()
        let conflict = SyncConflictItem(
            id: conflictID,
            operationID: UUID(),
            title: "Edited exposure",
            detail: "frame-1",
            explanation: "Changed elsewhere",
            evidence: SyncRecordEvidence(local: "local", remote: "remote"),
            canRebase: true,
            parkedAt: Date()
        )
        let service = StatusServiceStub(
            snapshots: [
                SyncStatusSnapshot(conflicts: [conflict]),
                SyncStatusSnapshot(),
            ]
        )
        let model = SyncStatusFeatureModel(
            service: service,
            transportAvailability: .available
        )
        await model.refresh()

        await model.rebaseLocalChange(conflictID: conflictID)

        #expect(await service.rebasedIDs() == [conflictID])
        #expect(model.snapshot.conflicts.isEmpty)
        #expect(model.notice == "Your version is queued against the latest server copy.")
    }
}
