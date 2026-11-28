import Foundation
import HypoLexicon
import SwiftUI
import TimerEngine

struct CustomDevelopmentRecipeDraft: Identifiable {
    let id: String
    var name: String
    var process: String
    var stages: [Stage]

    init(recipe: DevelopmentRecipeSelection? = nil) {
        id = recipe?.id ?? "local-\(UUID().uuidString.lowercased())"
        name = recipe?.plan.name ?? ""
        process = recipe?.process ?? AppGraycardDefsFilmProcess.bw.rawValue
        stages = recipe?.stages.map(Stage.init) ?? [Stage(name: "Develop")]
    }

    func recipe() throws -> DevelopmentRecipeSelection {
        let selections = try stages.map { try $0.selection() }
        let plan = try TimerPlan(
            id: id,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            stages: selections.compactMap(\.timerStage)
        )
        return DevelopmentRecipeSelection(
            plan: plan,
            process: process,
            stages: selections,
            provenance: DevelopmentRecipeProvenance(origin: .local, sourceLabel: "Saved on this device")
        )
    }

    struct Stage: Identifiable {
        let id: TimerStageID
        var name: String
        var duration: Int
        var dilution: String
        var temperature: Double?
        var agitation = Agitation.none
        var initialSeconds = 30
        var intervalSeconds = 60
        var agitationSeconds = 10

        init(name: String = "") {
            id = TimerStageID(rawValue: UUID().uuidString.lowercased())
            self.name = name
            duration = 60
            dilution = ""
        }

        init(_ stage: DevelopmentRecipeStage) {
            id = stage.id
            name = stage.name
            duration = Int(stage.publishedDuration ?? 60)
            dilution = stage.dilution ?? ""
            temperature = stage.targetTemperatureCelsius
            switch stage.selectedAgitation ?? .none {
            case .none:
                break
            case .continuous:
                agitation = .continuous
            case let .periodic(initial, every, active):
                agitation = .periodic
                initialSeconds = Int(initial)
                intervalSeconds = Int(every)
                agitationSeconds = Int(active)
            }
        }

        func selection() throws -> DevelopmentRecipeStage {
            let schedule: AgitationSchedule
            let description: String?
            switch agitation {
            case .none:
                schedule = .none
                description = nil
            case .continuous:
                schedule = .continuous
                description = "Continuous"
            case .periodic:
                schedule = .periodic(
                    initial: TimeInterval(initialSeconds),
                    every: TimeInterval(intervalSeconds),
                    for: TimeInterval(agitationSeconds)
                )
                description = "First \(initialSeconds)s, then \(agitationSeconds)s every \(intervalSeconds)s"
            }
            let timer = try TimerStage(
                id: id,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                duration: TimeInterval(duration),
                agitation: schedule
            )
            let ratio = dilution.trimmingCharacters(in: .whitespacesAndNewlines)
            return DevelopmentRecipeStage(
                timerStage: timer,
                chemistryRoles: [AppGraycardDefsChemistryRole.other.rawValue],
                dilution: ratio.isEmpty ? nil : ratio,
                targetTemperatureCelsius: temperature,
                selectedAgitationDescription: description
            )
        }

        enum Agitation: String, CaseIterable, Identifiable {
            case none = "None"
            case continuous = "Continuous"
            case periodic = "Intervals"

            var id: Self { self }
        }
    }
}

struct CustomDevelopmentRecipeEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: CustomDevelopmentRecipeDraft
    let onSave: (DevelopmentRecipeSelection) -> Void

    var body: some View {
        let recipe = try? draft.recipe()
        NavigationStack {
            Form {
                Section("Recipe") {
                    TextField("Recipe name", text: $draft.name)
                    Picker("Process", selection: $draft.process) {
                        Text("Black-and-white").tag(AppGraycardDefsFilmProcess.bw.rawValue)
                        Text("C-41").tag(AppGraycardDefsFilmProcess.c41.rawValue)
                        Text("ECN-2").tag(AppGraycardDefsFilmProcess.ecn2.rawValue)
                        Text("E-6").tag(AppGraycardDefsFilmProcess.e6.rawValue)
                        Text("B&W reversal").tag(AppGraycardDefsFilmProcess.reversalBw.rawValue)
                        Text("Monobath").tag(AppGraycardDefsFilmProcess.monobath.rawValue)
                        Text("Other").tag(AppGraycardDefsFilmProcess.other.rawValue)
                    }
                }
                Section("Timed stages") {
                    ForEach($draft.stages) { $stage in
                        DisclosureGroup(stage.name.isEmpty ? "Untitled stage" : stage.name) {
                            TextField("Stage name", text: $stage.name)
                            secondsField("Duration (seconds)", value: $stage.duration)
                            TextField("Dilution", text: $stage.dilution)
                            TextField("Temperature (°C)", value: $stage.temperature, format: .number)
                            Picker("Agitation", selection: $stage.agitation) {
                                ForEach(CustomDevelopmentRecipeDraft.Stage.Agitation.allCases) {
                                    Text($0.rawValue).tag($0)
                                }
                            }
                            if stage.agitation == .periodic {
                                secondsField("Initial seconds", value: $stage.initialSeconds)
                                secondsField("Repeat every (seconds)", value: $stage.intervalSeconds)
                                secondsField("Agitate for (seconds)", value: $stage.agitationSeconds)
                            }
                        }
                        .deleteDisabled(draft.stages.count == 1)
                    }
                    .onMove { draft.stages.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { draft.stages.remove(atOffsets: $0) }

                    Button("Add stage", systemImage: "plus.circle") { draft.stages.append(.init()) }
                }
            }
            .navigationTitle("Custom recipe")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                #if os(iOS)
                    ToolbarItem(placement: .secondaryAction) { EditButton() }
                #endif
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save recipe") {
                        guard let recipe else { return }
                        onSave(recipe)
                        dismiss()
                    }
                    .disabled(recipe == nil)
                }
            }
        }
    }

    private func secondsField(_ label: String, value: Binding<Int>) -> some View {
        LabeledContent(label) {
            TextField(label, value: value, format: .number.grouping(.never))
                .multilineTextAlignment(.trailing)
                #if os(iOS)
                    .keyboardType(.numberPad)
                #endif
        }
    }
}
