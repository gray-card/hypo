import DesignSystem
import Foundation
import MeterEngine
import Observation
import PhotometryKit

#if canImport(AVFoundation)
    @preconcurrency import AVFoundation
#endif

public enum MeterFeatureMode: String, CaseIterable, Hashable, Sendable {
    case reflected = "Reflected"
    case spot = "Spot"
    case incident = "Incident"
}

public enum MeterReadingLogFilter: String, CaseIterable, Hashable, Sendable {
    case all = "All"
    case reflected = "Reflected"
    case spot = "Spot"
    case incident = "Incident"

    fileprivate func includes(_ geometry: MeasurementGeometry) -> Bool {
        switch self {
        case .all: true
        case .reflected: geometry == .reflectedAverage
        case .spot: geometry == .reflectedSpot
        case .incident: geometry == .incidentFlat || geometry == .incidentDome
        }
    }
}

@MainActor
@Observable
public final class MeterFeatureModel {
    public var mode: MeterFeatureMode = .reflected
    public var averagingCount = 1
    public var spotAngleDegrees = 1.0
    public var spotReticleX = 0.5
    public var spotReticleY = 0.5
    public var previewZoom = 1.0
    public var incidentReceptor: IncidentReceptor = .flat
    public var darkroomMode = false
    public var readingLogQuery = ""
    public var readingLogFilter: MeterReadingLogFilter = .all
    public private(set) var spotAnalysisReferenceReadingID: UUID?
    public private(set) var spotAnalysisReferenceZone = Zone.middleGray.rawValue
    public private(set) var reading: Reading?
    public private(set) var heldReadings: [Reading] = []
    public private(set) var readingLog: [StoredMeterReading] = []
    public private(set) var selectedReadingLogIDs: Set<UUID> = []
    public private(set) var calibrationProfiles: [CalibrationProfile] = []
    public private(set) var selectedCalibrationID: UUID?
    public private(set) var isMeasuring = false
    public private(set) var isPromoting = false
    public private(set) var errorMessage: String?
    public private(set) var confirmationMessage: String?
    public private(set) var privateCaptureSettings = PrivateMeterCaptureSettings()
    public private(set) var privateCaptureContextCount = 0
    public private(set) var privateCaptureDataMayExist = false
    public private(set) var isSavingPrivateCapture = false
    public private(set) var privateCaptureMessage: String?
    public private(set) var privateCaptureExport: String?

    private let service: any MeterService
    private let heldReadingStore: any HeldReadingStoring
    private let readingWriter: any MeterReadingSemanticWriting
    private let readingLogStore: any MeterReadingLogStoring
    private let promoter: any LoggerExposureMeterPromoting
    private let calibrationStore: any CalibrationProfileStoring
    private let calibrationApplier: any MeterCalibrationApplying
    private let haptics: any HypoHapticPlaying
    private let privateCaptureCollector: any PrivateMeterCaptureContextCollecting
    private let privateCaptureStore: any PrivateMeterCaptureContextStoring
    private let privateCaptureSettingsStore: any PrivateMeterCaptureSettingsStoring
    private let deviceModelName: String
    private let now: @MainActor @Sendable () -> Date
    private var continuousTask: Task<Void, Never>?
    private var persistenceTask: Task<Void, Never>?
    private var privateCaptureTask: Task<Void, Never>?
    private var pendingPrivateCaptureOperations = 0
    private var privateCaptureDeletionGeneration = 0

    #if canImport(AVFoundation)
        private weak var previewProvider: (any MeterPreviewSessionProviding)?
    #endif

