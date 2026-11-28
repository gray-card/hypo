import DesignSystem
import Foundation
import HypoLexicon
import SwiftUI
import TimerEngine

/// A darkroom-safe development timer surface driven by absolute wall-clock time.
public struct TimerFeatureView: View {
    private let model: TimerFeatureModel
    private let onOpenAccountSettings: () -> Void

    public init(
        model: TimerFeatureModel,
        onOpenAccountSettings: @escaping () -> Void = {}
    ) {
        self.model = model
        self.onOpenAccountSettings = onOpenAccountSettings
    }

    public var body: some View {
        DevelopmentTimerScreen(model: model, onOpenAccountSettings: onOpenAccountSettings)
            .darkroomTreatment()
    }
}

private struct DevelopmentTimerScreen: View {
    @Bindable var model: TimerFeatureModel
    let onOpenAccountSettings: () -> Void
    @Environment(\.hypoAppearance) private var appearance
    @State private var isChoosingRecipe = false
    @State private var confirmsCancellation = false
    @AppStorage("hypo.timer.showElapsed") private var showsElapsed = false
    @AppStorage("hypo.timer.fahrenheit") private var usesFahrenheit = false
    @AppStorage("hypo.timer.autoAdvance") private var automaticallyAdvances = true
    @AppStorage("hypo.darkroom.customRecipes") private var customRecipeData = Data()

