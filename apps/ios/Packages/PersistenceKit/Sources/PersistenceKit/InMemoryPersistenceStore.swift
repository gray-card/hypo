import Foundation

/// An in-memory store suitable for previews, tests, and ephemeral sessions.
public actor InMemoryPersistenceStore: PersistenceStore {
    private var state: StoreState
    private var changeHub = ChangeHub()

    public init(snapshot: PersistenceSnapshot = PersistenceSnapshot()) {
        state = StoreState(snapshot: snapshot)
    }

    public func snapshot() -> PersistenceSnapshot { state.snapshot() }

    public func apply(_ mutations: [PersistenceMutation]) throws {
        guard !mutations.isEmpty else { return }
        var candidate = state
        let change = try candidate.apply(mutations)
        state = candidate
        changeHub.emit(change)
    }

    public func changes() -> AsyncStream<PersistenceChange> {
        changeHub.stream { [weak self] id in
            Task { await self?.removeContinuation(id) }
        }
    }

    private func removeContinuation(_ id: UUID) {
        changeHub.remove(id)
    }
}
