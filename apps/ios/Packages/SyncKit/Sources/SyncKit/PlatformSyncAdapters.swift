import Dispatch
import Foundation

#if canImport(Network)
    import Network

    /// NWPathMonitor-backed connectivity source. Call start once per instance and retain it.
    public final class NWPathSyncConnectivityMonitor: SyncConnectivityMonitoring, @unchecked Sendable {
        private let monitor: NWPathMonitor
        private let queue: DispatchQueue

        public init(
            monitor: NWPathMonitor = NWPathMonitor(),
            queue: DispatchQueue = DispatchQueue(label: "app.graycard.synckit.path-monitor")
        ) {
            self.monitor = monitor
            self.queue = queue
        }

        public func start(handler: @escaping @Sendable (Bool) -> Void) async {
            monitor.pathUpdateHandler = { path in
                handler(path.status == .satisfied)
            }
            monitor.start(queue: queue)
        }

        public func cancel() async {
            monitor.cancel()
        }
    }
#endif

#if os(iOS) && canImport(BackgroundTasks)
    import BackgroundTasks

    /// Sendable custody wrapper around the system-created BGAppRefreshTask.
    public final class SystemSyncBackgroundRefreshTask: SyncBackgroundRefreshTask, @unchecked Sendable {
        private let task: BGAppRefreshTask

        public init(_ task: BGAppRefreshTask) {
            self.task = task
        }

        public func setExpirationHandler(_ handler: (@Sendable () -> Void)?) async {
            task.expirationHandler = handler
        }

        public func setTaskCompleted(success: Bool) async {
            task.setTaskCompleted(success: success)
        }
    }

    public extension SyncBackgroundRefreshAdapter {
        /// Entry point for a BGTaskScheduler launch handler.
        func handle(_ task: BGAppRefreshTask, now: Date = Date()) async {
            await handle(SystemSyncBackgroundRefreshTask(task), now: now)
        }
    }
#endif
