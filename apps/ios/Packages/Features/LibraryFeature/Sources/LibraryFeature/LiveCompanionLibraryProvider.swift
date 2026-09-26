import CatalogKit
import Foundation
import HypoLexicon
import LoggerFeature
import PersistenceKit
import SyncKit

public struct CompanionLibrarySnapshot: Sendable {
    public let items: [LibraryItem]
    public let activeRolls: [ActiveRoll]
    public let warnings: [LibraryDataWarning]

    public init(
        items: [LibraryItem],
        activeRolls: [ActiveRoll],
        warnings: [LibraryDataWarning] = []
    ) {
        self.items = items
        self.activeRolls = activeRolls
        self.warnings = warnings
    }
}

/// Hydrates the signed-in user's companion records, commits complete collection pages to the
/// local persistence store, and projects only schema-valid records into the read-only library.
/// A failed collection refresh retains its last valid local records.
public actor LiveCompanionLibraryProvider: LibraryProviding, ActiveRollProviding {
    private let repo: String
    private let hydrator: any RecordHydrating
    private let store: any PersistenceStore
    private var loadedSnapshot: CompanionLibrarySnapshot?

    public init(
        repo: String,
        hydrator: any RecordHydrating,
        store: any PersistenceStore
    ) {
        self.repo = repo
        self.hydrator = hydrator
        self.store = store
    }

    public func items() async throws -> [LibraryItem] {
        try await refresh().items
    }

    public func activeRolls() async throws -> [ActiveRoll] {
        try await snapshot().activeRolls
    }

    public func warnings() async -> [LibraryDataWarning] {
        (try? await snapshot().warnings) ?? []
    }

    public func snapshot() async throws -> CompanionLibrarySnapshot {
        if let loadedSnapshot { return loadedSnapshot }
        return try await refresh()
    }

    @discardableResult
    public func refresh() async throws -> CompanionLibrarySnapshot {
        var warnings: [LibraryDataWarning] = []
        let before = try await store.snapshot()
        let outcomes = await hydrateCollections()
        var mutations: [PersistenceMutation] = []

        for outcome in outcomes {
            if let failure = outcome.failure {
                warnings.append(
                    LibraryDataWarning(
                        collection: outcome.collection,
                        message: "Could not refresh \(Self.collectionLabel(outcome.collection)): \(failure)"
                    )
                )
                continue
            }

            let receivedURIs = Set(outcome.records.map(\.uri))
            let pendingURIs = Set(
                before.records.lazy
                    .filter { $0.collection == outcome.collection && $0.pendingOperationID != nil }
                    .map(\.uri)
            )
            for cached in before.records where cached.collection == outcome.collection {
                guard cached.uri.hasPrefix("at://\(repo)/") else { continue }
                guard cached.pendingOperationID == nil else { continue }
                if !receivedURIs.contains(cached.uri) {
                    mutations.append(.removeRecord(uri: cached.uri))
                }
            }
            mutations.append(
                contentsOf: outcome.records.compactMap { remote in
                    guard !pendingURIs.contains(remote.uri) else { return nil }
                    return .upsertRecord(remote.cached())
                }
            )
        }

        if !mutations.isEmpty {
            do {
                try await store.apply(mutations)
            } catch {
                warnings.append(
                    LibraryDataWarning(message: "Could not update the saved library: \(error)")
                )
            }
        }

        let persisted = try await store.snapshot()
        let projection = try await Self.project(
            snapshot: persisted,
            repo: repo,
            initialWarnings: warnings
        )
        loadedSnapshot = projection
        return projection
    }

    public func invalidate() {
        loadedSnapshot = nil
    }

    private func hydrateCollections() async -> [HydrationOutcome] {
        await withTaskGroup(of: HydrationOutcome.self, returning: [HydrationOutcome].self) {
            group in
            for collection in Self.collections {
                group.addTask { [repo, hydrator] in
                    await Self.hydrate(collection: collection, repo: repo, with: hydrator)
                }
            }
            var outcomes: [HydrationOutcome] = []
            for await outcome in group {
                outcomes.append(outcome)
            }
            return outcomes.sorted { $0.collection < $1.collection }
        }
    }

    private static func hydrate(
        collection: String,
        repo: String,
        with hydrator: any RecordHydrating
    ) async -> HydrationOutcome {
        var records: [HydratedRepositoryRecord] = []
        var cursor: String?
        var seenCursors = Set<String>()

        do {
            for _ in 0..<100 {
                let page = try await hydrator.list(
                    RecordListHydrationRequest(
                        repo: repo,
                        collection: collection,
                        limit: 100,
                        cursor: cursor
                    )
                )
                records.append(contentsOf: page.records)
                guard let next = page.cursor, !next.isEmpty else {
                    return HydrationOutcome(collection: collection, records: records)
                }
                guard seenCursors.insert(next).inserted else {
                    return HydrationOutcome(
                        collection: collection,
                        records: [],
                        failure: "The server repeated a page cursor."
                    )
                }
                cursor = next
            }
            return HydrationOutcome(
                collection: collection,
                records: [],
                failure: "The collection exceeded the safe page limit."
            )
        } catch {
            return HydrationOutcome(
                collection: collection,
                records: [],
                failure: String(describing: error)
            )
        }
    }

    private static func project(
        snapshot: PersistenceSnapshot,
        repo: String,
        initialWarnings: [LibraryDataWarning]
    ) async throws -> CompanionLibrarySnapshot {
        var warnings = initialWarnings
        let pendingRepos = Dictionary(
            uniqueKeysWithValues: snapshot.outbox.map { ($0.id, $0.repo) }
        )
        let records = snapshot.records.filter { record in
            record.uri.hasPrefix("at://\(repo)/")
                || record.pendingOperationID.flatMap { pendingRepos[$0] } == repo
        }
        let decoder = JSONDecoder()

        let cameraTypes: [String: AppGraycardCatalogCameraTypeMain] = decodedIndex(
            records,
            collection: GeneratedRecordNSID.catalogCameraType.rawValue,
            repo: repo,
            as: AppGraycardCatalogCameraTypeMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let lensTypes: [String: AppGraycardCatalogLensTypeMain] = decodedIndex(
            records,
            collection: GeneratedRecordNSID.catalogLensType.rawValue,
            repo: repo,
            as: AppGraycardCatalogLensTypeMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let filmStocks: [String: AppGraycardCatalogFilmStockMain] = decodedIndex(
            records,
            collection: GeneratedRecordNSID.catalogFilmStock.rawValue,
            repo: repo,
            as: AppGraycardCatalogFilmStockMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let chemistryTypes: [String: AppGraycardCatalogChemistryTypeMain] = decodedIndex(
            records,
            collection: GeneratedRecordNSID.catalogChemistryType.rawValue,
            repo: repo,
            as: AppGraycardCatalogChemistryTypeMain.self,
            decoder: decoder,
            warnings: &warnings
        )

        let cameras: [(CachedRecord, AppGraycardInstanceCameraMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceCamera.rawValue,
            as: AppGraycardInstanceCameraMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let lenses: [(CachedRecord, AppGraycardInstanceLensMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceLens.rawValue,
            as: AppGraycardInstanceLensMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let stockpiles: [(CachedRecord, AppGraycardInstanceFilmStockpileMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceFilmStockpile.rawValue,
            as: AppGraycardInstanceFilmStockpileMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let rolls: [(CachedRecord, AppGraycardInstanceFilmRollMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
            as: AppGraycardInstanceFilmRollMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let exposures: [(CachedRecord, AppGraycardInstanceExposureMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceExposure.rawValue,
            as: AppGraycardInstanceExposureMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let chemistry: [(CachedRecord, AppGraycardInstanceChemistryMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.instanceChemistry.rawValue,
            as: AppGraycardInstanceChemistryMain.self,
            decoder: decoder,
            warnings: &warnings
        )
        let recipes: [(CachedRecord, AppGraycardCatalogDevRecipeMain)] = decodedRecords(
            records,
            collection: GeneratedRecordNSID.catalogDevRecipe.rawValue,
            as: AppGraycardCatalogDevRecipeMain.self,
            decoder: decoder,
            warnings: &warnings
        )

        let cameraNames = Dictionary(
            uniqueKeysWithValues: cameras.map { record, camera in
                (
                    record.uri,
                    gearTitle(
                        nickname: camera.nickname,
                        typeLabel: cameraTypes[camera.type.rawValue].map(cameraLabel))
                )
            }
        )
        let highestLoggedFrameByRoll = exposures.reduce(into: [String: Int]()) {
            result,
            pair in
            let exposure = pair.1
            guard let roll = exposure.roll?.rawValue, let frame = exposure.frameNumber else {
                return
            }
            result[roll] = max(result[roll] ?? 0, frame)
        }

        var userItems: [LibraryItem] = []
        userItems.append(
            contentsOf: cameras.map { record, camera in
                let type = cameraTypes[camera.type.rawValue]
                let typeLabel = type.map(cameraLabel)
                return LibraryItem(
                    id: record.uri,
                    category: .cameras,
                    title: gearTitle(nickname: camera.nickname, typeLabel: typeLabel),
                    subtitle: gearSubtitle(
                        nickname: camera.nickname,
                        typeLabel: typeLabel,
                        serialNumber: camera.serialNumber
                    ),
                    detail: camera.notes,
                    imageURL: assetURL(type?.image),
                    webTarget: .gear(kind: "camera", recordKey: record.rkey)
                )
            })
        userItems.append(
            contentsOf: lenses.map { record, lens in
                let type = lensTypes[lens.type.rawValue]
                let typeLabel = type.map(lensLabel)
                return LibraryItem(
                    id: record.uri,
                    category: .lenses,
                    title: gearTitle(nickname: lens.nickname, typeLabel: typeLabel),
                    subtitle: gearSubtitle(
                        nickname: lens.nickname,
                        typeLabel: typeLabel,
                        serialNumber: lens.serialNumber
                    ),
                    detail: lens.notes,
                    imageURL: assetURL(type?.image),
                    webTarget: .gear(kind: "lens", recordKey: record.rkey)
                )
            })
        userItems.append(
            contentsOf: stockpiles.map { record, stockpile in
                let stock = filmStocks[stockpile.stock.rawValue]
                let label = stock.map(filmLabel) ?? "Film reserve"
                let format = stockpile.format?.rawValue
                let expiry = stockpile.expiresAt.map { "Expires \(dateLabel($0))" }
                let selection = projectedURI(for: record, repo: repo).map {
                    FilmStockpileSelection(
                        uri: $0,
                        label: label,
                        quantity: stockpile.quantity
                    )
                }
                return LibraryItem(
                    id: record.uri,
                    category: .film,
                    title: label,
                    subtitle: "\(stockpile.quantity) on hand",
                    detail: [format, expiry].compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
                    imageURL: assetURL(stock?.image),
                    fieldAction: selection.map(LibraryFieldAction.loadFilmRoll),
                    webTarget: .gear(kind: "filmStockpile", recordKey: record.rkey)
                )
            })
        userItems.append(
            contentsOf: rolls.map { record, roll in
                let stock = filmStocks[roll.stock.rawValue]
                let title = roll.label ?? roll.rollNumber.map { "Roll \($0)" } ?? "Film roll"
                let stockLabel = stock.map(filmLabel) ?? "Film stock not resolved"
                let status = roll.status.map { humanized($0.rawValue) }
                let derivedUsed = max(
                    roll.exposuresUsed ?? 0,
                    highestLoggedFrameByRoll[record.uri] ?? 0
                )
                let count =
                    (roll.exposuresUsed != nil || highestLoggedFrameByRoll[record.uri] != nil)
                    ? roll.exposuresTotal.map { "\(derivedUsed)/\($0) frames" }
                        ?? "\(derivedUsed) frames used"
                    : nil
                return LibraryItem(
                    id: record.uri,
                    category: .rolls,
                    title: title,
                    subtitle: stockLabel,
                    detail: [status, count].compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
                    imageURL: assetURL(stock?.image),
                    webTarget: .roll(recordKey: record.rkey)
                )
            })
        userItems.append(
            contentsOf: chemistry.map { record, chemical in
                let type = chemistryTypes[chemical.type.rawValue]
                let typeLabel = type.map(chemistryLabel) ?? "Photographic chemistry"
                let title = chemical.nickname ?? chemical.componentName ?? typeLabel
                let roles = type?.roles.map { humanized($0.rawValue) }.joined(separator: " + ")
                return LibraryItem(
                    id: record.uri,
                    category: .chemistry,
                    title: title,
                    subtitle: [chemical.nickname == nil ? nil : typeLabel, roles]
                        .compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
                    detail: [chemical.dilution, chemical.status.map { humanized($0.rawValue) }]
                        .compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
                    imageURL: assetURL(type?.image),
                    webTarget: .gear(kind: "chemistry", recordKey: record.rkey)
                )
            })
        userItems.append(
            contentsOf: recipes.map { record, recipe in
                let title =
                    "\(recipe.filmMake) \(recipe.filmName) in \(recipe.developerMake) \(recipe.developerName)"
                let firstPoint = recipe.temps.first
                let time = firstPoint.map { durationLabel($0.timeSec) }
                let temperature = firstPoint.map { temperatureLabel($0.tempC10) }
                return LibraryItem(
                    id: record.uri,
                    category: .recipes,
                    title: title,
                    subtitle: [recipe.dilution, temperature, time]
                        .compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
                    detail: recipe.notes,
                    provenance: "Your recipe",
                    webTarget: .library(tab: "darkroom")
                )
            })

        let activeRolls = rolls.compactMap { record, roll -> ActiveRoll? in
            guard isActive(roll) else { return nil }
            guard let uri = projectedURI(for: record, repo: repo) else {
                warnings.append(
                    LibraryDataWarning(
                        collection: record.collection,
                        message: "Skipped a pending roll without a stable record key."
                    )
                )
                return nil
            }
            let stock = filmStocks[roll.stock.rawValue]
            let cameraName = roll.camera.flatMap { cameraNames[$0.rawValue] }
            let exposuresUsed = max(
                roll.exposuresUsed ?? 0,
                highestLoggedFrameByRoll[uri.rawValue]
                    ?? highestLoggedFrameByRoll[record.uri]
                    ?? 0
            )
            return ActiveRoll(
                uri: uri,
                label: roll.label ?? roll.rollNumber.map { "Roll \($0)" } ?? "Film roll",
                stockName: stock.map(filmLabel) ?? "Film stock not resolved",
                exposureIndex: roll.shotAtIso ?? stock?.iso,
                exposuresTotal: roll.exposuresTotal ?? stock?.exposuresPerRoll,
                exposuresUsed: exposuresUsed,
                camera: roll.camera,
                cameraName: cameraName,
                milestones: FilmRollMilestones(
                    loadedAt: roll.loadedAt,
                    partialAt: roll.partialAt,
                    exposedAt: roll.exposedAt,
                    unloadedAt: roll.unloadedAt,
                    sentToLabAt: roll.sentToLabAt,
                    developmentStartedAt: roll.developmentStartedAt,
                    developedAt: roll.developedAt,
                    receivedFromLabAt: roll.receivedFromLabAt,
                    scannedAt: roll.scannedAt,
                    archivedAt: roll.archivedAt
                ),
                developmentLocation: developmentLocation(roll.developmentLocation)
            )
        }
        .sorted { left, right in
            if left.label == right.label { return left.uri.rawValue < right.uri.rawValue }
            return left.label.localizedStandardCompare(right.label) == .orderedAscending
        }

        let mergedItems = try await BundledCatalogLibraryProvider(userItems: userItems).items()
        return CompanionLibrarySnapshot(
            items: mergedItems,
            activeRolls: activeRolls,
            warnings: warnings
        )
    }

    private static func decodedIndex<T: Decodable>(
        _ records: [CachedRecord],
        collection: String,
        repo: String,
        as type: T.Type,
        decoder: JSONDecoder,
        warnings: inout [LibraryDataWarning]
    ) -> [String: T] {
        Dictionary(
            uniqueKeysWithValues: decodedRecords(
                records,
                collection: collection,
                as: type,
                decoder: decoder,
                warnings: &warnings
            ).map { record, value in
                (projectedURI(for: record, repo: repo)?.rawValue ?? record.uri, value)
            }
        )
    }

    private static func decodedRecords<T: Decodable>(
        _ records: [CachedRecord],
        collection: String,
        as _: T.Type,
        decoder: JSONDecoder,
        warnings: inout [LibraryDataWarning]
    ) -> [(CachedRecord, T)] {
        records.filter { $0.collection == collection }.compactMap { record in
            do {
                let nsid = try NSID(collection)
                let issues = try GeneratedLexiconValidator.validate(record.value, as: nsid)
                guard issues.isEmpty else {
                    warnings.append(
                        LibraryDataWarning(
                            collection: collection,
                            message: "Skipped \(record.rkey): \(issues[0].message)"
                        )
                    )
                    return nil
                }
                return (record, try decoder.decode(T.self, from: record.value))
            } catch {
                warnings.append(
                    LibraryDataWarning(
                        collection: collection,
                        message: "Skipped \(record.rkey): \(error)"
                    )
                )
                return nil
            }
        }
    }

    private static func projectedURI(for record: CachedRecord, repo: String) -> ATURI? {
        if let uri = try? ATURI(record.uri) { return uri }
        guard record.pendingOperationID != nil, !record.rkey.isEmpty else { return nil }
        return try? ATURI("at://\(repo)/\(record.collection)/\(record.rkey)")
    }

    private static func isActive(_ roll: AppGraycardInstanceFilmRollMain) -> Bool {
        if let status = roll.status?.rawValue {
            return status == AppGraycardDefsRollStatus.loaded.rawValue
                || status == AppGraycardDefsRollStatus.partial.rawValue
        }
        return roll.loadedAt != nil && roll.exposedAt == nil && roll.unloadedAt == nil
    }

    private static func cameraLabel(_ type: AppGraycardCatalogCameraTypeMain) -> String {
        "\(type.make) \(type.model)"
    }

    private static func lensLabel(_ type: AppGraycardCatalogLensTypeMain) -> String {
        [type.make, type.model].compactMap { $0 }.joined(separator: " ")
    }

    private static func filmLabel(_ stock: AppGraycardCatalogFilmStockMain) -> String {
        [stock.brand, stock.name].compactMap { $0 }.joined(separator: " ")
    }

    private static func chemistryLabel(_ type: AppGraycardCatalogChemistryTypeMain) -> String {
        [type.brand, type.name].compactMap { $0 }.joined(separator: " ")
    }

    private static func gearTitle(nickname: String?, typeLabel: String?) -> String {
        nickname ?? typeLabel ?? "Unresolved gear"
    }

    private static func gearSubtitle(
        nickname: String?,
        typeLabel: String?,
        serialNumber: String?
    ) -> String? {
        [nickname == nil ? nil : typeLabel, serialNumber.map { "Serial \($0)" }]
            .compactMap { $0 }.joined(separator: " · ").nilIfEmpty
    }

    private static func assetURL(_ asset: AppGraycardDefsAssetRef?) -> URL? {
        asset?.url.flatMap(URL.init(string:))
    }

    private static func developmentLocation(
        _ value: AppGraycardInstanceFilmRollMainDevelopmentLocation?
    ) -> FilmRollDevelopmentLocation? {
        value.flatMap { FilmRollDevelopmentLocation(rawValue: $0.rawValue) }
    }

    private static func temperatureLabel(_ celsiusTenths: Int) -> String {
        let value = Double(celsiusTenths) / 10
        return "\(value.formatted(.number.precision(.fractionLength(0...1)))) °C"
    }

    private static func durationLabel(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let remainder = seconds % 60
        if minutes == 0 { return "\(remainder)s" }
        if remainder == 0 { return "\(minutes)m" }
        return "\(minutes)m \(remainder)s"
    }

    private static func dateLabel(_ date: ATProtoDate) -> String {
        date.date.formatted(date: .abbreviated, time: .omitted)
    }

    private static func humanized(_ value: String) -> String {
        value.replacingOccurrences(of: "-", with: " ")
    }

    private static func collectionLabel(_ collection: String) -> String {
        collection.split(separator: ".").last.map(String.init) ?? collection
    }

    private static let collections = [
        GeneratedRecordNSID.catalogCameraType.rawValue,
        GeneratedRecordNSID.catalogChemistryType.rawValue,
        GeneratedRecordNSID.catalogDevRecipe.rawValue,
        GeneratedRecordNSID.catalogFilmStock.rawValue,
        GeneratedRecordNSID.catalogLensType.rawValue,
        GeneratedRecordNSID.instanceCamera.rawValue,
        GeneratedRecordNSID.instanceChemistry.rawValue,
        GeneratedRecordNSID.instanceExposure.rawValue,
        GeneratedRecordNSID.instanceFilmRoll.rawValue,
        GeneratedRecordNSID.instanceFilmStockpile.rawValue,
        GeneratedRecordNSID.instanceLens.rawValue,
    ]
}

private struct HydrationOutcome: Sendable {
    let collection: String
    let records: [HydratedRepositoryRecord]
    let failure: String?

    init(
        collection: String,
        records: [HydratedRepositoryRecord],
        failure: String? = nil
    ) {
        self.collection = collection
        self.records = records
        self.failure = failure
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
