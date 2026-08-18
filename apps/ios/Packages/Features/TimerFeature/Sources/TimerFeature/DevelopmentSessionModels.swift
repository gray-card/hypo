import Foundation
import HypoLexicon
import TimerEngine

public enum DevelopmentRecipeOrigin: String, Codable, CaseIterable, Hashable, Sendable {
    case catalog
    case personalDataServer
    case builtIn
}

public struct DevelopmentRecipeProvenance: Codable, Hashable, Sendable {
    public var origin: DevelopmentRecipeOrigin
    public var sourceLabel: String
    public var sourceURI: ATURI?
    public var note: String?

    public init(
        origin: DevelopmentRecipeOrigin,
        sourceLabel: String,
        sourceURI: ATURI? = nil,
        note: String? = nil
    ) {
        self.origin = origin
        self.sourceLabel = sourceLabel
        self.sourceURI = sourceURI
        self.note = note
    }
}

public struct DevelopmentRecipeStage: Codable, Hashable, Sendable {
    public var id: TimerStageID
    public var name: String
    public var timerStage: TimerStage?
    public var isOptional: Bool
    public var chemistryRoles: [String]
    public var chemistry: ATURI?
    public var dilution: String?
    public var targetTemperatureCelsius: Double?
    public var hasSelectedAgitationSchedule: Bool
    public var selectedAgitationDescription: String?

    public init(
        timerStage: TimerStage,
        isOptional: Bool = false,
        chemistryRoles: [String],
        chemistry: ATURI? = nil,
        dilution: String? = nil,
        targetTemperatureCelsius: Double? = nil,
        hasSelectedAgitationSchedule: Bool = true,
        selectedAgitationDescription: String? = nil
    ) {
        id = timerStage.id
        name = timerStage.name
        self.timerStage = timerStage
        self.isOptional = isOptional
        self.chemistryRoles = chemistryRoles
        self.chemistry = chemistry
        self.dilution = dilution
        self.targetTemperatureCelsius = targetTemperatureCelsius
        self.hasSelectedAgitationSchedule = hasSelectedAgitationSchedule
        self.selectedAgitationDescription = selectedAgitationDescription
    }

    /// Creates an explicitly manual stage when the source establishes that the bath belongs in
    /// the process but does not publish a duration that the timer may honestly count down.
    public init(
        manualID: TimerStageID,
        name: String,
        isOptional: Bool = false,
        chemistryRoles: [String],
        chemistry: ATURI? = nil,
        dilution: String? = nil,
        targetTemperatureCelsius: Double? = nil,
        selectedAgitationDescription: String? = nil
    ) {
        id = manualID
        self.name = name
        timerStage = nil
        self.isOptional = isOptional
        self.chemistryRoles = chemistryRoles
        self.chemistry = chemistry
        self.dilution = dilution
        self.targetTemperatureCelsius = targetTemperatureCelsius
        hasSelectedAgitationSchedule = false
        self.selectedAgitationDescription = selectedAgitationDescription
    }

    public var isManual: Bool { timerStage == nil }
    public var publishedDuration: TimeInterval? { timerStage?.duration }
    public var selectedAgitation: AgitationSchedule? {
        hasSelectedAgitationSchedule ? timerStage?.agitation : nil
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case timerStage
        case isOptional
        case chemistryRoles
        case chemistry
        case dilution
        case targetTemperatureCelsius
        case hasSelectedAgitationSchedule
        case selectedAgitationDescription
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        timerStage = try container.decodeIfPresent(TimerStage.self, forKey: .timerStage)
        id =
            try container.decodeIfPresent(TimerStageID.self, forKey: .id)
            ?? timerStage?.id
            ?? TimerStageID(rawValue: "manual")
        name =
            try container.decodeIfPresent(String.self, forKey: .name)
            ?? timerStage?.name
            ?? "Manual stage"
        isOptional = try container.decodeIfPresent(Bool.self, forKey: .isOptional) ?? false
        chemistryRoles = try container.decode([String].self, forKey: .chemistryRoles)
        chemistry = try container.decodeIfPresent(ATURI.self, forKey: .chemistry)
        dilution = try container.decodeIfPresent(String.self, forKey: .dilution)
        targetTemperatureCelsius = try container.decodeIfPresent(
            Double.self,
            forKey: .targetTemperatureCelsius
        )
        hasSelectedAgitationSchedule =
            try container.decodeIfPresent(Bool.self, forKey: .hasSelectedAgitationSchedule)
            ?? (timerStage != nil)
        selectedAgitationDescription = try container.decodeIfPresent(
            String.self,
            forKey: .selectedAgitationDescription
        )
    }
}

