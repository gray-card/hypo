import Foundation
import PersistenceKit

public enum SyncConflictResolutionError: Error, Equatable, Sendable {
    case conflictNotFound(UUID)
    case remoteCIDRequired(UUID)
    case recordRequired(UUID)
    case recordIdentityRequired(UUID)
    case dependentOperationsExist(UUID)
}

/// Operations required by a needs-attention surface. Persistence remains atomic across
/// conflict removal, cache repair, and any requeued operation.
public protocol SyncConflictResolving: Sendable {
    func parkedConflicts() async throws -> [ParkedConflict]
    func discardConflict(id: UUID, now: Date) async throws
    func rebaseConflict(id: UUID, record: Data?, now: Date) async throws -> UUID
}

extension SyncEngine: SyncConflictResolving {
    public func parkedConflicts() async throws -> [ParkedConflict] {
        try await store.snapshot().conflicts
    }

    /// Discards the local intent. Remote evidence replaces the optimistic cache when present;
    /// otherwise the cache entry is removed so a later hydration cannot mistake local data for remote.
    public func discardConflict(id: UUID, now: Date = Date()) async throws {
        let snapshot = try await store.snapshot()
        guard let conflict = snapshot.conflicts.first(where: { $0.id == id }) else {
            throw SyncConflictResolutionError.conflictNotFound(id)
        }
        let operation = conflict.operation
        var mutations: [PersistenceMutation] = [.removeConflict(id: id)]

        switch operation.kind {
        case .create:
            if let tempURI = operation.tempURI {
                guard !snapshot.outbox.contains(where: { Self.references(tempURI, in: $0) }) else {
                    throw SyncConflictResolutionError.dependentOperationsExist(id)
                }
                mutations.append(.removeRecord(uri: tempURI))
            }
            if let remote = Self.remoteCache(conflict: conflict, now: now) {
                mutations.append(.upsertRecord(remote))
            }

        case .put:
            guard let uri = operation.uri else {
                throw SyncConflictResolutionError.recordIdentityRequired(operation.id)
            }
            if var later = snapshot.outbox.first(where: { $0.uri == uri }) {
                guard let remoteCID = conflict.remoteCID else {
                    throw SyncConflictResolutionError.remoteCIDRequired(id)
                }
                later.swapRecord = remoteCID
                later.updatedAt = now
                mutations.append(.updateOutbox(later))
                if var optimistic = snapshot.records.first(where: { $0.uri == uri }) {
                    optimistic.cid = remoteCID
                    optimistic.pendingOperationID = later.id
                    optimistic.cachedAt = now
                    mutations.append(.upsertRecord(optimistic))
                }
            } else if let remote = Self.remoteCache(conflict: conflict, now: now) {
                mutations.append(.upsertRecord(remote))
            } else {
                mutations.append(.removeRecord(uri: uri))
            }

        case .delete:
            guard let uri = operation.uri else {
                throw SyncConflictResolutionError.recordIdentityRequired(operation.id)
            }
            if let remote = Self.remoteCache(conflict: conflict, now: now) {
                mutations.append(.upsertRecord(remote))
            } else {
                mutations.append(.removeRecord(uri: uri))
            }
        }

        try await store.apply(mutations)
        emit(.conflictDiscarded(conflictID: id))
    }

