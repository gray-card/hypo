import Foundation

/// A cached AT Protocol record. The record body remains opaque JSON data so persistence
/// does not own an application schema or a Panproto representation.
public struct CachedRecord: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String?
    public var collection: String
    public var rkey: String
    public var value: Data
    public var cachedAt: Date
    public var pendingOperationID: UUID?

    public init(
        uri: String,
        cid: String?,
        collection: String,
        rkey: String,
        value: Data,
        cachedAt: Date = Date(),
        pendingOperationID: UUID? = nil
    ) {
        self.uri = uri
        self.cid = cid
        self.collection = collection
        self.rkey = rkey
        self.value = value
        self.cachedAt = cachedAt
        self.pendingOperationID = pendingOperationID
    }
}

public enum OutboxOperationKind: String, Codable, Hashable, Sendable {
    case create
    case put
    case delete
}

public enum OutboxOperationState: String, Codable, Hashable, Sendable {
    case queued
    case flushing
    case waitingForRetry
}

/// One durable write intent. `swapRecord` carries AT Protocol record-level CAS metadata.
public struct OutboxOperation: Codable, Hashable, Sendable {
    public var id: UUID
    public var kind: OutboxOperationKind
    public var repo: String
    public var collection: String
    public var rkey: String?
    public var uri: String?
    public var tempURI: String?
    public var record: Data?
    public var swapRecord: String?
    public var state: OutboxOperationState
    public var attemptCount: Int
    public var nextAttemptAt: Date?
    public var leaseID: UUID?
    public var lastError: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        kind: OutboxOperationKind,
        repo: String,
        collection: String,
        rkey: String? = nil,
        uri: String? = nil,
        tempURI: String? = nil,
        record: Data? = nil,
        swapRecord: String? = nil,
        state: OutboxOperationState = .queued,
        attemptCount: Int = 0,
        nextAttemptAt: Date? = nil,
        leaseID: UUID? = nil,
        lastError: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.uri = uri
        self.tempURI = tempURI
        self.record = record
        self.swapRecord = swapRecord
        self.state = state
        self.attemptCount = attemptCount
        self.nextAttemptAt = nextAttemptAt
        self.leaseID = leaseID
        self.lastError = lastError
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }
}

/// A write that cannot safely be retried without user or application intervention.
public struct ParkedConflict: Codable, Hashable, Sendable {
    public var id: UUID
    public var operation: OutboxOperation
    public var reason: String
    public var remoteCID: String?
    public var remoteRecord: Data?
    public var parkedAt: Date

    public init(
        id: UUID = UUID(),
        operation: OutboxOperation,
        reason: String,
        remoteCID: String? = nil,
        remoteRecord: Data? = nil,
        parkedAt: Date = Date()
    ) {
        self.id = id
        self.operation = operation
        self.reason = reason
        self.remoteCID = remoteCID
        self.remoteRecord = remoteRecord
        self.parkedAt = parkedAt
    }
}

/// Opaque Panproto complement custody keyed by the native record identity and chain.
///
/// PersistenceKit deliberately does not parse or transform `payload`. The Panproto caller
/// remains responsible for constructing and consuming complements with the matching chain.
public struct PanprotoComplement: Codable, Hashable, Sendable {
    public var recordURI: String
    public var nativeCID: String
    public var chainID: String
    public var payload: Data
    public var createdAt: Date

    public init(
        recordURI: String,
        nativeCID: String,
        chainID: String,
        payload: Data,
        createdAt: Date = Date()
    ) {
        self.recordURI = recordURI
        self.nativeCID = nativeCID
        self.chainID = chainID
        self.payload = payload
        self.createdAt = createdAt
    }

    var storageKey: String { "\(recordURI)\u{0}\(nativeCID)\u{0}\(chainID)" }
}

public struct PersistenceSnapshot: Sendable, Equatable {
    public var revision: Int64
    public var records: [CachedRecord]
    public var outbox: [OutboxOperation]
    public var conflicts: [ParkedConflict]
    public var complements: [PanprotoComplement]

    public init(
        revision: Int64 = 0,
        records: [CachedRecord] = [],
        outbox: [OutboxOperation] = [],
        conflicts: [ParkedConflict] = [],
        complements: [PanprotoComplement] = []
    ) {
        self.revision = revision
        self.records = records
        self.outbox = outbox
        self.conflicts = conflicts
        self.complements = complements
    }
}
