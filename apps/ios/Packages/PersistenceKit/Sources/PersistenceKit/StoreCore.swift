import Foundation

struct StoreDocument: Codable, Sendable {
    var version: Int
    var state: StoreState
}

struct StoreState: Codable, Sendable {
    var revision: Int64 = 0
    var records: [String: CachedRecord] = [:]
    var outbox: [UUID: OutboxOperation] = [:]
    var conflicts: [UUID: ParkedConflict] = [:]
    var complements: [String: PanprotoComplement] = [:]

    init(snapshot: PersistenceSnapshot = PersistenceSnapshot()) {
        revision = snapshot.revision
        records = Dictionary(snapshot.records.map { ($0.uri, $0) }, uniquingKeysWith: { _, new in new })
        outbox = Dictionary(snapshot.outbox.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        conflicts = Dictionary(snapshot.conflicts.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        complements = Dictionary(
            snapshot.complements.map { ($0.storageKey, $0) }, uniquingKeysWith: { _, new in new })
    }

    mutating func apply(_ mutations: [PersistenceMutation]) throws -> PersistenceChange {
        var kinds: [PersistenceMutationKind] = []
        for mutation in mutations {
            switch mutation {
            case let .upsertRecord(record):
                records[record.uri] = record
                kinds.append(.upsertRecord)
            case let .removeRecord(uri):
                records.removeValue(forKey: uri)
                kinds.append(.removeRecord)
            case let .enqueue(operation):
                guard outbox[operation.id] == nil else {
                    throw PersistenceError.duplicateOutboxOperation(operation.id)
                }
                outbox[operation.id] = operation
                kinds.append(.enqueue)
            case let .updateOutbox(operation):
                guard outbox[operation.id] != nil else {
                    throw PersistenceError.missingOutboxOperation(operation.id)
                }
                outbox[operation.id] = operation
                kinds.append(.updateOutbox)
            case let .removeOutbox(id):
                outbox.removeValue(forKey: id)
                kinds.append(.removeOutbox)
            case let .parkConflict(conflict):
                conflicts[conflict.id] = conflict
                kinds.append(.parkConflict)
            case let .removeConflict(id):
                conflicts.removeValue(forKey: id)
                kinds.append(.removeConflict)
            case let .saveComplement(complement):
                complements[complement.storageKey] = complement
                kinds.append(.saveComplement)
            case let .removeComplements(recordURI, nativeCID):
                complements = complements.filter { _, complement in
                    guard complement.recordURI == recordURI else { return true }
                    guard let nativeCID else { return false }
                    return complement.nativeCID != nativeCID
                }
                kinds.append(.removeComplements)
            }
        }
        revision += 1
        return PersistenceChange(revision: revision, mutations: kinds)
    }

    func snapshot() -> PersistenceSnapshot {
        PersistenceSnapshot(
            revision: revision,
            records: records.values.sorted { $0.uri < $1.uri },
            outbox: outbox.values.sorted {
                if $0.createdAt == $1.createdAt { return $0.id.uuidString < $1.id.uuidString }
                return $0.createdAt < $1.createdAt
            },
            conflicts: conflicts.values.sorted { $0.parkedAt < $1.parkedAt },
            complements: complements.values.sorted {
                if $0.recordURI != $1.recordURI { return $0.recordURI < $1.recordURI }
                if $0.nativeCID != $1.nativeCID { return $0.nativeCID < $1.nativeCID }
                return $0.chainID < $1.chainID
            }
        )
    }
}

struct ChangeHub: Sendable {
    var continuations: [UUID: AsyncStream<PersistenceChange>.Continuation] = [:]

    mutating func stream(onTermination: @escaping @Sendable (UUID) -> Void) -> AsyncStream<PersistenceChange>
    {
        let id = UUID()
        return AsyncStream { continuation in
            continuations[id] = continuation
            continuation.onTermination = { _ in onTermination(id) }
        }
    }

    func emit(_ change: PersistenceChange) {
        for continuation in continuations.values { continuation.yield(change) }
    }

    mutating func remove(_ id: UUID) {
        continuations.removeValue(forKey: id)
    }
}