    public init(
        service: any MeterService,
        heldReadingStore: any HeldReadingStoring = InMemoryHeldReadingStore(),
        readingWriter: any MeterReadingSemanticWriting = UnavailableMeterReadingWriter(),
        readingLogStore: any MeterReadingLogStoring = InMemoryMeterReadingLogStore(),
        promoter: any LoggerExposureMeterPromoting = DiscardingLoggerExposureMeterPromoter(),
        calibrationStore: any CalibrationProfileStoring = InMemoryCalibrationProfileStore(),
        calibrationApplier: any MeterCalibrationApplying = DiscardingMeterCalibrationApplier(),
        privateCaptureCollector: any PrivateMeterCaptureContextCollecting =
            UnavailablePrivateMeterCaptureContextCollector(),
        privateCaptureStore: any PrivateMeterCaptureContextStoring =
            InMemoryPrivateMeterCaptureContextStore(),
        privateCaptureSettingsStore: any PrivateMeterCaptureSettingsStoring =
            InMemoryPrivateMeterCaptureSettingsStore(),
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared,
        deviceModelName: String = "Current device",
        now: @escaping @MainActor @Sendable () -> Date = Date.init,
        previewProvider: (any MeterPreviewSessionProviding)? = nil
    ) {
        self.service = service
        self.heldReadingStore = heldReadingStore
        self.readingWriter = readingWriter
        self.readingLogStore = readingLogStore
        self.promoter = promoter
        self.calibrationStore = calibrationStore
        self.calibrationApplier = calibrationApplier
        self.privateCaptureCollector = privateCaptureCollector
        self.privateCaptureStore = privateCaptureStore
        self.privateCaptureSettingsStore = privateCaptureSettingsStore
        self.haptics = haptics
        self.deviceModelName = deviceModelName
        self.now = now
        #if canImport(AVFoundation)
            self.previewProvider = previewProvider
        #else
            _ = previewProvider
        #endif
    }

    #if canImport(AVFoundation)
        public var previewSession: AVCaptureSession? { previewProvider?.meterPreviewSession }
    #endif

    public var configuration: MeterConfiguration {
        get throws {
            let meterMode: MeterMode =
                switch mode {
                case .reflected: .reflectedAverage
                case .spot: .reflectedSpot(nominalAngleDegrees: spotAngleDegrees)
                case .incident: .incident(receptor: incidentReceptor)
                }
            return try MeterConfiguration(
                mode: meterMode,
                averagingCount: averagingCount,
                samplingInterval: .milliseconds(100),
                spotPointX: sourceSpotPoint(displayPoint: spotReticleX),
                spotPointY: sourceSpotPoint(displayPoint: spotReticleY)
            )
        }
    }

    public var selectedCalibration: CalibrationProfile? {
        calibrationProfiles.first { $0.id == selectedCalibrationID }
    }

    public var filteredReadingLog: [StoredMeterReading] {
        let query = readingLogQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return readingLog.filter { entry in
            readingLogFilter.includes(entry.reading.geometry)
                && (query.isEmpty || entry.searchText.contains(query))
        }
    }

    /// Reflected spot readings available to the comparison tools, in memory order. The current
    /// reading is appended when it has not already been held.
    public var spotAnalysisReadings: [Reading] {
        var seen = Set<UUID>()
        var spots = heldReadings.filter {
            $0.geometry == .reflectedSpot && seen.insert($0.id).inserted
        }
        if let reading, reading.geometry == .reflectedSpot, seen.insert(reading.id).inserted {
            if spots.count == MultiSpotMemory.capacity { spots.removeFirst() }
            spots.append(reading)
        }
        return spots
    }

    public var spotAnalysis: MeterSpotAnalysis? {
        MeterSpotAnalysis(
            readings: spotAnalysisReadings,
            referenceReadingID: spotAnalysisReferenceReadingID,
            referenceZone: Zone(rawValue: spotAnalysisReferenceZone)
        )
    }

