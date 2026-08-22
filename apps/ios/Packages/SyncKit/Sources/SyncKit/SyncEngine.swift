import Foundation
import PersistenceKit

/// Offline-first cache and outbox coordinator.
public actor SyncEngine {
    let store: any PersistenceStore
    private let transport: any SyncTransport
    private let retryPolicy: RetryPolicy
    private let leasePolicy: SyncLeasePolicy
    private let executionGuard: any SyncOperationExecutionGuarding
    private var activeFlush: Task<FlushReport, Never>?
    private var activeFlushID: UUID?
    private var isOnline = false
    private var continuations: [UUID: AsyncStream<SyncChange>.Continuation] = [:]

    public init(
        store: any PersistenceStore,
        transport: any SyncTransport,
        retryPolicy: RetryPolicy = RetryPolicy(),
        leasePolicy: SyncLeasePolicy = SyncLeasePolicy()
    ) {
        self.init(
            store: store,
            transport: transport,
            retryPolicy: retryPolicy,
            leasePolicy: leasePolicy,
            executionGuard: ProcessSyncOperationExecutionGuard.shared
        )
    }

    init(
        store: any PersistenceStore,
        transport: any SyncTransport,
        retryPolicy: RetryPolicy,
        leasePolicy: SyncLeasePolicy,
        executionGuard: any SyncOperationExecutionGuarding
    ) {
        self.store = store
        self.transport = transport
        self.retryPolicy = retryPolicy
        self.leasePolicy = leasePolicy
        self.executionGuard = executionGuard
    }

    public func changes() -> AsyncStream<SyncChange> {
        let id = UUID()
        return AsyncStream { continuation in
            continuations[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeContinuation(id) }
            }
        }
    }

    /// Flush hook for scene/application foreground transitions.
    public func applicationDidEnterForeground(now: Date = Date()) async -> FlushReport {
        await flush(now: now)
    }

    /// Records path state and flushes only when connectivity transitions to available.
    public func connectivityDidChange(isOnline nextIsOnline: Bool, now: Date = Date()) async
        -> FlushReport?
    {
        let regainedConnectivity = nextIsOnline && !isOnline
        isOnline = nextIsOnline
        guard regainedConnectivity else { return nil }
        return await flush(now: now)
    }

    /// Explicit post-enqueue hook for writers that compose with SyncKit through a protocol.
    /// SyncEngine's own enqueue methods also schedule this hook automatically when online.
    public func operationDidEnqueue(now: Date = Date()) async -> FlushReport? {
        guard isOnline else { return nil }
        var report = await flush(now: now)
        guard
            let head = try? await store.snapshot().outbox.first,
            leasePolicy.canAcquire(head, at: now)
        else {
            return report
        }
        report.merge(await flush(now: now))
        return report
    }

    /// Opportunistic background work is allowed to try even before a path update arrives.
    public func performBackgroundRefresh(now: Date = Date()) async -> FlushReport {
        await flush(now: now)
    }

    /// Clears transient backoff for an explicit user retry, then enters the same serialized
    /// flush path as every automatic trigger. Live flushing leases remain untouched.
    public func retryNow(now: Date = Date()) async -> FlushReport {
        if let activeFlush, let activeFlushID {
            _ = await activeFlush.value
            clearActiveFlush(ifMatching: activeFlushID)
        }
        if let snapshot = try? await store.snapshot() {
            let retries = snapshot.outbox.compactMap { operation -> PersistenceMutation? in
                guard operation.state == .waitingForRetry else { return nil }
                guard
                    var queued = try? OutboxStateMachine.transition(
                        operation,
                        to: .queued,
                        now: now
                    )
                else {
                    return nil
                }
                queued.nextAttemptAt = nil
                queued.lastError = nil
                return .updateOutbox(queued)
            }
            if !retries.isEmpty {
                do {
                    try await store.apply(retries)
                } catch {
                    return FlushReport()
                }
            }
        }
        return await flush(now: now)
    }

    /// Optimistically caches a create and durably queues it in one transaction.
    @discardableResult
    public func enqueueCreate(
        repo: String,
        collection: String,
        rkey: String? = nil,
        record: Data,
        now: Date = Date()
    ) async throws -> String {
        let id = UUID()
        let tempURI = "outbox://\(id.uuidString.lowercased())"
        let operation = OutboxOperation(
            id: id,
            kind: .create,
            repo: repo,
            collection: collection,
            rkey: rkey,
            tempURI: tempURI,
            record: record,
            createdAt: now
        )
        let cached = CachedRecord(
            uri: tempURI,
            cid: nil,
            collection: collection,
            rkey: rkey ?? id.uuidString.lowercased(),
            value: record,
            cachedAt: now,
            pendingOperationID: id
        )
        try await store.apply([.upsertRecord(cached), .enqueue(operation)])
        emit(.enqueued(operationID: id, tempURI: tempURI))
        schedulePostEnqueueFlush(now: now)
        return tempURI
    }

    /// Optimistically patches a cached record and queues a CAS put.
    @discardableResult
    public func enqueuePut(
        repo: String,
        collection: String,
        rkey: String,
        uri: String,
        record: Data,
        swapRecord: String? = nil,
        now: Date = Date()
    ) async throws -> UUID {
        let id = UUID()
        let cached = try await store.cachedRecord(uri: uri)
        let operation = OutboxOperation(
            id: id,
            kind: .put,
            repo: repo,
            collection: collection,
            rkey: rkey,
            uri: uri,
            record: record,
            swapRecord: swapRecord ?? cached?.cid,
            createdAt: now
        )
        let patched = CachedRecord(
            uri: uri,
            cid: cached?.cid,
            collection: collection,
            rkey: rkey,
            value: record,
            cachedAt: now,
            pendingOperationID: id
        )
        try await store.apply([.upsertRecord(patched), .enqueue(operation)])
        emit(.enqueued(operationID: id, tempURI: nil))
        schedulePostEnqueueFlush(now: now)
        return id
    }

    /// Optimistically removes a cached record and queues a CAS delete. Deleting a record
    /// created only in this outbox cancels the uncommitted chain instead of touching the network.
    @discardableResult
    public func enqueueDelete(
        repo: String,
        collection: String,
        rkey: String,
        uri: String,
        swapRecord: String? = nil,
        now: Date = Date()
    ) async throws -> UUID? {
        let snapshot = try await store.snapshot()
        if uri.hasPrefix("outbox://") {
            let related = snapshot.outbox.filter { $0.tempURI == uri || $0.uri == uri }
            var mutations: [PersistenceMutation] = related.map { .removeOutbox(id: $0.id) }
            mutations.append(.removeRecord(uri: uri))
            try await store.apply(mutations)
            return nil
        }

        let id = UUID()
        let cached = snapshot.records.first { $0.uri == uri }
        let operation = OutboxOperation(
            id: id,
            kind: .delete,
            repo: repo,
            collection: collection,
            rkey: rkey,
            uri: uri,
            swapRecord: swapRecord ?? cached?.cid,
            createdAt: now
        )
        try await store.apply([.removeRecord(uri: uri), .enqueue(operation)])
        emit(.enqueued(operationID: id, tempURI: nil))
        schedulePostEnqueueFlush(now: now)
        return id
    }

    /// Flushes all due operations in durable order. Concurrent callers await one shared task.
    public func flush(now: Date = Date()) async -> FlushReport {
        if let activeFlush, let activeFlushID {
            let report = await activeFlush.value
            clearActiveFlush(ifMatching: activeFlushID)
            return report
        }
        let flushID = UUID()
        let task = Task { [weak self] in
            guard let self else { return FlushReport() }
            return await self.performFlush(now: now)
        }
        activeFlush = task
        activeFlushID = flushID
        let report = await task.value
        clearActiveFlush(ifMatching: flushID)
        return report
    }

    private func performFlush(now: Date) async -> FlushReport {
        var report = FlushReport()
        guard let snapshot = try? await store.snapshot() else { return report }
        var due: [OutboxOperation] = []
        for operation in snapshot.outbox {
            guard leasePolicy.canAcquire(operation, at: now) else { break }
            due.append(operation)
        }

        for persisted in due {
            guard executionGuard.acquire(operationID: persisted.id) else { break }
            defer { executionGuard.release(operationID: persisted.id) }
            guard let current = try? await store.snapshot().outbox.first(where: { $0.id == persisted.id })
            else {
                continue
            }
            guard leasePolicy.canAcquire(current, at: now) else { break }
            let leaseID = UUID()
            let flushing: OutboxOperation
            do {
                flushing = try OutboxStateMachine.transition(
                    current, to: .flushing, now: now, leaseID: leaseID)
                try await store.apply([.updateOutbox(flushing)])
            } catch {
                break
            }

            report.attempted += 1
            emit(.began(operationID: flushing.id))
            do {
                let result = try await transport.execute(flushing)
                let reconciliation = try await commitSuccess(flushing, result: result, now: now)
                report.succeeded += 1
                emit(.succeeded(operationID: flushing.id, uri: result.uri))
                if let reconciliation {
                    report.reconciliations[reconciliation.0] = reconciliation.1
                    emit(.reconciled(tempURI: reconciliation.0, remoteURI: reconciliation.1))
                }
            } catch let error as SyncTransportError {
                switch error {
                case .deferred:
                    if var queued = try? OutboxStateMachine.transition(
                        flushing,
                        to: .queued,
                        now: now
                    ) {
                        queued.nextAttemptAt = nil
                        queued.lastError = nil
                        try? await store.apply([.updateOutbox(queued)])
                    }
                    report.deferred += 1
                    continue
                case let .conflict(remoteCID, remoteRecord, message):
                    if let conflict = try? await park(
                        flushing,
                        reason: message,
                        remoteCID: remoteCID,
                        remoteRecord: remoteRecord,
                        now: now
                    ) {
                        report.conflictsParked += 1
                        emit(.conflictParked(operationID: flushing.id, conflictID: conflict.id))
                    }
                    break
                case let .permanent(message):
                    if let conflict = try? await park(flushing, reason: message, now: now) {
                        report.conflictsParked += 1
                        emit(.conflictParked(operationID: flushing.id, conflictID: conflict.id))
                    }
                    break
                case let .transient(message):
                    if await scheduleRetry(flushing, message: message, now: now) {
                        report.retryScheduled += 1
                    } else {
                        report.conflictsParked += 1
                    }
                    return report
                }
                return report
            } catch {
                if await scheduleRetry(flushing, message: String(describing: error), now: now) {
                    report.retryScheduled += 1
                } else {
                    report.conflictsParked += 1
                }
                return report
            }
        }
        return report
    }

    private func scheduleRetry(_ operation: OutboxOperation, message: String, now: Date) async -> Bool {
        let attempt = operation.attemptCount + 1
        if attempt >= retryPolicy.maximumAttempts {
            if let conflict = try? await park(operation, reason: "Retry limit reached: \(message)", now: now)
            {
                emit(.conflictParked(operationID: operation.id, conflictID: conflict.id))
            }
            return false
        }
        var retry: OutboxOperation
        do {
            retry = try OutboxStateMachine.transition(operation, to: .waitingForRetry, now: now)
        } catch {
            return false
        }
        retry.attemptCount = attempt
        retry.lastError = message
        let next = now.addingTimeInterval(retryPolicy.delay(afterAttempt: attempt))
        retry.nextAttemptAt = next
        do {
            try await store.apply([.updateOutbox(retry)])
            emit(.retryScheduled(operationID: operation.id, attempt: attempt, nextAttemptAt: next))
            return true
        } catch {
            return false
        }
    }

    private func park(
        _ operation: OutboxOperation,
        reason: String,
        remoteCID: String? = nil,
        remoteRecord: Data? = nil,
        now: Date
    ) async throws -> ParkedConflict {
        let conflict = ParkedConflict(
            operation: operation,
            reason: reason,
            remoteCID: remoteCID,
            remoteRecord: remoteRecord,
            parkedAt: now
        )
        try await store.apply([.removeOutbox(id: operation.id), .parkConflict(conflict)])
        return conflict
    }

    private func commitSuccess(
        _ operation: OutboxOperation,
        result: RemoteWriteResult,
        now: Date
    ) async throws -> (String, String)? {
        switch operation.kind {
        case .create:
            guard let tempURI = operation.tempURI else {
                try await store.apply([.removeOutbox(id: operation.id)])
                return nil
            }
            try await reconcileCreate(operation, tempURI: tempURI, result: result, now: now)
            return (tempURI, result.uri)
        case .put:
            try await commitPut(operation, result: result, now: now)
            return nil
        case .delete:
            var mutations: [PersistenceMutation] = [.removeOutbox(id: operation.id)]
            if let uri = operation.uri {
                mutations.append(.removeRecord(uri: uri))
                mutations.append(.removeComplements(recordURI: uri, nativeCID: nil))
            }
            try await store.apply(mutations)
            return nil
        }
    }

    private func reconcileCreate(
        _ operation: OutboxOperation,
        tempURI: String,
        result: RemoteWriteResult,
        now: Date
    ) async throws {
        let snapshot = try await store.snapshot()
        var mutations: [PersistenceMutation] = [.removeOutbox(id: operation.id), .removeRecord(uri: tempURI)]
        let laterOperations = snapshot.outbox.filter { $0.id != operation.id }
        let directDependent = laterOperations.first { $0.uri == tempURI }
        let cachedTemp = snapshot.records.first { $0.uri == tempURI }
        let finalValue = JSONReferenceReconciler.replacing(
            tempURI,
            with: result.uri,
            in: cachedTemp?.value ?? result.record ?? operation.record ?? Data("{}".utf8)
        )
        let finalRecord = CachedRecord(
            uri: result.uri,
            cid: result.cid,
            collection: operation.collection,
            rkey: rkey(from: result.uri) ?? operation.rkey ?? cachedTemp?.rkey ?? operation.id.uuidString,
            value: finalValue,
            cachedAt: now,
            pendingOperationID: directDependent?.id
        )
        mutations.append(.upsertRecord(finalRecord))

        for record in snapshot.records where record.uri != tempURI {
            let patched = JSONReferenceReconciler.replacing(tempURI, with: result.uri, in: record.value)
            if patched != record.value {
                var changed = record
                changed.value = patched
                mutations.append(.upsertRecord(changed))
            }
        }

        for var pending in laterOperations {
            var changed = false
            if pending.uri == tempURI {
                pending.uri = result.uri
                pending.rkey = rkey(from: result.uri) ?? pending.rkey
                if pending.kind != .create { pending.swapRecord = result.cid }
                changed = true
            }
            if let record = pending.record {
                let patched = JSONReferenceReconciler.replacing(tempURI, with: result.uri, in: record)
                if patched != record {
                    pending.record = patched
                    changed = true
                }
            }
            if changed {
                pending.updatedAt = now
                mutations.append(.updateOutbox(pending))
            }
        }
        try await store.apply(mutations)
    }

    private func commitPut(_ operation: OutboxOperation, result: RemoteWriteResult, now: Date) async throws {
        let snapshot = try await store.snapshot()
        guard let uri = operation.uri else {
            try await store.apply([.removeOutbox(id: operation.id)])
            return
        }
        let later = snapshot.outbox.first { $0.id != operation.id && $0.uri == uri }
        var mutations: [PersistenceMutation] = [.removeOutbox(id: operation.id)]
        if var later, later.kind != .create {
            later.swapRecord = result.cid
            later.updatedAt = now
            mutations.append(.updateOutbox(later))
        }
        let optimistic = snapshot.records.first { $0.uri == uri }
        let value =
            later == nil ? (result.record ?? operation.record ?? optimistic?.value) : optimistic?.value
        if let value {
            mutations.append(
                .upsertRecord(
                    CachedRecord(
                        uri: uri,
                        cid: result.cid,
                        collection: operation.collection,
                        rkey: operation.rkey ?? rkey(from: uri) ?? "",
                        value: value,
                        cachedAt: now,
                        pendingOperationID: later?.id
                    )))
        }
        try await store.apply(mutations)
    }

    private func rkey(from uri: String) -> String? {
        guard uri.hasPrefix("at://") else { return nil }
        return uri.split(separator: "/").last.map(String.init)
    }

    func emit(_ change: SyncChange) {
        for continuation in continuations.values { continuation.yield(change) }
    }

    private func removeContinuation(_ id: UUID) {
        continuations.removeValue(forKey: id)
    }

    private func clearActiveFlush(ifMatching id: UUID) {
        guard activeFlushID == id else { return }
        activeFlush = nil
        activeFlushID = nil
    }

    func schedulePostEnqueueFlush(now: Date) {
        guard isOnline else { return }
        Task { [weak self] in
            _ = await self?.operationDidEnqueue(now: now)
        }
    }
}