    /// Requeues the same operation identity against the observed remote CID. An optional record
    /// is the user's merged value; omitting it keeps the parked local value.
    @discardableResult
    public func rebaseConflict(
        id: UUID,
        record: Data? = nil,
        now: Date = Date()
    ) async throws -> UUID {
        let snapshot = try await store.snapshot()
        guard let conflict = snapshot.conflicts.first(where: { $0.id == id }) else {
            throw SyncConflictResolutionError.conflictNotFound(id)
        }
        guard let remoteCID = conflict.remoteCID else {
            throw SyncConflictResolutionError.remoteCIDRequired(id)
        }

        var operation = conflict.operation
        operation.state = .queued
        operation.attemptCount = 0
        operation.nextAttemptAt = nil
        operation.leaseID = nil
        operation.lastError = nil
        operation.updatedAt = now
        operation.swapRecord = remoteCID
        var mutations: [PersistenceMutation] = [.removeConflict(id: id)]

        switch operation.kind {
        case .create:
            let rkey = operation.rkey ?? StableOperationRKey.make(for: operation.id)
            let remoteURI = "at://\(operation.repo)/\(operation.collection)/\(rkey)"
            let tempURI = operation.tempURI
            operation.kind = .put
            operation.rkey = rkey
            operation.uri = remoteURI
            operation.tempURI = nil
            operation.record = record ?? operation.record
            guard let value = operation.record else {
                throw SyncConflictResolutionError.recordRequired(operation.id)
            }

            if let tempURI {
                mutations.append(.removeRecord(uri: tempURI))
                for var cached in snapshot.records where cached.uri != tempURI {
                    let patched = JSONReferenceReconciler.replacing(
                        tempURI,
                        with: remoteURI,
                        in: cached.value
                    )
                    if patched != cached.value {
                        cached.value = patched
                        cached.cachedAt = now
                        mutations.append(.upsertRecord(cached))
                    }
                }
                for var pending in snapshot.outbox {
                    var changed = false
                    if pending.uri == tempURI {
                        pending.uri = remoteURI
                        pending.rkey = rkey
                        changed = true
                    }
                    if let pendingRecord = pending.record {
                        let patched = JSONReferenceReconciler.replacing(
                            tempURI,
                            with: remoteURI,
                            in: pendingRecord
                        )
                        if patched != pendingRecord {
                            pending.record = patched
                            changed = true
                        }
                    }
                    if changed {
                        pending.updatedAt = now
                        mutations.append(.updateOutbox(pending))
                    }
                }
            }
            mutations.append(
                .upsertRecord(
                    CachedRecord(
                        uri: remoteURI,
                        cid: remoteCID,
                        collection: operation.collection,
                        rkey: rkey,
                        value: value,
                        cachedAt: now,
                        pendingOperationID: operation.id
                    )))

        case .put:
            guard let uri = operation.uri, let rkey = operation.rkey else {
                throw SyncConflictResolutionError.recordIdentityRequired(operation.id)
            }
            operation.record = record ?? operation.record
            guard let value = operation.record else {
                throw SyncConflictResolutionError.recordRequired(operation.id)
            }
            mutations.append(
                .upsertRecord(
                    CachedRecord(
                        uri: uri,
                        cid: remoteCID,
                        collection: operation.collection,
                        rkey: rkey,
                        value: value,
                        cachedAt: now,
                        pendingOperationID: operation.id
                    )))

        case .delete:
            guard let uri = operation.uri else {
                throw SyncConflictResolutionError.recordIdentityRequired(operation.id)
            }
            operation.record = nil
            mutations.append(.removeRecord(uri: uri))
        }

        mutations.append(.enqueue(operation))
        try await store.apply(mutations)
        emit(.conflictRequeued(conflictID: id, operationID: operation.id))
        schedulePostEnqueueFlush(now: now)
        return operation.id
    }

    private static func remoteCache(conflict: ParkedConflict, now: Date) -> CachedRecord? {
        guard let remoteCID = conflict.remoteCID, let remoteRecord = conflict.remoteRecord else {
            return nil
        }
        let operation = conflict.operation
        let rkey = operation.rkey ?? StableOperationRKey.make(for: operation.id)
        let uri = operation.uri ?? "at://\(operation.repo)/\(operation.collection)/\(rkey)"
        return CachedRecord(
            uri: uri,
            cid: remoteCID,
            collection: operation.collection,
            rkey: rkey,
            value: remoteRecord,
            cachedAt: now
        )
    }

    private static func references(_ uri: String, in operation: OutboxOperation) -> Bool {
        if operation.uri == uri { return true }
        guard let record = operation.record else { return false }
        return record.range(of: Data(uri.utf8)) != nil
    }
}
