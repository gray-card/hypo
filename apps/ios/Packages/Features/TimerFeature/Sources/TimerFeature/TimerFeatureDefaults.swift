import HypoLexicon
import TimerEngine

/// Built-in plans used before a user selects a catalog or PDS recipe.
public enum TimerFeatureDefaults {
    public static func blackAndWhitePlan() -> TimerPlan {
        blackAndWhiteRecipe().plan
    }

    public static func blackAndWhiteRecipe() -> DevelopmentRecipeSelection {
        let develop = try! TimerStage(
            id: TimerStageID(rawValue: "develop"),
            name: "Develop",
            duration: 8 * 60,
            agitation: .periodic(initial: 30, every: 60, for: 10)
        )
        let stop = try! TimerStage(
            id: TimerStageID(rawValue: "stop"),
            name: "Stop",
            duration: 30
        )
        let fix = try! TimerStage(
            id: TimerStageID(rawValue: "fix"),
            name: "Fix",
            duration: 5 * 60,
            agitation: .periodic(initial: 10, every: 60, for: 10)
        )
        let plan = try! TimerPlan(
            id: "builtin-black-and-white",
            name: "Black-and-white film",
            stages: [develop, stop, fix]
        )
        return DevelopmentRecipeSelection(
            plan: plan,
            process: AppGraycardDefsFilmProcess.bw.rawValue,
            stages: [
                DevelopmentRecipeStage(
                    timerStage: develop,
                    chemistryRoles: [AppGraycardDefsChemistryRole.filmDeveloper.rawValue],
                    targetTemperatureCelsius: 20
                ),
                DevelopmentRecipeStage(
                    timerStage: stop,
                    chemistryRoles: [AppGraycardDefsChemistryRole.stop.rawValue],
                    targetTemperatureCelsius: 20
                ),
                DevelopmentRecipeStage(
                    timerStage: fix,
                    chemistryRoles: [AppGraycardDefsChemistryRole.fixer.rawValue],
                    targetTemperatureCelsius: 20
                ),
            ],
            provenance: DevelopmentRecipeProvenance(
                origin: .builtIn,
                sourceLabel: "Hypo built-in black-and-white fallback",
                note: "Select a catalog or personal recipe before use when one is available."
            )
        )
    }
}
