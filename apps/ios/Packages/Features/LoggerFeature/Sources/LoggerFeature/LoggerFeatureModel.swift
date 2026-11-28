import Foundation
import DesignSystem
import HypoLexicon
import Observation
import SyncKit

@MainActor
@Observable
public final class LoggerFeatureModel {
    public private(set) var activeRoll: ActiveRoll
    public private(set) var availableRolls: [ActiveRoll]
    public var draft: ExposureDraft
    public var draftTakenAt: Date?
    public private(set) var exposureControls: ExposureControlOptions
    public private(set) var shoots: [ShootAssociation]
    public private(set) var locationEnabledShoots: Set<ATURI>
    public private(set) var isRequestingLocation = false
    public private(set) var frameSummaries: [FrameSummary] = []
    public private(set) var frameDetails: [ExposureDetail] = []
    public private(set) var selectedFrameNumber: Int?
    public var editingExposure: ExposureDetail?
    public private(set) var isSaving = false
    public private(set) var isSavingLifecycle = false
    public private(set) var isLoadingFrameDetails = false
    public private(set) var isLoadingFrameList = false
    public private(set) var confirmation: String?
    public private(set) var error: LoggerError?

    public var errorPresentation: HypoErrorPresentation? { error?.presentation }

    private let writer: any ExposureWriting
    private let lifecycleWriter: (any FilmRollLifecycleWriting)?
    private let frameDetailStore: (any FrameDetailStoring)?
    private let locationProvider: (any ShootLocationProviding)?
    private let now: @MainActor @Sendable () -> Date
    private var frameListRequest = UUID()

    public init(
        activeRoll: ActiveRoll,
        availableRolls: [ActiveRoll] = [],
        camera: ATURI? = nil,
        lens: ATURI? = nil,
        writer: any ExposureWriting,
        lifecycleWriter: (any FilmRollLifecycleWriting)? = nil,
        frameDetailStore: (any FrameDetailStoring)? = nil,
        locationProvider: (any ShootLocationProviding)? = nil,
        exposureControls: ExposureControlOptions = ExposureControlOptions(),
        shoots: [ShootAssociation] = [],
        shoot: ATURI? = nil,
        locationEnabledShoots: Set<ATURI> = [],
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) {
        self.activeRoll = activeRoll
        self.availableRolls = Self.normalizedRolls(
            activeRoll: activeRoll,
            availableRolls: availableRolls
        )
        self.writer = writer
        self.lifecycleWriter = lifecycleWriter
        self.frameDetailStore = frameDetailStore
        self.locationProvider = locationProvider
        self.exposureControls = exposureControls
        self.shoots = shoots
        self.locationEnabledShoots = locationEnabledShoots
        self.now = now
        draft = ExposureDraft(
            roll: activeRoll.uri,
            frameNumber: activeRoll.nextFrameNumber,
            shoot: shoot,
            camera: camera ?? activeRoll.camera,
            lens: lens
        )
        if !exposureControls.apertures.contains(draft.aperture) {
            draft.aperture = exposureControls.apertures[0]
        }
        if !exposureControls.shutterSpeeds.contains(draft.shutterSpeed) {
            draft.shutterSpeed = exposureControls.shutterSpeeds[0]
        }
    }

    public var hasExposureIndexOverride: Bool { draft.shotAtISO != nil }

    public var canInspectFrames: Bool { frameDetailStore != nil }

    public var canCaptureShootLocation: Bool { locationProvider != nil }

    public var isLocationCaptureEnabledForSelectedShoot: Bool {
        draft.shoot.map(locationEnabledShoots.contains) ?? false
    }

    public var apertureIndex: Int {
        exposureControls.apertures.firstIndex(of: draft.aperture) ?? 0
    }

    public var shutterSpeedIndex: Int {
        exposureControls.shutterSpeeds.firstIndex(of: draft.shutterSpeed) ?? 0
    }

    public var availableLifecycleActions: [FilmRollLifecycleAction] {
        FilmRollLifecycleAction.allCases.filter { $0.date(in: activeRoll.milestones) == nil }
    }