    public func loadDurableState() async {
        do {
            async let held = heldReadingStore.loadHeldReadings()
            async let calibrationState = calibrationStore.loadCalibrationProfileState()
            async let log = readingLogStore.loadMeterReadingLog()
            let loadedHeld = try await held
            let loadedCalibrationState = try await calibrationState
            let loadedLog = try await log
            heldReadings = Array(loadedHeld.suffix(9))
            readingLog = loadedLog.sorted { $0.reading.takenAt > $1.reading.takenAt }
            selectedReadingLogIDs.formIntersection(readingLog.map(\.id))
            calibrationProfiles = loadedCalibrationState.profiles.sorted {
                $0.createdAt > $1.createdAt
            }
            selectedCalibrationID = loadedCalibrationState.selectedID
            await calibrationApplier.applyCalibration(selectedCalibration)
            errorMessage = nil
        } catch {
            errorMessage = MeterFeatureBoundaryError.statePersistence(String(describing: error)).message
            haptics.play(.failure)
        }

        do {
            privateCaptureSettings = try await privateCaptureSettingsStore.settings()
        } catch {
            privateCaptureMessage = "Private capture choices could not be loaded: \(error)"
        }
        do {
            privateCaptureDataMayExist = await privateCaptureStore.containsLocalPrivateData()
            privateCaptureContextCount = try await privateCaptureStore.contexts().count
            privateCaptureDataMayExist = privateCaptureDataMayExist || privateCaptureContextCount > 0
        } catch {
            privateCaptureDataMayExist = await privateCaptureStore.containsLocalPrivateData()
            privateCaptureMessage = "Private capture data could not be opened: \(error)"
        }
        await synchronizePrivateCaptureIfEnabled(reportSuccess: false)
    }

    public func measure() async {
        isMeasuring = true
        defer { isMeasuring = false }
        let captureConfiguration: MeterConfiguration
        let captured: MeterCapture
        do {
            try await ensureCameraAuthorization()
            captureConfiguration = try configuration
            captured = try await service.captureBatch(configuration: captureConfiguration)
        } catch {
            errorMessage = String(describing: error)
            confirmationMessage = nil
            haptics.play(.failure)
            return
        }

        reading = captured.reading
        let spotPoint =
            captured.reading.geometry == .reflectedSpot
            ? MeterReadingNormalizedPoint(
                x: captureConfiguration.spotPointX,
                y: captureConfiguration.spotPointY
            )
            : nil
        do {
            let request = MeterReadingBatchWriteRequest(
                capture: captured,
                spotPoint: spotPoint,
                deviceModelName: deviceModelName,
                requestedAt: now()
            )
            let receipt = try await readingWriter.storeMeterReadings(request)
            let requestedIDs = Set(request.records.map { $0.reading.id })
            guard Set(receipt.records.keys) == requestedIDs else {
                throw MeterFeatureBoundaryError.persistence(
                    "The meter writer did not confirm every record in the capture."
                )
            }
            let stored = try request.records.map { recordRequest in
                guard let recordReceipt = receipt.records[recordRequest.reading.id] else {
                    throw MeterFeatureBoundaryError.persistence(
                        "The meter writer omitted a record receipt."
                    )
                }
                return StoredMeterReading(
                    reading: recordRequest.reading,
                    reference: recordReceipt.reference,
                    spotPoint: recordRequest.spotPoint,
                    deviceModelName: recordRequest.deviceModelName,
                    acceptedAt: recordReceipt.acceptedAt
                )
            }
            var updatedLog = readingLog.filter { !requestedIDs.contains($0.id) }
            updatedLog.append(contentsOf: stored)
            updatedLog.sort { $0.reading.takenAt > $1.reading.takenAt }
            do {
                try await readingLogStore.saveMeterReadingLog(updatedLog)
                readingLog = updatedLog
            } catch {
                throw MeterFeatureBoundaryError.persistence(
                    "The reading was queued for sync, but its local log entry could not be saved: "
                        + String(describing: error)
                )
            }
            errorMessage = nil
            confirmationMessage =
                captured.constituents.isEmpty
                ? "Reading saved"
                : "Average and \(captured.constituents.count) source readings saved"
            haptics.play(.actionSucceeded)
            if privateCaptureSettings.captureEnabled,
                let primaryReceipt = receipt.records[captured.reading.id]
            {
                enqueuePrivateCaptureContextSave(
                    for: captured.reading,
                    publicReadingURI: primaryReceipt.reference.uri,
                    settings: privateCaptureSettings
                )
            }
        } catch {
            errorMessage = persistenceMessage(for: error)
            confirmationMessage = nil
            haptics.play(.failure)
        }
    }

