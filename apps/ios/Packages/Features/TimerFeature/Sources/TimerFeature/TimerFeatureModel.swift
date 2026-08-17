import DesignSystem
import Foundation
import HypoLexicon
import Observation
import TimerEngine

/// The timer feature's presentation state and user-driven transitions.
@MainActor
@Observable
public final class TimerFeatureModel {
    public private(set) var run: DevelopmentTimerRun
    public private(set) var snapshot: TimerSnapshot?
    public private(set) var selectedRecipe: DevelopmentRecipeSelection
    public private(set) var availableRecipes: [DevelopmentRecipeSelection]
    public private(set) var availableFilmRolls: [DevelopmentFilmRollOption]
    public private(set) var linkedFilmRolls: [ATURI]
    public private(set) var observations: [String: DevelopmentStageObservation]
    public private(set) var manualStageStates: [String: DevelopmentManualStageState]
    public private(set) var finishedAt: Date?
    public private(set) var errorMessage: String?
    public private(set) var isLoadingRecipes = false
    public private(set) var isPersisting = false

    private var generation: Int
    private var startedAt: Date?
    private var completionState: DevelopmentCompletionState
    private var developmentSessionURI: ATURI?
    private let recipeProvider: (any DevelopmentRecipeProviding)?
    private let pipeline: TimerSessionPipeline
    private let haptics: any HypoHapticPlaying
    private let platformPresenter: any TimerPlatformPresenting
    private let now: @MainActor @Sendable () -> Date
    private var persistenceTask: Task<TimerFeatureSessionState?, Never>?
    private var hasAttemptedDurableRestore = false

    public init(
        run: DevelopmentTimerRun,
        platformPresenter: any TimerPlatformPresenting = SystemTimerPlatformPresenter.shared,
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) {
        let recipe = Self.recipe(for: run.plan)
        self.run = run
        selectedRecipe = recipe
        availableRecipes = [recipe]
        availableFilmRolls = []
        linkedFilmRolls = []
        observations = [:]
        manualStageStates = Self.initialManualStageStates(for: recipe)
        finishedAt = nil
        generation = 0
        startedAt = run.status == .ready ? nil : run.lastObservedAt
        completionState = .pending
        recipeProvider = nil
        pipeline = TimerSessionPipeline(
            store: InMemoryTimerFeatureSessionStore(),
            writer: DiscardingDevelopmentSessionWriter(),
            rollAdvancer: DiscardingFilmRollDevelopmentAdvancer()
        )
        haptics = SystemHypoHaptics.shared
        self.platformPresenter = platformPresenter
        self.now = now
        refreshWithoutPersistence()
        reconcilePlatformPresentation()
    }

    public convenience init(
        plan: TimerPlan,
        platformPresenter: any TimerPlatformPresenting = SystemTimerPlatformPresenter.shared,
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) {
        self.init(
            run: DevelopmentTimerRun(plan: plan),
            platformPresenter: platformPresenter,
            now: now
        )
    }

    public init(
        recipe: DevelopmentRecipeSelection,
        linkedFilmRolls: [ATURI] = [],
        recipeProvider: (any DevelopmentRecipeProviding)? = nil,
        store: any TimerFeatureSessionStoring,
        completionWriter: any DevelopmentSessionWriting,
        rollAdvancer: any FilmRollDevelopmentAdvancing,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared,
        platformPresenter: any TimerPlatformPresenting = SystemTimerPlatformPresenter.shared,
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) {
        run = DevelopmentTimerRun(plan: recipe.plan)
        selectedRecipe = recipe
        availableRecipes = [recipe]
        availableFilmRolls = []
        self.linkedFilmRolls = linkedFilmRolls
        observations = [:]
        manualStageStates = Self.initialManualStageStates(for: recipe)
        finishedAt = nil
        generation = 0
        completionState = .pending
        self.recipeProvider = recipeProvider
        pipeline = TimerSessionPipeline(
            store: store,
            writer: completionWriter,
            rollAdvancer: rollAdvancer
        )
        self.haptics = haptics
        self.platformPresenter = platformPresenter
        self.now = now
        refreshWithoutPersistence()
        reconcilePlatformPresentation()
    }