    public func setExposureIndexOverrideEnabled(_ enabled: Bool) {
        draft.shotAtISO = enabled ? draft.shotAtISO ?? activeRoll.exposureIndex ?? 100 : nil
    }

    public func selectActiveRoll(_ uri: ATURI) {
        guard !isSaving, !isSavingLifecycle, !isLoadingFrameDetails, uri != activeRoll.uri,
            let selected = availableRolls.first(where: { $0.uri == uri })
        else { return }
        activeRoll = selected
        draft.roll = selected.uri
        draft.frameNumber = selected.nextFrameNumber
        draft.camera = selected.camera
        draft.lens = nil
        draft.shotAtISO = nil
        draft.multipleExposure = false
        draft.frameExposureIndex = nil
        draft.note = ""
        draft.meterReadings = []
        draft.location = nil
        draftTakenAt = nil
        frameSummaries = []
        frameDetails = []
        selectedFrameNumber = nil
        confirmation = nil
        error = nil
    }

    public func replaceAvailableRolls(_ rolls: [ActiveRoll], preferred uri: ATURI? = nil) {
        guard !isSaving, !isSavingLifecycle, !isLoadingFrameDetails else { return }
        let previous = activeRoll
        availableRolls = Self.normalizedRolls(activeRoll: activeRoll, availableRolls: rolls)
        if let updated = availableRolls.first(where: { $0.uri == previous.uri }) {
            activeRoll = updated
            activeRoll.exposuresUsed = max(previous.exposuresUsed, updated.exposuresUsed)
            if !draft.multipleExposure, draft.frameNumber == previous.nextFrameNumber {
                draft.frameNumber = activeRoll.nextFrameNumber
            }
            if draft.camera == previous.camera { draft.camera = updated.camera }
            updateSelectedRollInList()
        }
        if let uri, availableRolls.contains(where: { $0.uri == uri }) {
            selectActiveRoll(uri)
        } else if !availableRolls.contains(where: { $0.uri == activeRoll.uri }),
            let first = availableRolls.first
        {
            selectActiveRoll(first.uri)
        }
    }

    public func associateWithShoot(_ shoot: ATURI?) {
        draft.shoot = shoot
    }

    public func replaceShoots(_ shoots: [ShootAssociation]) {
        self.shoots = shoots
        if let selected = draft.shoot, !shoots.contains(where: { $0.uri == selected }) {
            draft.shoot = nil
        }
    }

    public func selectAperture(at index: Int) {
        guard exposureControls.apertures.indices.contains(index) else { return }
        draft.aperture = exposureControls.apertures[index]
    }

    public func selectShutterSpeed(at index: Int) {
        guard exposureControls.shutterSpeeds.indices.contains(index) else { return }
        draft.shutterSpeed = exposureControls.shutterSpeeds[index]
    }

    public func replaceExposureControls(_ controls: ExposureControlOptions) {
        exposureControls = controls
        if !controls.apertures.contains(draft.aperture) {
            draft.aperture = controls.apertures[0]
        }
        if !controls.shutterSpeeds.contains(draft.shutterSpeed) {
            draft.shutterSpeed = controls.shutterSpeeds[0]
        }
    }

    /// Enables GPS capture only after an explicit action for the selected shoot.
    /// Disabling never touches the location boundary.
    public func setLocationCaptureEnabled(_ enabled: Bool) async {
        guard let shoot = draft.shoot else { return }
        if !enabled {
            locationEnabledShoots.remove(shoot)
            return
        }
        guard let locationProvider else {
            error = .locationUnavailable("Location is not available on this device.")
            return
        }
        guard !isRequestingLocation else { return }
        isRequestingLocation = true
        defer { isRequestingLocation = false }
        guard await locationProvider.requestWhenInUseAuthorization() else {
            error = .locationPermissionDenied
            return
        }
        locationEnabledShoots.insert(shoot)
        error = nil
    }