    public func startContinuous() {
        guard continuousTask == nil else { return }
        isMeasuring = true
        continuousTask = Task { [weak self, service] in
            guard let self else { return }
            do {
                try await self.ensureCameraAuthorization()
                let stream = try await service.readings(configuration: configuration)
                for try await reading in stream {
                    if Task.isCancelled { break }
                    self.reading = reading
                    self.errorMessage = nil
                }
            } catch is CancellationError {
                // Cancellation is the normal stop path.
            } catch {
                self.errorMessage = String(describing: error)
                self.haptics.play(.failure)
            }
            self.isMeasuring = false
            self.continuousTask = nil
        }
    }

    public func stopContinuous() {
        continuousTask?.cancel()
        continuousTask = nil
        isMeasuring = false
    }

    private func ensureCameraAuthorization() async throws {
        switch await service.authorizationStatus() {
        case .authorized:
            return
        case .notDetermined:
            guard await service.requestAuthorization() else {
                throw MeterError.authorizationDenied
            }
        case .denied, .restricted:
            throw MeterError.authorizationDenied
        }
    }

    public func holdCurrentReading() {
        guard let reading else { return }
        heldReadings.append(reading)
        if heldReadings.count > 9 { heldReadings.removeFirst() }
        haptics.play(.selectionChanged)
        persistHeldReadings()
    }

    public func clearHeldReadings() {
        heldReadings.removeAll()
        normalizeSpotAnalysisReference()
        persistHeldReadings()
    }

    public func removeHeldReading(id: UUID) {
        heldReadings.removeAll { $0.id == id }
        normalizeSpotAnalysisReference()
        persistHeldReadings()
    }

    public func selectSpotAnalysisReference(id: UUID) {
        guard spotAnalysisReadings.contains(where: { $0.id == id }) else { return }
        spotAnalysisReferenceReadingID = id
        haptics.play(.selectionChanged)
    }

    public func setSpotAnalysisReferenceZone(_ value: Int) {
        spotAnalysisReferenceZone = min(10, max(0, value))
        haptics.play(.selectionChanged)
    }

    public func adjustSpotAnalysisReferenceZone(by offset: Int) {
        setSpotAnalysisReferenceZone(spotAnalysisReferenceZone + offset)
    }

    public func promoteSpotAnalysisToLogger() async {
        guard let analysis = spotAnalysis else {
            errorMessage = MeterFeatureBoundaryError.noReading.message
            haptics.play(.warning)
            return
        }
        await promote(
            readings: analysis.points.map(\.reading),
            preferredReadingID: analysis.referenceReadingID
        )
    }

    public func promoteToLogger(_ selected: Reading? = nil) async {
        guard let preferred = selected ?? reading else {
            errorMessage = MeterFeatureBoundaryError.noReading.message
            haptics.play(.warning)
            return
        }
        let bank =
            heldReadings.contains(where: { $0.id == preferred.id })
            ? heldReadings
            : heldReadings + [preferred]
        await promote(readings: bank, preferredReadingID: preferred.id)
    }

    public func promoteStoredReading(id: UUID) async {
        guard let entry = readingLog.first(where: { $0.id == id }) else {
            errorMessage = MeterFeatureBoundaryError.noReading.message
            haptics.play(.warning)
            return
        }
        await promote(readings: [entry.reading], preferredReadingID: entry.id)
    }

    public func toggleReadingLogSelection(id: UUID) {
        guard readingLog.contains(where: { $0.id == id }) else { return }
        if selectedReadingLogIDs.contains(id) {
            selectedReadingLogIDs.remove(id)
        } else {
            selectedReadingLogIDs.insert(id)
        }
        haptics.play(.selectionChanged)
    }

    public func clearReadingLogSelection() {
        selectedReadingLogIDs.removeAll()
    }

