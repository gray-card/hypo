import Foundation
import HypoLexicon
import PersistenceKit
import SyncKit

public protocol LibraryRecordKeyGenerating: Sendable {
    func nextRecordKey(at date: Date) async -> String
}

/// Generates lexicon `tid` record keys. The actor advances by one logical tick when two records
/// are reserved within the same microsecond, which keeps offline relationship URIs stable.
public actor TIDLibraryRecordKeyGenerator: LibraryRecordKeyGenerating {
    private static let alphabet = Array("234567abcdefghijklmnopqrstuvwxyz")

    private let clockID: UInt64
    private var lastValue: UInt64 = 0

    public init(clockID: UInt16 = UInt16.random(in: 0..<1_024)) {
        precondition(clockID < 1_024)
        self.clockID = UInt64(clockID)
    }

    public func nextRecordKey(at date: Date) -> String {
        let microseconds = UInt64(max(0, date.timeIntervalSince1970 * 1_000_000))
        let physicalValue = (microseconds << 10) | clockID
        let value = max(physicalValue, lastValue &+ 1)
        lastValue = value

        var remainder = value
        var characters = Array(repeating: Character("2"), count: 13)
        for index in characters.indices.reversed() {
            characters[index] = Self.alphabet[Int(remainder & 31)]
            remainder >>= 5
        }
        return String(characters)
    }
}

