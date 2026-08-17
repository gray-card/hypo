import ATProtoClient
import BackgroundTasks
@preconcurrency import CoreLocation
import Darwin
import DiagnosticsKit
import Foundation
import HypoLexicon
import LoggerFeature
import LibraryFeature
import MeterEngine
import MeterFeature
import Observation
import PanprotoKit
import PersistenceKit
import SettingsFeature
import SyncKit
import SyncStatusFeature
import SystemIntegrationKit
import TimerFeature
import UIKit

#if canImport(WidgetKit)
    import WidgetKit
#endif

/// Replaceable account context shared by the app shell and the future live sync transport.
@MainActor
@Observable
final class AppAuthenticationState {
    private(set) var session: OAuthSession?
    private(set) var pdsURL: URL?

    func replace(with session: OAuthSession?) {
        self.session = session
        pdsURL = session?.pdsURL
    }
}

/// Services assembled once at the application boundary.
struct AppDependencies: Sendable {
    let schemaChecker: any PanprotoSchemaChecking
    let persistenceStore: any PersistenceStore
    let syncEngine: SyncEngine
    let persistenceIsDurable: Bool
    let diagnosticsRecorder: any DiagnosticsRecording
    let authenticationClient: any SettingsAuthenticationClient
    let authenticationSessionID: OAuthSessionID
    let authenticationState: AppAuthenticationState
    let meterStateStore: any HeldReadingStoring & CalibrationProfileStoring & MeterReadingLogStoring
    let privateMeterCaptureStore: any PrivateMeterCaptureContextStoring
    let privateMeterCaptureSettingsStore: any PrivateMeterCaptureSettingsStoring
    let timerStateStore: any TimerFeatureSessionStoring
    let syncSessionProvider: any SyncOAuthSessionProviding
    let recordHydrator: any RecordHydrating
    let syncConnectivityMonitor: (any SyncConnectivityMonitoring)?

    @MainActor
    static func makeLive() -> AppDependencies {
        let store: any PersistenceStore
        let persistenceIsDurable: Bool
        if let baseURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first,
            let durableStore = try? SwiftDataPersistenceStore(
                storeURL: baseURL.appending(path: "Hypo/Persistence.store")
            )
        {
            store = durableStore
            persistenceIsDurable = true
        } else {
            store = InMemoryPersistenceStore()
            persistenceIsDurable = false
        }

        let authenticationState = AppAuthenticationState()
        let diagnosticsFileURL =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appending(path: "Hypo/Diagnostics/events.json")
            ?? FileManager.default.temporaryDirectory.appending(
                path: "Hypo/Diagnostics/events.json"
            )
        let diagnosticsRecorder = LocalDiagnosticsRecorder(
            fileURL: diagnosticsFileURL,
            applicationVersion: {
                Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
                    ?? "Unknown"
            },
            operatingSystem: { ProcessInfo.processInfo.operatingSystemVersionString }
        )
        let meterStateStore: any HeldReadingStoring & CalibrationProfileStoring & MeterReadingLogStoring
        let timerStateStore: any TimerFeatureSessionStoring
        let privateMeterCaptureStore: any PrivateMeterCaptureContextStoring
        let privateMeterCaptureSettingsStore: any PrivateMeterCaptureSettingsStoring
        if let baseURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first {
            meterStateStore = FileMeterFeatureStateStore(
                fileURL: baseURL.appending(path: "Hypo/MeterFeatureState.json")
            )
            timerStateStore = FileTimerFeatureSessionStore(
                fileURL: baseURL.appending(path: "Hypo/TimerFeatureSession.json")
            )
            privateMeterCaptureStore = EncryptedPrivateMeterCaptureContextStore(
                fileURL: baseURL.appending(path: "Hypo/PrivateMeterCaptureContexts.json"),
                keyProvider: LocalKeychainPrivateMeterCaptureKeyProvider(),
                cloudKeyProvider: SynchronizableKeychainPrivateMeterCaptureKeyProvider(),
                cloud: CloudKitPrivateMeterCaptureSync()
            )
            privateMeterCaptureSettingsStore = FilePrivateMeterCaptureSettingsStore(
                fileURL: baseURL.appending(path: "Hypo/PrivateMeterCaptureSettings.json")
            )
        } else {
            meterStateStore = InMemoryMeterFeatureStateStore()
            timerStateStore = InMemoryTimerFeatureSessionStore()
            privateMeterCaptureStore = InMemoryPrivateMeterCaptureContextStore()
            privateMeterCaptureSettingsStore = InMemoryPrivateMeterCaptureSettingsStore()
        }
        let sessionStore = KeychainOAuthSessionStore(
            service: "app.graycard.hypo.oauth"
        )
        let keyCustody = KeychainDPoPKeyCustody(
            service: "app.graycard.hypo.dpop"
        )
        let browser = ASWebAuthenticationSessionPresenter {
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
            guard let window = windows.first(where: \.isKeyWindow) ?? windows.first else {
                preconditionFailure("Hypo needs a foreground window to present account sign-in")
            }
            return window
        }
        let authenticationClient = OAuthFlowCoordinator(
            configuration: OAuthFlowConfiguration(
                clientID: HypoOAuthConfiguration.clientID,
                redirectURI: HypoOAuthConfiguration.redirectURI,
                scope: HypoOAuthConfiguration.scope
            ),
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody
        )

        let primarySessionID = OAuthSessionID(rawValue: "primary-account")
        let sessionProvider = StoredSyncOAuthSessionProvider(
            store: sessionStore,
            id: primarySessionID
        )
        let liveTransport = SessionAwareSyncTransport(
            sessionProvider: sessionProvider,
            keyCustody: keyCustody,
            authenticationClient: authenticationClient,
            sessionID: primarySessionID
        )
        let refreshingSessionProvider = RefreshingSyncOAuthSessionProvider(
            stored: sessionProvider,
            authenticationClient: authenticationClient,
            sessionID: primarySessionID
        )
        let nativeRecordHydrator = ATProtoRecordHydrator(
            repository: SessionAwareRepositoryGateway(keyCustody: keyCustody),
            sessionProvider: refreshingSessionProvider
        )
        // `lexicons-v1` is the first released suite, so this build has no historical transition
        // artifact. The production boundary is nevertheless version-aware: current records take
        // the generated-validator fast path, while a non-current record is rejected with a typed
        // failure until a reviewed Panproto chain is registered in a later release.
        let panproto = PanprotoProductionComposition(
            nativeHydrator: nativeRecordHydrator,
            transport: liveTransport,
            store: store,
            registry: PanprotoMigrationRegistry(
                currentReleaseLabel: LexiconRelease.schemaTag,
                registrations: []
            )
        )
        let syncEngine = SyncEngine(store: store, transport: panproto.transport)

        return AppDependencies(
            schemaChecker: PanprotoSchemaInspector(),
            persistenceStore: store,
            syncEngine: syncEngine,
            persistenceIsDurable: persistenceIsDurable,
            diagnosticsRecorder: diagnosticsRecorder,
            authenticationClient: authenticationClient,
            authenticationSessionID: primarySessionID,
            authenticationState: authenticationState,
            meterStateStore: meterStateStore,
            privateMeterCaptureStore: privateMeterCaptureStore,
            privateMeterCaptureSettingsStore: privateMeterCaptureSettingsStore,
            timerStateStore: timerStateStore,
            // Queueing a local write needs only the account DID. Using the stored session here
            // keeps enqueue offline-first even when its access token has expired; the transport
            // refreshes immediately before the eventual remote write.
            syncSessionProvider: sessionProvider,
            recordHydrator: panproto.hydrator,
            syncConnectivityMonitor: NWPathSyncConnectivityMonitor()
        )
    }
}

private struct RefreshingSyncOAuthSessionProvider: SyncOAuthSessionProviding {
    let stored: any SyncOAuthSessionProviding
    let authenticationClient: any SettingsAuthenticationClient
    let sessionID: OAuthSessionID

    func session() async throws -> OAuthSession {
        let session = try await stored.session()
        guard let expiresAt = session.expiresAt,
            expiresAt <= Date().addingTimeInterval(30)
        else {
            return session
        }
        return try await authenticationClient.refresh(sessionID: sessionID)
    }
}

private struct SessionAwareRepositoryGateway: ATProtoRepositoryAccessing {
    let keyCustody: any DPoPKeyCustody

