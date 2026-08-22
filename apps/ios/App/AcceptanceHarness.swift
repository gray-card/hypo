#if DEBUG
    import ATProtoClient
    import DiagnosticsKit
    import Foundation
    import HypoLexicon
    import MeterFeature
    import PanprotoKit
    import PersistenceKit
    import SettingsFeature
    import SwiftUI
    import SyncKit
    import SystemIntegrationKit
    import TimerFeature

    struct AcceptanceLaunchConfiguration: Sendable {
        enum Fixture: String, Sendable {
            case accessibility
            case deepLink = "deep-link"
            case sharedSnapshot = "shared-snapshot"
            case synchronization
        }

        enum Network: String, Sendable {
            case offline
            case online
        }

        let fixture: Fixture
        let network: Network
        let resetsPersistentState: Bool
        let initialURL: URL?

        static var current: Self? {
            let environment = ProcessInfo.processInfo.environment
            guard environment["HYPO_UI_TESTING"] == "1",
                let fixtureValue = environment["HYPO_UI_TEST_FIXTURE"],
                let fixture = Fixture(rawValue: fixtureValue)
            else { return nil }

            return Self(
                fixture: fixture,
                network: Network(rawValue: environment["HYPO_UI_TEST_NETWORK"] ?? "offline")
                    ?? .offline,
                resetsPersistentState: environment["HYPO_UI_TEST_RESET"] == "1",
                initialURL: environment["HYPO_UI_TEST_INITIAL_URL"].flatMap(URL.init(string:))
            )
        }
    }

    struct AcceptanceHarnessView: View {
        let configuration: AcceptanceLaunchConfiguration

        var body: some View {
            NavigationStack {
                Group {
                    switch configuration.fixture {
                    case .accessibility:
                        AcceptanceAccessibilityFixtureView()
                    case .deepLink:
                        AcceptanceDeepLinkFixtureView(initialURL: configuration.initialURL)
                    case .sharedSnapshot:
                        AcceptanceSharedSnapshotFixtureView(
                            resetsPersistentState: configuration.resetsPersistentState
                        )
                    case .synchronization:
                        Text("The synchronization fixture is mounted through RootView.")
                    }
                }
                .navigationTitle("Hypo acceptance")
            }
            .preferredColorScheme(.dark)
        }
    }

    @MainActor
    struct AcceptanceSynchronizationComposition {
        let model: AppModel
        let fixturePDS: AcceptanceFixturePDS

        static func make(configuration: AcceptanceLaunchConfiguration) -> Self {
            do {
                let baseURL =
                    FileManager.default.urls(
                        for: .applicationSupportDirectory,
                        in: .userDomainMask
                    ).first ?? FileManager.default.temporaryDirectory
                let directory = baseURL.appending(
                    path: "HypoAcceptance/Synchronization",
                    directoryHint: .isDirectory
                )
                if configuration.resetsPersistentState,
                    FileManager.default.fileExists(atPath: directory.path)
                {
                    try FileManager.default.removeItem(at: directory)
                }
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )

                let store = try SwiftDataPersistenceStore(
                    storeURL: directory.appending(path: "Persistence.store")
                )
                let fixturePDS = try AcceptanceFixturePDS(
                    fileURL: directory.appending(path: "FixturePDS.json"),
                    isOnline: configuration.network == .online
                )
                let sessionID = OAuthSessionID(rawValue: "acceptance-session")
                let session = OAuthSession(
                    id: sessionID,
                    issuer: URL(string: "https://auth.acceptance.invalid")!,
                    subject: AcceptanceFixturePDS.repositoryDID,
                    pdsURL: URL(string: "https://pds.acceptance.invalid")!,
                    accessToken: "acceptance-token",
                    scope: "atproto transition:generic"
                )
                let engine = SyncEngine(store: store, transport: fixturePDS)
                let dependencies = AppDependencies(
                    schemaChecker: PanprotoSchemaInspector(),
                    persistenceStore: store,
                    syncEngine: engine,
                    persistenceIsDurable: true,
                    diagnosticsRecorder: UnavailableSettingsDiagnosticsRecorder(),
                    authenticationClient: AcceptanceAuthenticationClient(session: session),
                    authenticationSessionID: sessionID,
                    authenticationState: AppAuthenticationState(),
                    meterStateStore: InMemoryMeterFeatureStateStore(),
                    privateMeterCaptureStore: InMemoryPrivateMeterCaptureContextStore(),
                    privateMeterCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(),
                    timerStateStore: InMemoryTimerFeatureSessionStore(),
                    syncSessionProvider: FixedSyncOAuthSessionProvider(session),
                    recordHydrator: fixturePDS,
                    syncConnectivityMonitor: AcceptanceConnectivityMonitor(
                        isOnline: configuration.network == .online
                    )
                )
                return Self(model: AppModel(dependencies: dependencies), fixturePDS: fixturePDS)
            } catch {
                preconditionFailure("Could not compose the synchronization fixture: \(error)")
            }
        }
    }

    struct AcceptanceSynchronizationRootView: View {
        @Bindable var model: AppModel
        let fixturePDS: AcceptanceFixturePDS
        @State private var remoteExposure = "No remote exposure"

        var body: some View {
            RootView(model: model)
                .overlay(alignment: .topLeading) {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(remoteExposure)
                        .accessibilityIdentifier("acceptance.sync.remote-record")
                }
                .task {
                    while !Task.isCancelled {
                        remoteExposure = await fixturePDS.remoteExposureLabel()
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                }
        }
    }

    private struct AcceptanceAuthenticationClient: SettingsAuthenticationClient {
        let session: OAuthSession

        func signIn(identifier _: String, sessionID _: OAuthSessionID) async throws -> OAuthSession {
            session
        }

        func restore(sessionID _: OAuthSessionID) async throws -> OAuthSession? { session }
        func refresh(sessionID _: OAuthSessionID) async throws -> OAuthSession { session }
        func signOut(sessionID _: OAuthSessionID) async throws {}
    }

    private struct AcceptanceConnectivityMonitor: SyncConnectivityMonitoring {
        let isOnline: Bool

        func start(handler: @escaping @Sendable (Bool) -> Void) async {
            handler(isOnline)
        }

        func cancel() async {}
    }

    actor AcceptanceFixturePDS: SyncTransport, RecordHydrating {
        static let repositoryDID = "did:plc:hypoacceptance"

        private struct StoredRecord: Codable, Hashable, Sendable {
            var uri: String
            var cid: String
            var collection: String
            var rkey: String
            var value: Data

            var hydrated: HydratedRepositoryRecord {
                HydratedRepositoryRecord(
                    uri: uri,
                    cid: cid,
                    collection: collection,
                    rkey: rkey,
                    value: value
                )
            }
        }

        private struct Envelope: Codable, Sendable {
            var revision: Int
            var records: [StoredRecord]
        }

        private enum FixtureError: Error {
            case malformedOperation
            case recordNotFound
        }

        private let fileURL: URL
        private let isOnline: Bool
        private var envelope: Envelope

        init(fileURL: URL, isOnline: Bool) throws {
            self.fileURL = fileURL
            self.isOnline = isOnline
            if FileManager.default.fileExists(atPath: fileURL.path) {
                envelope = try JSONDecoder().decode(
                    Envelope.self,
                    from: Data(contentsOf: fileURL)
                )
            } else {
                envelope = Envelope(revision: 0, records: [])
            }
        }

        func execute(_ operation: OutboxOperation) throws -> RemoteWriteResult {
            guard isOnline else {
                throw SyncTransportError.deferred(
                    message: "The deterministic fixture PDS is offline."
                )
            }
            let rkey = operation.rkey ?? operation.id.uuidString.lowercased()
            let uri = operation.uri ?? "at://\(operation.repo)/\(operation.collection)/\(rkey)"

            switch operation.kind {
            case .create:
                guard let value = operation.record else { throw FixtureError.malformedOperation }
                if let existing = envelope.records.first(where: { $0.uri == uri }) {
                    guard existing.value == value else {
                        throw SyncTransportError.conflict(
                            remoteCID: existing.cid,
                            remoteRecord: existing.value,
                            message: "The fixture record key already exists."
                        )
                    }
                    return RemoteWriteResult(
                        uri: existing.uri,
                        cid: existing.cid,
                        record: existing.value
                    )
                }
                return try save(
                    uri: uri,
                    collection: operation.collection,
                    rkey: rkey,
                    value: value
                )
            case .put:
                guard let value = operation.record else { throw FixtureError.malformedOperation }
                return try save(
                    uri: uri,
                    collection: operation.collection,
                    rkey: rkey,
                    value: value
                )
            case .delete:
                envelope.records.removeAll { $0.uri == uri }
                envelope.revision += 1
                try persist()
                return RemoteWriteResult(uri: uri)
            }
        }

        func get(_ request: RecordHydrationRequest) throws -> HydratedRepositoryRecord {
            let uri = "at://\(request.repo)/\(request.collection)/\(request.rkey)"
            guard let record = allRecords().first(where: { $0.uri == uri }) else {
                throw FixtureError.recordNotFound
            }
            return record.hydrated
        }

        func list(_ request: RecordListHydrationRequest) -> HydratedRepositoryPage {
            HydratedRepositoryPage(
                records: allRecords()
                    .filter {
                        $0.collection == request.collection
                            && $0.uri.hasPrefix("at://\(request.repo)/")
                    }
                    .sorted { $0.uri < $1.uri }
                    .map(\.hydrated)
            )
        }

        func remoteExposureLabel() -> String {
            let exposures = envelope.records
                .filter { $0.collection == GeneratedRecordNSID.instanceExposure.rawValue }
                .sorted { $0.uri < $1.uri }
            guard
                let exposure = exposures.last,
                let decoded = try? JSONSerialization.jsonObject(with: exposure.value),
                let object = decoded as? [String: Any],
                let frameNumber = object["frameNumber"] as? Int
            else {
                return "No remote exposure"
            }
            return "Frame \(frameNumber) · Kodak Tri-X 400"
        }

        private func save(
            uri: String,
            collection: String,
            rkey: String,
            value: Data
        ) throws -> RemoteWriteResult {
            envelope.revision += 1
            let record = StoredRecord(
                uri: uri,
                cid: "fixture-cid-\(envelope.revision)",
                collection: collection,
                rkey: rkey,
                value: value
            )
            envelope.records.removeAll { $0.uri == uri }
            envelope.records.append(record)
            try persist()
            return RemoteWriteResult(uri: uri, cid: record.cid, record: value)
        }

        private func persist() throws {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(envelope).write(to: fileURL, options: .atomic)
        }

        private func allRecords() -> [StoredRecord] {
            Self.seedRecords + envelope.records
        }

        private static let seedRecords: [StoredRecord] = [
            StoredRecord(
                uri:
                    "at://\(repositoryDID)/app.graycard.catalog.filmStock/kodak-tri-x-400",
                cid: "fixture-seed-stock",
                collection: GeneratedRecordNSID.catalogFilmStock.rawValue,
                rkey: "kodak-tri-x-400",
                value: Data(
                    #"{"$type":"app.graycard.catalog.filmStock","brand":"Kodak","name":"Tri-X 400","iso":400,"exposuresPerRoll":36,"createdAt":"2026-08-01T00:00:00Z"}"#
                        .utf8
                )
            ),
            StoredRecord(
                uri: "at://\(repositoryDID)/app.graycard.instance.filmRoll/acceptance-roll",
                cid: "fixture-seed-roll",
                collection: GeneratedRecordNSID.instanceFilmRoll.rawValue,
                rkey: "acceptance-roll",
                value: Data(
                    #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:hypoacceptance/app.graycard.catalog.filmStock/kodak-tri-x-400","label":"Acceptance roll","status":"partial","exposuresUsed":0,"exposuresTotal":36,"shotAtIso":400,"loadedAt":"2026-08-03T00:00:00Z","partialAt":"2026-08-03T01:00:00Z","createdAt":"2026-08-03T00:00:00Z"}"#
                        .utf8
                )
            ),
        ]
    }

    private struct AcceptanceDeepLinkFixtureView: View {
        @State private var route: HypoDeepLink?

        init(initialURL: URL?) {
            _route = State(initialValue: initialURL.flatMap(HypoDeepLink.init(url:)))
        }

        var body: some View {
            VStack(spacing: 16) {
                Image(systemName: "link")
                    .font(.largeTitle)
                Text(routeTitle)
                    .font(.title2.bold())
                    .accessibilityIdentifier("acceptance.deep-link.route")
                Text(
                    route == nil
                        ? "No supported route was supplied." : "Opened before the first screen appeared."
                )
                .accessibilityIdentifier("acceptance.deep-link.detail")
            }
            .onOpenURL { route = HypoDeepLink(url: $0) }
        }

        private var routeTitle: String {
            switch route {
            case let .log(aperture, shutterSpeed):
                return "Log · \(aperture ?? "Auto") · \(shutterSpeed ?? "Auto")"
            case let .meter(mode):
                return "Meter · \(mode?.rawValue.capitalized ?? "Reflected")"
            case let .timer(recipe):
                return "Timer · \(recipe ?? "Default")"
            case .library:
                return "Library"
            case .settings:
                return "Settings"
            case nil:
                return "Unsupported link"
            }
        }
    }

    private struct AcceptanceSharedSnapshotFixtureView: View {
        private static let suiteName = "app.graycard.hypo.acceptance.snapshot"
        private let snapshot: HypoSystemSnapshot?

        init(resetsPersistentState: Bool) {
            guard let defaults = UserDefaults(suiteName: Self.suiteName) else {
                snapshot = nil
                return
            }
            if resetsPersistentState {
                defaults.removePersistentDomain(forName: Self.suiteName)
            }
            let store = HypoSharedSnapshotStore(defaults: defaults)
            if store.load() == nil {
                try? store.save(Self.fixtureSnapshot)
            }
            snapshot = store.load()
        }

        var body: some View {
            List {
                Section("Extension snapshot metadata") {
                    if let activeRoll = snapshot?.activeRoll {
                        AcceptanceMetadataRow(
                            label: "Active roll",
                            value: activeRoll.label,
                            valueIdentifier: "acceptance.snapshot.roll-label"
                        )
                        AcceptanceMetadataRow(
                            label: "Stock",
                            value: activeRoll.stockName,
                            valueIdentifier: "acceptance.snapshot.stock"
                        )
                        AcceptanceMetadataRow(
                            label: "Frames",
                            value: "\(activeRoll.exposuresUsed) of \(activeRoll.exposuresTotal ?? 0)",
                            valueIdentifier: "acceptance.snapshot.frames"
                        )
                    }

                    if let timer = snapshot?.runningTimer {
                        AcceptanceMetadataRow(
                            label: "Timer recipe",
                            value: timer.recipeName,
                            valueIdentifier: "acceptance.snapshot.timer-recipe"
                        )
                        AcceptanceMetadataRow(
                            label: "Timer stage",
                            value: timer.stageName,
                            valueIdentifier: "acceptance.snapshot.timer-stage"
                        )
                    }

                    if let reading = snapshot?.latestReading {
                        AcceptanceMetadataRow(
                            label: "Latest reading",
                            value: reading.spokenSummary,
                            valueIdentifier: "acceptance.snapshot.reading"
                        )
                    }
                }
            }
        }

        private static let fixtureSnapshot = HypoSystemSnapshot(
            activeRoll: HypoActiveRollSnapshot(
                label: "Roll 12",
                stockName: "Tri-X 400",
                exposuresUsed: 17,
                exposuresTotal: 36
            ),
            runningTimer: HypoRunningTimerSnapshot(
                recipeName: "D-76 1+1",
                stageName: "Develop",
                stageEndsAt: Date(timeIntervalSince1970: 1_800_000_000)
            ),
            latestReading: HypoReadingSnapshot(
                mode: .spot,
                exposureValue: 11,
                exposureIndex: 100,
                aperture: "5.6",
                shutterSpeed: "1/250",
                measuredAt: Date(timeIntervalSince1970: 1_700_000_000)
            ),
            updatedAt: Date(timeIntervalSince1970: 1_700_000_001)
        )
    }

    private struct AcceptanceAccessibilityFixtureView: View {
        @State private var didCompleteFlow = false

        var body: some View {
            VStack(spacing: 24) {
                Text("Accessible logging flow")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("acceptance.accessibility.heading")

                Text("Record a frame with the selected exposure values.")

                Button("Log frame at f/5.6 and 1/125") {
                    didCompleteFlow = true
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("acceptance.accessibility.continue")
                .accessibilityHint("Creates the fixture exposure record")

                if didCompleteFlow {
                    Text("Frame logged")
                        .accessibilityIdentifier("acceptance.accessibility.result")
                }
            }
            .padding()
        }
    }

    private struct AcceptanceMetadataRow: View {
        let label: String
        let value: String
        let valueIdentifier: String

        var body: some View {
            HStack {
                Text(label)
                Spacer()
                Text(value)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(valueIdentifier)
            }
        }
    }
#endif