    private init(
        restored session: TimerFeatureSessionState,
        availableRecipes: [DevelopmentRecipeSelection],
        recipeProvider: (any DevelopmentRecipeProviding)?,
        pipeline: TimerSessionPipeline,
        haptics: any HypoHapticPlaying,
        platformPresenter: any TimerPlatformPresenting,
        now: @escaping @MainActor @Sendable () -> Date
    ) {
        run = session.run
        selectedRecipe = session.recipe
        self.availableRecipes = availableRecipes
        availableFilmRolls = []
        linkedFilmRolls = session.linkedFilmRolls
        observations = session.observations
        manualStageStates = Self.mergedManualStageStates(for: session)
        finishedAt = session.finishedAt
        generation = session.generation
        startedAt = session.startedAt
        completionState = session.completionState
        developmentSessionURI = session.developmentSessionURI
        self.recipeProvider = recipeProvider
        self.pipeline = pipeline
        self.haptics = haptics
        self.platformPresenter = platformPresenter
        self.now = now
        hasAttemptedDurableRestore = true
        refreshWithoutPersistence()
        reconcilePlatformPresentation()
    }

    public static func restore(
        recipeProvider: (any DevelopmentRecipeProviding)? = nil,
        store: any TimerFeatureSessionStoring,
        completionWriter: any DevelopmentSessionWriting,
        rollAdvancer: any FilmRollDevelopmentAdvancing,
        haptics: any HypoHapticPlaying = SystemHypoHaptics.shared,
        platformPresenter: any TimerPlatformPresenting = SystemTimerPlatformPresenter.shared,
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) async throws -> TimerFeatureModel? {
        let pipeline = TimerSessionPipeline(
            store: store,
            writer: completionWriter,
            rollAdvancer: rollAdvancer
        )
        guard let session = try await pipeline.load() else { return nil }
        let model = TimerFeatureModel(
            restored: session,
            availableRecipes: [session.recipe],
            recipeProvider: recipeProvider,
            pipeline: pipeline,
            haptics: haptics,
            platformPresenter: platformPresenter,
            now: now
        )
        let caughtUpDuringRestore = model.run != session.run
        model.refresh()
        if caughtUpDuringRestore
            || (session.isReadyForCompletion && session.completionState != .written)
        {
            model.queuePersistence()
        }
        return model
    }

    /// Restores into an already-composed live model. This lets the synchronous app shell create
    /// feature state while file I/O and wall-clock catch-up remain asynchronous.
    public func restoreDurableSession() async {
        guard !hasAttemptedDurableRestore else { return }
        hasAttemptedDurableRestore = true
        guard run.status == .ready, generation == 0 else { return }
        do {
            guard let session = try await pipeline.load() else { return }
            let storedRun = session.run
            run = session.run
            selectedRecipe = session.recipe
            availableRecipes = [session.recipe]
            let availableURIs = Set(availableFilmRolls.map(\.uri))
            linkedFilmRolls =
                run.status == .ready && !availableURIs.isEmpty
                ? session.linkedFilmRolls.filter { availableURIs.contains($0) }
                : session.linkedFilmRolls
            observations = session.observations
            manualStageStates = Self.mergedManualStageStates(for: session)
            finishedAt = session.finishedAt
            generation = session.generation
            startedAt = session.startedAt
            completionState = session.completionState
            developmentSessionURI = session.developmentSessionURI
            refreshWithoutPersistence()
            reconcilePlatformPresentation()
            if run != storedRun || linkedFilmRolls != session.linkedFilmRolls
                || (session.isReadyForCompletion && completionState != .written)
            {
                queuePersistence()
            }
        } catch let error as TimerFeatureError {
            errorMessage = error.message
            haptics.play(.failure)
        } catch {
            errorMessage = TimerFeatureError.persistence(String(describing: error)).message
            haptics.play(.failure)
        }
    }

    public var primaryActionTitle: String {
        switch run.status {
        case .ready: "Start"
        case .running: "Pause"
        case .paused: "Resume"
        case .completed: "Done"
        case .cancelled: "Cancelled"
        }
    }

