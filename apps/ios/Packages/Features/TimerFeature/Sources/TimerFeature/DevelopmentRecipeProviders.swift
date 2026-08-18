import CatalogKit
import Foundation
import HypoLexicon
import TimerEngine

/// Aggregates independent recipe sources. A working bundled source remains available when an
/// optional signed-in source cannot be reached.
public struct CompositeDevelopmentRecipeProvider: DevelopmentRecipeProviding {
    private let providers: [any DevelopmentRecipeProviding]

    public init(_ providers: [any DevelopmentRecipeProviding]) {
        self.providers = providers
    }

    public func recipes() async throws -> [DevelopmentRecipeSelection] {
        var recipes: [DevelopmentRecipeSelection] = []
        var lastError: (any Error)?
        for provider in providers {
            do {
                recipes.append(contentsOf: try await provider.recipes())
            } catch {
                lastError = error
            }
        }
        if recipes.isEmpty, let lastError { throw lastError }
        return recipes
    }
}

/// Integrity-checks the bundled CatalogKit snapshot and exposes every published development
/// temperature point as a selectable timer recipe. Recipes that explicitly permit interpolation
/// retain the complete point series so the timer can calculate an in-range time.
public struct BundledCatalogDevelopmentRecipeProvider: DevelopmentRecipeProviding {
    public init() {}

    public func recipes() throws -> [DevelopmentRecipeSelection] {
        let snapshot = try BundledCatalog.load()
        guard let shard = snapshot.shards["dev-times"] else { return [] }
        return try shard.items.flatMap { item in
            let data = try JSONEncoder().encode(item)
            return try DevelopmentRecipeDecoder.selections(
                record: data,
                uri: nil,
                origin: .catalog,
                sourceLabel: "Bundled Graycard catalog"
            )
        }
    }
}

/// Converts a catalog.devRecipe record from either the bundled catalog or a personal repository.
public enum DevelopmentRecipeDecoder {
    public static func selections(
        record data: Data,
        uri: ATURI?,
        origin: DevelopmentRecipeOrigin,
        sourceLabel: String
    ) throws -> [DevelopmentRecipeSelection] {
        let record = try JSONDecoder().decode(AppGraycardCatalogDevRecipeMain.self, from: data)
        guard !record.temps.isEmpty else {
            throw TimerFeatureError.invalidRecipe("A development recipe has no time points.")
        }
        let temperaturePoints = try record.temps.map {
            try TemperatureTimePoint(
                temperatureCelsius: Double($0.tempC10) / 10,
                duration: TimeInterval($0.timeSec)
            )
        }
        return try record.temps.map { point in
            try selection(
                record: record,
                point: point,
                temperaturePoints: temperaturePoints,
                uri: uri,
                origin: origin,
                sourceLabel: sourceLabel
            )
        }
    }

    private static func selection(
        record: AppGraycardCatalogDevRecipeMain,
        point: AppGraycardCatalogDevRecipeTempPoint,
        temperaturePoints: [TemperatureTimePoint],
        uri: ATURI?,
        origin: DevelopmentRecipeOrigin,
        sourceLabel: String
    ) throws -> DevelopmentRecipeSelection {
        let temperature = Double(point.tempC10) / 10
        let title = recipeTitle(record, temperature: temperature)
        let primaryRoles = primaryChemistryRoles(record)
        let develop = try TimerStage(
            id: TimerStageID(rawValue: "develop"),
            name: primaryStageName(record),
            duration: TimeInterval(point.timeSec),
            agitation: agitation(record.agitation)
        )
        let plan = try TimerPlan(
            id: recipeID(record, point: point, uri: uri),
            name: title,
            stages: [develop]
        )
        let note = [record.methodNotes, record.notes]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return DevelopmentRecipeSelection(
            plan: plan,
            process: record.process.rawValue,
            stages: [
                DevelopmentRecipeStage(
                    timerStage: develop,
                    chemistryRoles: primaryRoles,
                    dilution: record.dilution,
                    targetTemperatureCelsius: temperature,
                    hasSelectedAgitationSchedule: hasRepresentableAgitationSchedule(
                        record.agitation
                    ),
                    selectedAgitationDescription: agitationDescription(record.agitation)
                )
            ] + manualStages(record),
            recipeURI: uri,
            provenance: DevelopmentRecipeProvenance(
                origin: origin,
                sourceLabel: sourceLabel,
                sourceURI: uri,
                note: note.isEmpty ? nil : note
            ),
            temperaturePoints: temperaturePoints,
            interpolationAllowed: record.interpolationAllowed == true
        )
    }

    private static func recipeTitle(
        _ record: AppGraycardCatalogDevRecipeMain,
        temperature: Double
    ) -> String {
        var details = [
            "\(record.filmMake) \(record.filmName)",
            "\(record.developerMake) \(record.developerName)",
        ]
        if let dilution = record.dilution { details.append(dilution) }
        if let ei = record.ei { details.append("EI \(ei)") }
        details.append("\(temperature.formatted(.number.precision(.fractionLength(0...1)))) °C")
        return details.joined(separator: " · ")
    }