public struct DevelopmentRecipeSelection: Codable, Identifiable, Hashable, Sendable {
    public var plan: TimerPlan
    public var process: String
    public var stages: [DevelopmentRecipeStage]
    public var recipeURI: ATURI?
    public var provenance: DevelopmentRecipeProvenance
    public var temperaturePoints: [TemperatureTimePoint]
    public var interpolationAllowed: Bool
    public var generalTemperatureEstimate: GeneralBlackAndWhiteTemperatureEstimate?

    public init(
        plan: TimerPlan,
        process: String,
        stages: [DevelopmentRecipeStage],
        recipeURI: ATURI? = nil,
        provenance: DevelopmentRecipeProvenance,
        temperaturePoints: [TemperatureTimePoint] = [],
        interpolationAllowed: Bool = false,
        generalTemperatureEstimate: GeneralBlackAndWhiteTemperatureEstimate? = nil
    ) {
        precondition(
            stages.compactMap(\.timerStage) == plan.stages,
            "Timed recipe stages must preserve the timer plan's stage order and values."
        )
        precondition(
            Set(stages.map(\.id)).count == stages.count,
            "Recipe stage identifiers must be unique."
        )
        self.plan = plan
        self.process = process
        self.stages = stages
        self.recipeURI = recipeURI
        self.provenance = provenance
        self.temperaturePoints = temperaturePoints
        self.interpolationAllowed = interpolationAllowed
        self.generalTemperatureEstimate = generalTemperatureEstimate
    }

    public var id: String { plan.id }

    public var selectedTemperatureCelsius: Double? {
        primaryStage?.targetTemperatureCelsius
    }

    public var selectedDevelopmentDuration: TimeInterval? {
        primaryStage?.publishedDuration
    }

    public var adjustableTemperatureRange: ClosedRange<Double>? {
        guard interpolationAllowed else { return nil }
        let temperatures = temperaturePoints.map(\.temperatureCelsius)
        guard let minimum = temperatures.min(), let maximum = temperatures.max(), minimum < maximum
        else { return nil }
        return minimum...maximum
    }

    public var usesInterpolatedTemperature: Bool {
        guard generalTemperatureEstimate == nil else { return false }
        guard !temperaturePoints.isEmpty else { return false }
        guard let selectedTemperatureCelsius else { return false }
        return !temperaturePoints.contains {
            abs($0.temperatureCelsius - selectedTemperatureCelsius) < 0.000_001
        }
    }

    public var usesGeneralTemperatureEstimate: Bool {
        generalTemperatureEstimate != nil
    }

    public var canUseGeneralTemperatureEstimate: Bool {
        guard process == "bw" else { return false }
        if generalTemperatureEstimate != nil { return true }
        guard !usesInterpolatedTemperature,
            let temperature = selectedTemperatureCelsius,
            let duration = selectedDevelopmentDuration
        else { return false }
        return GeneralBlackAndWhiteTemperatureEstimator.supportedRange.contains(temperature)
            && duration > 0
    }

    public var selectedTimeBasis: String {
        if usesGeneralTemperatureEstimate { return "general-estimate" }
        if usesInterpolatedTemperature { return "recipe-interpolation" }
        return "published"
    }