    public var canSkip: Bool {
        run.status == .running || run.status == .paused
    }

    public var canExtend: Bool { canSkip }

    public var canEditFilmRollLinks: Bool { run.status == .ready }

    public var filmRollSelectionSummary: String {
        switch linkedFilmRolls.count {
        case 0: "No film rolls"
        case 1: title(for: linkedFilmRolls[0])
        default: "\(linkedFilmRolls.count) film rolls"
        }
    }

    public var currentStageObservation: DevelopmentStageObservation {
        observations[run.currentStage.id.rawValue] ?? DevelopmentStageObservation()
    }

    public var currentRecipeStage: DevelopmentRecipeStage? {
        selectedRecipe.stages.first { $0.timerStage?.id == run.currentStage.id }
    }

    public var manualStages: [DevelopmentRecipeStage] {
        selectedRecipe.stages.filter(\.isManual)
    }

    public var activeManualStage: DevelopmentRecipeStage? {
        guard run.status == .completed else { return nil }
        return manualStages.first {
            manualStageStates[$0.id.rawValue, default: .pending] == .pending
        }
    }

    public var isProcessComplete: Bool {
        guard run.status == .completed else { return false }
        return activeManualStage == nil
    }

    public func observation(for stage: TimerStageID) -> DevelopmentStageObservation {
        observations[stage.rawValue] ?? DevelopmentStageObservation()
    }

    public func manualStageState(for stage: DevelopmentRecipeStage) -> DevelopmentManualStageState {
        manualStageStates[stage.id.rawValue, default: .pending]
    }

    public func loadRecipes() async {
        guard let recipeProvider else { return }
        isLoadingRecipes = true
        defer { isLoadingRecipes = false }
        do {
            let remote = try await recipeProvider.recipes()
            var recipesByID = Dictionary(
                uniqueKeysWithValues: availableRecipes.map { ($0.id, $0) }
            )
            for recipe in remote { recipesByID[recipe.id] = recipe }
            availableRecipes = recipesByID.values.sorted {
                if $0.provenance.origin == $1.provenance.origin {
                    return $0.plan.name.localizedStandardCompare($1.plan.name) == .orderedAscending
                }
                return $0.provenance.origin.sortOrder < $1.provenance.origin.sortOrder
            }
            errorMessage = nil
        } catch {
            errorMessage = TimerFeatureError.recipeUnavailable(String(describing: error)).message
            haptics.play(.failure)
        }
    }

    public func selectRecipe(id: String) {
        guard run.status == .ready else {
            errorMessage = "A recipe cannot be changed after the timer starts."
            haptics.play(.warning)
            return
        }
        guard let recipe = availableRecipes.first(where: { $0.id == id }) else {
            errorMessage = TimerFeatureError.invalidRecipe("No recipe with identifier \(id).").message
            haptics.play(.failure)
            return
        }
        let replacedRunID = run.id
        selectedRecipe = recipe
        run = DevelopmentTimerRun(plan: recipe.plan)
        observations = [:]
        manualStageStates = Self.initialManualStageStates(for: recipe)
        finishedAt = nil
        snapshot = nil
        completionState = .pending
        developmentSessionURI = nil
        errorMessage = nil
        refreshWithoutPersistence()
        platformPresenter.invalidate(runID: replacedRunID)
        reconcilePlatformPresentation()
        haptics.play(.selectionChanged)
        queuePersistence()
    }

    /// Replaces the active-roll choices without selecting one implicitly.
    ///
    /// Any ready-session selection that is no longer present is removed. Once a timer starts,
    /// its links are frozen so a repository refresh cannot change the record being timed.
    public func setAvailableFilmRolls(_ rolls: [DevelopmentFilmRollOption]) {
        var seen = Set<ATURI>()
        availableFilmRolls = rolls.filter { seen.insert($0.uri).inserted }
        guard canEditFilmRollLinks else { return }
        let availableURIs = Set(availableFilmRolls.map(\.uri))
        let validated = linkedFilmRolls.filter { availableURIs.contains($0) }
        guard validated != linkedFilmRolls else { return }
        linkedFilmRolls = validated
        queuePersistence()
    }