/// Durable, offline-first implementation of LibraryFeature's two supported field workflows.
/// The writer resolves the current account for every call rather than retaining an expired token.
public actor QueuedLibraryFieldWriter: LibraryFieldSemanticWriting {
    private let engine: SyncEngine
    private let store: any PersistenceStore
    private let hydrator: any RecordHydrating
    private let sessionProvider: any SyncOAuthSessionProviding
    private let recordKeyGenerator: any LibraryRecordKeyGenerating

    public init(
        engine: SyncEngine,
        store: any PersistenceStore,
        hydrator: any RecordHydrating,
        sessionProvider: any SyncOAuthSessionProviding,
        recordKeyGenerator: any LibraryRecordKeyGenerating = TIDLibraryRecordKeyGenerator()
    ) {
        self.engine = engine
        self.store = store
        self.hydrator = hydrator
        self.sessionProvider = sessionProvider
        self.recordKeyGenerator = recordKeyGenerator
    }

    public func loadFilmRoll(_ request: FilmRollLoadRequest) async throws
        -> LibraryFieldWriteReceipt
    {
        try LibraryFieldRequestValidator.validate(request)
        let repo = try await sessionProvider.session().subject
        guard request.stockpile.uri.authority == repo,
            let stockpileKey = request.stockpile.uri.recordKey
        else { throw LibraryFieldError.invalidStockpile }

        let stockpile = try await stockpileRecord(
            uri: request.stockpile.uri,
            repo: repo,
            rkey: stockpileKey
        )
        guard let stockpileCID = stockpile.cid else {
            throw LibraryFieldError.invalidRecord("The film reserve has no revision identifier.")
        }
        let records = try LibraryFieldRecordEncoder.filmRollLoadRecords(
            stockpileRecord: stockpile.value,
            request: request
        )
        let rollKey = await recordKeyGenerator.nextRecordKey(at: request.loadedAt)
        let rollURI = try ATURI(
            "at://\(repo)/\(GeneratedRecordNSID.instanceFilmRoll.rawValue)/\(rollKey)"
        )

        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
            rkey: rollKey,
            record: records.roll,
            now: request.loadedAt
        )
        _ = try await engine.enqueuePut(
            repo: repo,
            collection: GeneratedRecordNSID.instanceFilmStockpile.rawValue,
            rkey: stockpileKey,
            uri: request.stockpile.uri.rawValue,
            record: records.updatedStockpile,
            swapRecord: stockpileCID,
            now: request.loadedAt.addingTimeInterval(0.000_001)
        )
        return LibraryFieldWriteReceipt(createdRecord: rollURI, acceptedAt: request.loadedAt)
    }

    public func quickAddGear(_ request: GearQuickAddRequest) async throws
        -> LibraryFieldWriteReceipt
    {
        try LibraryFieldRequestValidator.validate(request)
        let repo = try await sessionProvider.session().subject
        let snapshot = try await store.snapshot()
        let existingType = existingTypeURI(for: request.selection, repo: repo, snapshot: snapshot)

        let typeURI: ATURI
        let typeKey: String?
        if let existingType {
            typeURI = existingType
            typeKey = nil
        } else {
            let reservedKey = await recordKeyGenerator.nextRecordKey(at: request.createdAt)
            typeURI = try ATURI(
                "at://\(repo)/\(request.selection.kind.catalogCollection.rawValue)/\(reservedKey)"
            )
            typeKey = reservedKey
        }

        let records = try LibraryFieldRecordEncoder.gearQuickAddRecords(
            request: request,
            catalogTypeURI: typeURI
        )
        if let typeKey {
            _ = try await engine.enqueueCreate(
                repo: repo,
                collection: request.selection.kind.catalogCollection.rawValue,
                rkey: typeKey,
                record: records.catalogType,
                now: request.createdAt
            )
        }

        let instanceKey = await recordKeyGenerator.nextRecordKey(at: request.createdAt)
        let instanceURI = try ATURI(
            "at://\(repo)/\(request.selection.kind.instanceCollection.rawValue)/\(instanceKey)"
        )
        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: request.selection.kind.instanceCollection.rawValue,
            rkey: instanceKey,
            record: records.instance,
            now: typeKey == nil
                ? request.createdAt
                : request.createdAt.addingTimeInterval(0.000_001)
        )
        return LibraryFieldWriteReceipt(createdRecord: instanceURI, acceptedAt: request.createdAt)
    }

    private func stockpileRecord(
        uri: ATURI,
        repo: String,
        rkey: String
    ) async throws -> HydratedRepositoryRecord {
        let snapshot = try await store.snapshot()
        if let cached = snapshot.records.first(where: { $0.uri == uri.rawValue }) {
            let pending =
                cached.pendingOperationID != nil
                || snapshot.outbox.contains { $0.uri == uri.rawValue }
                || snapshot.conflicts.contains { $0.operation.uri == uri.rawValue }
            guard !pending else { throw LibraryFieldError.pendingRecord }
            if cached.cid != nil {
                return HydratedRepositoryRecord(
                    uri: cached.uri,
                    cid: cached.cid,
                    collection: cached.collection,
                    rkey: cached.rkey,
                    value: cached.value
                )
            }
        }

        let hydrated = try await hydrator.get(
            RecordHydrationRequest(
                repo: repo,
                collection: GeneratedRecordNSID.instanceFilmStockpile.rawValue,
                rkey: rkey
            )
        )
        guard hydrated.uri == uri.rawValue else { throw LibraryFieldError.invalidStockpile }
        return hydrated
    }

    private func existingTypeURI(
        for selection: CatalogGearSelection,
        repo: String,
        snapshot: PersistenceSnapshot
    ) -> ATURI? {
        let pendingRepos = Dictionary(
            uniqueKeysWithValues: snapshot.outbox.map { ($0.id, $0.repo) }
        )
        for record in snapshot.records
        where record.collection == selection.kind.catalogCollection.rawValue {
            let belongsToRepo =
                record.uri.hasPrefix("at://\(repo)/")
                || record.pendingOperationID.flatMap { pendingRepos[$0] } == repo
            guard belongsToRepo,
                normalizedLabel(catalogLabel(record.value, kind: selection.kind))
                    == normalizedLabel(selection.label)
            else {
                continue
            }
            if let uri = try? ATURI(record.uri) { return uri }
            return try? ATURI("at://\(repo)/\(record.collection)/\(record.rkey)")
        }
        return nil
    }

    private func catalogLabel(_ data: Data, kind: LibraryGearKind) -> String? {
        switch kind {
        case .camera:
            guard
                let value = try? JSONDecoder().decode(
                    AppGraycardCatalogCameraTypeMain.self,
                    from: data
                )
            else { return nil }
            return "\(value.make) \(value.model)"
        case .lens:
            guard
                let value = try? JSONDecoder().decode(
                    AppGraycardCatalogLensTypeMain.self,
                    from: data
                )
            else { return nil }
            return [value.make, value.model].compactMap { $0 }.joined(separator: " ")
        }
    }

    private func normalizedLabel(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