    private static func recipeID(
        _ record: AppGraycardCatalogDevRecipeMain,
        point: AppGraycardCatalogDevRecipeTempPoint,
        uri: ATURI?
    ) -> String {
        [
            uri?.rawValue ?? "catalog",
            record.filmMake,
            record.filmName,
            record.developerMake,
            record.developerName,
            record.dilution ?? "stock",
            record.ei.map(String.init) ?? "native",
            String(point.tempC10),
            String(point.timeSec),
        ]
        .map(normalizedIDComponent)
        .joined(separator: ":")
    }

    private static func normalizedIDComponent(_ value: String) -> String {
        let normalized = value.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return normalized.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
            .reduce(into: "") { $0.append($1) }
    }

    private static func agitation(
        _ value: AppGraycardCatalogDevRecipeAgitation?
    ) -> AgitationSchedule {
        guard let value else { return .none }
        if value.continuous == true { return .continuous }
        guard let every = value.everySec, every > 0,
            let activeDuration = value.forSec, activeDuration > 0
        else { return .none }
        let initial = max(0, value.initialSec ?? 0)
        let active = min(activeDuration, every)
        return .periodic(
            initial: TimeInterval(initial),
            every: TimeInterval(every),
            for: TimeInterval(active)
        )
    }

    private static func primaryChemistryRoles(
        _ record: AppGraycardCatalogDevRecipeMain
    ) -> [String] {
        if normalizedNotes(record).contains("monobath") {
            return [
                AppGraycardDefsChemistryRole.filmDeveloper.rawValue,
                AppGraycardDefsChemistryRole.fixer.rawValue,
            ]
        }
        switch record.process.rawValue {
        case AppGraycardDefsFilmProcess.monobath.rawValue:
            return [
                AppGraycardDefsChemistryRole.filmDeveloper.rawValue,
                AppGraycardDefsChemistryRole.fixer.rawValue,
            ]
        case AppGraycardDefsFilmProcess.c41.rawValue,
            AppGraycardDefsFilmProcess.ecn2.rawValue:
            return [AppGraycardDefsChemistryRole.colorDeveloper.rawValue]
        case AppGraycardDefsFilmProcess.e6.rawValue,
            AppGraycardDefsFilmProcess.reversalBw.rawValue:
            return [AppGraycardDefsChemistryRole.firstDeveloper.rawValue]
        default:
            return [AppGraycardDefsChemistryRole.filmDeveloper.rawValue]
        }
    }

    private static func primaryStageName(_ record: AppGraycardCatalogDevRecipeMain) -> String {
        if normalizedNotes(record).contains("monobath") { return "Develop + fix" }
        return switch record.process.rawValue {
        case AppGraycardDefsFilmProcess.monobath.rawValue: "Develop + fix"
        case AppGraycardDefsFilmProcess.c41.rawValue,
            AppGraycardDefsFilmProcess.ecn2.rawValue:
            "Color developer"
        case AppGraycardDefsFilmProcess.e6.rawValue,
            AppGraycardDefsFilmProcess.reversalBw.rawValue:
            "First developer"
        default: "Develop"
        }
    }