    public func promoteSelectedReadingLog() async {
        let entries = readingLog.filter { selectedReadingLogIDs.contains($0.id) }
        guard let preferred = entries.first else {
            errorMessage = MeterFeatureBoundaryError.noReading.message
            haptics.play(.warning)
            return
        }
        await promote(
            readings: entries.map(\.reading),
            preferredReadingID: preferred.id
        )
    }

    public func selectCalibration(id: UUID?) async {
        let profile = calibrationProfiles.first { $0.id == id }
        selectedCalibrationID = profile?.id
        do {
            try await calibrationStore.saveCalibrationProfileState(calibrationState)
            await calibrationApplier.applyCalibration(profile)
            confirmationMessage = profile.map { _ in "Calibration applied" } ?? "Calibration removed"
            errorMessage = nil
            haptics.play(.selectionChanged)
        } catch {
            errorMessage = MeterFeatureBoundaryError.calibration(String(describing: error)).message
            haptics.play(.failure)
        }
    }

    public func createOnePointCalibration(
        referenceEV100: Double,
        reference: CalibrationReference
    ) async {
        guard let reading else {
            errorMessage = MeterFeatureBoundaryError.noReading.message
            haptics.play(.warning)
            return
        }
        do {
            let profile = try CalibrationBuilder.constantOffsetProfile(
                identity: CalibrationIdentity(
                    deviceModel: deviceModelName,
                    cameraID: reading.camera.id,
                    module: reading.camera.module,
                    sensorPath: reading.sensorPath
                ),
                reference: reference,
                observations: [
                    CalibrationObservation(
                        measuredEV100: reading.ev100,
                        referenceEV100: ExposureValue(referenceEV100)
                    )
                ],
                createdAt: now()
            )
            calibrationProfiles.insert(profile, at: 0)
            try await calibrationStore.saveCalibrationProfileState(calibrationState)
            await selectCalibration(id: profile.id)
            confirmationMessage = "One-point calibration saved"
        } catch {
            errorMessage = MeterFeatureBoundaryError.calibration(String(describing: error)).message
            confirmationMessage = nil
            haptics.play(.failure)
        }
    }

    public func deleteCalibration(id: UUID) async {
        calibrationProfiles.removeAll { $0.id == id }
        do {
            if selectedCalibrationID == id {
                selectedCalibrationID = nil
                await calibrationApplier.applyCalibration(nil)
            }
            try await calibrationStore.saveCalibrationProfileState(calibrationState)
            errorMessage = nil
        } catch {
            errorMessage = MeterFeatureBoundaryError.calibration(String(describing: error)).message
            haptics.play(.failure)
        }
    }

    public func setSpotReticle(x: Double, y: Double) {
        spotReticleX = min(1, max(0, x))
        spotReticleY = min(1, max(0, y))
    }

    public func moveSpotReticle(horizontal: Double, vertical: Double) {
        setSpotReticle(
            x: spotReticleX + horizontal,
            y: spotReticleY + vertical
        )
        haptics.play(.selectionChanged)
    }

    public func setPreviewZoom(_ zoom: Double) {
        previewZoom = min(4, max(1, zoom))
    }

    public func flushPersistence() async {
        await persistenceTask?.value
    }

    public func flushPrivateCapturePersistence() async {
        await privateCaptureTask?.value
    }

    public func setPrivateCaptureEnabled(_ enabled: Bool) async {
        privateCaptureSettings.captureEnabled = enabled
        if !enabled { privateCaptureSettings.preciseLocationEnabled = false }
        await persistPrivateCaptureSettings()
    }

    public func setPrivatePreciseLocationEnabled(_ enabled: Bool) async {
        guard privateCaptureSettings.captureEnabled else { return }
        privateCaptureSettings.preciseLocationEnabled = enabled
        await persistPrivateCaptureSettings()
    }

