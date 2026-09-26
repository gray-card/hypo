import Foundation

/// Durable storage used by the timer actor. Implementations may use SwiftData or a file.
public protocol TimerRunStore: Sendable {
    func load() async throws -> DevelopmentTimerRun?
    func save(_ run: DevelopmentTimerRun) async throws
    func clear() async throws
}

/// A deterministic in-memory store for previews and tests.
public actor InMemoryTimerRunStore: TimerRunStore {
    private var run: DevelopmentTimerRun?

    public init(run: DevelopmentTimerRun? = nil) {
        self.run = run
    }

    public func load() -> DevelopmentTimerRun? { run }

    public func save(_ run: DevelopmentTimerRun) {
        self.run = run
    }

    public func clear() {
        run = nil
    }
}

/// Serializes timer state transitions and persists every accepted transition.
public actor DevelopmentTimerEngine {
    private var run: DevelopmentTimerRun
    private let store: any TimerRunStore

    public init(run: DevelopmentTimerRun, store: any TimerRunStore) {
        self.run = run
        self.store = store
    }

    public static func restore(from store: any TimerRunStore) async throws -> DevelopmentTimerEngine {
        do {
            guard let run = try await store.load() else { throw TimerError.noPersistedRun }
            return DevelopmentTimerEngine(run: run, store: store)
        } catch let error as TimerError {
            throw error
        } catch {
            throw TimerError.persistence(String(describing: error))
        }
    }

    public func start(at date: Date = Date()) async throws -> TimerSnapshot {
        try run.start(at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func pause(at date: Date = Date()) async throws -> TimerSnapshot {
        try run.pause(at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func resume(at date: Date = Date()) async throws -> TimerSnapshot {
        try run.resume(at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func skip(at date: Date = Date()) async throws -> TimerSnapshot {
        try run.skip(at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func extendCurrentStage(
        by interval: TimeInterval,
        at date: Date = Date()
    ) async throws -> TimerSnapshot {
        try run.extendCurrentStage(by: interval, at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func cancel(at date: Date = Date()) async throws -> TimerSnapshot {
        try run.cancel(at: date)
        return try await persistAndSnapshot(at: date)
    }

    public func snapshot(at date: Date = Date()) async throws -> TimerSnapshot {
        let before = run
        let snapshot = try run.snapshot(at: date)
        if before != run {
            try await persist()
        }
        return snapshot
    }

    public func durableRun() -> DevelopmentTimerRun { run }

    private func persistAndSnapshot(at date: Date) async throws -> TimerSnapshot {
        try await persist()
        return try run.snapshot(at: date)
    }

    private func persist() async throws {
        do {
            try await store.save(run)
        } catch {
            throw TimerError.persistence(String(describing: error))
        }
    }
}