    func putRecord(
        _ request: PutRecordRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryWriteReceipt {
        try await gateway(for: session).putRecord(request, session: session)
    }

    func deleteRecord(_ request: DeleteRecordRequest, session: OAuthSession) async throws {
        try await gateway(for: session).deleteRecord(request, session: session)
    }

    func getRecord(
        _ request: GetRecordRequest,
        session: OAuthSession
    ) async throws -> RepositoryRecord {
        try await gateway(for: session).getRecord(request, session: session)
    }

    func listRecords(
        _ request: ListRecordsRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryPage {
        try await gateway(for: session).listRecords(request, session: session)
    }

    private func gateway(for session: OAuthSession) async throws
        -> ATProtoRepositoryClientGateway
    {
        guard let pdsURL = session.pdsURL else {
            throw SyncTransportError.permanent(message: "The saved session has no PDS endpoint.")
        }
        guard let key = try await keyCustody.load(sessionID: session.id) else {
            throw SyncTransportError.permanent(message: "The saved session has no DPoP key.")
        }
        let transport = DPoPAuthenticatedTransport(
            transport: URLSessionHTTPTransport(),
            signer: DPoPRequestSigner(proofGenerator: DPoPProofGenerator(privateKey: key))
        )
        return ATProtoRepositoryClientGateway(
            client: RepositoryClient(serviceURL: pdsURL, transport: transport)
        )
    }
}

private actor QueuedDevelopmentSessionWriter: DevelopmentSessionWriting {
    private static let collection = "app.graycard.process.developSession"

    let engine: SyncEngine
    let store: any PersistenceStore
    let sessionProvider: any SyncOAuthSessionProviding

    init(
        engine: SyncEngine,
        store: any PersistenceStore,
        sessionProvider: any SyncOAuthSessionProviding
    ) {
        self.engine = engine
        self.store = store
        self.sessionProvider = sessionProvider
    }

    func writeDevelopmentSession(record: Data, idempotencyKey: String) async throws -> ATURI {
        let session = try await sessionProvider.session()
        let repo = session.subject
        let uri = try ATURI("at://\(repo)/\(Self.collection)/\(idempotencyKey)")
        let snapshot = try await store.snapshot()

        if let operation = snapshot.outbox.first(where: {
            $0.kind == .create
                && $0.repo == repo
                && $0.collection == Self.collection
                && $0.rkey == idempotencyKey
        }) {
            guard operation.record == record else {
                throw TimerFeatureError.completion(
                    "The queued development session key belongs to different data."
                )
            }
            return uri
        }
        if let cached = snapshot.records.first(where: {
            $0.uri == uri.rawValue
                || ($0.collection == Self.collection && $0.rkey == idempotencyKey)
        }) {
            guard cached.value == record else {
                throw TimerFeatureError.completion(
                    "The development session key already belongs to a different record."
                )
            }
            return uri
        }

        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: Self.collection,
            rkey: idempotencyKey,
            record: record
        )
        return uri
    }
}

private actor HydratingFilmRollDevelopmentAdvancer: FilmRollDevelopmentAdvancing {
    let engine: SyncEngine
    let store: any PersistenceStore
    let sessionProvider: any SyncOAuthSessionProviding
    let hydrator: any RecordHydrating

    init(
        engine: SyncEngine,
        store: any PersistenceStore,
        sessionProvider: any SyncOAuthSessionProviding,
        hydrator: any RecordHydrating
    ) {
        self.engine = engine
        self.store = store
        self.sessionProvider = sessionProvider
        self.hydrator = hydrator
    }

    func advanceFilmRoll(_ request: FilmRollDevelopmentAdvanceRequest) async throws {
        guard let collection = request.roll.collection?.rawValue,
            let rkey = request.roll.recordKey
        else {
            throw TimerFeatureError.completion("The linked film roll URI is incomplete.")
        }
        let session = try await sessionProvider.session()
        guard request.roll.authority == session.subject else {
            throw TimerFeatureError.completion(
                "A development session can update only a film roll in the signed-in repository."
            )
        }

        let snapshot = try await store.snapshot()
        if snapshot.outbox.contains(where: { $0.uri == request.roll.rawValue }),
            let cached = snapshot.records.first(where: { $0.uri == request.roll.rawValue })
        {
            let merged = try FilmRollDevelopmentRecordMerger.merge(
                record: cached.value,
                request: request
            )
            guard merged == cached.value else {
                throw TimerFeatureError.completion(
                    "Finish syncing the film roll before recording its development."
                )
            }
            return
        }

        let hydrated = try await hydrator.get(
            RecordHydrationRequest(
                repo: request.roll.authority,
                collection: collection,
                rkey: rkey
            )
        )
        guard hydrated.uri == request.roll.rawValue else {
            throw TimerFeatureError.completion(
                "The personal data server returned a different film roll."
            )
        }
        let merged = try FilmRollDevelopmentRecordMerger.merge(
            record: hydrated.value,
            request: request
        )
        guard merged != hydrated.value else { return }
        _ = try await engine.enqueuePut(
            repo: request.roll.authority,
            collection: collection,
            rkey: rkey,
            uri: request.roll.rawValue,
            record: merged,
            swapRecord: hydrated.cid
        )
    }
}

private actor PersonalPDSDevelopmentRecipeProvider: DevelopmentRecipeProviding {
    private static let collection = "app.graycard.catalog.devRecipe"

    let store: any PersistenceStore
    let sessionProvider: any SyncOAuthSessionProviding
    let hydrator: any RecordHydrating

    init(
        store: any PersistenceStore,
        sessionProvider: any SyncOAuthSessionProviding,
        hydrator: any RecordHydrating
    ) {
        self.store = store
        self.sessionProvider = sessionProvider
        self.hydrator = hydrator
    }

    func recipes() async throws -> [DevelopmentRecipeSelection] {
        let session = try await sessionProvider.session()
        var cursor: String?
        var records: [HydratedRepositoryRecord] = []
        repeat {
            let page = try await hydrator.list(
                RecordListHydrationRequest(
                    repo: session.subject,
                    collection: Self.collection,
                    limit: 100,
                    cursor: cursor
                )
            )
            records.append(contentsOf: page.records)
            guard page.cursor != cursor else { break }
            cursor = page.cursor
        } while cursor != nil

        let pendingURIs = Set(
            try await store.snapshot().records.compactMap {
                $0.pendingOperationID == nil ? nil : $0.uri
            }
        )
        let cacheMutations =
            records
            .filter { !pendingURIs.contains($0.uri) }
            .map { PersistenceMutation.upsertRecord($0.cached()) }
        if !cacheMutations.isEmpty { try await store.apply(cacheMutations) }

        return try records.flatMap { record -> [DevelopmentRecipeSelection] in
            guard let uri = try? ATURI(record.uri) else { return [] }
            return try DevelopmentRecipeDecoder.selections(
                record: record.value,
                uri: uri,
                origin: .personalDataServer,
                sourceLabel: "Your personal data server"
            )
        }
    }
}

private struct SessionAwareSyncTransport: SyncTransport {
    let sessionProvider: any SyncOAuthSessionProviding
    let keyCustody: any DPoPKeyCustody
    let authenticationClient: any SettingsAuthenticationClient
    let sessionID: OAuthSessionID

    func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult {
        var session: OAuthSession
        do {
            session = try await sessionProvider.session()
        } catch {
            throw SyncTransportError.deferred(
                message: "Sign in to the operation's account before syncing it."
            )
        }
        guard session.subject == operation.repo else {
            throw SyncTransportError.deferred(
                message: "This operation belongs to a different signed-in account."
            )
        }
        if let expiresAt = session.expiresAt,
            expiresAt <= Date().addingTimeInterval(30)
        {
            do {
                session = try await authenticationClient.refresh(sessionID: sessionID)
            } catch {
                throw SyncTransportError.transient(
                    message: "The account session could not be refreshed before syncing."
                )
            }
        }
        guard let pdsURL = session.pdsURL else {
            throw SyncTransportError.permanent(message: "The saved session has no PDS endpoint.")
        }
        guard let key = try await keyCustody.load(sessionID: session.id) else {
            throw SyncTransportError.permanent(message: "The saved session has no DPoP key.")
        }
        let authenticatedTransport = DPoPAuthenticatedTransport(
            transport: URLSessionHTTPTransport(),
            signer: DPoPRequestSigner(proofGenerator: DPoPProofGenerator(privateKey: key))
        )
        let client = RepositoryClient(
            serviceURL: pdsURL,
            transport: authenticatedTransport
        )
        return try await ATProtoSyncTransport(
            client: client,
            sessionProvider: FixedSyncOAuthSessionProvider(session)
        ).execute(operation)
    }
}

private struct QueuedExposureWriter: ExposureWriting {
    let engine: SyncEngine
    let repo: String