    public func adjusted(to temperatureCelsius: Double) throws -> DevelopmentRecipeSelection {
        let duration: TimeInterval
        do {
            duration = try TemperatureCompensator.duration(
                at: temperatureCelsius,
                points: temperaturePoints,
                interpolationAllowed: interpolationAllowed
            )
        } catch {
            throw TimerFeatureError.invalidRecipe(temperatureAdjustmentMessage(error))
        }
        guard let primaryStageIndex else {
            throw TimerFeatureError.invalidRecipe("This recipe has no timed development stage.")
        }
        let primary = stages[primaryStageIndex]
        guard var timerStage = primary.timerStage,
            let planStageIndex = plan.stages.firstIndex(where: { $0.id == primary.id })
        else {
            throw TimerFeatureError.invalidRecipe("The primary development stage has no timer.")
        }

        timerStage.duration = duration
        var adjustedPlan = plan
        adjustedPlan.stages[planStageIndex] = timerStage
        adjustedPlan.name = adjustedRecipeName(plan.name, temperatureCelsius: temperatureCelsius)
        var adjustedStages = stages
        adjustedStages[primaryStageIndex].timerStage = timerStage
        adjustedStages[primaryStageIndex].targetTemperatureCelsius = temperatureCelsius
        return DevelopmentRecipeSelection(
            plan: adjustedPlan,
            process: process,
            stages: adjustedStages,
            recipeURI: recipeURI,
            provenance: provenance,
            temperaturePoints: temperaturePoints,
            interpolationAllowed: interpolationAllowed,
            generalTemperatureEstimate: nil
        )
    }

    public func estimatedUsingGeneralTemperature(
        _ temperatureCelsius: Double
    ) throws -> DevelopmentRecipeSelection {
        guard process == "bw" else {
            throw TimerFeatureError.invalidRecipe(
                "The general estimate is only available for standard black-and-white development."
            )
        }
        let referenceTemperature =
            generalTemperatureEstimate?.referenceTemperatureCelsius
            ?? selectedTemperatureCelsius
        let referenceDuration =
            generalTemperatureEstimate?.referenceDuration
            ?? selectedDevelopmentDuration
        guard let referenceTemperature, let referenceDuration else {
            throw TimerFeatureError.invalidRecipe(
                "This recipe has no published time and temperature to use as a reference."
            )
        }
        let estimate: GeneralBlackAndWhiteTemperatureEstimate
        do {
            estimate = try GeneralBlackAndWhiteTemperatureEstimator.estimate(
                referenceDuration: referenceDuration,
                referenceTemperatureCelsius: referenceTemperature,
                targetTemperatureCelsius: temperatureCelsius
            )
        } catch {
            throw TimerFeatureError.invalidRecipe(generalTemperatureEstimateMessage(error))
        }
        guard let primaryStageIndex else {
            throw TimerFeatureError.invalidRecipe("This recipe has no timed development stage.")
        }
        let primary = stages[primaryStageIndex]
        guard var timerStage = primary.timerStage,
            let planStageIndex = plan.stages.firstIndex(where: { $0.id == primary.id })
        else {
            throw TimerFeatureError.invalidRecipe("The primary development stage has no timer.")
        }

        timerStage.duration = estimate.duration
        var adjustedPlan = plan
        adjustedPlan.stages[planStageIndex] = timerStage
        adjustedPlan.name = adjustedRecipeName(
            plan.name,
            temperatureCelsius: estimate.targetTemperatureCelsius
        )
        var adjustedStages = stages
        adjustedStages[primaryStageIndex].timerStage = timerStage
        adjustedStages[primaryStageIndex].targetTemperatureCelsius =
            estimate.targetTemperatureCelsius
        return DevelopmentRecipeSelection(
            plan: adjustedPlan,
            process: process,
            stages: adjustedStages,
            recipeURI: recipeURI,
            provenance: provenance,
            temperaturePoints: temperaturePoints,
            interpolationAllowed: interpolationAllowed,
            generalTemperatureEstimate: estimate
        )
    }

