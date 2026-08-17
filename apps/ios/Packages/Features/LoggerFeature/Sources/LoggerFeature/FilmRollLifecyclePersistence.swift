import Foundation
import HypoLexicon
import PersistenceKit
import SyncKit

/// Merges lifecycle fields into a complete film-roll record without decoding and re-encoding
/// fields that this client does not own.
public enum FilmRollLifecycleRecordMerger {
    public static func merge(record: Data, update: FilmRollLifecycleUpdate) throws -> Data {
        let issues = ConsumableLifecycleValidator.validate(update.milestones)
        guard issues.isEmpty else { throw LoggerError.lifecycle(issues) }

        let schemaIssues = try GeneratedLexiconValidator.validate(
            record,
            as: GeneratedRecordNSID.instanceFilmRoll
        )
        guard schemaIssues.isEmpty else {
            throw LoggerError.write(schemaIssues[0].message)
        }
        let decoded = try JSONDecoder().decode(AppGraycardInstanceFilmRollMain.self, from: record)
        guard var object = try JSONSerialization.jsonObject(with: record) as? [String: Any] else {
            throw LoggerError.write("The film-roll record is not a JSON object.")
        }

        assign(update.milestones.loadedAt, to: "loadedAt", in: &object)
        assign(update.milestones.partialAt, to: "partialAt", in: &object)
        assign(update.milestones.exposedAt, to: "exposedAt", in: &object)
        assign(update.milestones.unloadedAt, to: "unloadedAt", in: &object)
        assign(update.milestones.sentToLabAt, to: "sentToLabAt", in: &object)
        assign(update.milestones.developmentStartedAt, to: "developmentStartedAt", in: &object)
        assign(update.milestones.developedAt, to: "developedAt", in: &object)
        assign(update.milestones.receivedFromLabAt, to: "receivedFromLabAt", in: &object)
        assign(update.milestones.scannedAt, to: "scannedAt", in: &object)
        assign(update.milestones.archivedAt, to: "archivedAt", in: &object)
        assign(update.developmentLocation?.rawValue, to: "developmentLocation", in: &object)
        object["updatedAt"] = update.updatedAt.rawValue
        object["status"] = advancedStatus(
            current: decoded.status?.rawValue,
            milestones: update.milestones
        )

        return try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }

    private static func assign(
        _ date: ATProtoDate?,
        to key: String,
        in object: inout [String: Any]
    ) {
        assign(date?.rawValue, to: key, in: &object)
    }

    private static func assign(
        _ value: String?,
        to key: String,
        in object: inout [String: Any]
    ) {
        if let value {
            object[key] = value
        } else {
            object.removeValue(forKey: key)
        }
    }

    private static func advancedStatus(
        current: String?,
        milestones: FilmRollMilestones
    ) -> String {
        let candidate: String
        if milestones.archivedAt != nil {
            candidate = "archived"
        } else if milestones.scannedAt != nil {
            candidate = "scanned"
        } else if milestones.developedAt != nil {
            candidate = "developed"
        } else if milestones.developmentStartedAt != nil {
            candidate = "developing"
        } else if milestones.sentToLabAt != nil {
            candidate = "at-lab"
        } else if milestones.unloadedAt != nil || milestones.exposedAt != nil {
            candidate = "exposed"
        } else if milestones.partialAt != nil {
            candidate = "partial"
        } else {
            candidate = "loaded"
        }

        let rank = [
            "loaded": 0,
            "partial": 1,
            "exposed": 2,
            "at-lab": 3,
            "developing": 4,
            "developed": 5,
            "scanned": 6,
            "archived": 7,
        ]
        guard let current, let currentRank = rank[current],
            currentRank > (rank[candidate] ?? -1)
        else { return candidate }
        return current
    }
}

/// An offline-first lifecycle writer. A complete cached record with a CID is enough to queue a
/// CAS update; network hydration is used only when no safe cached base is available.
public actor QueuedFilmRollLifecycleWriter: FilmRollLifecycleWriting {
    private let repo: String
    private let engine: SyncEngine
    private let store: any PersistenceStore
    private let hydrator: any RecordHydrating

    public init(
        repo: String,
        engine: SyncEngine,
        store: any PersistenceStore,
        hydrator: any RecordHydrating
    ) {
        self.repo = repo
        self.engine = engine
        self.store = store
        self.hydrator = hydrator
    }

    public func updateFilmRollLifecycle(_ update: FilmRollLifecycleUpdate) async throws {
        guard update.roll.authority == repo,
            update.roll.collection == GeneratedRecordNSID.instanceFilmRoll,
            let rkey = update.roll.recordKey
        else {
            throw LoggerError.write("The roll does not belong to the signed-in account.")
        }

        let uri = update.roll.rawValue
        let snapshot = try await store.snapshot()
        let cached = snapshot.records.first { $0.uri == uri }
        let hasPendingWrite =
            cached?.pendingOperationID != nil
            || snapshot.outbox.contains { $0.uri == uri }
            || snapshot.conflicts.contains { $0.operation.uri == uri }

        if hasPendingWrite {
            if let cached,
                try FilmRollLifecycleRecordMerger.merge(record: cached.value, update: update)
                    == cached.value
            {
                return
            }
            throw LoggerError.write("Finish syncing this roll before changing its dates.")
        }

        if let cached, let cid = cached.cid {
            try await enqueueMerged(cached.value, cid: cid, rkey: rkey, uri: uri, update: update)
            return
        }

        let hydrated = try await hydrator.get(
            RecordHydrationRequest(
                repo: repo,
                collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
                rkey: rkey
            )
        )
        guard hydrated.uri == uri else {
            throw LoggerError.write("The personal data server returned a different roll.")
        }
        try await enqueueMerged(
            hydrated.value,
            cid: hydrated.cid,
            rkey: rkey,
            uri: uri,
            update: update
        )
    }

    private func enqueueMerged(
        _ record: Data,
        cid: String?,
        rkey: String,
        uri: String,
        update: FilmRollLifecycleUpdate
    ) async throws {
        let merged = try FilmRollLifecycleRecordMerger.merge(record: record, update: update)
        guard merged != record else { return }
        _ = try await engine.enqueuePut(
            repo: repo,
            collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
            rkey: rkey,
            uri: uri,
            record: merged,
            swapRecord: cid
        )
    }
}