    public func logFrame() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        let submitted = draft
        let submittedTakenAt = draftTakenAt
        do {
            var recordDraft = submitted
            if let shoot = submitted.shoot, locationEnabledShoots.contains(shoot) {
                guard let locationProvider else {
                    throw LoggerError.locationUnavailable(
                        "Location is not available on this device."
                    )
                }
                do {
                    recordDraft.location = try await locationProvider.currentLocation()
                } catch {
                    throw LoggerError.locationUnavailable(String(describing: error))
                }
            }
            let createdAt = ATProtoDate(now())
            let record = try recordDraft.record(
                createdAt: createdAt,
                takenAt: submittedTakenAt.map(ATProtoDate.init) ?? createdAt
            )
            try await writer.createExposure(record: record)
            activeRoll.exposuresUsed = max(activeRoll.exposuresUsed, submitted.frameNumber)
            updateSelectedRollInList()
            confirmation = "Frame \(submitted.frameNumber) logged"
            error = nil

            if draft.frameNumber == submitted.frameNumber
                && draft.multipleExposure == submitted.multipleExposure
            {
                if submitted.multipleExposure {
                    draft.frameExposureIndex = (submitted.frameExposureIndex ?? 1) + 1
                } else {
                    draft.frameNumber = submitted.frameNumber + 1
                    draft.frameExposureIndex = nil
                }
            }
            if draft.note == submitted.note { draft.note = "" }
            if draftTakenAt == submittedTakenAt { draftTakenAt = nil }
            draft.meterReadings.removeAll { submitted.meterReadings.contains($0) }
        } catch let loggerError as LoggerError {
            error = loggerError
            HypoErrorReporter.record(loggerError, presentation: loggerError.presentation)
            confirmation = nil
        } catch {
            self.error = userFacingWriteError(for: error)
            HypoErrorReporter.record(error, presentation: self.error!.presentation)
            confirmation = nil
        }
    }

    public func updateMilestones(_ milestones: FilmRollMilestones) throws {
        let issues = ConsumableLifecycleValidator.validate(milestones)
        guard issues.isEmpty else { throw LoggerError.lifecycle(issues) }
        activeRoll.milestones = milestones
        updateSelectedRollInList()
    }

    public func applyLifecycleAction(
        _ action: FilmRollLifecycleAction,
        at date: Date? = nil
    ) async throws {
        let change = action.applying(
            to: activeRoll.milestones,
            at: ATProtoDate(date ?? now())
        )
        try await saveMilestones(
            change.milestones,
            developmentLocation: change.developmentLocation ?? activeRoll.developmentLocation
        )
    }

    public func saveMilestones(
        _ milestones: FilmRollMilestones,
        developmentLocation: FilmRollDevelopmentLocation? = nil
    ) async throws {
        guard !isSavingLifecycle else { return }
        let issues = ConsumableLifecycleValidator.validate(milestones)
        guard issues.isEmpty else {
            let lifecycleError = LoggerError.lifecycle(issues)
            error = lifecycleError
            confirmation = nil
            throw lifecycleError
        }

        isSavingLifecycle = true
        defer { isSavingLifecycle = false }
        do {
            let update = FilmRollLifecycleUpdate(
                roll: activeRoll.uri,
                milestones: milestones,
                developmentLocation: developmentLocation,
                updatedAt: ATProtoDate(now())
            )
            try await lifecycleWriter?.updateFilmRollLifecycle(update)
            activeRoll.milestones = milestones
            activeRoll.developmentLocation = developmentLocation
            updateSelectedRollInList()
            error = nil
            confirmation = "Roll dates updated"
        } catch let loggerError as LoggerError {
            error = loggerError
            HypoErrorReporter.record(loggerError, presentation: loggerError.presentation)
            confirmation = nil
            throw loggerError
        } catch {
            let writeError = userFacingWriteError(for: error)
            self.error = writeError
            HypoErrorReporter.record(error, presentation: writeError.presentation)
            confirmation = nil
            throw writeError
        }
    }

    public func loadFrameDetails(frameNumber: Int) async {
        guard let frameDetailStore else {
            error = .frameDetailsUnavailable
            frameDetails = []
            return
        }
        guard !isLoadingFrameDetails else { return }
        isLoadingFrameDetails = true
        selectedFrameNumber = frameNumber
        editingExposure = nil
        defer { isLoadingFrameDetails = false }
        do {
            frameDetails = try await frameDetailStore.exposures(
                roll: activeRoll.uri,
                frameNumber: frameNumber
            )
            error = nil
        } catch {
            self.error = .read(String(describing: error))
            HypoErrorReporter.record(error, presentation: self.error!.presentation)
            frameDetails = []
        }
    }

    public func loadFrameList() async {
        await loadFrameList(refresh: true)
    }

    private func loadFrameList(refresh: Bool) async {
        guard let frameDetailStore else {
            error = .frameDetailsUnavailable
            frameSummaries = []
            return
        }
        let request = UUID()
        frameListRequest = request
        let roll = activeRoll.uri
        isLoadingFrameList = true
        selectedFrameNumber = nil
        editingExposure = nil
        defer {
            if frameListRequest == request { isLoadingFrameList = false }
        }
        do {
            let cached = try await frameDetailStore.cachedFrames(roll: roll)
            guard frameListRequest == request, activeRoll.uri == roll, !Task.isCancelled else { return }
            frameSummaries = cached.sorted { $0.frameNumber > $1.frameNumber }
            error = nil
            if refresh {
                let refreshed = try await frameDetailStore.frames(roll: roll)
                guard frameListRequest == request, activeRoll.uri == roll, !Task.isCancelled else { return }
                frameSummaries = refreshed.sorted { $0.frameNumber > $1.frameNumber }
            }
        } catch {
            guard frameListRequest == request, activeRoll.uri == roll, !Task.isCancelled else { return }
            self.error = .read(String(describing: error))
            HypoErrorReporter.record(error, presentation: self.error!.presentation)
        }
    }

    public func closeSelectedFrame() {
        selectedFrameNumber = nil
        editingExposure = nil
        frameDetails = []
    }

    public func exportExposures() async throws -> [ExposureDetail] {
        guard let frameDetailStore else { throw LoggerError.frameDetailsUnavailable }
        return try await frameDetailStore.exposures(roll: activeRoll.uri)
    }

    public func beginEditing(_ exposure: ExposureDetail) {
        editingExposure = exposure
    }

    public func cancelEditingExposure() {
        editingExposure = nil
    }

    public func saveEditingExposure() async {
        guard let frameDetailStore, let editingExposure else {
            error = .frameDetailsUnavailable
            return
        }
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let record = try editingExposure.updatedRecord(at: ATProtoDate(now()))
            try await frameDetailStore.updateExposure(uri: editingExposure.uri, record: record)
            self.editingExposure = nil
            error = nil
            confirmation = "Frame \(editingExposure.draft.frameNumber) updated"
        } catch let loggerError as LoggerError {
            error = loggerError
            HypoErrorReporter.record(loggerError, presentation: loggerError.presentation)
            confirmation = nil
            return
        } catch {
            self.error = userFacingWriteError(for: error)
            HypoErrorReporter.record(error, presentation: self.error!.presentation)
            confirmation = nil
            return
        }
        await loadFrameList(refresh: false)
        if error == nil { await loadFrameDetails(frameNumber: editingExposure.draft.frameNumber) }
    }

    public func dismissError() {
        error = nil
    }

    private func userFacingWriteError(for error: any Error) -> LoggerError {
        if let syncError = error as? ATProtoSyncAdapterError,
            case .missingSession = syncError
        {
            return .authenticationRequired
        }
        return .write(String(reflecting: error))
    }

    private static func normalizedRolls(
        activeRoll: ActiveRoll,
        availableRolls: [ActiveRoll]
    ) -> [ActiveRoll] {
        var seen = Set<ATURI>()
        let values = availableRolls.isEmpty ? [activeRoll] : availableRolls
        return values.filter { seen.insert($0.uri).inserted }
    }

    private func updateSelectedRollInList() {
        guard let index = availableRolls.firstIndex(where: { $0.uri == activeRoll.uri }) else {
            return
        }
        availableRolls[index] = activeRoll
    }
}