    var body: some View {
        ZStack {
            appearance.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    if model.run.status == .ready {
                        recipePanel
                        stagePanel
                    } else {
                        stagePanel
                        recipePanel
                    }
                    timerFeedback
                    disclosedPanel("Film rolls", summary: model.filmRollSelectionSummary) { filmRollPanel }
                    disclosedPanel("Processing stages") { planPanel }
                    if model.run.status == .ready {
                        disclosedPanel("Mix chemistry") {
                            DilutionCalculator(recipeDilution: model.selectedRecipe.stages.first?.dilution)
                                .id(model.selectedRecipe.id)
                        }
                    } else {
                        disclosedPanel("Record observations") { observationPanel }
                    }
                }
                .padding(HypoTheme.Space.four)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { controls }
        .navigationTitle("Develop film")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu("Timer options", systemImage: "ellipsis.circle") {
                    Toggle("Show elapsed time", isOn: $showsElapsed)
                    Toggle("Use Fahrenheit", isOn: $usesFahrenheit)
                    if model.run.status == .ready {
                        Toggle("Automatically start the next stage", isOn: $automaticallyAdvances)
                    }
                    if model.canSkip {
                        Button("End development", role: .destructive) { confirmsCancellation = true }
                    }
                }
            }
        }
        .task {
            await model.restoreDurableSession()
            await model.loadRecipes()
        }
        .sheet(isPresented: $isChoosingRecipe) {
            DevelopmentRecipeBrowser(
                recipes: browserRecipes,
                isLoading: model.isLoadingRecipes,
                selectedID: model.selectedRecipe.id,
                onSelect: chooseRecipe,
                onSave: saveLocalRecipe,
                onDelete: deleteLocalRecipe
            )
            .darkroomTreatment()
        }
        .confirmationDialog("End this development session?", isPresented: $confirmsCancellation) {
            Button("End development", role: .destructive) { model.cancel() }
        }
    }

    private var customRecipes: [DevelopmentRecipeSelection] {
        (try? JSONDecoder().decode([DevelopmentRecipeSelection].self, from: customRecipeData)) ?? []
    }

    private var browserRecipes: [DevelopmentRecipeSelection] {
        customRecipes + model.availableRecipes.filter { $0.provenance.origin != .local }
    }

    private func chooseRecipe(_ recipe: DevelopmentRecipeSelection) {
        if recipe.provenance.origin == .local {
            model.selectLocalRecipe(recipe)
        } else {
            model.selectRecipe(id: recipe.id)
        }
    }

    private func saveLocalRecipe(_ recipe: DevelopmentRecipeSelection) {
        let updated = (customRecipes.filter { $0.id != recipe.id } + [recipe]).sorted {
            $0.plan.name.localizedStandardCompare($1.plan.name) == .orderedAscending
        }
        if let data = try? JSONEncoder().encode(updated) { customRecipeData = data }
    }

    private func deleteLocalRecipe(_ recipe: DevelopmentRecipeSelection) {
        if let data = try? JSONEncoder().encode(customRecipes.filter { $0.id != recipe.id }) {
            customRecipeData = data
        }
    }

    private func disclosedPanel<Content: View>(
        _ title: String,
        summary: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let details = content()
        return DisclosureGroup {
            details.padding(.top, HypoTheme.Space.two)
        } label: {
            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                Text(title).font(.headline)
                if let summary {
                    Text(summary).font(.caption).foregroundStyle(appearance.muted)
                }
            }
        }
        .padding(.vertical, HypoTheme.Space.two)
    }

    private var recipePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Recipe")
                        .font(.headline)
                    Spacer()
                    sourceBadge(model.selectedRecipe.provenance.origin)
                }

                Text(model.selectedRecipe.plan.name)
                    .font(.title3.weight(.semibold))
                if model.run.status == .ready {
                    Button("Browse recipes", systemImage: "magnifyingglass") { isChoosingRecipe = true }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("timer.recipe-browser")
                }

                if model.selectedRecipe.provenance.origin == .catalog
                    || model.selectedRecipe.provenance.origin == .personalDataServer
                {
                    Text(model.selectedRecipe.provenance.sourceLabel)
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                }
                timeBasisBadge
                if model.isLoadingRecipes {
                    ProgressView("Checking your recipes")
                        .font(.caption)
                }

                if model.canAdjustDevelopmentTemperature || model.canUseGeneralTemperatureEstimate
                    || model.isUsingGeneralTemperatureEstimate
                {
                    DisclosureGroup("Adjust temperature") { temperatureOptions }
                }
            }
        }
    }

    private var temperatureOptions: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            if model.canAdjustDevelopmentTemperature,
                let range = model.selectedRecipe.adjustableTemperatureRange,
                let temperature = model.selectedRecipe.selectedTemperatureCelsius,
                let developmentTime = model.selectedRecipe.selectedDevelopmentDuration
            {
                Divider()
                Stepper(
                    value: developmentTemperature,
                    in: displayTemperature(range.lowerBound)...displayTemperature(range.upperBound),
                    step: temperatureStep
                ) {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text("Development temperature")
                            .font(.callout.weight(.medium))
                        Text(
                            "\(temperatureLabel(temperature)) · \(duration(developmentTime))"
                        )
                        .font(.title3.monospacedDigit())
                        .foregroundStyle(appearance.accent)
                    }
                }
                .accessibilityLabel("Development temperature")
                .accessibilityValue(
                    "\(temperatureLabel(temperature)), \(duration(developmentTime))"
                )

                Text("Interpolated only between this recipe's published points; never extrapolated.")
                    .font(.caption)
                    .foregroundStyle(appearance.muted)
            }

            if model.canUseGeneralTemperatureEstimate
                || model.isUsingGeneralTemperatureEstimate
            {
                Divider()
                Toggle("Use estimated time", isOn: usesGeneralTemperatureEstimate)
                    .font(.callout.weight(.medium))
                    .disabled(model.run.status != .ready)
                    .accessibilityHint(
                        "Uses the general Ilford black-and-white compensation chart, not this recipe's manufacturer data."
                    )

                Text(
                    "Approximate black-and-white conversion from Ilford's general chart. It is not a recommendation for this film and developer pair."
                )
                .font(.caption)
                .foregroundStyle(appearance.muted)

                if let estimate = model.selectedRecipe.generalTemperatureEstimate {
                    Stepper(
                        value: estimatedDevelopmentTemperature,
                        in: displayTemperature(
                            model.generalTemperatureEstimateRange.lowerBound)...displayTemperature(
                                model.generalTemperatureEstimateRange.upperBound),
                        step: temperatureStep
                    ) {
                        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                            Text("Estimated temperature")
                                .font(.callout.weight(.medium))
                            Text(
                                "\(temperatureLabel(estimate.targetTemperatureCelsius)) · \(duration(estimate.duration))"
                            )
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(appearance.accent)
                        }
                    }
                    .disabled(model.run.status != .ready)
                    .accessibilityLabel("Estimated development temperature")
                    .accessibilityValue(
                        "\(temperatureLabel(estimate.targetTemperatureCelsius)), \(duration(estimate.duration))"
                    )

                    Text(
                        "Estimated from \(duration(estimate.referenceDuration)) at \(temperatureLabel(estimate.referenceTemperatureCelsius)). Rounded to 15 seconds."
                    )
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(appearance.muted)

                    if estimate.isBelowRecommendedMinimum {
                        Label(
                            "Times under 5:00 risk uneven development.",
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(HypoTheme.ColorToken.danger)
                    }
                    if estimate.hasLargeTemperatureChange {
                        Label(
                            "This changes the temperature by at least 4 °C. Test before important work.",
                            systemImage: "thermometer.medium"
                        )
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                    }
                }

                Link(
                    "Read the Ilford compensation chart",
                    destination: URL(
                        string:
                            "https://www.ilfordphoto.com/wp/wp-content/uploads/2017/03/Temperature-compensation-chart.pdf"
                    )!
                )
                .font(.caption.weight(.medium))
            }
        }
        .padding(.top, HypoTheme.Space.two)
    }

    private var timeBasisBadge: some View {
        let label: String
        let systemImage: String
        switch model.selectedRecipe.selectedTimeBasis {
        case "general-estimate":
            label = "General estimate"
            systemImage = "function"
        case "recipe-interpolation":
            label = "Recipe interpolation"
            systemImage = "point.3.connected.trianglepath.dotted"
        default:
            label =
                switch model.selectedRecipe.provenance.origin {
                case .builtIn: "Preset time"
                case .local: "Custom time"
                case .catalog, .personalDataServer: "Recipe time"
                }
            systemImage = "clock"
        }
        return Label(label, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(
                model.selectedRecipe.usesGeneralTemperatureEstimate
                    ? appearance.accent : appearance.muted
            )
            .accessibilityLabel("Time basis: \(label)")
    }

    private var filmRollPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text("Film rolls")
                    .font(.headline)
                Text("Optional. Linked rolls are marked developed when this session finishes.")
                    .font(.caption)
                    .foregroundStyle(appearance.muted)

                if model.canEditFilmRollLinks {
                    if model.availableFilmRolls.isEmpty {
                        Label("No active film rolls available", systemImage: "film")
                            .font(.callout)
                        Text("You can still record a development session without linking a roll.")
                            .font(.caption)
                            .foregroundStyle(appearance.muted)
                    } else {
                        Menu {
                            Button {
                                model.clearFilmRollLinks()
                            } label: {
                                Label(
                                    "No film rolls",
                                    systemImage: model.linkedFilmRolls.isEmpty
                                        ? "checkmark" : "minus"
                                )
                            }

                            Divider()

                            ForEach(model.availableFilmRolls) { roll in
                                Button {
                                    model.toggleFilmRollLink(roll.uri)
                                } label: {
                                    Label(
                                        roll.displayTitle,
                                        systemImage: model.isFilmRollLinked(roll.uri)
                                            ? "checkmark.square.fill" : "square"
                                    )
                                }
                            }
                        } label: {
                            Label(model.filmRollSelectionSummary, systemImage: "film.stack")
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Film rolls for this development session")
                        .accessibilityValue(model.filmRollSelectionSummary)
                        .accessibilityHint("Choose one or more rolls, or choose no film rolls.")
                    }
                }

                if !model.linkedFilmRolls.isEmpty {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                        ForEach(model.linkedFilmRolls, id: \.self) { uri in
                            filmRollSelection(uri)
                        }
                    }
                } else {
                    Label("No film rolls linked", systemImage: "minus.circle")
                        .font(.callout)
                        .foregroundStyle(appearance.muted)
                        .accessibilityHint("The development session will not update a film roll.")
                }

                if !model.canEditFilmRollLinks {
                    Text("Film-roll links are locked after the timer starts.")
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                }
            }
        }
    }

    private func filmRollSelection(_ uri: ATURI) -> some View {
        let option = model.availableFilmRolls.first { $0.uri == uri }
        return HStack(alignment: .firstTextBaseline, spacing: HypoTheme.Space.two) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(appearance.accent)
            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                Text(option?.displayTitle ?? uri.rawValue)
                if let detail = option?.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Linked film roll, \(option?.displayTitle ?? uri.rawValue)")
    }

    private var stagePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                if let manual = model.activeManualStage {
                    Text(manual.name)
                        .font(.title2.weight(.semibold))
                    Label("Manual stage", systemImage: "hand.tap")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(appearance.accent)
                    Text(
                        "This recipe does not publish a duration for this stage. Complete it using the chemistry instructions, then continue here."
                    )
                    .font(.callout)
                    .foregroundStyle(appearance.muted)
                } else {
                    Text(model.snapshot?.stage.name ?? model.run.currentStage.name)
                        .font(.title2.weight(.semibold))
                    Text(displayedTime)
                        .font(.system(size: 64, weight: .medium, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.55)
                        .foregroundStyle(appearance.accent)
                        .accessibilityLabel(showsElapsed ? "Time elapsed" : "Time remaining")
                        .accessibilityValue(displayedTime)

                    ProgressView(value: model.snapshot?.progress ?? 0)
                        .tint(appearance.accent)

                    if model.run.status == .running, let agitation = model.snapshot?.agitation,
                        agitation.isActive
                    {
                        Label("Agitate now", systemImage: "waveform.path")
                            .font(.headline)
                            .foregroundStyle(appearance.accent)
                    } else if model.run.status == .running,
                        let next = model.snapshot?.agitation.nextTransitionAfter
                    {
                        Text("Next agitation in \(duration(next))")
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(appearance.muted)
                    }
                }

                if let target = observedRecipeStage?.targetTemperatureCelsius {
                    Text(
                        "Selected temperature \(temperatureLabel(target))"
                    )
                    .font(.callout)
                }
                if let agitation = observedRecipeStage?.selectedAgitationDescription {
                    Text("Selected agitation: \(agitation)")
                        .font(.callout)
                }
            }
        }
    }

    private var displayedTime: String {
        if showsElapsed { return duration(floor(model.snapshot?.elapsed ?? 0)) }
        return duration(model.snapshot?.remaining ?? model.run.currentStage.duration)
    }

    private var temperatureUnit: String { usesFahrenheit ? "°F" : "°C" }

    private var temperatureStep: Double { usesFahrenheit ? 0.18 : 0.1 }

    private func displayTemperature(_ celsius: Double) -> Double {
        usesFahrenheit ? celsius * 1.8 + 32 : celsius
    }

    private func celsiusTemperature(_ value: Double) -> Double {
        usesFahrenheit ? (value - 32) / 1.8 : value
    }

    private func temperatureLabel(_ celsius: Double) -> String {
        "\(displayTemperature(celsius).formatted(.number.precision(.fractionLength(0...1)))) \(temperatureUnit)"
    }

    private var controls: some View {
        VStack(spacing: HypoTheme.Space.two) {
            if let manual = model.activeManualStage {
                timerAction("Complete \(manual.name)") {
                    model.completeManualStage(manual.id)
                }

                if manual.isOptional {
                    Button("Skip optional stage", systemImage: "forward.end") {
                        model.skipManualStage(manual.id)
                    }
                    .buttonStyle(.bordered)
                }
            } else if model.canPrepareNewRun {
                timerAction("New session") { model.prepareNewRun() }
                    .accessibilityIdentifier("timer.new-session")
            } else if model.run.status == .ready || model.canSkip {
                timerAction(model.primaryActionTitle) {
                    model.performPrimaryAction(automaticallyAdvances: automaticallyAdvances)
                }
                .accessibilityIdentifier("timer.primary-action")

                if model.canSkip {
                    HStack(spacing: HypoTheme.Space.three) {
                        Button("Add 30 seconds", systemImage: "plus.circle") { model.extendStage() }
                        Button("Skip stage", systemImage: "forward.end") { model.skipStage() }
                    }
                    .buttonStyle(.bordered)
                }
            } else if model.isPersisting {
                ProgressView("Saving development session…")
            }
        }
        .padding(.horizontal, HypoTheme.Space.four)
        .padding(.vertical, HypoTheme.Space.two)
        .frame(maxWidth: .infinity)
        .background(appearance.background)
    }

    private func timerAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).frame(maxWidth: .infinity)
        }
        .buttonStyle(HypoPrimaryButtonStyle())
    }

    @ViewBuilder
    private var timerFeedback: some View {
        if let presentation = model.errorPresentation {
            HypoErrorNotice(
                presentation,
                onRecovery: {
                    if presentation.recoveryAction == .signIn {
                        onOpenAccountSettings()
                    } else {
                        Task { await model.retryFailedOperation() }
                    }
                },
                onDismiss: model.dismissError
            )
        }
    }

    private var observationPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text("Observed · \(observedRecipeStage?.name ?? model.run.currentStage.name)")
                    .font(.headline)
                Text("Optional. Record what happened, not just what the recipe selected.")
                    .font(.caption)
                    .foregroundStyle(appearance.muted)

                if observedRecipeStage?.isManual == true {
                    TextField(
                        "Actual duration (seconds)",
                        value: actualDuration,
                        format: .number.precision(.fractionLength(0...1))
                    )
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Actual stage duration in seconds")
                }

                TextField(
                    "Actual bath temperature (\(temperatureUnit))",
                    value: actualTemperature,
                    format: .number.precision(.fractionLength(0...2))
                )
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Actual bath temperature (\(temperatureUnit))")

                TextField("Observed agitation", text: observedAgitation, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(
                        "Observed agitation for \(observedRecipeStage?.name ?? model.run.currentStage.name)"
                    )
                    .accessibilityHint("Describe deviations or confirm that you followed the recipe.")
            }
        }
    }

    private var planPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text(model.run.plan.name)
                    .font(.headline)

                ForEach(model.selectedRecipe.stages, id: \.id) { stage in
                    HStack {
                        Image(
                            systemName: stageIsComplete(stage)
                                ? "checkmark.circle.fill" : "circle"
                        )
                        .foregroundStyle(
                            stageIsCurrent(stage) || stageIsComplete(stage)
                                ? appearance.accent
                                : appearance.muted
                        )
                        Text(stage.name)
                        if stage.isOptional {
                            Text("Optional")
                                .font(.caption2)
                                .foregroundStyle(appearance.muted)
                        }
                        Spacer()
                        Text(stage.publishedDuration.map(duration) ?? "Manual")
                            .monospacedDigit()
                            .foregroundStyle(appearance.muted)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private func sourceBadge(_ origin: DevelopmentRecipeOrigin) -> some View {
        Text(origin.label)
            .font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .tracking(0.8)
            .padding(.horizontal, HypoTheme.Space.two)
            .padding(.vertical, HypoTheme.Space.one)
            .background(appearance.background, in: Capsule())
            .overlay {
                Capsule().stroke(appearance.border, lineWidth: 1)
            }
            .accessibilityLabel("Recipe source: \(origin.label)")
    }

    private var developmentTemperature: Binding<Double> {
        Binding(
            get: { displayTemperature(model.selectedRecipe.selectedTemperatureCelsius ?? 20) },
            set: { model.setDevelopmentTemperature(celsiusTemperature($0)) }
        )
    }

    private var usesGeneralTemperatureEstimate: Binding<Bool> {
        Binding(
            get: { model.isUsingGeneralTemperatureEstimate },
            set: { model.setUsesGeneralTemperatureEstimate($0) }
        )
    }

    private var estimatedDevelopmentTemperature: Binding<Double> {
        Binding(
            get: {
                displayTemperature(
                    model.selectedRecipe.generalTemperatureEstimate?.targetTemperatureCelsius
                        ?? model.selectedRecipe.selectedTemperatureCelsius
                        ?? 20
                )
            },
            set: { model.setEstimatedDevelopmentTemperature(celsiusTemperature($0)) }
        )
    }

    private var actualTemperature: Binding<Double?> {
        Binding(
            get: { model.observation(for: observedStageID).actualTemperatureCelsius.map(displayTemperature) },
            set: { model.setActualTemperature($0.map(celsiusTemperature), for: observedStageID) }
        )
    }

    private var actualDuration: Binding<Double?> {
        Binding(
            get: { model.observation(for: observedStageID).actualDuration },
            set: { model.setActualDuration($0, for: observedStageID) }
        )
    }

    private var observedAgitation: Binding<String> {
        Binding(
            get: { model.observation(for: observedStageID).observedAgitation ?? "" },
            set: { model.setObservedAgitation($0, for: observedStageID) }
        )
    }

    private var observedRecipeStage: DevelopmentRecipeStage? {
        model.activeManualStage ?? model.currentRecipeStage
    }

    private var observedStageID: TimerStageID {
        observedRecipeStage?.id ?? model.run.currentStage.id
    }

    private func stageIsCurrent(_ stage: DevelopmentRecipeStage) -> Bool {
        if let manual = model.activeManualStage { return manual.id == stage.id }
        return stage.timerStage?.id == model.run.currentStage.id && model.run.status != .completed
    }

    private func stageIsComplete(_ stage: DevelopmentRecipeStage) -> Bool {
        if stage.isManual {
            return model.manualStageState(for: stage) != .pending
        }
        guard let timerStage = stage.timerStage,
            let index = model.run.plan.stages.firstIndex(where: { $0.id == timerStage.id })
        else { return false }
        return index < model.run.currentStageIndex || model.run.status == .completed
    }

    private func duration(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval.rounded(.up)))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

private extension DevelopmentRecipeOrigin {
    var label: String {
        switch self {
        case .catalog: "Catalog"
        case .personalDataServer: "Your PDS"
        case .builtIn: "Built in"
        case .local: "On this device"
        }
    }
}

#Preview {
    NavigationStack {
        TimerFeatureView(model: TimerFeatureModel(plan: TimerFeatureDefaults.blackAndWhitePlan()))
    }
    .preferredColorScheme(.dark)
}