    func createExposure(record: Data) async throws {
        let rkey = UUID().uuidString.lowercased()
        try await engine.enqueueCreate(
            repo: repo,
            collection: GraycardNSID.exposure.rawValue,
            rkey: rkey,
            record: record
        )
    }
}

private actor HydratingFrameDetailStore: FrameDetailStoring {
    private static let exposureCollection = "app.graycard.instance.exposure"
    private static let shootCollection = "app.graycard.session.capture"
    private static let editableExposureKeys: Set<String> = [
        "$type", "shoot", "roll", "frameNumber", "multipleExposure",
        "frameExposureIndex", "camera", "lens", "aperture", "shutterSpeed",
        "meterReadings", "shotAtIso", "location", "takenAt", "note", "createdAt",
        "updatedAt",
    ]

    let repo: String
    let engine: SyncEngine
    let store: any PersistenceStore
    let hydrator: any RecordHydrating

    init(
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

    func frames(roll: ATURI) async throws -> [FrameSummary] {
        let details = try await exposureDetails(roll: roll, frameNumber: nil)
        return Dictionary(grouping: details, by: { $0.draft.frameNumber })
            .map { frameNumber, exposures in
                let latest = exposures.max {
                    ($0.takenAt?.date ?? $0.createdAt.date)
                        < ($1.takenAt?.date ?? $1.createdAt.date)
                }
                return FrameSummary(
                    frameNumber: frameNumber,
                    exposureCount: exposures.count,
                    latestTakenAt: latest?.takenAt ?? latest?.createdAt,
                    aperture: latest?.draft.aperture,
                    shutterSpeed: latest?.draft.shutterSpeed
                )
            }
            .sorted { $0.frameNumber < $1.frameNumber }
    }

    func exposures(roll: ATURI, frameNumber: Int) async throws -> [ExposureDetail] {
        try await exposureDetails(roll: roll, frameNumber: frameNumber)
    }

    func shoots() async throws -> [ShootAssociation] {
        _ = try? await refresh(collection: Self.shootCollection)
        let records = try await indexedRecords(collection: Self.shootCollection)
        return records.compactMap { indexed in
            guard
                let record = try? JSONDecoder().decode(
                    AppGraycardSessionCaptureMain.self,
                    from: indexed.value
                ),
                let uri = try? ATURI(indexed.uri)
            else { return nil }
            return ShootAssociation(uri: uri, label: record.label)
        }
        .sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
    }

    func updateExposure(uri: ATURI, record: Data) async throws {
        guard uri.authority == repo,
            uri.collection?.rawValue == Self.exposureCollection,
            let rkey = uri.recordKey
        else {
            throw LoggerError.write("The exposure does not belong to the signed-in account.")
        }

        let snapshot = try await store.snapshot()
        guard !snapshot.conflicts.contains(where: { $0.operation.uri == uri.rawValue }) else {
            throw LoggerError.write("Resolve the exposure's sync conflict before editing it.")
        }

        if var pending = snapshot.outbox.first(where: {
            $0.repo == repo && $0.collection == Self.exposureCollection && $0.rkey == rkey
        }), let original = pending.record {
            let merged = try mergeExposure(original: original, proposed: record)
            pending.record = merged
            pending.updatedAt = Date()
            var mutations: [PersistenceMutation] = [.updateOutbox(pending)]
            if var cached = snapshot.records.first(where: {
                $0.pendingOperationID == pending.id
            }) {
                cached.value = merged
                cached.cachedAt = Date()
                mutations.append(.upsertRecord(cached))
            }
            try await store.apply(mutations)
            return
        }

        let local = snapshot.records.first(where: { $0.uri == uri.rawValue })
        var current: HydratedRepositoryRecord
        do {
            current = try await hydrator.get(
                RecordHydrationRequest(
                    repo: repo,
                    collection: Self.exposureCollection,
                    rkey: rkey,
                    cid: local?.cid
                )
            )
            try await store.apply([.upsertRecord(current.cached())])
        } catch {
            guard let local else {
                throw LoggerError.write("The complete exposure record is not available offline.")
            }
            current = HydratedRepositoryRecord(
                uri: local.uri,
                cid: local.cid,
                collection: local.collection,
                rkey: local.rkey,
                value: local.value
            )
        }
        let merged = try mergeExposure(original: current.value, proposed: record)
        _ = try await engine.enqueuePut(
            repo: repo,
            collection: Self.exposureCollection,
            rkey: rkey,
            uri: uri.rawValue,
            record: merged,
            swapRecord: current.cid
        )
    }

    private func exposureDetails(roll: ATURI, frameNumber: Int?) async throws
        -> [ExposureDetail]
    {
        _ = try? await refresh(collection: Self.exposureCollection)
        let records = try await indexedRecords(collection: Self.exposureCollection)
        return records.compactMap { indexed in
            guard
                let record = try? JSONDecoder().decode(
                    AppGraycardInstanceExposureMain.self,
                    from: indexed.value
                ),
                record.roll == roll,
                frameNumber == nil || record.frameNumber == frameNumber,
                let frame = record.frameNumber,
                let uri = try? ATURI(indexed.uri)
            else { return nil }
            return ExposureDetail(
                uri: uri,
                draft: ExposureDraft(
                    roll: roll,
                    frameNumber: frame,
                    shoot: record.shoot,
                    aperture: record.aperture ?? "5.6",
                    shutterSpeed: record.shutterSpeed ?? "1/125",
                    camera: record.camera,
                    lens: record.lens,
                    shotAtISO: record.shotAtIso,
                    note: record.note ?? "",
                    multipleExposure: record.multipleExposure ?? false,
                    frameExposureIndex: record.frameExposureIndex,
                    meterReadings: record.meterReadings ?? [],
                    location: record.location
                ),
                createdAt: record.createdAt,
                takenAt: record.takenAt
            )
        }
        .sorted {
            if $0.draft.frameNumber != $1.draft.frameNumber {
                return $0.draft.frameNumber < $1.draft.frameNumber
            }
            let leftIndex = $0.draft.frameExposureIndex ?? 1
            let rightIndex = $1.draft.frameExposureIndex ?? 1
            if leftIndex != rightIndex { return leftIndex < rightIndex }
            return $0.createdAt.date < $1.createdAt.date
        }
    }

    private func refresh(collection: String) async throws {
        var cursor: String?
        repeat {
            let page = try await hydrator.list(
                RecordListHydrationRequest(
                    repo: repo,
                    collection: collection,
                    limit: 100,
                    cursor: cursor
                )
            )
            let snapshot = try await store.snapshot()
            let pendingURIs = Set(
                snapshot.records.filter { $0.pendingOperationID != nil }.map(\.uri)
            )
            let mutations = page.records
                .filter { !pendingURIs.contains($0.uri) }
                .map { PersistenceMutation.upsertRecord($0.cached()) }
            if !mutations.isEmpty { try await store.apply(mutations) }
            cursor = page.cursor
        } while cursor != nil
    }

    private struct IndexedRecord {
        let uri: String
        let value: Data
    }

    private func indexedRecords(collection: String) async throws -> [IndexedRecord] {
        let snapshot = try await store.snapshot()
        var records: [String: IndexedRecord] = Dictionary(
            uniqueKeysWithValues: snapshot.records.compactMap { cached -> (String, IndexedRecord)? in
                guard cached.collection == collection, cached.uri.hasPrefix("at://") else {
                    return nil
                }
                return (cached.uri, IndexedRecord(uri: cached.uri, value: cached.value))
            }
        )
        for operation in snapshot.outbox
        where operation.repo == repo
            && operation.collection == collection && operation.kind == .create
        {
            guard let rkey = operation.rkey, let value = operation.record else { continue }
            let uri = "at://\(repo)/\(collection)/\(rkey)"
            records[uri] = IndexedRecord(uri: uri, value: value)
        }
        return Array(records.values)
    }

    private func mergeExposure(original: Data, proposed: Data) throws -> Data {
        guard
            var originalObject = try JSONSerialization.jsonObject(with: original)
                as? [String: Any],
            let proposedObject = try JSONSerialization.jsonObject(with: proposed)
                as? [String: Any]
        else {
            throw LoggerError.write("The exposure record is not a JSON object.")
        }
        for key in Self.editableExposureKeys {
            originalObject[key] = proposedObject[key]
        }
        return try JSONSerialization.data(
            withJSONObject: originalObject,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }
}

private enum ShootLocationError: LocalizedError, Sendable {
    case permissionDenied
    case unavailable

    var errorDescription: String? {
        switch self {
        case .permissionDenied: "Location access is not enabled for Hypo."
        case .unavailable: "The phone could not determine a current location."
        }
    }
}

@MainActor
private final class CoreLocationShootLocationProvider: NSObject, ShootLocationProviding,
    @preconcurrency CLLocationManagerDelegate, @unchecked Sendable
{
    private let manager = CLLocationManager()
    private var authorizationContinuations: [CheckedContinuation<Bool, Never>] = []
    private var locationContinuation: CheckedContinuation<AppGraycardDefsGeoLocation, any Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func requestWhenInUseAuthorization() async -> Bool {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return true
        case .denied, .restricted: return false
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                authorizationContinuations.append(continuation)
                manager.requestWhenInUseAuthorization()
            }
        @unknown default: return false
        }
    }

    func currentLocation() async throws -> AppGraycardDefsGeoLocation {
        guard
            manager.authorizationStatus == .authorizedAlways
                || manager.authorizationStatus == .authorizedWhenInUse
        else {
            throw ShootLocationError.permissionDenied
        }
        guard locationContinuation == nil else { throw ShootLocationError.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            locationContinuation = continuation
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined else { return }
        let granted =
            manager.authorizationStatus == .authorizedAlways
            || manager.authorizationStatus == .authorizedWhenInUse
        let continuations = authorizationContinuations
        authorizationContinuations = []
        continuations.forEach { $0.resume(returning: granted) }
    }

    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let continuation = locationContinuation else { return }
        locationContinuation = nil
        guard let location = locations.last, location.horizontalAccuracy >= 0 else {
            continuation.resume(throwing: ShootLocationError.unavailable)
            return
        }
        continuation.resume(
            returning: AppGraycardDefsGeoLocation(
                latitude: Int((location.coordinate.latitude * 10_000_000).rounded()),
                longitude: Int((location.coordinate.longitude * 10_000_000).rounded()),
                altitude: location.verticalAccuracy >= 0
                    ? Int((location.altitude * 1_000).rounded()) : nil,
                accuracy: Int((location.horizontalAccuracy * 1_000).rounded()),
                capturedAt: ATProtoDate(location.timestamp)
            )
        )
    }

    func locationManager(_: CLLocationManager, didFailWithError _: any Error) {
        guard let continuation = locationContinuation else { return }
        locationContinuation = nil
        continuation.resume(throwing: ShootLocationError.unavailable)
    }
}

private actor QueuedMeterReadingWriter: MeterReadingSemanticWriting {
    private static let collection = "app.graycard.meter.reading"
    private static let meterCollection = "app.graycard.instance.meter"

    let engine: SyncEngine
    let store: any PersistenceStore
    let sessionProvider: any SyncOAuthSessionProviding
    let calibrationStore: any CalibrationProfileStoring
    let meterIdentity: PersistentPhoneMeterIdentity
    let deviceModel: String

    init(
        engine: SyncEngine,
        store: any PersistenceStore,
        sessionProvider: any SyncOAuthSessionProviding,
        calibrationStore: any CalibrationProfileStoring,
        meterIdentity: PersistentPhoneMeterIdentity,
        deviceModel: String
    ) {
        self.engine = engine
        self.store = store
        self.sessionProvider = sessionProvider
        self.calibrationStore = calibrationStore
        self.meterIdentity = meterIdentity
        self.deviceModel = deviceModel
    }

    func storeMeterReadings(_ request: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
    {
        let repo = try await sessionProvider.session().subject
        let meterURI = try ATURI(
            "at://\(repo)/\(Self.meterCollection)/\(meterIdentity.rkey)"
        )
        let calibrationState = try await calibrationStore.loadCalibrationProfileState()
        let calibrationProfiles = Dictionary(
            uniqueKeysWithValues: calibrationState.profiles.map { ($0.id, $0) }
        )
        let references = try Dictionary(
            uniqueKeysWithValues: request.records.map { recordRequest in
                let rkey = recordRequest.reading.id.uuidString.lowercased()
                return (
                    recordRequest.reading.id,
                    try MeterReadingRecordReference(
                        uri: "at://\(repo)/\(Self.collection)/\(rkey)"
                    )
                )
            }
        )
        let averagedFrom: [ATURI] = try request.capture.constituents.map { reading in
            guard let reference = references[reading.id] else {
                throw MeterFeatureBoundaryError.persistence(
                    "The averaged reading is missing a constituent record reference."
                )
            }
            return try ATURI(reference.uri)
        }
        let encoded = try Dictionary(
            uniqueKeysWithValues: request.records.map { recordRequest in
                (
                    recordRequest.reading.id,
                    try MeterReadingWireEncoder.record(
                        recordRequest,
                        meter: meterURI,
                        calibration: try calibrationURI(
                            for: recordRequest.reading,
                            profiles: calibrationProfiles,
                            repo: repo
                        ),
                        averagedFrom: recordRequest.reading.id == request.primaryReadingID
                            ? averagedFrom : []
                    )
                )
            }
        )

        let snapshot = try await store.snapshot()
        var mutations: [PersistenceMutation] = []
        let meterRecord = try encode(
            AppGraycardInstanceMeterMain(
                createdAt: ATProtoDate(meterIdentity.createdAt),
                kind: .phoneCamera,
                deviceModel: deviceModel,
                nickname: "Hypo on \(deviceModel)",
                status: .inUse
            )
        )
        try appendCreateIfNeeded(
            repo: repo,
            collection: Self.meterCollection,
            rkey: meterIdentity.rkey,
            record: meterRecord,
            createdAt: meterIdentity.createdAt,
            snapshot: snapshot,
            mutations: &mutations
        )
        for recordRequest in request.records {
            let readingID = recordRequest.reading.id
            let rkey = readingID.uuidString.lowercased()
            guard let record = encoded[readingID], let reference = references[readingID] else {
                throw MeterFeatureBoundaryError.persistence(
                    "The meter batch could not prepare every record."
                )
            }
            if let pending = snapshot.outbox.first(where: {
                $0.kind == .create && $0.repo == repo && $0.collection == Self.collection
                    && $0.rkey == rkey
            }) {
                guard pending.record == record else {
                    throw MeterFeatureBoundaryError.persistence(
                        "A queued meter-reading key belongs to different data."
                    )
                }
                continue
            }
            if let cached = snapshot.records.first(where: {
                ($0.uri == reference.uri)
                    || ($0.collection == Self.collection && $0.rkey == rkey)
            }) {
                guard cached.value == record else {
                    throw MeterFeatureBoundaryError.persistence(
                        "A stored meter-reading key belongs to different data."
                    )
                }
                continue
            }

            let operationID = UUID()
            let tempURI = "outbox://\(operationID.uuidString.lowercased())"
            mutations.append(
                .upsertRecord(
                    CachedRecord(
                        uri: tempURI,
                        cid: nil,
                        collection: Self.collection,
                        rkey: rkey,
                        value: record,
                        cachedAt: request.requestedAt,
                        pendingOperationID: operationID
                    )
                )
            )
            mutations.append(
                .enqueue(
                    OutboxOperation(
                        id: operationID,
                        kind: .create,
                        repo: repo,
                        collection: Self.collection,
                        rkey: rkey,
                        tempURI: tempURI,
                        record: record,
                        createdAt: request.requestedAt
                    )
                )
            )
        }
        if !mutations.isEmpty {
            try await store.apply(mutations)
            Task { [engine] in _ = await engine.flush() }
        }
        let acceptedAt = Date()
        return MeterReadingBatchPersistenceReceipt(
            records: Dictionary(
                uniqueKeysWithValues: references.map { readingID, reference in
                    (
                        readingID,
                        MeterReadingPersistenceReceipt(
                            reference: reference,
                            acceptedAt: acceptedAt
                        )
                    )
                }
            )
        )
    }

    private func calibrationURI(
        for reading: Reading,
        profiles: [UUID: CalibrationProfile],
        repo: String
    ) throws -> ATURI? {
        guard let calibrationID = reading.calibrationID else { return nil }
        guard let profile = profiles[calibrationID] else {
            throw MeterFeatureBoundaryError.persistence(
                "The applied calibration profile is missing from durable meter state."
            )
        }
        return try ATURI(
            "at://\(repo)/app.graycard.meter.calibration/"
                + QueuedSettingsCalibrationRecordWriter.calibrationRKey(profile)
        )
    }

    private func appendCreateIfNeeded(
        repo: String,
        collection: String,
        rkey: String,
        record: Data,
        createdAt: Date,
        snapshot: PersistenceSnapshot,
        mutations: inout [PersistenceMutation]
    ) throws {
        if let pending = snapshot.outbox.first(where: {
            $0.kind == .create && $0.repo == repo && $0.collection == collection
                && $0.rkey == rkey
        }) {
            guard pending.record == record else {
                throw MeterFeatureBoundaryError.persistence(
                    "A queued phone-meter key belongs to different data."
                )
            }
            return
        }
        if let cached = snapshot.records.first(where: {
            $0.collection == collection && $0.rkey == rkey
        }) {
            guard cached.value == record else {
                throw MeterFeatureBoundaryError.persistence(
                    "A stored phone-meter key belongs to different data."
                )
            }
            return
        }

        let operationID = UUID()
        let tempURI = "outbox://\(operationID.uuidString.lowercased())"
        mutations.append(
            .upsertRecord(
                CachedRecord(
                    uri: tempURI,
                    cid: nil,
                    collection: collection,
                    rkey: rkey,
                    value: record,
                    cachedAt: createdAt,
                    pendingOperationID: operationID
                )
            )
        )
        mutations.append(
            .enqueue(
                OutboxOperation(
                    id: operationID,
                    kind: .create,
                    repo: repo,
                    collection: collection,
                    rkey: rkey,
                    tempURI: tempURI,
                    record: record,
                    createdAt: createdAt
                )
            )
        )
    }

    private func encode<T: Encodable>(_ record: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(record)
    }
}

@MainActor
private final class LiveSettingsCalibrationSampleSource: SettingsCalibrationSampleCapturing,
    @unchecked Sendable
{
    private let engine: DefaultMeterEngine
    private let deviceModel: String

    init(engine: DefaultMeterEngine, deviceModel: String) {
        self.engine = engine
        self.deviceModel = deviceModel
    }

    func captureCalibrationSample() async throws -> SettingsCalibrationSample {
        let configuration = try MeterConfiguration(
            mode: .reflectedAverage,
            averagingCount: 1
        )
        let capture = try await engine.captureUncalibrated(configuration: configuration)
        return try SettingsCalibrationSample(
            uncorrected: capture.reading,
            deviceModel: deviceModel
        )
    }
}

private actor QueuedSettingsCalibrationRecordWriter: SettingsCalibrationRecordWriting {
    private static let meterCollection = "app.graycard.instance.meter"
    private static let calibrationCollection = "app.graycard.meter.calibration"

    private let engine: SyncEngine
    private let store: any PersistenceStore
    private let sessionProvider: any SyncOAuthSessionProviding
    private let meterRKey: String
    private let meterCreatedAt: Date
    private let deviceModel: String
    private let osVersion: String

    init(
        engine: SyncEngine,
        store: any PersistenceStore,
        sessionProvider: any SyncOAuthSessionProviding,
        meterRKey: String,
        meterCreatedAt: Date,
        deviceModel: String,
        osVersion: String
    ) {
        self.engine = engine
        self.store = store
        self.sessionProvider = sessionProvider
        self.meterRKey = meterRKey
        self.meterCreatedAt = meterCreatedAt
        self.deviceModel = deviceModel
        self.osVersion = osVersion
    }

    func storeCalibrationProfile(_ request: SettingsCalibrationRecordWriteRequest) async throws {
        let repo = try await sessionProvider.session().subject
        let meterURI = try ATURI(
            "at://\(repo)/\(Self.meterCollection)/\(meterRKey)"
        )
        let meterRecord = try encode(
            AppGraycardInstanceMeterMain(
                createdAt: ATProtoDate(meterCreatedAt),
                kind: .phoneCamera,
                deviceModel: deviceModel,
                nickname: "Hypo on \(deviceModel)",
                status: .inUse
            )
        )
        try await ensureCreate(
            repo: repo,
            collection: Self.meterCollection,
            rkey: meterRKey,
            record: meterRecord,
            now: meterCreatedAt
        )

        let profile = request.profile
        let calibrationRecord = try encode(
            AppGraycardMeterCalibrationMain(
                meter: meterURI,
                createdAt: ATProtoDate(profile.createdAt),
                cameraModule: AppGraycardMeterDefsCameraModule(
                    Self.cameraModule(profile.identity.module)
                ),
                sensorPath: AppGraycardMeterDefsSensorPath(
                    Self.sensorPath(profile.identity.sensorPath)
                ),
                reference: AppGraycardMeterDefsCalibrationReference(
                    Self.reference(profile.reference)
                ),
                referenceDetail: request.referenceDetail,
                offsetStops: Self.measure(profile.constantOffsetStops, unit: "stops"),
                constantK: Self.measure(profile.reflectedConstant, unit: "cd·s/(m2·ISO)"),
                constantCFlat: Self.measure(profile.incidentConstant, unit: "lx·s/ISO"),
                curve: profile.correctionCurve.map {
                    AppGraycardMeterCalibrationMainCurveItem(
                        engineEv: Self.measure($0.rawEV100, unit: "EV"),
                        correctedEv: Self.measure(
                            $0.rawEV100 + profile.constantOffsetStops + $0.correctionStops,
                            unit: "EV"
                        )
                    )
                },
                validEvMin: profile.validatedEVRange.map {
                    Self.measure($0.lowerBound, unit: "EV")
                },
                validEvMax: profile.validatedEVRange.map {
                    Self.measure($0.upperBound, unit: "EV")
                },
                deviceModel: profile.identity.deviceModel,
                osVersion: osVersion
            )
        )
        try await ensureCreate(
            repo: repo,
            collection: Self.calibrationCollection,
            rkey: Self.calibrationRKey(profile),
            record: calibrationRecord,
            now: profile.createdAt
        )
    }

    func deleteCalibrationProfile(_ profile: CalibrationProfile) async throws {
        let repo = try await sessionProvider.session().subject
        let snapshot = try await store.snapshot()
        var targetRKeys = Set(
            snapshot.records.lazy.filter { cached in
                cached.collection == Self.calibrationCollection
                    && cached.uri.hasPrefix("at://\(repo)/")
                    && SettingsCalibrationRecordProjection.isSemanticallyEquivalent(
                        SettingsCalibrationRemoteRecord(uri: cached.uri, value: cached.value),
                        to: profile
                    )
            }.map(\.rkey)
        )
        if targetRKeys.isEmpty {
            targetRKeys.insert(Self.calibrationRKey(profile))
        }

        for rkey in targetRKeys.sorted() {
            let canonicalURI = "at://\(repo)/\(Self.calibrationCollection)/\(rkey)"
            let pendingCreate = snapshot.outbox.first {
                $0.kind == .create && $0.repo == repo
                    && $0.collection == Self.calibrationCollection && $0.rkey == rkey
            }
            _ = try await engine.enqueueDelete(
                repo: repo,
                collection: Self.calibrationCollection,
                rkey: rkey,
                uri: pendingCreate?.tempURI ?? canonicalURI,
                now: Date()
            )
        }
    }

    private func ensureCreate(
        repo: String,
        collection: String,
        rkey: String,
        record: Data,
        now: Date
    ) async throws {
        let snapshot = try await store.snapshot()
        if let pending = snapshot.outbox.first(where: {
            $0.kind == .create && $0.repo == repo && $0.collection == collection
                && $0.rkey == rkey
        }) {
            guard pending.record == record else {
                throw MeterFeatureBoundaryError.persistence(
                    "A queued calibration key belongs to different data."
                )
            }
            return
        }
        if let cached = snapshot.records.first(where: {
            $0.collection == collection && $0.rkey == rkey
        }) {
            guard cached.value == record else {
                throw MeterFeatureBoundaryError.persistence(
                    "A stored calibration key belongs to different data."
                )
            }
            return
        }
        _ = try await engine.enqueueCreate(
            repo: repo,
            collection: collection,
            rkey: rkey,
            record: record,
            now: now
        )
    }

    private func encode<T: Encodable>(_ record: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(record)
    }

    fileprivate static func calibrationRKey(_ profile: CalibrationProfile) -> String {
        var hash: UInt64 = 1_469_598_103_934_665_603
        for byte in profile.id.uuidString.utf8 {
            hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211
        }
        return tid(date: profile.createdAt, clockID: UInt16(hash & 0x03ff))
    }

    fileprivate static func tid(date: Date, clockID: UInt16) -> String {
        let alphabet = Array("234567abcdefghijklmnopqrstuvwxyz")
        let micros = UInt64(max(0, date.timeIntervalSince1970 * 1_000_000))
        var value = (micros << 10) | UInt64(clockID & 0x03ff)
        var characters = Array(repeating: Character("2"), count: 13)
        for index in stride(from: 12, through: 0, by: -1) {
            characters[index] = alphabet[Int(value & 31)]
            value >>= 5
        }
        return String(characters)
    }

    private static func measure(_ value: Double, unit: String) -> AppGraycardDefsMeasure {
        AppGraycardDefsMeasure(
            value: Int((value * 10_000).rounded()),
            unit: unit,
            scale: 4
        )
    }

    private static func reference(_ reference: CalibrationReference) -> String {
        switch reference {
        case .sunny16: "sunny-16"
        case .handheldMeter: "reference-meter"
        case .knownTarget: "known-illuminant"
        case .factory: "factory"
        case .manufacturerSpecification: "manufacturer-spec"
        }
    }

    private static func cameraModule(_ module: CameraModule) -> String {
        switch module {
        case .front: "front"
        case .ultraWide: "ultra-wide"
        case .wide: "wide"
        case .telephoto: "telephoto"
        case .external: "external"
        case .unknown: "unknown"
        }
    }

    private static func sensorPath(_ path: SensorPath) -> String {
        switch path {
        case .aeMetadata: "ae-metadata"
        case .rawPatch: "raw-patch"
        case .processedPatch: "processed-patch"
        case .ambientSensor: "ambient-sensor"
        case .manual: "manual"
        case .simulated: "simulated"
        }
    }
}

private struct PersistentPhoneMeterIdentity: Sendable {
    let rkey: String
    let createdAt: Date

    @MainActor
    static func load(defaults: UserDefaults = .standard, now: Date = Date()) -> Self {
        let key = "app.graycard.hypo.phone-meter-rkey"
        let dateKey = "app.graycard.hypo.phone-meter-created-at"
        if let rkey = defaults.string(forKey: key),
            let createdAt = defaults.object(forKey: dateKey) as? Date
        {
            return Self(rkey: rkey, createdAt: createdAt)
        }
        let rkey = QueuedSettingsCalibrationRecordWriter.tid(
            date: now,
            clockID: UInt16.random(in: 0...1023)
        )
        defaults.set(rkey, forKey: key)
        defaults.set(now, forKey: dateKey)
        return Self(rkey: rkey, createdAt: now)
    }
}

private enum HardwareIdentity {
    static func modelIdentifier() -> String {
        #if targetEnvironment(simulator)
            return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
                ?? "iOS Simulator"
        #else
            var size = 0
            guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 1 else {
                return "Unknown iPhone"
            }
            var bytes = [CChar](repeating: 0, count: size)
            guard sysctlbyname("hw.machine", &bytes, &size, nil, 0) == 0 else {
                return "Unknown iPhone"
            }
            return String(
                decoding: bytes.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) },
                as: UTF8.self
            )
        #endif
    }
}

