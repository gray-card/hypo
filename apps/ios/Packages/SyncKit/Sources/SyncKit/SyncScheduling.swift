import Foundation

/// App and platform adapters target this boundary rather than reaching into outbox state.
public protocol SyncFlushScheduling: Sendable {
    func applicationDidEnterForeground(now: Date) async -> FlushReport
    func connectivityDidChange(isOnline: Bool, now: Date) async -> FlushReport?
    func operationDidEnqueue(now: Date) async -> FlushReport?
    func performBackgroundRefresh(now: Date) async -> FlushReport
}

extension SyncEngine: SyncFlushScheduling {}

/// Small application-lifecycle surface suitable for a scene delegate or SwiftUI scene phase.
public struct SyncLifecycleFlushAdapter: Sendable {
    private let scheduler: any SyncFlushScheduling

    public init(scheduler: any SyncFlushScheduling) {
        self.scheduler = scheduler
    }

    public func didEnterForeground(now: Date = Date()) async -> FlushReport {
        await scheduler.applicationDidEnterForeground(now: now)
    }

    public func didEnqueue(now: Date = Date()) async -> FlushReport? {
        await scheduler.operationDidEnqueue(now: now)
    }
}

/// Testable connectivity boundary. The production implementation is backed by NWPathMonitor.
public protocol SyncConnectivityMonitoring: Sendable {
    func start(handler: @escaping @Sendable (Bool) -> Void) async
    func cancel() async
}

public struct SyncReconnectAdapter: Sendable {
    private let monitor: any SyncConnectivityMonitoring
    private let scheduler: any SyncFlushScheduling

    public init(
        monitor: any SyncConnectivityMonitoring,
        scheduler: any SyncFlushScheduling
    ) {
        self.monitor = monitor
        self.scheduler = scheduler
    }

    public func start() async {
        let scheduler = scheduler
        await monitor.start { isOnline in
            Task {
                _ = await scheduler.connectivityDidChange(isOnline: isOnline, now: Date())
            }
        }
    }

    public func cancel() async {
        await monitor.cancel()
    }
}

/// Platform-neutral task surface used to test expiration and exactly-once completion.
public protocol SyncBackgroundRefreshTask: Sendable {
    func setExpirationHandler(_ handler: (@Sendable () -> Void)?) async
    func setTaskCompleted(success: Bool) async
}

private actor BackgroundRefreshCompletion {
    private let task: any SyncBackgroundRefreshTask
    private var isCompleted = false

    init(task: any SyncBackgroundRefreshTask) {
        self.task = task
    }

    func complete(success: Bool) async {
        guard !isCompleted else { return }
        isCompleted = true
        await task.setExpirationHandler(nil)
        await task.setTaskCompleted(success: success)
    }
}

public struct SyncBackgroundRefreshAdapter: Sendable {
    private let scheduler: any SyncFlushScheduling

    public init(scheduler: any SyncFlushScheduling) {
        self.scheduler = scheduler
    }

    /// Runs one background flush. Expiration cancels the waiter and completes the system task
    /// unsuccessfully; an expiration/completion race still calls task completion only once.
    public func handle(_ task: any SyncBackgroundRefreshTask, now: Date = Date()) async {
        let scheduler = scheduler
        let completion = BackgroundRefreshCompletion(task: task)
        let work = Task { await scheduler.performBackgroundRefresh(now: now) }
        await task.setExpirationHandler {
            work.cancel()
            Task { await completion.complete(success: false) }
        }

        let report = await work.value
        await completion.complete(success: !work.isCancelled && report.retryScheduled == 0)
    }
}

protocol SyncOperationExecutionGuarding: Sendable {
    func acquire(operationID: UUID) -> Bool
    func release(operationID: UUID)
}

/// Process-local exclusion closes the race between reading and persisting the durable lease.
/// The durable lease itself survives process death and is reclaimed after SyncLeasePolicy's interval.
final class ProcessSyncOperationExecutionGuard: SyncOperationExecutionGuarding, @unchecked Sendable {
    static let shared = ProcessSyncOperationExecutionGuard()

    private let lock = NSLock()
    private var operationIDs: Set<UUID> = []

    func acquire(operationID: UUID) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return operationIDs.insert(operationID).inserted
    }

    func release(operationID: UUID) {
        lock.lock()
        operationIDs.remove(operationID)
        lock.unlock()
    }
}
