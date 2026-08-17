import Foundation
import PersistenceKit

/// The result of a remotely committed outbox operation.
public struct RemoteWriteResult: Hashable, Sendable {
    public var uri: String
    public var cid: String?
    public var record: Data?

    public init(uri: String, cid: String? = nil, record: Data? = nil) {
        self.uri = uri
        self.cid = cid
        self.record = record
    }
}

/// Errors classified by retry safety. A conflict is parked with its remote evidence.
public enum SyncTransportError: Error, Equatable, Sendable {
    case conflict(remoteCID: String?, remoteRecord: Data?, message: String)
    /// The operation belongs to a repository the current transport cannot authorize. The
    /// operation remains queued without consuming a retry attempt or becoming a conflict.
    case deferred(message: String)
    case transient(message: String)
    case permanent(message: String)
}

/// A protocol-bounded remote writer. Implementations must use `operation.id` as their
/// idempotency identity (for AT Protocol creates, normally by choosing a stable rkey).
public protocol SyncTransport: Sendable {
    func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult
}

public struct RetryPolicy: Hashable, Sendable {
    public var initialDelay: TimeInterval
    public var multiplier: Double
    public var maximumDelay: TimeInterval
    public var maximumAttempts: Int

    public init(
        initialDelay: TimeInterval = 1,
        multiplier: Double = 2,
        maximumDelay: TimeInterval = 300,
        maximumAttempts: Int = 8
    ) {
        precondition(initialDelay >= 0 && multiplier >= 1 && maximumDelay >= 0 && maximumAttempts >= 1)
        self.initialDelay = initialDelay
        self.multiplier = multiplier
        self.maximumDelay = maximumDelay
        self.maximumAttempts = maximumAttempts
    }

    public func delay(afterAttempt attempt: Int) -> TimeInterval {
        min(maximumDelay, initialDelay * Foundation.pow(multiplier, Double(max(0, attempt - 1))))
    }
}

/// A persisted flushing lease prevents a second scheduler from replaying an operation while
/// the first attempt can still be running. Once the lease expires, a relaunched process may
/// safely retry using the operation's stable idempotency identity.
public struct SyncLeasePolicy: Hashable, Sendable {
    public var crashRecoveryInterval: TimeInterval

    public init(crashRecoveryInterval: TimeInterval = 60) {
        precondition(crashRecoveryInterval >= 0)
        self.crashRecoveryInterval = crashRecoveryInterval
    }

    public func canAcquire(_ operation: OutboxOperation, at now: Date) -> Bool {
        switch operation.state {
        case .queued:
            true
        case .waitingForRetry:
            (operation.nextAttemptAt ?? .distantPast) <= now
        case .flushing:
            operation.updatedAt.addingTimeInterval(crashRecoveryInterval) <= now
        }
    }
}

public struct FlushReport: Equatable, Sendable {
    public var attempted = 0
    public var succeeded = 0
    public var deferred = 0
    public var retryScheduled = 0
    public var conflictsParked = 0
    public var reconciliations: [String: String] = [:]

    public init() {}

    mutating func merge(_ other: FlushReport) {
        attempted += other.attempted
        succeeded += other.succeeded
        deferred += other.deferred
        retryScheduled += other.retryScheduled
        conflictsParked += other.conflictsParked
        reconciliations.merge(other.reconciliations) { _, new in new }
    }
}

public enum SyncChange: Equatable, Sendable {
    case enqueued(operationID: UUID, tempURI: String?)
    case began(operationID: UUID)
    case succeeded(operationID: UUID, uri: String)
    case retryScheduled(operationID: UUID, attempt: Int, nextAttemptAt: Date)
    case conflictParked(operationID: UUID, conflictID: UUID)
    case conflictDiscarded(conflictID: UUID)
    case conflictRequeued(conflictID: UUID, operationID: UUID)
    case reconciled(tempURI: String, remoteURI: String)
}

public enum OutboxTransitionError: Error, Equatable, Sendable {
    case invalid(from: OutboxOperationState, to: OutboxOperationState)
}

public enum OutboxStateMachine {
    public static func transition(
        _ operation: OutboxOperation,
        to state: OutboxOperationState,
        now: Date,
        leaseID: UUID? = nil
    ) throws -> OutboxOperation {
        let allowed: Bool =
            switch (operation.state, state) {
            case (.queued, .flushing), (.waitingForRetry, .flushing), (.flushing, .waitingForRetry),
                (.flushing, .queued):
                true
            case (.waitingForRetry, .queued): true  // explicit user retry
            case (.flushing, .flushing): true  // crash-lease recovery
            default: false
            }
        guard allowed else { throw OutboxTransitionError.invalid(from: operation.state, to: state) }
        var changed = operation
        changed.state = state
        changed.updatedAt = now
        changed.leaseID = state == .flushing ? leaseID : nil
        return changed
    }
}