private actor QueuedLoggerMeterPromoter: LoggerExposureMeterPromoting {
    let readingWriter: any MeterReadingSemanticWriting
    let deviceModel: String
    let attachToLogger: @MainActor @Sendable ([ATURI]) -> Void

    init(
        readingWriter: any MeterReadingSemanticWriting,
        deviceModel: String,
        attachToLogger: @escaping @MainActor @Sendable ([ATURI]) -> Void
    ) {
        self.readingWriter = readingWriter
        self.deviceModel = deviceModel
        self.attachToLogger = attachToLogger
    }

    func promoteMeterReadings(_ request: LoggerExposureMeterPromotionRequest) async throws {
        var uris: [ATURI] = []
        for reading in request.readings {
            if let storedReference = request.recordReferences[reading.id] {
                uris.append(try ATURI(storedReference.uri))
                continue
            }
            guard reading.role != .average else {
                throw MeterFeatureBoundaryError.promotion(
                    "Save the averaged reading before sending it to Logger."
                )
            }
            let receipt = try await readingWriter.storeMeterReadings(
                MeterReadingBatchWriteRequest(
                    capture: try MeterCapture(reading: reading),
                    spotPoint: nil,
                    deviceModelName: deviceModel,
                    requestedAt: request.requestedAt
                )
            )
            guard let stored = receipt.records[reading.id] else {
                throw MeterFeatureBoundaryError.promotion(
                    "The meter writer did not return the saved reading."
                )
            }
            uris.append(try ATURI(stored.reference.uri))
        }
        await attachToLogger(uris)
    }
}

