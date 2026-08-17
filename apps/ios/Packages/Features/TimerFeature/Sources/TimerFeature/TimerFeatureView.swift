import DesignSystem
import HypoLexicon
import SwiftUI
import TimerEngine

/// A darkroom-safe development timer surface driven by absolute wall-clock time.
public struct TimerFeatureView: View {
    @Bindable private var model: TimerFeatureModel
    @Environment(\.hypoAppearance) private var appearance

    public init(model: TimerFeatureModel) {
        self.model = model
    }

    public var body: some View {
        ZStack {
            appearance.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    recipePanel
                    filmRollPanel
                    stagePanel
                    controls
                    observationPanel
                    planPanel
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .darkroomTreatment()
        .navigationTitle("Timer")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                HypoWordmark()
            }
        }
        .task {
            await model.restoreDurableSession()
            await model.loadRecipes()
            while !Task.isCancelled {
                model.refresh()
                try? await Task.sleep(for: .seconds(0.25))
            }
        }
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

                if model.run.status == .ready, model.availableRecipes.count > 1 {
                    Picker("Development recipe", selection: recipeSelection) {
                        ForEach(model.availableRecipes) { recipe in
                            Text(recipe.plan.name).tag(recipe.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .accessibilityHint("Choose before starting the timer.")
                } else {
                    Text(model.selectedRecipe.plan.name)
                        .font(.title3.weight(.semibold))
                }

                Text(model.selectedRecipe.provenance.sourceLabel)
                    .font(.caption)
                    .foregroundStyle(appearance.muted)
                if model.isLoadingRecipes {
                    ProgressView("Checking your recipes")
                        .font(.caption)
                }
            }
        }
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
                    Text(duration(model.snapshot?.remaining ?? model.run.currentStage.duration))
                        .font(.system(size: 64, weight: .medium, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.55)
                        .foregroundStyle(appearance.accent)
                        .accessibilityLabel("Time remaining")
                        .accessibilityValue(duration(model.snapshot?.remaining ?? 0))

                    ProgressView(value: model.snapshot?.progress ?? 0)
                        .tint(appearance.accent)

                    if let agitation = model.snapshot?.agitation, agitation.isActive {
                        Label("Agitate now", systemImage: "waveform.path")
                            .font(.headline)
                            .foregroundStyle(appearance.accent)
                    } else if let next = model.snapshot?.agitation.nextTransitionAfter {
                        Text("Next agitation in \(duration(next))")
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(appearance.muted)
                    }
                }

                if let target = observedRecipeStage?.targetTemperatureCelsius {
                    Text(
                        "Selected temperature: \(target.formatted(.number.precision(.fractionLength(0...1)))) °C"
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

    private var controls: some View {
        VStack(spacing: HypoTheme.Space.three) {
            if let manual = model.activeManualStage {
                Button("Complete \(manual.name)") {
                    model.completeManualStage(manual.id)
                }
                .buttonStyle(HypoPrimaryButtonStyle())
                .frame(maxWidth: .infinity)

                if manual.isOptional {
                    Button("Skip optional stage", systemImage: "forward.end") {
                        model.skipManualStage(manual.id)
                    }
                    .buttonStyle(.bordered)
                }
            } else {
                Button(model.primaryActionTitle) {
                    model.performPrimaryAction()
                }
                .buttonStyle(HypoPrimaryButtonStyle())
                .frame(maxWidth: .infinity)
                .disabled(model.run.status == .completed || model.run.status == .cancelled)

                HStack(spacing: HypoTheme.Space.three) {
                    Button("Skip", systemImage: "forward.end") {
                        model.skipStage()
                    }
                    .disabled(!model.canSkip)

                    Button("Add 30 seconds", systemImage: "plus.circle") {
                        model.extendStage()
                    }
                    .disabled(!model.canExtend)

                    Spacer()

                    Button("Cancel", role: .destructive) {
                        model.cancel()
                    }
                    .disabled(!model.canSkip && model.run.status != .ready)
                }
                .buttonStyle(.bordered)
            }

            if let errorMessage = model.errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
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
                    "Actual bath temperature (°C)",
                    value: actualTemperature,
                    format: .number.precision(.fractionLength(0...2))
                )
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Actual bath temperature in degrees Celsius")

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

    private var recipeSelection: Binding<String> {
        Binding(
            get: { model.selectedRecipe.id },
            set: { model.selectRecipe(id: $0) }
        )
    }

    private var actualTemperature: Binding<Double?> {
        Binding(
            get: { model.observation(for: observedStageID).actualTemperatureCelsius },
            set: { model.setActualTemperature($0, for: observedStageID) }
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
        }
    }
}

#Preview {
    NavigationStack {
        TimerFeatureView(model: TimerFeatureModel(plan: TimerFeatureDefaults.blackAndWhitePlan()))
    }
    .preferredColorScheme(.dark)
}
