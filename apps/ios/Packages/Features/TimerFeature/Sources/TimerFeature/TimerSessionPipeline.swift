import Foundation
import HypoLexicon

actor TimerSessionPipeline {
    private let store: any TimerFeatureSessionStoring
    private let writer: any DevelopmentSessionWriting
    private let rollAdvancer: any FilmRollDevelopmentAdvancing
    private var latestGeneration = -1
    private var completedRunIDs: Set<UUID> = []

    init(
        store: any TimerFeatureSessionStoring,
        writer: any DevelopmentSessionWriting,
        rollAdvancer: any FilmRollDevelopmentAdvancing
    ) {
        self.store = store
        self.writer = writer
        self.rollAdvancer = rollAdvancer
    }

    func load() async throws -> TimerFeatureSessionState? {
        do {
            let session = try await store.load()
            if let session, session.completionState == .written {
                completedRunIDs.insert(session.run.id)
            }
            return session
        } catch {
            throw TimerFeatureError.persistence(String(describing: error))
        }
    }

    func persist(_ incoming: TimerFeatureSessionState) async throws -> TimerFeatureSessionState {
        guard incoming.generation >= latestGeneration else {
            return try await store.load() ?? incoming
        }
        latestGeneration = incoming.generation

        var session = incoming
        if completedRunIDs.contains(session.run.id) {
            session.completionState = .written
            session.developmentSessionURI =
                try await store.load()?.developmentSessionURI ?? session.developmentSessionURI
            try await save(session)
            return session
        }

        if let stored = try await store.load(),
            stored.run.id == session.run.id,
            stored.completionState == .written
        {
            completedRunIDs.insert(session.run.id)
            session.completionState = .written
            session.developmentSessionURI = stored.developmentSessionURI
            try await save(session)
            return session
        }

        try await save(session)
        guard session.isReadyForCompletion else { return session }

        session.completionState = .writing
        try await save(session)
        do {
            let record = try DevelopmentSessionRecordBuilder.record(for: session)
            let idempotencyKey = session.run.id.uuidString.lowercased()
            let developmentSession = try await writer.writeDevelopmentSession(
                record: record,
                idempotencyKey: idempotencyKey
            )
            guard let startedAt = session.startedAt, let developedAt = session.processFinishedAt else {
                throw TimerFeatureError.incompleteRun
            }
            for roll in session.linkedFilmRolls {
                try await rollAdvancer.advanceFilmRoll(
                    FilmRollDevelopmentAdvanceRequest(
                        roll: roll,
                        developmentSession: developmentSession,
                        developmentStartedAt: ATProtoDate(startedAt),
                        developedAt: ATProtoDate(developedAt),
                        idempotencyKey: "\(idempotencyKey):\(roll.rawValue)"
                    )
                )
            }
            session.completionState = .written
            session.developmentSessionURI = developmentSession
            completedRunIDs.insert(session.run.id)
            try await save(session)
            return session
        } catch let error as TimerFeatureError {
            throw error
        } catch {
            throw TimerFeatureError.completion(String(describing: error))
        }
    }

    private func save(_ session: TimerFeatureSessionState) async throws {
        do {
            try await store.save(session)
        } catch {
            throw TimerFeatureError.persistence(String(describing: error))
        }
    }
}