    public func isFilmRollLinked(_ uri: ATURI) -> Bool {
        linkedFilmRolls.contains(uri)
    }

    public func toggleFilmRollLink(_ uri: ATURI) {
        guard canEditFilmRollLinks else {
            errorMessage = "Film rolls cannot be changed after the timer starts."
            haptics.play(.warning)
            return
        }
        guard availableFilmRolls.contains(where: { $0.uri == uri }) else {
            errorMessage = "That film roll is no longer available."
            haptics.play(.warning)
            return
        }
        if let index = linkedFilmRolls.firstIndex(of: uri) {
            linkedFilmRolls.remove(at: index)
        } else {
            linkedFilmRolls.append(uri)
            linkedFilmRolls.sort { $0.rawValue < $1.rawValue }
        }
        errorMessage = nil
        haptics.play(.selectionChanged)
        queuePersistence()
    }

    public func clearFilmRollLinks() {
        guard canEditFilmRollLinks else {
            errorMessage = "Film rolls cannot be changed after the timer starts."
            haptics.play(.warning)
            return
        }
        guard !linkedFilmRolls.isEmpty else { return }
        linkedFilmRolls = []
        errorMessage = nil
        haptics.play(.selectionChanged)
        queuePersistence()
    }

    /// Retained for callers that restore a known explicit selection by URI. New app composition
    /// should provide displayable choices with `setAvailableFilmRolls(_:)` and let the user select.
    public func setLinkedFilmRolls(_ rolls: [ATURI]) {
        guard canEditFilmRollLinks else {
            errorMessage = "Film rolls cannot be changed after the timer starts."
            haptics.play(.warning)
            return
        }
        let availableURIs = Set(availableFilmRolls.map(\.uri))
        let unique = Array(Set(rolls)).sorted { $0.rawValue < $1.rawValue }
        linkedFilmRolls =
            availableURIs.isEmpty
            ? unique
            : unique.filter { availableURIs.contains($0) }
        queuePersistence()
    }

    public func setActualTemperature(_ celsius: Double?, for stage: TimerStageID? = nil) {
        updateObservation(for: stage ?? run.currentStage.id) {
            $0.actualTemperatureCelsius = celsius
        }
    }