    public func setPrivateCloudSyncEnabled(_ enabled: Bool) async {
        guard enabled else {
            privateCaptureSettings.privateCloudSyncEnabled = false
            privateCaptureSettings.privateCloudAccountIdentifier = nil
            await persistPrivateCaptureSettings()
            return
        }
        do {
            let accountID = try await privateCaptureStore.privateCloudAccountIdentifier()
            privateCaptureSettings.privateCloudSyncEnabled = true
            privateCaptureSettings.privateCloudAccountIdentifier = accountID
            await persistPrivateCaptureSettings()
        } catch {
            privateCaptureSettings.privateCloudSyncEnabled = false
            privateCaptureSettings.privateCloudAccountIdentifier = nil
            await persistPrivateCaptureSettings()
            privateCaptureMessage = "Private iCloud sync could not be enabled: \(error)"
            return
        }
        await synchronizePrivateCaptureIfEnabled(reportSuccess: true)
    }

    /// Pulls private ciphertext created on another device whenever the app becomes active.
    /// A temporary iCloud failure is reported only in the private-data panel and never prevents
    /// the meter, its public record writer, or the rest of durable state from loading.
    public func synchronizePrivateCaptureIfEnabled(reportSuccess: Bool = false) async {
        guard privateCaptureSettings.privateCloudSyncEnabled else { return }
        guard let expectedAccountID = await privateCloudAuthorizedAccountIdentifier() else { return }
        do {
            try await privateCaptureStore.synchronizePrivateCloud(
                expectedCloudAccountIdentifier: expectedAccountID
            )
            privateCaptureContextCount = try await privateCaptureStore.contexts().count
            privateCaptureDataMayExist = await privateCaptureStore.containsLocalPrivateData()
            if reportSuccess { privateCaptureMessage = "Private iCloud data is up to date." }
        } catch PrivateMeterCaptureError.privateCloudAccountChanged {
            await disablePrivateCloudAfterAccountChange()
        } catch {
            privateCaptureMessage = "Private iCloud sync could not finish: \(error)"
        }
    }

    public func exportPrivateCaptureData() async {
        do {
            let data = try await privateCaptureStore.exportJSON()
            guard let json = String(data: data, encoding: .utf8) else {
                throw PrivateMeterCaptureError.corruptLocalStore
            }
            privateCaptureExport = json
            privateCaptureMessage = "Private capture data is ready to share."
        } catch {
            privateCaptureMessage = "Private capture data could not be exported: \(error)"
        }
    }

    public func deleteAllPrivateCaptureData() async {
        privateCaptureDeletionGeneration += 1
        privateCaptureTask?.cancel()
        let syncWasRequested = privateCaptureSettings.privateCloudSyncEnabled
        let expectedAccountID =
            syncWasRequested ? await privateCloudAuthorizedAccountIdentifier() : nil
        do {
            try await privateCaptureStore.deleteAll(
                syncToPrivateCloud: expectedAccountID != nil,
                expectedCloudAccountIdentifier: expectedAccountID
            )
            privateCaptureContextCount = 0
            privateCaptureDataMayExist = false
            privateCaptureExport = nil
            privateCaptureMessage =
                syncWasRequested && expectedAccountID == nil
                ? "Local private capture data was deleted. Private iCloud was not changed because "
                    + "the account could not be verified."
                : "Private capture data deleted."
        } catch PrivateMeterCaptureError.privateCloudDeletionPending(let detail) {
            privateCaptureContextCount = 0
            privateCaptureDataMayExist = true
            privateCaptureExport = nil
            privateCaptureMessage =
                "Local private capture payloads were deleted. iCloud deletion markers are saved "
                + "locally for retry: \(detail)"
        } catch PrivateMeterCaptureError.privateCloudAccountChangedAfterLocalDeletion {
            privateCaptureContextCount = 0
            privateCaptureDataMayExist = true
            privateCaptureExport = nil
            await disablePrivateCloudAfterAccountChange(
                prefix: "Local private capture payloads were deleted. "
            )
        } catch {
            privateCaptureDataMayExist = await privateCaptureStore.containsLocalPrivateData()
            privateCaptureMessage = "Private capture data could not be deleted: \(error)"
        }
    }

    private func sourceSpotPoint(displayPoint: Double) -> Double {
        min(1, max(0, 0.5 + (displayPoint - 0.5) / previewZoom))
    }