    public func restoringGeneralTemperatureReference() throws -> DevelopmentRecipeSelection {
        guard let estimate = generalTemperatureEstimate else { return self }
        guard let primaryStageIndex else {
            throw TimerFeatureError.invalidRecipe("This recipe has no timed development stage.")
        }
        let primary = stages[primaryStageIndex]
        guard var timerStage = primary.timerStage,
            let planStageIndex = plan.stages.firstIndex(where: { $0.id == primary.id })
        else {
            throw TimerFeatureError.invalidRecipe("The primary development stage has no timer.")
        }

        timerStage.duration = estimate.referenceDuration
        var restoredPlan = plan
        restoredPlan.stages[planStageIndex] = timerStage
        restoredPlan.name = adjustedRecipeName(
            plan.name,
            temperatureCelsius: estimate.referenceTemperatureCelsius
        )
        var restoredStages = stages
        restoredStages[primaryStageIndex].timerStage = timerStage
        restoredStages[primaryStageIndex].targetTemperatureCelsius =
            estimate.referenceTemperatureCelsius
        return DevelopmentRecipeSelection(
            plan: restoredPlan,
            process: process,
            stages: restoredStages,
            recipeURI: recipeURI,
            provenance: provenance,
            temperaturePoints: temperaturePoints,
            interpolationAllowed: interpolationAllowed
        )
    }

    private var primaryStageIndex: Int? {
        stages.firstIndex { stage in
            stage.chemistryRoles.contains(AppGraycardDefsChemistryRole.filmDeveloper.rawValue)
                || stage.chemistryRoles.contains(
                    AppGraycardDefsChemistryRole.firstDeveloper.rawValue
                )
                || stage.chemistryRoles.contains(
                    AppGraycardDefsChemistryRole.colorDeveloper.rawValue
                )
        } ?? stages.indices.first
    }

    private var primaryStage: DevelopmentRecipeStage? {
        primaryStageIndex.map { stages[$0] }
    }

    private enum CodingKeys: String, CodingKey {
        case plan
        case process
        case stages
        case recipeURI
        case provenance
        case temperaturePoints
        case interpolationAllowed
        case generalTemperatureEstimate
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        plan = try container.decode(TimerPlan.self, forKey: .plan)
        process = try container.decode(String.self, forKey: .process)
        stages = try container.decode([DevelopmentRecipeStage].self, forKey: .stages)
        recipeURI = try container.decodeIfPresent(ATURI.self, forKey: .recipeURI)
        provenance = try container.decode(DevelopmentRecipeProvenance.self, forKey: .provenance)
        interpolationAllowed =
            try container.decodeIfPresent(Bool.self, forKey: .interpolationAllowed) ?? false
        generalTemperatureEstimate = try container.decodeIfPresent(
            GeneralBlackAndWhiteTemperatureEstimate.self,
            forKey: .generalTemperatureEstimate
        )
        if let decoded = try container.decodeIfPresent(
            [TemperatureTimePoint].self,
            forKey: .temperaturePoints
        ) {
            temperaturePoints = decoded
        } else if let stage = stages.first(where: { stage in
            stage.chemistryRoles.contains(AppGraycardDefsChemistryRole.filmDeveloper.rawValue)
                || stage.chemistryRoles.contains(
                    AppGraycardDefsChemistryRole.firstDeveloper.rawValue
                )
                || stage.chemistryRoles.contains(
                    AppGraycardDefsChemistryRole.colorDeveloper.rawValue
                )
        }) ?? stages.first,
            let temperature = stage.targetTemperatureCelsius,
            let duration = stage.publishedDuration
        {
            temperaturePoints = [
                try TemperatureTimePoint(
                    temperatureCelsius: temperature,
                    duration: duration
                )
            ]
        } else {
            temperaturePoints = []
        }
    }
}

private func generalTemperatureEstimateMessage(
    _ error: GeneralBlackAndWhiteTemperatureEstimateError
) -> String {
    switch error {
    case .invalidTemperature:
        "Enter a valid development temperature."
    case .invalidDuration:
        "The reference development time is invalid."
    case let .outsideChartRange(_, minimum, maximum):
        "Choose a temperature between \(minimum.formatted()) and \(maximum.formatted()) °C."
    }
}

