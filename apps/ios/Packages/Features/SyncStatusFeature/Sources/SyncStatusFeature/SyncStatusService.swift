import Foundation
import PersistenceKit
import SyncKit

public protocol SyncStatusServicing: Sendable {
    func status() async throws -> SyncStatusSnapshot
    func selectRepository(_ repo: String?) async
    func retry(now: Date) async -> FlushReport
    func discardConflict(id: UUID, now: Date) async throws
    func rebaseConflict(id: UUID, now: Date) async throws
    func didEnterForeground(now: Date) async -> FlushReport
    func connectivityDidChange(isOnline: Bool, now: Date) async -> FlushReport?
}

extension SyncStatusServicing {
    public func selectRepository(_: String?) async {}
}

public enum SyncStatusRepositoryScope: Equatable, Sendable {
    case all
    case active(String?)
}

public enum SyncStatusServiceError: Error, Equatable, Sendable {
    case conflictOutsideActiveRepository
}

public actor SyncKitStatusService: SyncStatusServicing {
    private let store: any PersistenceStore
    private let engine: SyncEngine
    private var scope: SyncStatusRepositoryScope

    public init(
        store: any PersistenceStore,
        engine: SyncEngine,
        scope: SyncStatusRepositoryScope = .all
    ) {
        self.store = store
        self.engine = engine
        self.scope = scope
    }

    public func status() async throws -> SyncStatusSnapshot {
        SyncStatusProjection.make(from: try await store.snapshot(), scope: scope)
    }

    public func selectRepository(_ repo: String?) {
        guard case .active = scope else { return }
        scope = .active(repo)
    }

    public func retry(now: Date = Date()) async -> FlushReport {
        await engine.retryNow(now: now)
    }

    public func discardConflict(id: UUID, now: Date = Date()) async throws {
        try await requireVisibleConflict(id: id)
        try await engine.discardConflict(id: id, now: now)
    }

    public func rebaseConflict(id: UUID, now: Date = Date()) async throws {
        try await requireVisibleConflict(id: id)
        try await engine.rebaseConflict(id: id, now: now)
    }

    public func didEnterForeground(now: Date = Date()) async -> FlushReport {
        await engine.applicationDidEnterForeground(now: now)
    }

    public func connectivityDidChange(isOnline: Bool, now: Date = Date()) async -> FlushReport? {
        await engine.connectivityDidChange(isOnline: isOnline, now: now)
    }

    private func requireVisibleConflict(id: UUID) async throws {
        guard case let .active(repo) = scope else { return }
        let conflict = try await store.snapshot().conflicts.first { $0.id == id }
        guard conflict?.operation.repo == repo else {
            throw SyncStatusServiceError.conflictOutsideActiveRepository
        }
    }
}