    /// A devRecipe publishes the primary developer time only. The process value and explicit
    /// method notes still establish the remaining bath order, so those stages are retained as
    /// manual steps rather than assigned guessed countdowns.
    private static func manualStages(
        _ record: AppGraycardCatalogDevRecipeMain
    ) -> [DevelopmentRecipeStage] {
        let notes = normalizedNotes(record)
        if notes.contains("monobath") {
            var stages = [manual("wash", "Wash", roles: [.wash])]
            appendFinishingStage(to: &stages, notes: notes)
            return stages
        }
        switch record.process.rawValue {
        case AppGraycardDefsFilmProcess.bw.rawValue:
            var stages = [
                manual("stop-or-rinse", "Stop or rinse", roles: [.stop]),
                manual("fix", "Fix", roles: [.fixer]),
                manual("wash", "Wash", roles: [.wash]),
            ]
            appendFinishingStage(to: &stages, notes: notes)
            return stages

        case AppGraycardDefsFilmProcess.monobath.rawValue:
            var stages = [manual("wash", "Wash", roles: [.wash])]
            appendFinishingStage(to: &stages, notes: notes)
            return stages

        case AppGraycardDefsFilmProcess.c41.rawValue:
            var stages: [DevelopmentRecipeStage]
            if mentionsCombinedBleachFix(notes) {
                stages = [manual("blix", "Blix", roles: [.bleach, .fixer])]
            } else {
                stages = [
                    manual("bleach", "Bleach", roles: [.bleach]),
                    manual("fix", "Fix", roles: [.fixer]),
                ]
            }
            stages.append(manual("wash", "Wash", roles: [.wash]))
            appendFinishingStage(to: &stages, notes: notes, defaultToFinalRinse: true)
            return stages

        case AppGraycardDefsFilmProcess.e6.rawValue:
            var stages: [DevelopmentRecipeStage]
            if notes.contains("3-bath") || notes.contains("three-bath") {
                stages = [
                    manual(
                        "reversal-color-developer",
                        "Reversal + color developer",
                        roles: [.reversalBath, .colorDeveloper]
                    ),
                    manual("blix", "Blix", roles: [.bleach, .fixer]),
                ]
            } else {
                stages = [
                    manual("reversal", "Reversal bath", roles: [.reversalBath]),
                    manual("color-developer", "Color developer", roles: [.colorDeveloper]),
                    manual("pre-bleach", "Pre-bleach", roles: [.preBleach]),
                    manual("bleach", "Bleach", roles: [.bleach]),
                    manual("fix", "Fix", roles: [.fixer]),
                ]
            }
            stages.append(manual("wash", "Wash", roles: [.wash]))
            appendFinishingStage(to: &stages, notes: notes, defaultToFinalRinse: true)
            return stages

        case AppGraycardDefsFilmProcess.ecn2.rawValue:
            var stages = [
                manual("stop", "Stop", roles: [.stop]),
                manual("wash-1", "Wash", roles: [.wash]),
                manual("bleach", "Bleach", roles: [.bleach]),
                manual("wash-2", "Wash", roles: [.wash]),
                manual("fix", "Fix", roles: [.fixer]),
                manual("wash-3", "Wash", roles: [.wash]),
            ]
            appendFinishingStage(to: &stages, notes: notes, defaultToFinalRinse: true)
            return stages

        case AppGraycardDefsFilmProcess.reversalBw.rawValue:
            var stages = [
                manual("bleach", "Bleach", roles: [.bleach]),
                manual("clear", "Clearing bath", roles: [.clearingAgent]),
                manual("reversal", "Reversal", roles: [.reversalBath]),
                manual("second-developer", "Second developer", roles: [.filmDeveloper]),
                manual("fix", "Fix", roles: [.fixer]),
                manual("wash", "Wash", roles: [.wash]),
            ]
            appendFinishingStage(to: &stages, notes: notes)
            return stages

        default:
            return []
        }
    }

    private static func manual(
        _ id: String,
        _ name: String,
        optional: Bool = false,
        roles: [AppGraycardDefsChemistryRole]
    ) -> DevelopmentRecipeStage {
        DevelopmentRecipeStage(
            manualID: TimerStageID(rawValue: id),
            name: name,
            isOptional: optional,
            chemistryRoles: roles.map(\.rawValue)
        )
    }

    private static func appendFinishingStage(
        to stages: inout [DevelopmentRecipeStage],
        notes: String,
        defaultToFinalRinse: Bool = false
    ) {
        if notes.contains("stabilizer") || notes.contains("stabiliser") {
            stages.append(
                manual(
                    "stabilizer",
                    "Stabilizer",
                    optional: notes.contains("optional stabilizer")
                        || notes.contains("optional stabiliser"),
                    roles: [.stabilizer]
                )
            )
        } else if notes.contains("wetting agent") || notes.contains("wetting-agent") {
            stages.append(
                manual("wetting-agent", "Wetting agent", optional: true, roles: [.wettingAgent])
            )
        } else if notes.contains("final rinse") || defaultToFinalRinse {
            stages.append(manual("final-rinse", "Final rinse", roles: [.finalRinse]))
        }
    }

    private static func mentionsCombinedBleachFix(_ notes: String) -> Bool {
        notes.contains("blix") || notes.contains("bleach-fix")
            || notes.contains("bleach fix") || notes.contains("bleach/fix")
    }

    private static func normalizedNotes(_ record: AppGraycardCatalogDevRecipeMain) -> String {
        [record.methodNotes, record.notes]
            .compactMap { $0?.lowercased() }
            .joined(separator: " ")
    }

    private static func agitationDescription(
        _ value: AppGraycardCatalogDevRecipeAgitation?
    ) -> String? {
        guard let value else { return nil }
        var parts: [String] = []
        if value.continuous == true { parts.append("continuous") }
        if let initial = value.initialSec { parts.append("initial \(initial)s") }
        if let every = value.everySec { parts.append("every \(every)s") }
        if let duration = value.forSec { parts.append("for \(duration)s") }
        if let inversions = value.inversions { parts.append("\(inversions) inversions") }
        if let note = value.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            parts.append(note)
        }
        return parts.isEmpty ? nil : parts.joined(separator: "; ")
    }

    private static func hasRepresentableAgitationSchedule(
        _ value: AppGraycardCatalogDevRecipeAgitation?
    ) -> Bool {
        guard let value else { return false }
        if value.continuous == true { return true }
        return (value.everySec ?? 0) > 0 && (value.forSec ?? 0) > 0
    }
}