private struct MeterEngineCalibrationApplier: MeterCalibrationApplying {
    let engine: DefaultMeterEngine

    func applyCalibration(_ profile: CalibrationProfile?) async {
        await engine.setCalibration(profile)
    }
}

private enum MeterReadingWireEncoder {
    static func record(
        _ request: MeterReadingWriteRequest,
        meter: ATURI,
        calibration: ATURI?,
        averagedFrom: [ATURI] = []
    ) throws -> Data {
        try record(
            request.reading,
            spotPoint: request.spotPoint,
            deviceModelName: request.deviceModelName,
            meter: meter,
            calibration: calibration,
            averagedFrom: averagedFrom
        )
    }

    private static func record(
        _ reading: Reading,
        spotPoint: MeterReadingNormalizedPoint?,
        deviceModelName: String?,
        meter: ATURI,
        calibration: ATURI?,
        averagedFrom: [ATURI]
    ) throws -> Data {
        let exposure = reading.exposure
        let instrument = [deviceModelName, reading.camera.name]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: "; ")
        let provenanceNote = [
            "Hypo meter",
            "\(reading.accuracyTier.rawValue) accuracy tier",
            instrument.isEmpty ? nil : instrument,
        ].compactMap { $0 }.joined(separator: "; ")
        let record = AppGraycardMeterReadingMain(
            geometry: AppGraycardMeterDefsMeterGeometry(reading.geometry.rawValue),
            lightKind: .ambient,
            createdAt: ATProtoDate(reading.takenAt),
            meter: meter,
            calibration: calibration,
            sensorPath: AppGraycardMeterDefsSensorPath(sensorPath(reading.sensorPath)),
            cameraModule: AppGraycardMeterDefsCameraModule(cameraModule(reading.camera.module)),
            ev100: measure(reading.ev100.rawValue, unit: "EV"),
            illuminance: reading.illuminance.map { measure($0.lux, unit: "lx") },
            luminance: reading.luminance.map {
                measure($0.candelaPerSquareMetre, unit: "cd/m2")
            },
            calibrationConstant: measure(
                reading.calibrationConstant,
                unit: reading.geometry == .incidentFlat || reading.geometry == .incidentDome
                    ? "lx·s/ISO" : "cd·s/(m2·ISO)"
            ),
            nominalSpotAngle: reading.nominalSpotAngleDegrees.map {
                measure($0, unit: "deg")
            },
            achievedSpotAngle: reading.achievedSpotAngleDegrees.map {
                measure($0, unit: "deg")
            },
            spotPoint: spotPoint.map {
                AppGraycardMeterReadingMainSpotPoint(
                    x: Int(($0.x * 1_000_000).rounded()),
                    y: Int(($0.y * 1_000_000).rounded())
                )
            },
            iso: exposure.map { max(1, Int($0.sensitivity.iso.rounded())) },
            priorityMode: .evOnly,
            aperture: exposure.map { String(format: "%g", $0.aperture.rawValue) },
            shutterSeconds: exposure.map { measure($0.duration.seconds, unit: "s") },
            role: AppGraycardMeterDefsReadingRole(reading.role.rawValue),
            averagedFrom: averagedFrom.isEmpty ? nil : averagedFrom,
            flags: reading.flags.isEmpty ? nil : reading.flags.sorted().map(\.rawValue),
            takenAt: ATProtoDate(reading.takenAt),
            provenance: AppGraycardDefsProvenance(
                source: .analysis,
                confidence: reading.accuracyTier == .calibrated ? .certain : .likely,
                assertedAt: ATProtoDate(reading.takenAt),
                note: provenanceNote
            )
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(record)
    }

