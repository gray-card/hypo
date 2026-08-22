import Foundation
import Observation
import SyncKit

@MainActor
@Observable
public final class SyncStatusFeatureModel {
    public private(set) var snapshot = SyncStatusSnapshot()
    public private(set) var connection: SyncConnectionState = .checking
    public private(set) var isLoading = false
    public private(set) var actionConflictID: UUID?
    public private(set) var notice: String?
    public private(set) var errorMessage: String?

    public private(set) var transportAvailability: SyncTransportAvailability

    private let service: any SyncStatusServicing
    private let connectivityMonitor: (any SyncConnectivityMonitoring)?
    private var monitoringStarted = false

    public init(
        service: any SyncStatusServicing,
        transportAvailability: SyncTransportAvailability,
        connectivityMonitor: (any SyncConnectivityMonitoring)? = nil
    ) {
        self.service = service
        self.transportAvailability = transportAvailability
        self.connectivityMonitor = connectivityMonitor
    }

    public var attentionCount: Int { snapshot.conflicts.count }
    public var localChangeCount: Int { snapshot.localChangeCount }

    public func setTransportAvailability(_ availability: SyncTransportAvailability) {
        transportAvailability = availability
    }

    public func selectRepository(_ repo: String?) async {
        await service.selectRepository(repo)
        await refresh()
    }

    public func start() async {
        await refresh()
        guard !monitoringStarted, let connectivityMonitor else { return }
        monitoringStarted = true
        let service = service
        await connectivityMonitor.start { [weak self] isOnline in
            Task { @MainActor in
                guard let self else { return }
                self.connection = isOnline ? .online : .offline
                _ = await service.connectivityDidChange(isOnline: isOnline, now: Date())
                await self.refresh()
            }
        }
    }

    public func stop() async {
        guard monitoringStarted, let connectivityMonitor else { return }
        monitoringStarted = false
        await connectivityMonitor.cancel()
    }

    public func didEnterForeground(now: Date = Date()) async {
        _ = await service.didEnterForeground(now: now)
        await refresh()
    }

    public func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try await service.status()
            errorMessage = nil
        } catch {
            errorMessage = "Hypo couldn’t read the local sync queue. Your records were not changed."
        }
    }

    public func retryNow(now: Date = Date()) async {
        isLoading = true
        notice = nil
        let report = await service.retry(now: now)
        await reloadAfterAction()

        if report.succeeded > 0, report.retryScheduled == 0, report.conflictsParked == 0 {
            notice = report.succeeded == 1 ? "1 change synced." : "\(report.succeeded) changes synced."
        } else if report.retryScheduled > 0 {
            notice = "Hypo couldn’t sync yet. Your changes are still on this iPhone."
        } else if report.conflictsParked > 0 {
            notice = "A change needs your attention before Hypo can continue."
        } else if snapshot.pending.isEmpty {
            notice = "Nothing is waiting to sync."
        } else {
            notice = "No change was ready to retry yet. Your queue is still safe."
        }
        isLoading = false
    }

    public func discardLocalChange(conflictID: UUID, now: Date = Date()) async {
        await resolve(conflictID: conflictID) {
            try await service.discardConflict(id: conflictID, now: now)
            return "Local change discarded. The server copy is shown in Hypo."
        }
    }

    public func rebaseLocalChange(conflictID: UUID, now: Date = Date()) async {
        await resolve(conflictID: conflictID) {
            try await service.rebaseConflict(id: conflictID, now: now)
            return "Your version is queued against the latest server copy."
        }
    }

    private func resolve(
        conflictID: UUID,
        operation: () async throws -> String
    ) async {
        actionConflictID = conflictID
        notice = nil
        errorMessage = nil
        defer { actionConflictID = nil }
        do {
            notice = try await operation()
            await reloadAfterAction()
        } catch {
            errorMessage = "Hypo couldn’t update this conflict. Nothing was discarded or overwritten."
            await reloadAfterAction(clearError: false)
        }
    }

    private func reloadAfterAction(clearError: Bool = true) async {
        do {
            snapshot = try await service.status()
            if clearError { errorMessage = nil }
        } catch {
            errorMessage = "Hypo couldn’t refresh the local sync queue."
        }
    }
}