    private func enqueuePrivateCaptureContextSave(
        for reading: Reading,
        publicReadingURI: String,
        settings: PrivateMeterCaptureSettings
    ) {
        let previous = privateCaptureTask
        let deletionGeneration = privateCaptureDeletionGeneration
        pendingPrivateCaptureOperations += 1
        isSavingPrivateCapture = true
        privateCaptureTask = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            if deletionGeneration == self.privateCaptureDeletionGeneration, !Task.isCancelled {
                await self.savePrivateCaptureContext(
                    for: reading,
                    publicReadingURI: publicReadingURI,
                    settings: settings,
                    deletionGeneration: deletionGeneration
                )
            }
            self.pendingPrivateCaptureOperations -= 1
            self.isSavingPrivateCapture = self.pendingPrivateCaptureOperations > 0
        }
    }

    private func savePrivateCaptureContext(
        for reading: Reading,
        publicReadingURI: String,
        settings: PrivateMeterCaptureSettings,
        deletionGeneration: Int
    ) async {
        let syncWasRequested = settings.privateCloudSyncEnabled
        let expectedAccountID =
            syncWasRequested ? await privateCloudAuthorizedAccountIdentifier() : nil
        var localSaveCompleted = false
        do {
            let context = try await privateCaptureCollector.context(
                for: reading,
                publicReadingURI: publicReadingURI,
                includePreciseLocation: settings.preciseLocationEnabled
            )
            guard deletionGeneration == privateCaptureDeletionGeneration, !Task.isCancelled else {
                return
            }
            try await privateCaptureStore.save(
                context,
                syncToPrivateCloud: expectedAccountID != nil,
                expectedCloudAccountIdentifier: expectedAccountID
            )
            localSaveCompleted = true
            privateCaptureContextCount = try await privateCaptureStore.contexts().count
            privateCaptureDataMayExist = true
            if !syncWasRequested || expectedAccountID != nil {
                privateCaptureMessage = "Private device context saved."
            }
        } catch is CancellationError {
            return
        } catch PrivateMeterCaptureError.keyUnavailable {
            guard deletionGeneration == privateCaptureDeletionGeneration else { return }
            privateCaptureMessage =
                "The public reading was saved, but private context could not be encrypted."
        } catch PrivateMeterCaptureError.privateCloudSaveFailedAfterLocalSave(let detail) {
            guard deletionGeneration == privateCaptureDeletionGeneration else { return }
            privateCaptureContextCount = (try? await privateCaptureStore.contexts().count) ?? 0
            privateCaptureDataMayExist = true
            privateCaptureMessage =
                "The public reading and local private context were saved, but private iCloud sync "
                + "could not finish: \(detail)"
        } catch PrivateMeterCaptureError.privateCloudAccountChangedAfterLocalSave {
            guard deletionGeneration == privateCaptureDeletionGeneration else { return }
            privateCaptureContextCount = (try? await privateCaptureStore.contexts().count) ?? 0
            privateCaptureDataMayExist = true
            await disablePrivateCloudAfterAccountChange(
                prefix: "The public reading and local private context were saved. "
            )
        } catch PrivateMeterCaptureError.privateContextAlreadyDeleted {
            guard deletionGeneration == privateCaptureDeletionGeneration else { return }
            privateCaptureContextCount = (try? await privateCaptureStore.contexts().count) ?? 0
            privateCaptureDataMayExist = true
            privateCaptureMessage =
                "The public reading was saved. Private context for this capture remains deleted."
        } catch {
            guard deletionGeneration == privateCaptureDeletionGeneration else { return }
            privateCaptureContextCount = (try? await privateCaptureStore.contexts().count) ?? 0
            privateCaptureDataMayExist = await privateCaptureStore.containsLocalPrivateData()
            privateCaptureMessage =
                localSaveCompleted
                ? "The public reading and local private context were saved, but the private data "
                    + "panel could not refresh: \(error)"
                : "The public reading was saved, but private context was not: \(error)"
        }
    }

    private func privateCloudAuthorizedAccountIdentifier() async -> String? {
        do {
            let currentAccountID = try await privateCaptureStore.privateCloudAccountIdentifier()
            guard
                privateCaptureSettings.privateCloudAccountIdentifier == currentAccountID
            else {
                privateCaptureSettings.privateCloudSyncEnabled = false
                privateCaptureSettings.privateCloudAccountIdentifier = nil
                await persistPrivateCaptureSettings()
                privateCaptureMessage =
                    "The iCloud account changed. Private sync is off until you review and enable it again."
                return nil
            }
            return currentAccountID
        } catch {
            privateCaptureMessage =
                "Hypo could not verify the current iCloud account, so no private data was synced: \(error)"
            return nil
        }
    }

    private func disablePrivateCloudAfterAccountChange(prefix: String = "") async {
        privateCaptureSettings.privateCloudSyncEnabled = false
        privateCaptureSettings.privateCloudAccountIdentifier = nil
        await persistPrivateCaptureSettings()
        privateCaptureMessage =
            prefix
            + "The iCloud account changed. Private sync is off until you review and enable it again."
    }

    private func persistPrivateCaptureSettings() async {
        do {
            try await privateCaptureSettingsStore.save(privateCaptureSettings)
            privateCaptureMessage = nil
        } catch {
            privateCaptureMessage = "Private capture choices could not be saved: \(error)"
        }
    }

    private var calibrationState: CalibrationProfileState {
        CalibrationProfileState(
            profiles: calibrationProfiles,
            selectedID: selectedCalibrationID
        )
    }

    private func persistHeldReadings() {
        let readings = heldReadings
        let previous = persistenceTask
        persistenceTask = Task { [weak self, heldReadingStore] in
            await previous?.value
            do {
                try await heldReadingStore.saveHeldReadings(readings)
            } catch {
                guard let self else { return }
                self.errorMessage =
                    MeterFeatureBoundaryError.statePersistence(
                        String(describing: error)
                    ).message
                self.haptics.play(.failure)
            }
        }
    }

    private func normalizeSpotAnalysisReference() {
        guard let spotAnalysisReferenceReadingID else { return }
        if !spotAnalysisReadings.contains(where: { $0.id == spotAnalysisReferenceReadingID }) {
            self.spotAnalysisReferenceReadingID = nil
        }
    }

    private func promote(readings: [Reading], preferredReadingID: UUID) async {
        guard !isPromoting else { return }
        isPromoting = true
        defer { isPromoting = false }
        let ids = Set(readings.map(\.id))
        let references = Dictionary(
            uniqueKeysWithValues: readingLog.compactMap { entry in
                ids.contains(entry.id) ? (entry.id, entry.reference) : nil
            }
        )
        do {
            try await promoter.promoteMeterReadings(
                LoggerExposureMeterPromotionRequest(
                    readings: readings,
                    preferredReadingID: preferredReadingID,
                    recordReferences: references,
                    requestedAt: now()
                )
            )
            confirmationMessage = "Reading ready in Logger"
            errorMessage = nil
            selectedReadingLogIDs.subtract(ids)
            haptics.play(.actionSucceeded)
        } catch {
            errorMessage = MeterFeatureBoundaryError.promotion(String(describing: error)).message
            confirmationMessage = nil
            haptics.play(.failure)
        }
    }

    private func persistenceMessage(for error: any Error) -> String {
        if let boundary = error as? MeterFeatureBoundaryError {
            return boundary.message
        }
        return MeterFeatureBoundaryError.persistence(String(describing: error)).message
    }
}

extension StoredMeterReading {
    fileprivate var searchText: String {
        let reading = reading
        return [
            String(format: "%.1f", reading.ev100.rawValue),
            reading.geometry.rawValue,
            reading.camera.name,
            reading.camera.id,
            reading.camera.module.rawValue,
            reading.sensorPath.rawValue,
            reading.accuracyTier.rawValue,
            reading.flags.sorted().map(\.rawValue).joined(separator: " "),
            deviceModelName,
            reference.uri,
        ].joined(separator: " ").lowercased()
    }
}