private func adjustedRecipeName(_ name: String, temperatureCelsius: Double) -> String {
    var components = name.components(separatedBy: " · ")
    let temperature =
        "\(temperatureCelsius.formatted(.number.precision(.fractionLength(0...1)))) °C"
    if components.last?.hasSuffix("°C") == true {
        components[components.count - 1] = temperature
    } else {
        components.append(temperature)
    }
    return components.joined(separator: " · ")
}

private func temperatureAdjustmentMessage(_ error: TemperatureCompensationError) -> String {
    switch error {
    case .insufficientPoints:
        "This recipe does not publish enough temperature points to calculate another time."
    case .duplicateTemperature:
        "This recipe publishes conflicting times for the same temperature."
    case .invalidTemperature:
        "Enter a valid development temperature."
    case .invalidDuration:
        "This recipe contains an invalid development time."
    case .interpolationDisabled:
        "The recipe source does not allow interpolated development times."
    case let .outsidePublishedRange(_, minimum, maximum):
        "Choose a temperature between \(minimum.formatted()) and \(maximum.formatted()) °C."
    }
}

public protocol DevelopmentRecipeProviding: Sendable {
    /// Returns catalog and personal-repository recipes with their source provenance intact.
    func recipes() async throws -> [DevelopmentRecipeSelection]
}

public struct DevelopmentStageObservation: Codable, Hashable, Sendable {
    public var actualDuration: TimeInterval?
    public var actualTemperatureCelsius: Double?
    public var observedAgitation: String?

    public init(
        actualDuration: TimeInterval? = nil,
        actualTemperatureCelsius: Double? = nil,
        observedAgitation: String? = nil
    ) {
        self.actualDuration = actualDuration
        self.actualTemperatureCelsius = actualTemperatureCelsius
        self.observedAgitation = observedAgitation
    }
}

public enum DevelopmentCompletionState: String, Codable, Hashable, Sendable {
    case pending
    case writing
    case written
}

public enum DevelopmentManualStageState: String, Codable, Hashable, Sendable {
    case pending
    case completed
    case skipped
}

public struct TimerFeatureSessionState: Codable, Hashable, Sendable {
    public var generation: Int
    public var run: DevelopmentTimerRun
    public var recipe: DevelopmentRecipeSelection
    public var linkedFilmRolls: [ATURI]
    public var startedAt: Date?
    public var observations: [String: DevelopmentStageObservation]
    public var manualStageStates: [String: DevelopmentManualStageState]
    public var finishedAt: Date?
    public var completionState: DevelopmentCompletionState
    public var developmentSessionURI: ATURI?

    public init(
        generation: Int = 0,
        run: DevelopmentTimerRun,
        recipe: DevelopmentRecipeSelection,
        linkedFilmRolls: [ATURI] = [],
        startedAt: Date? = nil,
        observations: [String: DevelopmentStageObservation] = [:],
        manualStageStates: [String: DevelopmentManualStageState] = [:],
        finishedAt: Date? = nil,
        completionState: DevelopmentCompletionState = .pending,
        developmentSessionURI: ATURI? = nil
    ) {
        self.generation = generation
        self.run = run
        self.recipe = recipe
        self.linkedFilmRolls = linkedFilmRolls
        self.startedAt = startedAt
        self.observations = observations
        self.manualStageStates = manualStageStates
        self.finishedAt = finishedAt
        self.completionState = completionState
        self.developmentSessionURI = developmentSessionURI
    }

    public var isReadyForCompletion: Bool {
        guard run.status == .completed else { return false }
        return recipe.stages.filter(\.isManual).allSatisfy {
            manualStageStates[$0.id.rawValue, default: .pending] != .pending
        }
    }

    public var processFinishedAt: Date? {
        guard isReadyForCompletion else { return nil }
        return finishedAt ?? run.completedAt
    }

