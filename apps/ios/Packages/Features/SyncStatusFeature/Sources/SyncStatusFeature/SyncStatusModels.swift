import Foundation
import PersistenceKit

public enum SyncTransportAvailability: Equatable, Sendable {
    case available
    case signInRequired
}

public enum SyncConnectionState: Equatable, Sendable {
    case checking
    case offline
    case online
}

public enum PendingSyncState: Equatable, Sendable {
    case ready
    case syncing
    case retryScheduled(Date?)

    public var label: String {
        switch self {
        case .ready: "Ready to sync"
        case .syncing: "Syncing"
        case .retryScheduled(let date):
            if let date {
                "Retry after \(date.formatted(date: .omitted, time: .shortened))"
            } else {
                "Waiting to retry"
            }
        }
    }
}

public struct PendingSyncItem: Identifiable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var detail: String
    public var state: PendingSyncState
    public var createdAt: Date

    public init(
        id: UUID,
        title: String,
        detail: String,
        state: PendingSyncState,
        createdAt: Date
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.state = state
        self.createdAt = createdAt
    }
}

public struct SyncRecordEvidence: Equatable, Sendable {
    public var local: String?
    public var remote: String?

    public init(local: String?, remote: String?) {
        self.local = local
        self.remote = remote
    }
}

public struct SyncConflictItem: Identifiable, Equatable, Sendable {
    public var id: UUID
    public var operationID: UUID
    public var title: String
    public var detail: String
    public var explanation: String
    public var evidence: SyncRecordEvidence
    public var canRebase: Bool
    public var parkedAt: Date

    public init(
        id: UUID,
        operationID: UUID,
        title: String,
        detail: String,
        explanation: String,
        evidence: SyncRecordEvidence,
        canRebase: Bool,
        parkedAt: Date
    ) {
        self.id = id
        self.operationID = operationID
        self.title = title
        self.detail = detail
        self.explanation = explanation
        self.evidence = evidence
        self.canRebase = canRebase
        self.parkedAt = parkedAt
    }
}

public struct SyncStatusSnapshot: Equatable, Sendable {
    public var pending: [PendingSyncItem]
    public var conflicts: [SyncConflictItem]

    public init(
        pending: [PendingSyncItem] = [],
        conflicts: [SyncConflictItem] = []
    ) {
        self.pending = pending
        self.conflicts = conflicts
    }

    public var localChangeCount: Int { pending.count + conflicts.count }
}

public enum SyncStatusProjection {
    public static func make(from snapshot: PersistenceSnapshot) -> SyncStatusSnapshot {
        make(from: snapshot, scope: .all)
    }

    public static func make(
        from snapshot: PersistenceSnapshot,
        scope: SyncStatusRepositoryScope
    ) -> SyncStatusSnapshot {
        let repository: String? =
            switch scope {
            case .all: nil
            case let .active(repo): repo
            }
        let pending = snapshot.outbox.filter { operation in
            switch scope {
            case .all: true
            case .active: operation.repo == repository
            }
        }
        let conflicts = snapshot.conflicts.filter { conflict in
            switch scope {
            case .all: true
            case .active: conflict.operation.repo == repository
            }
        }
        return SyncStatusSnapshot(
            pending: pending.map(pendingItem),
            conflicts: conflicts.map(conflictItem)
        )
    }

    private static func pendingItem(_ operation: OutboxOperation) -> PendingSyncItem {
        PendingSyncItem(
            id: operation.id,
            title: title(for: operation),
            detail: operationDetail(operation),
            state: pendingState(operation),
            createdAt: operation.createdAt
        )
    }

    private static func conflictItem(_ conflict: ParkedConflict) -> SyncConflictItem {
        SyncConflictItem(
            id: conflict.id,
            operationID: conflict.operation.id,
            title: title(for: conflict.operation),
            detail: operationDetail(conflict.operation),
            explanation: explanation(for: conflict),
            evidence: SyncRecordEvidence(
                local: formattedJSON(conflict.operation.record),
                remote: formattedJSON(conflict.remoteRecord)
            ),
            canRebase: conflict.remoteCID != nil && conflict.operation.record != nil,
            parkedAt: conflict.parkedAt
        )
    }

    private static func pendingState(_ operation: OutboxOperation) -> PendingSyncState {
        switch operation.state {
        case .queued: .ready
        case .flushing: .syncing
        case .waitingForRetry: .retryScheduled(operation.nextAttemptAt)
        }
    }

    private static func title(for operation: OutboxOperation) -> String {
        let noun = recordName(for: operation.collection)
        return switch operation.kind {
        case .create: "New \(noun)"
        case .put: "Edited \(noun)"
        case .delete: "Deleted \(noun)"
        }
    }

    private static func operationDetail(_ operation: OutboxOperation) -> String {
        if let uri = operation.uri ?? operation.tempURI {
            return uri
        }
        return operation.collection
    }

    private static func recordName(for collection: String) -> String {
        let raw = collection.split(separator: ".").last.map(String.init) ?? "record"
        let separated = raw.reduce(into: "") { result, character in
            if character.isUppercase, !result.isEmpty { result.append(" ") }
            result.append(character.lowercased())
        }
        return separated.isEmpty ? "record" : separated
    }

    private static func explanation(for conflict: ParkedConflict) -> String {
        if conflict.reason.localizedCaseInsensitiveContains("InvalidSwap")
            || conflict.reason.localizedCaseInsensitiveContains("stale")
        {
            return "This record changed elsewhere before Hypo could save your version."
        }
        if conflict.remoteCID == nil {
            return "Hypo stopped before replacing server data. Review the saved copies below."
        }
        return conflict.reason
    }

    private static func formattedJSON(_ data: Data?) -> String? {
        guard let data else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) else {
            return String(data: data, encoding: .utf8)
        }
        guard
            let formatted = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            )
        else {
            return String(data: data, encoding: .utf8)
        }
        return String(data: formatted, encoding: .utf8)
    }
}