    private static func measure(_ value: Double, unit: String) -> AppGraycardDefsMeasure {
        let scale = 4
        return AppGraycardDefsMeasure(
            value: Int((value * 10_000).rounded()),
            unit: unit,
            scale: scale
        )
    }

    private static func sensorPath(_ path: SensorPath) -> String {
        switch path {
        case .aeMetadata: "ae-metadata"
        case .rawPatch: "raw-patch"
        case .processedPatch: "processed-patch"
        case .ambientSensor: "ambient-sensor"
        case .manual: "manual"
        case .simulated: "simulated"
        }
    }

    private static func cameraModule(_ module: CameraModule) -> String {
        switch module {
        case .front: "front"
        case .ultraWide: "ultra-wide"
        case .wide: "wide"
        case .telephoto: "telephoto"
        case .external: "external"
        case .unknown: "unknown"
        }
    }
}

/// Keeps the immutable bundled catalog available while signed out and switches to the
/// account-bound companion projection only after Settings has restored a verified session.
private actor AccountCompanionLibraryProvider: LibraryProviding, ActiveRollProviding {
    private let hydrator: any RecordHydrating
    private let store: any PersistenceStore
    private var session: OAuthSession?
    private var liveProvider: LiveCompanionLibraryProvider?

    init(hydrator: any RecordHydrating, store: any PersistenceStore) {
        self.hydrator = hydrator
        self.store = store
    }

    func replaceSession(_ session: OAuthSession?) async {
        guard self.session?.subject != session?.subject else {
            self.session = session
            if session != nil { await liveProvider?.invalidate() }
            return
        }
        self.session = session
        liveProvider = session.map {
            LiveCompanionLibraryProvider(repo: $0.subject, hydrator: hydrator, store: store)
        }
    }

    func items() async throws -> [LibraryFeature.LibraryItem] {
        guard let liveProvider else {
            return try await BundledCatalogLibraryProvider().items()
        }
        return try await liveProvider.items()
    }

    func activeRolls() async throws -> [ActiveRoll] {
        guard let liveProvider else { return [] }
        return try await liveProvider.activeRolls()
    }

    func warnings() async -> [LibraryDataWarning] {
        guard let liveProvider else { return [] }
        return await liveProvider.warnings()
    }
}

@MainActor
private final class AppSessionChangeRouter {
    weak var model: AppModel?

    func receive(_ session: OAuthSession?) {
        model?.replaceSession(session)
    }

    func attachMeterReadings(_ uris: [ATURI]) {
        guard let loggerModel = model?.loggerModel else { return }
        loggerModel.draft.meterReadings = Array(Set(loggerModel.draft.meterReadings + uris))
            .sorted { $0.rawValue < $1.rawValue }
            .prefix(16)
            .map { $0 }
    }
}

/// App-wide navigation state. Feature state remains inside feature packages.
private enum AppCalibrationRefreshError: Error {
    case repeatedCursor
    case pageLimitExceeded
}

@MainActor
@Observable
final class AppModel {
    static let backgroundRefreshIdentifier = "app.graycard.hypo.sync-refresh"

    enum Tab: Hashable, Sendable {
        case meter
        case logger
        case timer
        case library
        case settings
    }