    private enum CodingKeys: String, CodingKey {
        case generation
        case run
        case recipe
        case linkedFilmRolls
        case startedAt
        case observations
        case manualStageStates
        case finishedAt
        case completionState
        case developmentSessionURI
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generation = try container.decodeIfPresent(Int.self, forKey: .generation) ?? 0
        run = try container.decode(DevelopmentTimerRun.self, forKey: .run)
        recipe = try container.decode(DevelopmentRecipeSelection.self, forKey: .recipe)
        linkedFilmRolls = try container.decodeIfPresent([ATURI].self, forKey: .linkedFilmRolls) ?? []
        startedAt = try container.decodeIfPresent(Date.self, forKey: .startedAt)
        observations =
            try container.decodeIfPresent(
                [String: DevelopmentStageObservation].self,
                forKey: .observations
            ) ?? [:]
        manualStageStates =
            try container.decodeIfPresent(
                [String: DevelopmentManualStageState].self,
                forKey: .manualStageStates
            ) ?? [:]
        finishedAt = try container.decodeIfPresent(Date.self, forKey: .finishedAt)
        completionState =
            try container.decodeIfPresent(DevelopmentCompletionState.self, forKey: .completionState)
            ?? .pending
        developmentSessionURI = try container.decodeIfPresent(ATURI.self, forKey: .developmentSessionURI)
    }
}

public protocol TimerFeatureSessionStoring: Sendable {
    func load() async throws -> TimerFeatureSessionState?
    func save(_ session: TimerFeatureSessionState) async throws
    func clear() async throws
}

public actor InMemoryTimerFeatureSessionStore: TimerFeatureSessionStoring {
    private var session: TimerFeatureSessionState?

    public init(session: TimerFeatureSessionState? = nil) {
        self.session = session
    }

    public func load() -> TimerFeatureSessionState? { session }

    public func save(_ session: TimerFeatureSessionState) {
        self.session = session
    }

    public func clear() {
        session = nil
    }
}

public protocol DevelopmentSessionWriting: Sendable {
    /// The implementation must make repeated calls with the same key resolve to one AT record.
    func writeDevelopmentSession(record: Data, idempotencyKey: String) async throws -> ATURI
}

public struct FilmRollDevelopmentAdvanceRequest: Codable, Hashable, Sendable {
    public let roll: ATURI
    public let developmentSession: ATURI
    public let developmentStartedAt: ATProtoDate
    public let developedAt: ATProtoDate
    public let status: String
    public let developmentLocation: String
    public let idempotencyKey: String

    public init(
        roll: ATURI,
        developmentSession: ATURI,
        developmentStartedAt: ATProtoDate,
        developedAt: ATProtoDate,
        status: String = "developed",
        developmentLocation: String = "home",
        idempotencyKey: String
    ) {
        self.roll = roll
        self.developmentSession = developmentSession
        self.developmentStartedAt = developmentStartedAt
        self.developedAt = developedAt
        self.status = status
        self.developmentLocation = developmentLocation
        self.idempotencyKey = idempotencyKey
    }
}

public protocol FilmRollDevelopmentAdvancing: Sendable {
    /// Applies a semantic merge to the roll; unknown fields and migration complements are preserved.
    func advanceFilmRoll(_ request: FilmRollDevelopmentAdvanceRequest) async throws
}

public struct DiscardingDevelopmentSessionWriter: DevelopmentSessionWriting {
    public init() {}

    public func writeDevelopmentSession(
        record _: Data,
        idempotencyKey: String
    ) async throws -> ATURI {
        try ATURI(
            "at://did:plc:local/app.graycard.process.developSession/\(idempotencyKey)"
        )
    }
}

public struct DiscardingFilmRollDevelopmentAdvancer: FilmRollDevelopmentAdvancing {
    public init() {}

    public func advanceFilmRoll(_: FilmRollDevelopmentAdvanceRequest) async throws {}
}

public enum TimerFeatureError: Error, Equatable, Sendable {
    case recipeUnavailable(String)
    case invalidRecipe(String)
    case incompleteRun
    case persistence(String)
    case completion(String)

