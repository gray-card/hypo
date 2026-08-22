import Foundation

public enum PersistenceError: Error, Equatable, Sendable {
    case unsupportedStoreVersion(found: Int, supported: Int)
    case duplicateOutboxOperation(UUID)
    case missingOutboxOperation(UUID)
    case corruptStoredValue(entity: String, identifier: String)
}

/// Atomic mutations accepted by a persistence store.
public enum PersistenceMutation: Sendable {
    case upsertRecord(CachedRecord)
    case removeRecord(uri: String)
    case enqueue(OutboxOperation)
    case updateOutbox(OutboxOperation)
    case removeOutbox(id: UUID)
    case parkConflict(ParkedConflict)
    case removeConflict(id: UUID)
    case saveComplement(PanprotoComplement)
    case removeComplements(recordURI: String, nativeCID: String?)
}

public enum PersistenceMutationKind: String, Sendable, Equatable {
    case upsertRecord
    case removeRecord
    case enqueue
    case updateOutbox
    case removeOutbox
    case parkConflict
    case removeConflict
    case saveComplement
    case removeComplements
}

public struct PersistenceChange: Sendable, Equatable {
    public var revision: Int64
    public var mutations: [PersistenceMutationKind]

    public init(revision: Int64, mutations: [PersistenceMutationKind]) {
        self.revision = revision
        self.mutations = mutations
    }
}

/// A transactional persistence boundary shared by the file and preview implementations.
public protocol PersistenceStore: Sendable {
    func snapshot() async throws -> PersistenceSnapshot
    func apply(_ mutations: [PersistenceMutation]) async throws
    func changes() async -> AsyncStream<PersistenceChange>
}

public extension PersistenceStore {
    func cachedRecord(uri: String) async throws -> CachedRecord? {
        try await snapshot().records.first { $0.uri == uri }
    }

    func outboxOperations() async throws -> [OutboxOperation] {
        try await snapshot().outbox
    }

    func parkedConflicts() async throws -> [ParkedConflict] {
        try await snapshot().conflicts
    }

    func complement(recordURI: String, nativeCID: String, chainID: String) async throws -> PanprotoComplement?
    {
        try await snapshot().complements.first {
            $0.recordURI == recordURI && $0.nativeCID == nativeCID && $0.chainID == chainID
        }
    }
}