    let dependencies: AppDependencies
    private(set) var loggerModel: LoggerFeatureModel?
    let libraryModel: LibraryFeatureModel
    let meterModel: MeterFeatureModel
    let timerModel: TimerFeatureModel
    let settingsModel: SettingsFeatureModel
    let syncStatusModel: SyncStatusFeatureModel
    private let accountLibraryProvider: AccountCompanionLibraryProvider
    private let deviceModel: String
    private let meterEngine: DefaultMeterEngine
    private let sessionRouter: AppSessionChangeRouter
    private let systemSnapshotStore: HypoSharedSnapshotStore?
    private(set) var isLoadingAccountData = false
    private(set) var loggerUnavailableMessage = "Sign in to load your active rolls."
    var selectedTab: Tab = .meter
    private(set) var requestedTimerRecipe: String?
    private var requestedLoggerAperture: String?
    private var requestedLoggerShutterSpeed: String?
    private var persistenceChangesTask: Task<Void, Never>?

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        loggerModel = nil
        let accountLibraryProvider = AccountCompanionLibraryProvider(
            hydrator: dependencies.recordHydrator,
            store: dependencies.persistenceStore
        )
        self.accountLibraryProvider = accountLibraryProvider
        libraryModel = LibraryFeatureModel(
            provider: accountLibraryProvider,
            fieldWriter: QueuedLibraryFieldWriter(
                engine: dependencies.syncEngine,
                store: dependencies.persistenceStore,
                hydrator: dependencies.recordHydrator,
                sessionProvider: dependencies.syncSessionProvider
            )
        )
        let sessionRouter = AppSessionChangeRouter()
        self.sessionRouter = sessionRouter
        systemSnapshotStore = HypoSharedSnapshotStore()
        let deviceModel = HardwareIdentity.modelIdentifier()
        self.deviceModel = deviceModel
        let phoneMeterIdentity = PersistentPhoneMeterIdentity.load()
        let meterEngine = DefaultMeterEngine(sensor: AVFoundationMeterSensor())
        self.meterEngine = meterEngine
        let meterCalibrationApplier = MeterEngineCalibrationApplier(engine: meterEngine)
        let meterReadingWriter = QueuedMeterReadingWriter(
            engine: dependencies.syncEngine,
            store: dependencies.persistenceStore,
            sessionProvider: dependencies.syncSessionProvider,
            calibrationStore: dependencies.meterStateStore,
            meterIdentity: phoneMeterIdentity,
            deviceModel: deviceModel
        )
        let meterFeatureModel = MeterFeatureModel(
            service: meterEngine,
            heldReadingStore: dependencies.meterStateStore,
            readingWriter: meterReadingWriter,
            readingLogStore: dependencies.meterStateStore,
            promoter: QueuedLoggerMeterPromoter(
                readingWriter: meterReadingWriter,
                deviceModel: deviceModel
            ) { uris in
                sessionRouter.attachMeterReadings(uris)
            },
            calibrationStore: dependencies.meterStateStore,
            calibrationApplier: meterCalibrationApplier,
            privateCaptureCollector: LivePrivateMeterCaptureContextCollector(
                modelIdentifier: deviceModel
            ),
            privateCaptureStore: dependencies.privateMeterCaptureStore,
            privateCaptureSettingsStore: dependencies.privateMeterCaptureSettingsStore,
            deviceModelName: deviceModel
        )
        meterModel = meterFeatureModel
        timerModel = TimerFeatureModel(
            recipe: TimerFeatureDefaults.blackAndWhiteRecipe(),
            recipeProvider: CompositeDevelopmentRecipeProvider([
                BundledCatalogDevelopmentRecipeProvider(),
                PersonalPDSDevelopmentRecipeProvider(
                    store: dependencies.persistenceStore,
                    sessionProvider: dependencies.syncSessionProvider,
                    hydrator: dependencies.recordHydrator
                ),
            ]),
            store: dependencies.timerStateStore,
            completionWriter: QueuedDevelopmentSessionWriter(
                engine: dependencies.syncEngine,
                store: dependencies.persistenceStore,
                sessionProvider: dependencies.syncSessionProvider
            ),
            rollAdvancer: HydratingFilmRollDevelopmentAdvancer(
                engine: dependencies.syncEngine,
                store: dependencies.persistenceStore,
                sessionProvider: dependencies.syncSessionProvider,
                hydrator: dependencies.recordHydrator
            )
        )
        let syncStatusModel = SyncStatusFeatureModel(
            service: SyncKitStatusService(
                store: dependencies.persistenceStore,
                engine: dependencies.syncEngine,
                scope: .active(nil)
            ),
            transportAvailability: .signInRequired,
            connectivityMonitor: dependencies.syncConnectivityMonitor
        )
        self.syncStatusModel = syncStatusModel
        let calibrationManager = DefaultSettingsCalibrationManager(
            store: dependencies.meterStateStore,
            applier: meterCalibrationApplier,
            sampleSource: LiveSettingsCalibrationSampleSource(
                engine: meterEngine,
                deviceModel: deviceModel
            ),
            recordWriter: QueuedSettingsCalibrationRecordWriter(
                engine: dependencies.syncEngine,
                store: dependencies.persistenceStore,
                sessionProvider: dependencies.syncSessionProvider,
                meterRKey: phoneMeterIdentity.rkey,
                meterCreatedAt: phoneMeterIdentity.createdAt,
                deviceModel: deviceModel,
                osVersion: UIDevice.current.systemVersion
            )
        )
        settingsModel = SettingsFeatureModel(
            client: dependencies.authenticationClient,
            sessionID: dependencies.authenticationSessionID,
            onSessionChange: { session in sessionRouter.receive(session) },
            calibrationManager: calibrationManager,
            diagnosticsRecorder: dependencies.diagnosticsRecorder,
            onCalibrationStateChange: { _ in
                Task { await meterFeatureModel.loadDurableState() }
            }
        )
        sessionRouter.model = self
        consumePendingSystemRoute()
    }

    fileprivate func replaceSession(_ session: OAuthSession?) {
        dependencies.authenticationState.replace(with: session)
        syncStatusModel.setTransportAvailability(
            session == nil ? .signInRequired : .available
        )
        Task {
            await syncStatusModel.selectRepository(session?.subject)
            await refreshAccountData(session: session)
            if session != nil { await syncStatusModel.retryNow() }
        }
    }

    private func refreshAccountData(session: OAuthSession?) async {
        isLoadingAccountData = true
        defer { isLoadingAccountData = false }
        await accountLibraryProvider.replaceSession(session)
        while libraryModel.isLoading {
            try? await Task.sleep(for: .milliseconds(25))
        }
        await libraryModel.load()
        guard let session else {
            loggerModel = nil
            loggerUnavailableMessage = "Sign in to load your active rolls."
            timerModel.setAvailableFilmRolls([])
            return
        }
        await refreshCalibrationProfiles(repo: session.subject)
        do {
            let rolls = try await accountLibraryProvider.activeRolls()
            guard let first = rolls.first else {
                loggerModel = nil
                loggerUnavailableMessage = "No loaded or partially exposed rolls were found."
                timerModel.setAvailableFilmRolls([])
                return
            }
            let frameDetailStore = HydratingFrameDetailStore(
                repo: session.subject,
                engine: dependencies.syncEngine,
                store: dependencies.persistenceStore,
                hydrator: dependencies.recordHydrator
            )
            let shoots = (try? await frameDetailStore.shoots()) ?? []
            loggerModel = LoggerFeatureModel(
                activeRoll: first,
                availableRolls: rolls,
                writer: QueuedExposureWriter(
                    engine: dependencies.syncEngine,
                    repo: session.subject
                ),
                lifecycleWriter: QueuedFilmRollLifecycleWriter(
                    repo: session.subject,
                    engine: dependencies.syncEngine,
                    store: dependencies.persistenceStore,
                    hydrator: dependencies.recordHydrator
                ),
                frameDetailStore: frameDetailStore,
                locationProvider: CoreLocationShootLocationProvider(),
                shoots: shoots
            )
            applyRequestedLoggerValues()
            timerModel.setAvailableFilmRolls(
                rolls.map { roll in
                    let details = [
                        roll.exposureIndex.map { "EI \($0)" },
                        roll.cameraName,
                    ].compactMap { $0 }
                    return DevelopmentFilmRollOption(
                        uri: roll.uri,
                        title: roll.label == roll.stockName
                            ? roll.label : "\(roll.label) · \(roll.stockName)",
                        detail: details.isEmpty ? nil : details.joined(separator: " · ")
                    )
                }
            )
        } catch {
            loggerModel = nil
            loggerUnavailableMessage = "Your active rolls could not be loaded."
            timerModel.setAvailableFilmRolls([])
        }
    }

    private func refreshCalibrationProfiles(repo: String) async {
        let collection = "app.graycard.meter.calibration"
        var hydrationSucceeded = false
        do {
            var records: [HydratedRepositoryRecord] = []
            var cursor: String?
            var seenCursors = Set<String>()
            var completed = false
            for _ in 0..<100 {
                let page = try await dependencies.recordHydrator.list(
                    RecordListHydrationRequest(
                        repo: repo,
                        collection: collection,
                        limit: 100,
                        cursor: cursor
                    )
                )
                records.append(contentsOf: page.records)
                guard let next = page.cursor, !next.isEmpty else {
                    completed = true
                    break
                }
                guard seenCursors.insert(next).inserted else {
                    throw AppCalibrationRefreshError.repeatedCursor
                }
                cursor = next
            }
            guard completed else { throw AppCalibrationRefreshError.pageLimitExceeded }

            let before = try await dependencies.persistenceStore.snapshot()
            let pendingRKeys = Set(
                before.outbox.lazy.compactMap { operation in
                    operation.repo == repo && operation.collection == collection
                        ? operation.rkey : nil
                }
            )
            let receivedURIs = Set(records.map(\.uri))
            var mutations: [PersistenceMutation] = []
            for cached in before.records where cached.collection == collection {
                guard cached.uri.hasPrefix("at://\(repo)/"),
                    cached.pendingOperationID == nil,
                    !receivedURIs.contains(cached.uri)
                else { continue }
                mutations.append(.removeRecord(uri: cached.uri))
            }
            mutations.append(
                contentsOf: records.compactMap { remote in
                    pendingRKeys.contains(remote.rkey) ? nil : .upsertRecord(remote.cached())
                }
            )
            if !mutations.isEmpty {
                try await dependencies.persistenceStore.apply(mutations)
            }
            hydrationSucceeded = true
        } catch {
            // Keep and project the last complete local page when the PDS is unavailable.
        }

        guard let snapshot = try? await dependencies.persistenceStore.snapshot() else { return }
        let records = snapshot.records.compactMap { cached -> SettingsCalibrationRemoteRecord? in
            guard cached.collection == collection, cached.uri.hasPrefix("at://\(repo)/") else {
                return nil
            }
            return SettingsCalibrationRemoteRecord(uri: cached.uri, value: cached.value)
        }
        let cameras = (try? await meterEngine.discoverCameras()) ?? []
        let activeIdentity = cameras.first.map {
            CalibrationIdentity(
                deviceModel: deviceModel,
                cameraID: $0.id,
                module: $0.module,
                sensorPath: .aeMetadata
            )
        }
        let result = await settingsModel.reconcileCalibrationRecords(
            records,
            device: SettingsCalibrationDeviceContext(
                deviceModel: deviceModel,
                cameras: cameras,
                activeIdentity: activeIdentity
            )
        )
        if let result, result.skippedMalformedRecordCount > 0 {
            await recordDiagnostic(
                category: .meter,
                operation: .calibrationRefresh,
                outcome: .failed,
                code: .malformedRecords
            )
        } else {
            await recordDiagnostic(
                category: .meter,
                operation: .calibrationRefresh,
                outcome: hydrationSucceeded ? .succeeded : .deferred,
                code: hydrationSucceeded ? nil : .unavailable
            )
        }
    }

    func start() async {
        startPersistenceObservation()
        settingsModel.restore()
        await timerModel.restoreDurableSession()
        timerModel.reconcilePlatformPresentation()
        await settingsModel.waitForCurrentOperation()
        await applyRequestedTimerRecipe()
        await syncStatusModel.start()
        await recordDiagnostic(
            category: .application,
            operation: .applicationStart,
            outcome: .succeeded
        )
        publishSystemSnapshot()
    }

    private func startPersistenceObservation() {
        guard persistenceChangesTask == nil else { return }
        let store = dependencies.persistenceStore
        persistenceChangesTask = Task { [weak self] in
            let changes = await store.changes()
            for await _ in changes {
                guard !Task.isCancelled else { return }
                await self?.syncStatusModel.refresh()
            }
        }
    }

    func didEnterForeground() async {
        timerModel.reconcilePlatformPresentation()
        consumePendingSystemRoute()
        await syncStatusModel.didEnterForeground()
        await meterModel.synchronizePrivateCaptureIfEnabled()
        await refreshAccountData(session: settingsModel.session)
        await applyRequestedTimerRecipe()
        await recordDiagnostic(
            category: .application,
            operation: .applicationForeground,
            outcome: .succeeded
        )
        publishSystemSnapshot()
    }

    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundRefreshIdentifier)
        request.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    func performBackgroundRefresh() async {
        let report = await dependencies.syncEngine.performBackgroundRefresh()
        let wasDeferred = report.deferred > 0 || report.retryScheduled > 0
        await recordDiagnostic(
            category: .synchronization,
            operation: .synchronizationBackgroundRefresh,
            outcome: wasDeferred ? .deferred : .succeeded,
            code: wasDeferred ? .unavailable : nil
        )
        scheduleBackgroundRefresh()
    }

    private func recordDiagnostic(
        category: DiagnosticCategory,
        operation: DiagnosticOperation,
        outcome: DiagnosticOutcome,
        code: DiagnosticCode? = nil
    ) async {
        guard
            let event = try? DiagnosticEvent(
                category: category,
                operation: operation,
                outcome: outcome,
                code: code
            )
        else { return }
        try? await dependencies.diagnosticsRecorder.record(event)
    }

    @discardableResult
    func open(_ url: URL) -> Bool {
        if url.scheme?.lowercased() == "app.graycard.hypo",
            url.path == "/oauth/callback"
        {
            selectedTab = .settings
            settingsModel.receiveExpiredCallback()
            return true
        }

        if let deepLink = HypoDeepLink(url: url) {
            return apply(deepLink)
        }

        let route: String
        let pathComponents = url.pathComponents.filter { $0 != "/" }
        if url.scheme?.lowercased() == "hypo", let host = url.host?.lowercased() {
            route = host
        } else if url.scheme?.lowercased() == "https",
            url.host?.lowercased() == "hypo.graycard.app",
            pathComponents.first == "app",
            pathComponents.count >= 2
        {
            route = pathComponents[1].lowercased()
        } else {
            return false
        }

        switch route {
        case "meter": selectedTab = .meter
        case "log", "logger": selectedTab = .logger
        case "timer":
            selectedTab = .timer
            if url.scheme?.lowercased() == "hypo" {
                requestedTimerRecipe = pathComponents.first
            } else if pathComponents.count >= 3 {
                requestedTimerRecipe = pathComponents[2]
            }
        case "library": selectedTab = .library
        case "settings", "account": selectedTab = .settings
        default: return false
        }
        return true
    }

    @discardableResult
    private func apply(_ route: HypoDeepLink) -> Bool {
        switch route {
        case let .log(aperture, shutterSpeed):
            selectedTab = .logger
            requestedLoggerAperture = aperture
            requestedLoggerShutterSpeed = shutterSpeed
            applyRequestedLoggerValues()
        case let .meter(mode):
            selectedTab = .meter
            if let mode {
                meterModel.mode =
                    switch mode {
                    case .reflected: .reflected
                    case .spot: .spot
                    case .incident: .incident
                    }
            }
        case let .timer(recipe):
            selectedTab = .timer
            requestedTimerRecipe = recipe
            Task { await applyRequestedTimerRecipe() }
        case .library:
            selectedTab = .library
        case .settings:
            selectedTab = .settings
        }
        return true
    }

    private func consumePendingSystemRoute() {
        guard let route = systemSnapshotStore?.consumePendingRoute() else { return }
        _ = apply(route)
    }

    private func applyRequestedLoggerValues() {
        guard let loggerModel else { return }
        if let aperture = requestedLoggerAperture,
            loggerModel.exposureControls.apertures.contains(aperture)
        {
            loggerModel.draft.aperture = aperture
            requestedLoggerAperture = nil
        }
        if let shutterSpeed = requestedLoggerShutterSpeed,
            loggerModel.exposureControls.shutterSpeeds.contains(shutterSpeed)
        {
            loggerModel.draft.shutterSpeed = shutterSpeed
            requestedLoggerShutterSpeed = nil
        }
    }

    private func applyRequestedTimerRecipe() async {
        guard let request = requestedTimerRecipe?.trimmingCharacters(in: .whitespacesAndNewlines),
            !request.isEmpty
        else { return }
        await timerModel.loadRecipes()
        guard
            let recipe = timerModel.availableRecipes.first(where: {
                $0.id.caseInsensitiveCompare(request) == .orderedSame
                    || $0.plan.name.caseInsensitiveCompare(request) == .orderedSame
            })
        else { return }
        timerModel.selectRecipe(id: recipe.id)
        requestedTimerRecipe = nil
    }

    func publishSystemSnapshot() {
        guard let systemSnapshotStore else { return }
        let roll = loggerModel?.activeRoll
        let reading = meterModel.reading
        let timerSnapshot = timerModel.snapshot
        let runningTimer: HypoRunningTimerSnapshot? =
            if let timerSnapshot,
                timerSnapshot.status == .running || timerSnapshot.status == .paused
            {
                HypoRunningTimerSnapshot(
                    recipeName: timerModel.selectedRecipe.plan.name,
                    stageName: timerSnapshot.stage.name,
                    stageEndsAt: timerSnapshot.stageEndsAt,
                    isPaused: timerSnapshot.status == .paused
                )
            } else {
                nil
            }
        let snapshot = HypoSystemSnapshot(
            activeRoll: roll.map {
                HypoActiveRollSnapshot(
                    label: $0.label,
                    stockName: $0.stockName,
                    exposuresUsed: $0.exposuresUsed,
                    exposuresTotal: $0.exposuresTotal
                )
            },
            runningTimer: runningTimer,
            latestReading: reading.map {
                HypoReadingSnapshot(
                    mode: Self.systemMeterMode(for: $0.geometry),
                    exposureValue: $0.ev100.rawValue,
                    exposureIndex: Int(($0.exposure?.sensitivity.iso ?? 100).rounded()),
                    aperture: $0.exposure.map {
                        Self.compactNumber($0.aperture.rawValue)
                    },
                    shutterSpeed: $0.exposure.map {
                        Self.shutterLabel(seconds: $0.duration.seconds)
                    },
                    measuredAt: $0.takenAt
                )
            },
            updatedAt: Date()
        )
        try? systemSnapshotStore.save(snapshot)
        #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private static func systemMeterMode(for geometry: MeasurementGeometry) -> HypoMeterMode {
        switch geometry {
        case .reflectedAverage: .reflected
        case .reflectedSpot: .spot
        case .incidentFlat, .incidentDome: .incident
        }
    }

    private static func compactNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    private static func shutterLabel(seconds: Double) -> String {
        guard seconds < 1 else { return compactNumber(seconds) + "s" }
        return "1/\(max(1, Int((1 / seconds).rounded())))"
    }
}
