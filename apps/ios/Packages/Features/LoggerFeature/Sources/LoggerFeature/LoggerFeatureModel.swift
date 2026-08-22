import Foundation
import HypoLexicon
import Observation

@MainActor
@Observable
public final class LoggerFeatureModel {
    public private(set) var activeRoll: ActiveRoll
    public private(set) var availableRolls: [ActiveRoll]
    public var draft: ExposureDraft
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
    public private(set) var confirmation: String?
    public private(set) var error: LoggerError?

    private let writer: any ExposureWriting
    private let lifecycleWriter: (any FilmRollLifecycleWriting)?
    private let frameDetailStore: (any FrameDetailStoring)?
    private let locationProvider: (any ShootLocationProviding)?
    private let now: @MainActor @Sendable () -> Date

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
        draft.shotAtISO = enabled ? activeRoll.exposureIndex : nil
    }

    public func selectActiveRoll(_ uri: ATURI) {
        guard let selected = availableRolls.first(where: { $0.uri == uri }) else { return }
        activeRoll = selected
        draft.roll = selected.uri
        draft.frameNumber = selected.nextFrameNumber
        draft.camera = selected.camera
        draft.shotAtISO = nil
        draft.multipleExposure = false
        draft.frameExposureIndex = nil
        draft.note = ""
        draft.meterReadings = []
        frameSummaries = []
        frameDetails = []
        selectedFrameNumber = nil
        confirmation = nil
        error = nil
    }

    public func replaceAvailableRolls(_ rolls: [ActiveRoll], preferred uri: ATURI? = nil) {
        availableRolls = Self.normalizedRolls(activeRoll: activeRoll, availableRolls: rolls)
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
            error = .locationUnavailable("Allow location access in Settings to use this option.")
            return
        }
        locationEnabledShoots.insert(shoot)
        error = nil
    }

    public func logFrame() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        do {
            var recordDraft = draft
            if let shoot = draft.shoot, locationEnabledShoots.contains(shoot) {
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
            let record = try recordDraft.record(createdAt: ATProtoDate(now()))
            try await writer.createExposure(record: record)
            activeRoll.exposuresUsed = max(activeRoll.exposuresUsed, draft.frameNumber)
            updateSelectedRollInList()
            confirmation = "Frame \(draft.frameNumber) logged"
            error = nil

            if draft.multipleExposure {
                draft.frameExposureIndex = (draft.frameExposureIndex ?? 1) + 1
            } else {
                draft.frameNumber += 1
                draft.frameExposureIndex = nil
            }
            draft.note = ""
            draft.meterReadings = []
        } catch let loggerError as LoggerError {
            error = loggerError
            confirmation = nil
        } catch {
            self.error = .write(String(describing: error))
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
            confirmation = nil
            throw loggerError
        } catch {
            let writeError = LoggerError.write(String(describing: error))
            self.error = writeError
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
        defer { isLoadingFrameDetails = false }
        do {
            frameDetails = try await frameDetailStore.exposures(
                roll: activeRoll.uri,
                frameNumber: frameNumber
            )
            selectedFrameNumber = frameNumber
            editingExposure = nil
            error = nil
        } catch {
            self.error = .read(String(describing: error))
            frameDetails = []
        }
    }

    public func loadFrameList() async {
        guard let frameDetailStore else {
            error = .frameDetailsUnavailable
            frameSummaries = []
            return
        }
        guard !isLoadingFrameDetails else { return }
        isLoadingFrameDetails = true
        defer { isLoadingFrameDetails = false }
        do {
            frameSummaries = try await frameDetailStore.frames(roll: activeRoll.uri)
                .sorted { $0.frameNumber > $1.frameNumber }
            selectedFrameNumber = nil
            editingExposure = nil
            error = nil
        } catch {
            self.error = .read(String(describing: error))
            frameSummaries = []
        }
    }

    public func closeSelectedFrame() {
        selectedFrameNumber = nil
        editingExposure = nil
        frameDetails = []
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
            if let index = frameDetails.firstIndex(where: { $0.uri == editingExposure.uri }) {
                frameDetails[index] = editingExposure
            }
            frameSummaries = try await frameDetailStore.frames(roll: activeRoll.uri)
                .sorted { $0.frameNumber > $1.frameNumber }
            self.editingExposure = nil
            error = nil
            confirmation = "Frame \(editingExposure.draft.frameNumber) updated"
        } catch let loggerError as LoggerError {
            error = loggerError
            confirmation = nil
        } catch {
            self.error = .write(String(describing: error))
            confirmation = nil
        }
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