    public func setObservedAgitation(_ note: String?, for stage: TimerStageID? = nil) {
        updateObservation(for: stage ?? run.currentStage.id) {
            $0.observedAgitation = note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
    }

    public func setActualDuration(_ duration: TimeInterval?, for stage: TimerStageID) {
        updateObservation(for: stage) {
            $0.actualDuration = duration.map { max(0, $0) }
        }
    }

    public func completeManualStage(_ stageID: TimerStageID) {
        guard run.status == .completed,
            let stage = manualStages.first(where: { $0.id == stageID }),
            activeManualStage?.id == stageID,
            manualStageState(for: stage) == .pending
        else {
            errorMessage = "That manual stage is not ready to complete."
            haptics.play(.warning)
            return
        }
        manualStageStates[stageID.rawValue] = .completed
        finishManualSequenceIfNeeded()
    }

    public func skipManualStage(_ stageID: TimerStageID) {
        guard run.status == .completed,
            let stage = manualStages.first(where: { $0.id == stageID }),
            activeManualStage?.id == stageID,
            stage.isOptional,
            manualStageState(for: stage) == .pending
        else {
            errorMessage = "Only a pending optional stage can be skipped."
            haptics.play(.warning)
            return
        }
        manualStageStates[stageID.rawValue] = .skipped
        finishManualSequenceIfNeeded()
    }

    public func performPrimaryAction() {
        let date = now()
        let previous = run
        let previousStageIndex = run.currentStageIndex
        perform {
            switch run.status {
            case .ready:
                try run.start(at: date)
                startedAt = date
            case .running:
                try run.pause(at: date)
            case .paused:
                try run.resume(at: date)
            case .completed, .cancelled:
                break
            }
            recordNaturallyCompletedStages(from: previous, startingAt: previousStageIndex)
        }
    }

    public func skipStage() {
        let date = now()
        perform {
            let original = run
            let originalIndex = run.currentStageIndex
            let beforeSkip = try run.snapshot(at: date)
            recordNaturallyCompletedStages(from: original, startingAt: originalIndex)
            guard run.status != .completed else { return }
            let skippedIndex = run.currentStageIndex
            let skippedElapsed = beforeSkip.stageIndex == skippedIndex ? beforeSkip.elapsed : 0
            try run.skip(at: date)
            recordDuration(skippedElapsed, at: skippedIndex)
        }
    }

    public func extendStage(by interval: TimeInterval = 30) {
        let date = now()
        let previous = run
        let previousStageIndex = run.currentStageIndex
        perform {
            try run.extendCurrentStage(by: interval, at: date)
            recordNaturallyCompletedStages(from: previous, startingAt: previousStageIndex)
        }
    }

    public func cancel() {
        perform { try run.cancel(at: now()) }
    }

    /// Updates presentation from absolute time. A view may call this on a visual cadence;
    /// correctness does not depend on receiving every tick.
    public func refresh() {
        let previous = run
        let previousStageIndex = run.currentStageIndex
        perform(persistUnchanged: false) {
            snapshot = try run.snapshot(at: now())
            recordNaturallyCompletedStages(from: previous, startingAt: previousStageIndex)
        }
    }

    public func replace(with run: DevelopmentTimerRun) {
        let replacedRunID = self.run.id
        self.run = run
        selectedRecipe = Self.recipe(for: run.plan)
        if !availableRecipes.contains(where: { $0.id == selectedRecipe.id }) {
            availableRecipes.append(selectedRecipe)
        }
        observations = [:]
        manualStageStates = Self.initialManualStageStates(for: selectedRecipe)
        finishedAt = nil
        startedAt = run.status == .ready ? nil : run.lastObservedAt
        completionState = .pending
        developmentSessionURI = nil
        errorMessage = nil
        refreshWithoutPersistence()
        if replacedRunID != run.id {
            platformPresenter.invalidate(runID: replacedRunID)
        }
        reconcilePlatformPresentation()
        queuePersistence()
    }

    /// Reconciles notifications and the Live Activity after launch or foreground entry.
    ///
    /// App composition should call this from its `scenePhase == .active` handler after durable
    /// restoration. The operation is idempotent and does not alter timer or completion state.
    public func reconcilePlatformPresentation() {
        guard let snapshot else { return }
        platformPresenter.synchronize(
            TimerPlatformPresentation(
                run: run,
                snapshot: snapshot,
                recipeName: selectedRecipe.plan.name,
                now: now()
            )
        )
    }

    public func flushPersistence() async {
        _ = await persistenceTask?.value
    }

    private func perform(
        persistUnchanged: Bool = true,
        _ action: () throws -> Void
    ) {
        let previous = run
        let previousStageIndex = run.currentStageIndex
        let previousStatus = run.status
        do {
            try action()
            snapshot = try run.snapshot(at: now())
            errorMessage = nil
            let changed = previous != run
            if run.currentStageIndex != previousStageIndex {
                haptics.play(.timerStage)
            }
            if previousStatus != .completed, run.status == .completed {
                haptics.play(activeManualStage == nil ? .timerCompleted : .timerStage)
            }
            reconcilePlatformPresentation()
            if persistUnchanged || changed { queuePersistence() }
        } catch {
            errorMessage = String(describing: error)
            haptics.play(.failure)
        }
    }

    private func refreshWithoutPersistence() {
        do {
            snapshot = try run.snapshot(at: now())
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func recordNaturallyCompletedStages(
        from previous: DevelopmentTimerRun,
        startingAt index: Int
    ) {
        let terminalExclusive =
            run.status == .completed ? run.plan.stages.count : run.currentStageIndex
        guard terminalExclusive > index else { return }
        for completedIndex in index..<terminalExclusive {
            let base = previous.plan.stages[completedIndex].duration
            let extensionDuration = run.extensionsByStage[completedIndex, default: 0]
            recordDuration(base + extensionDuration, at: completedIndex)
        }
    }

    private func recordDuration(_ duration: TimeInterval, at index: Int) {
        guard run.plan.stages.indices.contains(index) else { return }
        let timerStageID = run.plan.stages[index].id
        guard
            let stageID = selectedRecipe.stages.first(where: {
                $0.timerStage?.id == timerStageID
            })?.id
        else { return }
        updateObservation(for: stageID, persist: false) {
            $0.actualDuration = max(0, duration)
        }
    }

    private func updateObservation(
        for stage: TimerStageID,
        persist: Bool = true,
        _ update: (inout DevelopmentStageObservation) -> Void
    ) {
        var observation = observations[stage.rawValue] ?? DevelopmentStageObservation()
        update(&observation)
        observations[stage.rawValue] = observation
        if persist { queuePersistence() }
    }

    private func queuePersistence() {
        generation += 1
        let session = durableSession
        isPersisting = true
        persistenceTask = Task { [weak self, pipeline] in
            do {
                let persisted = try await pipeline.persist(session)
                guard let self else { return persisted }
                if persisted.generation >= self.generation {
                    self.completionState = persisted.completionState
                    self.developmentSessionURI = persisted.developmentSessionURI
                    self.isPersisting = false
                }
                return persisted
            } catch let featureError as TimerFeatureError {
                guard let self else { return nil }
                self.errorMessage = featureError.message
                self.isPersisting = false
                self.haptics.play(.failure)
                return nil
            } catch {
                guard let self else { return nil }
                self.errorMessage = TimerFeatureError.persistence(String(describing: error)).message
                self.isPersisting = false
                self.haptics.play(.failure)
                return nil
            }
        }
    }

    private var durableSession: TimerFeatureSessionState {
        TimerFeatureSessionState(
            generation: generation,
            run: run,
            recipe: selectedRecipe,
            linkedFilmRolls: linkedFilmRolls,
            startedAt: startedAt,
            observations: observations,
            manualStageStates: manualStageStates,
            finishedAt: finishedAt,
            completionState: completionState,
            developmentSessionURI: developmentSessionURI
        )
    }

    private func title(for uri: ATURI) -> String {
        availableFilmRolls.first(where: { $0.uri == uri })?.displayTitle ?? uri.rawValue
    }

    private static func recipe(for plan: TimerPlan) -> DevelopmentRecipeSelection {
        if plan == TimerFeatureDefaults.blackAndWhiteRecipe().plan {
            return TimerFeatureDefaults.blackAndWhiteRecipe()
        }
        return DevelopmentRecipeSelection(
            plan: plan,
            process: AppGraycardDefsFilmProcess.other.rawValue,
            stages: plan.stages.map {
                DevelopmentRecipeStage(
                    timerStage: $0,
                    chemistryRoles: [AppGraycardDefsChemistryRole.other.rawValue]
                )
            },
            provenance: DevelopmentRecipeProvenance(
                origin: .builtIn,
                sourceLabel: plan.name,
                note: "Timer plan supplied without recipe metadata."
            )
        )
    }

    private func finishManualSequenceIfNeeded() {
        errorMessage = nil
        if activeManualStage == nil {
            finishedAt = now()
            haptics.play(.timerCompleted)
        } else {
            haptics.play(.timerStage)
        }
        queuePersistence()
    }

    private static func initialManualStageStates(
        for recipe: DevelopmentRecipeSelection
    ) -> [String: DevelopmentManualStageState] {
        Dictionary(
            uniqueKeysWithValues: recipe.stages.filter(\.isManual).map {
                ($0.id.rawValue, .pending)
            })
    }

    private static func mergedManualStageStates(
        for session: TimerFeatureSessionState
    ) -> [String: DevelopmentManualStageState] {
        var states = initialManualStageStates(for: session.recipe)
        for (id, state) in session.manualStageStates where states[id] != nil {
            states[id] = state
        }
        return states
    }
}

private extension DevelopmentRecipeOrigin {
    var sortOrder: Int {
        switch self {
        case .personalDataServer: 0
        case .catalog: 1
        case .builtIn: 2
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