    public var message: String {
        switch self {
        case let .recipeUnavailable(detail): "Could not load recipes: \(detail)"
        case let .invalidRecipe(detail): "The recipe cannot be used: \(detail)"
        case .incompleteRun: "The development session has not finished."
        case let .persistence(detail): "Could not save the timer: \(detail)"
        case let .completion(detail): "Could not finish the development record: \(detail)"
        }
    }
}

public enum DevelopmentSessionRecordBuilder {
    public static func record(for session: TimerFeatureSessionState) throws -> Data {
        guard session.isReadyForCompletion,
            let startedAt = session.startedAt,
            let finishedAt = session.processFinishedAt
        else {
            throw TimerFeatureError.incompleteRun
        }

        let primary =
            session.recipe.stages.first { stage in
                stage.chemistryRoles.contains(AppGraycardDefsChemistryRole.filmDeveloper.rawValue)
                    || stage.chemistryRoles.contains(
                        AppGraycardDefsChemistryRole.firstDeveloper.rawValue
                    )
                    || stage.chemistryRoles.contains(
                        AppGraycardDefsChemistryRole.colorDeveloper.rawValue
                    )
            } ?? session.recipe.stages.first
        let steps = session.recipe.stages.compactMap { stage -> AppGraycardProcessDevelopSessionStep? in
            if stage.isManual,
                session.manualStageStates[stage.id.rawValue, default: .pending] == .skipped
            {
                return nil
            }
            let observation = session.observations[stage.id.rawValue]
            let isPrimary = stage.id == primary?.id
            let timeBasis = timeBasis(for: stage, isPrimary: isPrimary, session: session)
            return AppGraycardProcessDevelopSessionStep(
                roles: stage.chemistryRoles.map { AppGraycardDefsChemistryRole($0) },
                name: stage.name,
                recipe: stage.id == primary?.id ? session.recipe.recipeURI : nil,
                kind: stageKind(for: stage),
                chemistries: stage.chemistry.map { [$0] },
                dilution: stage.dilution,
                temperatureSetpoint: measure(stage.targetTemperatureCelsius, unit: "degC"),
                actualTemperature: measure(observation?.actualTemperatureCelsius, unit: "degC"),
                publishedTimeSeconds: timeBasis == .published
                    ? seconds(stage.publishedDuration) : nil,
                plannedTimeSeconds: seconds(stage.publishedDuration),
                timeBasis: timeBasis,
                actualTimeSeconds: seconds(observation?.actualDuration),
                agitationScheme: stage.selectedAgitation.map(agitationScheme),
                notes: stageNotes(
                    for: stage,
                    primaryStageID: primary?.id,
                    session: session,
                    observation: observation
                )
            )
        }
        let record = AppGraycardProcessDevelopSessionMain(
            process: AppGraycardDefsFilmProcess(session.recipe.process),
            createdAt: ATProtoDate(finishedAt),
            filmRolls: session.linkedFilmRolls.isEmpty ? nil : session.linkedFilmRolls,
            steps: steps,
            provenance: AppGraycardDefsProvenance(
                source: .manual,
                confidence: .certain,
                assertedAt: ATProtoDate(finishedAt),
                note: provenanceNote(session.recipe)
            ),
            startedAt: ATProtoDate(startedAt),
            finishedAt: ATProtoDate(finishedAt),
            developmentLocation: .home
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(record)
    }

    private static func seconds(_ duration: TimeInterval?) -> Int? {
        duration.map { max(0, Int($0.rounded())) }
    }

    private static func measure(_ value: Double?, unit: String) -> AppGraycardDefsMeasure? {
        guard let value, value.isFinite else { return nil }
        let scale = 2
        return AppGraycardDefsMeasure(
            value: Int((value * pow(10, Double(scale))).rounded()),
            unit: unit,
            scale: scale
        )
    }

    private static func agitationScheme(
        _ agitation: AgitationSchedule
    ) -> AppGraycardCatalogDevRecipeAgitation {
        switch agitation {
        case .none:
            AppGraycardCatalogDevRecipeAgitation(note: "No scheduled agitation")
        case .continuous:
            AppGraycardCatalogDevRecipeAgitation(continuous: true)
        case let .periodic(initial, every, activeDuration):
            AppGraycardCatalogDevRecipeAgitation(
                initialSec: seconds(initial),
                everySec: seconds(every),
                forSec: seconds(activeDuration)
            )
        }
    }

    private static func stageKind(
        for stage: DevelopmentRecipeStage
    ) -> AppGraycardProcessDevelopSessionStepKind {
        if stage.chemistryRoles.contains(AppGraycardDefsChemistryRole.wash.rawValue) {
            return .wash
        }
        return .chemicalBath
    }

    private static func timeBasis(
        for stage: DevelopmentRecipeStage,
        isPrimary: Bool,
        session: TimerFeatureSessionState
    ) -> AppGraycardProcessDevelopSessionTimeBasis? {
        guard stage.publishedDuration != nil else { return nil }
        guard isPrimary else { return .published }
        return AppGraycardProcessDevelopSessionTimeBasis(session.recipe.selectedTimeBasis)
    }

    private static func stageNotes(
        for stage: DevelopmentRecipeStage,
        primaryStageID: TimerStageID?,
        session: TimerFeatureSessionState,
        observation: DevelopmentStageObservation?
    ) -> String? {
        var notes: [String] = []
        if stage.id == primaryStageID, session.recipe.usesInterpolatedTemperature {
            notes.append("Development time interpolated between published recipe points.")
        }
        if stage.id == primaryStageID,
            let estimate = session.recipe.generalTemperatureEstimate
        {
            notes.append(
                "Development time estimated from Ilford's general black-and-white "
                    + "compensation chart: \(durationText(estimate.referenceDuration)) at "
                    + "\(temperatureText(estimate.referenceTemperatureCelsius)) °C to "
                    + "\(durationText(estimate.duration)) at "
                    + "\(temperatureText(estimate.targetTemperatureCelsius)) °C; rounded "
                    + "to 15 seconds. This is approximate, not a recipe-specific recommendation."
            )
        }
        if let agitation = agitationComparison(
            selected: stage.selectedAgitation,
            selectedDescription: stage.selectedAgitationDescription,
            observed: observation?.observedAgitation
        ) {
            notes.append(agitation)
        }
        return notes.isEmpty ? nil : notes.joined(separator: " ")
    }

    private static func agitationComparison(
        selected: AgitationSchedule?,
        selectedDescription: String?,
        observed: String?
    ) -> String? {
        guard selected != nil || selectedDescription != nil || observed != nil else { return nil }
        let selectedText: String
        if let selectedDescription {
            selectedText = selectedDescription
        } else {
            switch selected {
            case .some(.none):
                selectedText = "none"
            case .some(.continuous):
                selectedText = "continuous"
            case let .some(.periodic(initial, every, activeDuration)):
                selectedText =
                    "initial \(seconds(initial) ?? 0)s; every \(seconds(every) ?? 0)s "
                    + "for \(seconds(activeDuration) ?? 0)s"
            case nil:
                selectedText = "not specified"
            }
        }
        return "Selected: \(selectedText); observed: \(observed ?? "not recorded")"
    }

    private static func durationText(_ duration: TimeInterval) -> String {
        let totalSeconds = max(0, Int(duration.rounded()))
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }

    private static func temperatureText(_ temperature: Double) -> String {
        temperature.formatted(.number.precision(.fractionLength(0...1)))
    }

    private static func provenanceNote(_ recipe: DevelopmentRecipeSelection) -> String {
        let provenance = recipe.provenance
        var parts = [
            "Recipe source: \(provenance.origin.rawValue)",
            provenance.sourceLabel,
        ]
        if let note = provenance.note { parts.append(note) }
        if recipe.usesGeneralTemperatureEstimate {
            parts.append(
                "Time basis: general estimate from Ilford's black-and-white "
                    + "time/temperature compensation chart"
            )
        }
        return parts.joined(separator: "; ")
    }
}
