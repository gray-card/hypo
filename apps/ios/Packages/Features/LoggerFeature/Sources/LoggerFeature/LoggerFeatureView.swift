import DesignSystem
import HypoLexicon
import SwiftUI

public struct LoggerFeatureView: View {
    @Bindable private var model: LoggerFeatureModel
    @State private var isEditingLifecycle = false
    @State private var isShowingFrameBrowser = false

    public init(model: LoggerFeatureModel) {
        self.model = model
    }

    public var body: some View {
        ZStack {
            HypoTheme.ColorToken.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    rollPanel
                    lifecyclePanel
                    exposurePanel
                    feedback
                }
                .padding(HypoTheme.Space.four)
                .padding(.bottom, HypoTheme.Space.two)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            logFrameBar
        }
        .foregroundStyle(HypoTheme.ColorToken.text)
        .navigationTitle("Log")
        .toolbar {
            ToolbarItem(placement: .automatic) { HypoWordmark() }
        }
        .sheet(isPresented: $isEditingLifecycle) {
            RollLifecycleEditorView(model: model)
        }
        .sheet(isPresented: $isShowingFrameBrowser) {
            FrameBrowserView(model: model)
        }
    }

    private var rollPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                if model.availableRolls.count > 1 {
                    Picker("Active roll", selection: activeRollBinding) {
                        ForEach(model.availableRolls, id: \.uri) { roll in
                            Text(roll.label).tag(roll.uri)
                        }
                    }
                    .pickerStyle(.menu)
                    .accessibilityHint("Changes which roll receives new frame records.")
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(model.activeRoll.label)
                        .font(.title2.weight(.semibold))
                    Spacer()
                    Text(exposureCount)
                        .font(.title3.monospacedDigit())
                        .accessibilityLabel(exposureCountAccessibilityLabel)
                }
                Text(stockAndExposureIndex)
                    .foregroundStyle(HypoTheme.ColorToken.muted)
                if let camera = model.activeRoll.cameraName {
                    Text([camera, model.activeRoll.lensName].compactMap { $0 }.joined(separator: " · "))
                        .font(.callout)
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
                if model.canInspectFrames, model.activeRoll.exposuresUsed > 0 {
                    Button {
                        Task {
                            await model.loadFrameList()
                            if model.error == nil { isShowingFrameBrowser = true }
                        }
                    } label: {
                        Label(
                            "Review logged frames",
                            systemImage: "list.bullet.rectangle"
                        )
                    }
                    .font(.callout.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(HypoTheme.ColorToken.accent)
                    .accessibilityHint("Shows the complete frame list for this roll.")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Active roll")
    }

    private var lifecyclePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text("Roll timeline")
                            .font(.headline)
                        Text("Dates are optional. Add only what you know.")
                            .font(.caption)
                            .foregroundStyle(HypoTheme.ColorToken.muted)
                    }
                    Spacer()
                    Button("Edit dates") { isEditingLifecycle = true }
                        .font(.callout.weight(.semibold))
                        .accessibilityHint("Opens all optional roll dates.")
                }

                if model.availableLifecycleActions.isEmpty {
                    Label("Timeline complete", systemImage: "checkmark.circle")
                        .font(.callout)
                        .foregroundStyle(HypoTheme.ColorToken.success)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: HypoTheme.Space.two) {
                            ForEach(model.availableLifecycleActions) { action in
                                Button {
                                    Task { try? await model.applyLifecycleAction(action) }
                                } label: {
                                    Label(action.title, systemImage: action.systemImage)
                                        .font(.callout.weight(.medium))
                                        .padding(.horizontal, HypoTheme.Space.three)
                                        .frame(minHeight: 44)
                                        .background(
                                            HypoTheme.ColorToken.background,
                                            in: Capsule()
                                        )
                                        .overlay {
                                            Capsule()
                                                .stroke(HypoTheme.ColorToken.border, lineWidth: 1)
                                        }
                                }
                                .buttonStyle(.plain)
                                .disabled(model.isSavingLifecycle)
                                .accessibilityLabel(action.accessibilityLabel)
                                .accessibilityHint("Uses the current date and time.")
                            }
                        }
                    }
                }
            }
        }
    }

    private var exposurePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                Stepper(value: $model.draft.frameNumber, in: 0...999) {
                    LabeledContent("Frame") {
                        Text("\(model.draft.frameNumber)").monospacedDigit()
                    }
                }
                .accessibilityLabel("Frame number")
                .accessibilityValue("\(model.draft.frameNumber)")

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: HypoTheme.Space.three) {
                        exposureDials
                    }
                    VStack(spacing: HypoTheme.Space.four) { exposureDials }
                }

                if !model.shoots.isEmpty {
                    Picker("Shoot", selection: shootBinding) {
                        Text("No shoot").tag(ATURI?.none)
                        ForEach(model.shoots) { shoot in
                            Text(shoot.label).tag(Optional(shoot.uri))
                        }
                    }
                    .accessibilityHint("Associates this exposure with a shoot.")

                    if model.canCaptureShootLocation, model.draft.shoot != nil {
                        Toggle(
                            "Add location for this shoot",
                            isOn: shootLocationBinding
                        )
                        .disabled(model.isRequestingLocation)
                        .accessibilityHint(
                            "When on, the logger requests the current location for each new frame in this shoot."
                        )
                    }
                }

                Toggle("Use a different EI for this frame", isOn: exposureIndexOverrideBinding)
                    .accessibilityHint(
                        model.activeRoll.exposureIndex.map { "The roll remains at EI \($0)." }
                            ?? "The roll's exposure index is not recorded."
                    )
                    .disabled(model.activeRoll.exposureIndex == nil)
                if model.hasExposureIndexOverride {
                    Stepper(value: exposureIndexBinding, in: 1...204_800, step: 1) {
                        LabeledContent("Frame EI") {
                            Text("\(model.draft.shotAtISO ?? model.activeRoll.exposureIndex ?? 1)")
                                .monospacedDigit()
                        }
                    }
                    .accessibilityLabel("Frame exposure index")
                    .accessibilityValue(
                        "\(model.draft.shotAtISO ?? model.activeRoll.exposureIndex ?? 1)"
                    )
                }

                Toggle("Multiple exposure", isOn: $model.draft.multipleExposure)
                    .accessibilityHint("Keeps the next log on this physical frame.")
                TextField("Note", text: $model.draft.note, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Exposure note")
                    .accessibilityHint("Type a note, or use the keyboard microphone to dictate one.")
            }
        }
    }

    @ViewBuilder
    private var exposureDials: some View {
        ApertureDial(selection: apertureIndexBinding, scale: apertureScale)
        ShutterSpeedDial(selection: shutterSpeedIndexBinding, scale: shutterSpeedScale)
    }

    @ViewBuilder
    private var feedback: some View {
        if let confirmation = model.confirmation {
            Label(confirmation, systemImage: "checkmark.circle.fill")
                .foregroundStyle(HypoTheme.ColorToken.success)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(confirmation)
        }
        if let error = model.error {
            Label(error.message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("Error: \(error.message)")
        }
    }

    private var logFrameBar: some View {
        Button {
            Task { await model.logFrame() }
        } label: {
            Label(model.isSaving ? "Logging…" : "Log frame", systemImage: "square.and.pencil")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(HypoPrimaryButtonStyle())
        .disabled(model.isSaving)
        .accessibilityIdentifier("logger.log-frame")
        .accessibilityHint("Saves frame \(model.draft.frameNumber) and prepares the next frame.")
        .padding(.horizontal, HypoTheme.Space.four)
        .padding(.vertical, HypoTheme.Space.two)
        .background(.ultraThinMaterial)
    }

    private var shootBinding: Binding<ATURI?> {
        Binding(
            get: { model.draft.shoot },
            set: { model.associateWithShoot($0) }
        )
    }

    private var shootLocationBinding: Binding<Bool> {
        Binding(
            get: { model.isLocationCaptureEnabledForSelectedShoot },
            set: { enabled in
                Task { await model.setLocationCaptureEnabled(enabled) }
            }
        )
    }

    private var apertureIndexBinding: Binding<Int> {
        Binding(
            get: { model.apertureIndex },
            set: { model.selectAperture(at: $0) }
        )
    }

    private var shutterSpeedIndexBinding: Binding<Int> {
        Binding(
            get: { model.shutterSpeedIndex },
            set: { model.selectShutterSpeed(at: $0) }
        )
    }

    private var apertureScale: ExposureDialScale {
        ExposureDialScale(
            marks: model.exposureControls.apertures.map {
                ExposureDialMark(id: $0, displayValue: "f/\($0)", accessibilityValue: "f \($0)")
            }
        )
    }

    private var shutterSpeedScale: ExposureDialScale {
        ExposureDialScale(
            marks: model.exposureControls.shutterSpeeds.map {
                ExposureDialMark(
                    id: $0,
                    displayValue: $0.hasSuffix("s") ? $0 : $0,
                    accessibilityValue: shutterAccessibilityValue($0)
                )
            }
        )
    }

    private func shutterAccessibilityValue(_ value: String) -> String {
        if value.contains("/") {
            return value.replacingOccurrences(of: "/", with: " over ") + " second"
        }
        return value.hasSuffix("s") ? value : "\(value) seconds"
    }

    private var exposureIndexOverrideBinding: Binding<Bool> {
        Binding(
            get: { model.hasExposureIndexOverride },
            set: { model.setExposureIndexOverrideEnabled($0) }
        )
    }

    private var exposureIndexBinding: Binding<Int> {
        Binding(
            get: { model.draft.shotAtISO ?? model.activeRoll.exposureIndex ?? 1 },
            set: { model.draft.shotAtISO = $0 }
        )
    }

    private var activeRollBinding: Binding<ATURI> {
        Binding(
            get: { model.activeRoll.uri },
            set: { model.selectActiveRoll($0) }
        )
    }

    private var exposureCount: String {
        guard let total = model.activeRoll.exposuresTotal else {
            return "\(model.activeRoll.exposuresUsed) used"
        }
        return "\(model.activeRoll.exposuresUsed)/\(total)"
    }

    private var exposureCountAccessibilityLabel: String {
        guard let total = model.activeRoll.exposuresTotal else {
            return "\(model.activeRoll.exposuresUsed) frames used; roll capacity unknown"
        }
        return "\(model.activeRoll.exposuresUsed) of \(total) frames used"
    }

    private var stockAndExposureIndex: String {
        guard let exposureIndex = model.activeRoll.exposureIndex else {
            return "\(model.activeRoll.stockName) · EI not recorded"
        }
        return "\(model.activeRoll.stockName) · EI \(exposureIndex)"
    }
}

private struct RollLifecycleEditorView: View {
    @Bindable var model: LoggerFeatureModel
    @Environment(\.dismiss) private var dismiss
    @State private var milestones: FilmRollMilestones
    @State private var developmentLocation: FilmRollDevelopmentLocation?

    init(model: LoggerFeatureModel) {
        self.model = model
        _milestones = State(initialValue: model.activeRoll.milestones)
        _developmentLocation = State(initialValue: model.activeRoll.developmentLocation)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Every date is optional. Dates that are present must follow the roll’s order.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Shooting") {
                    lifecycleDate("Loaded", date: $milestones.loadedAt)
                    lifecycleDate("First exposure", date: $milestones.partialAt)
                    lifecycleDate("Fully exposed", date: $milestones.exposedAt)
                    lifecycleDate("Unloaded", date: $milestones.unloadedAt)
                }

                Section("Development") {
                    lifecycleDate("Sent to lab", date: $milestones.sentToLabAt)
                    lifecycleDate("Development started", date: $milestones.developmentStartedAt)
                    lifecycleDate("Developed", date: $milestones.developedAt)
                    Picker("Developed at", selection: $developmentLocation) {
                        Text("Not specified").tag(FilmRollDevelopmentLocation?.none)
                        Text("Home").tag(Optional(FilmRollDevelopmentLocation.home))
                        Text("Lab").tag(Optional(FilmRollDevelopmentLocation.lab))
                        Text("Other").tag(Optional(FilmRollDevelopmentLocation.other))
                    }
                    lifecycleDate("Received from lab", date: $milestones.receivedFromLabAt)
                }

                Section("After development") {
                    lifecycleDate("Scanned", date: $milestones.scannedAt)
                    lifecycleDate("Archived", date: $milestones.archivedAt)
                }

                if let error = model.error {
                    Section {
                        Label(error.message, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(HypoTheme.ColorToken.danger)
                            .accessibilityLabel("Error: \(error.message)")
                    }
                }
            }
            .navigationTitle("Roll dates")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.isSavingLifecycle ? "Saving…" : "Save") {
                        Task {
                            do {
                                try await model.saveMilestones(
                                    milestones,
                                    developmentLocation: developmentLocation
                                )
                                dismiss()
                            } catch {
                                // The model exposes an actionable validation or write error in the form.
                            }
                        }
                    }
                    .disabled(model.isSavingLifecycle)
                }
            }
        }
    }

    private func lifecycleDate(
        _ title: String,
        date: Binding<ATProtoDate?>
    ) -> some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            Toggle(title, isOn: optionalDateEnabled(date))
                .accessibilityHint("Turn off to leave this date unknown.")
            if date.wrappedValue != nil {
                DatePicker(
                    title,
                    selection: dateValue(date),
                    displayedComponents: [.date, .hourAndMinute]
                )
                .labelsHidden()
                .accessibilityLabel("\(title) date and time")
            }
        }
    }

    private func optionalDateEnabled(_ date: Binding<ATProtoDate?>) -> Binding<Bool> {
        Binding(
            get: { date.wrappedValue != nil },
            set: { enabled in
                date.wrappedValue = enabled ? ATProtoDate(Date()) : nil
            }
        )
    }

    private func dateValue(_ date: Binding<ATProtoDate?>) -> Binding<Date> {
        Binding(
            get: { date.wrappedValue?.date ?? Date() },
            set: { date.wrappedValue = ATProtoDate($0) }
        )
    }
}

private struct FrameBrowserView: View {
    @Bindable var model: LoggerFeatureModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoadingFrameDetails {
                    ProgressView("Loading frames")
                } else if let editing = model.editingExposure {
                    editForm(editing)
                } else if model.selectedFrameNumber != nil {
                    frameDetails
                } else {
                    frameList
                }
            }
            .navigationTitle(navigationTitle)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if model.editingExposure != nil {
                        Button("Cancel") { model.cancelEditingExposure() }
                    } else if model.selectedFrameNumber != nil {
                        Button("Frames") { model.closeSelectedFrame() }
                    } else {
                        Button("Close") { dismiss() }
                    }
                }
                if model.editingExposure != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(model.isSaving ? "Saving…" : "Save") {
                            Task { await model.saveEditingExposure() }
                        }
                        .disabled(model.isSaving)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var frameList: some View {
        if model.frameSummaries.isEmpty {
            ContentUnavailableView(
                "No logged frames",
                systemImage: "rectangle.stack",
                description: Text("This roll has no cached or published exposure records.")
            )
        } else {
            List(model.frameSummaries) { frame in
                Button {
                    Task { await model.loadFrameDetails(frameNumber: frame.frameNumber) }
                } label: {
                    HStack(spacing: HypoTheme.Space.three) {
                        Text("\(frame.frameNumber)")
                            .font(.title2.monospacedDigit().weight(.semibold))
                            .frame(minWidth: 42, alignment: .leading)
                        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                            Text(
                                frame.exposureCount == 1
                                    ? "1 exposure" : "\(frame.exposureCount) exposures"
                            )
                            .font(.headline)
                            if let aperture = frame.aperture,
                                let shutterSpeed = frame.shutterSpeed
                            {
                                Text("f/\(aperture) · \(shutterSpeed)")
                                    .font(.callout.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(frameAccessibilityLabel(frame))
                .accessibilityHint("Shows and edits the exposures on this physical frame.")
            }
        }
    }

    @ViewBuilder
    private var frameDetails: some View {
        if model.frameDetails.isEmpty {
            ContentUnavailableView(
                "No logged exposures",
                systemImage: "square.dashed",
                description: Text("This physical frame has no exposure records.")
            )
        } else {
            List(model.frameDetails) { detail in
                VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                    HStack {
                        Text(detail.draft.multipleExposure ? "Multiple exposure" : "Exposure")
                            .font(.headline)
                        Spacer()
                        Button("Edit") { model.beginEditing(detail) }
                            .accessibilityLabel(
                                "Edit exposure on frame \(detail.draft.frameNumber)"
                            )
                    }
                    Text("f/\(detail.draft.aperture) · \(detail.draft.shutterSpeed)")
                        .font(.title3.monospacedDigit())
                    if let ei = detail.draft.shotAtISO {
                        Text("EI \(ei) override")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    if let shoot = detail.draft.shoot,
                        let association = model.shoots.first(where: { $0.uri == shoot })
                    {
                        Label(association.label, systemImage: "camera.viewfinder")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    if detail.draft.location != nil {
                        Label("Location recorded", systemImage: "location.fill")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    if !detail.draft.note.isEmpty {
                        Text(detail.draft.note)
                            .font(.callout)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var navigationTitle: String {
        guard let frameNumber = model.selectedFrameNumber else { return "Frames" }
        return "Frame \(frameNumber)"
    }

    private func frameAccessibilityLabel(_ frame: FrameSummary) -> String {
        let count = frame.exposureCount == 1 ? "1 exposure" : "\(frame.exposureCount) exposures"
        guard let aperture = frame.aperture, let shutterSpeed = frame.shutterSpeed else {
            return "Frame \(frame.frameNumber), \(count)"
        }
        return
            "Frame \(frame.frameNumber), \(count), f \(aperture), \(shutterAccessibilityValue(shutterSpeed))"
    }

    private func shutterAccessibilityValue(_ value: String) -> String {
        value.contains("/")
            ? value.replacingOccurrences(of: "/", with: " over ") + " second"
            : "\(value) seconds"
    }

    private func editForm(_ exposure: ExposureDetail) -> some View {
        Form {
            Section("Exposure") {
                TextField("Aperture", text: editingText(\.aperture))
                    .accessibilityLabel("Aperture")
                TextField("Shutter speed", text: editingText(\.shutterSpeed))
                    .accessibilityLabel("Shutter speed")
                Stepper(value: editingFrameNumber, in: 0...999) {
                    LabeledContent("Frame") {
                        Text("\(model.editingExposure?.draft.frameNumber ?? exposure.draft.frameNumber)")
                            .monospacedDigit()
                    }
                }
                Toggle("Multiple exposure", isOn: editingMultipleExposure)
            }
            Section("Context") {
                if !model.shoots.isEmpty {
                    Picker("Shoot", selection: editingShoot) {
                        Text("No shoot").tag(ATURI?.none)
                        ForEach(model.shoots) { shoot in
                            Text(shoot.label).tag(Optional(shoot.uri))
                        }
                    }
                }
                Toggle("Use a different EI", isOn: editingEIEnabled)
                if model.editingExposure?.draft.shotAtISO != nil {
                    Stepper(value: editingEI, in: 1...204_800) {
                        LabeledContent("Frame EI") {
                            Text(
                                "\(model.editingExposure?.draft.shotAtISO ?? model.activeRoll.exposureIndex ?? 1)"
                            )
                            .monospacedDigit()
                        }
                    }
                }
                TextField("Note", text: editingText(\.note), axis: .vertical)
                    .lineLimit(2...5)
                    .accessibilityLabel("Exposure note")
                    .accessibilityHint("Type a note, or use the keyboard microphone to dictate one.")
            }
        }
    }

    private func editingText(_ keyPath: WritableKeyPath<ExposureDraft, String>) -> Binding<String> {
        Binding(
            get: { model.editingExposure?.draft[keyPath: keyPath] ?? "" },
            set: { model.editingExposure?.draft[keyPath: keyPath] = $0 }
        )
    }

    private var editingFrameNumber: Binding<Int> {
        Binding(
            get: { model.editingExposure?.draft.frameNumber ?? 0 },
            set: { model.editingExposure?.draft.frameNumber = $0 }
        )
    }

    private var editingMultipleExposure: Binding<Bool> {
        Binding(
            get: { model.editingExposure?.draft.multipleExposure ?? false },
            set: { model.editingExposure?.draft.multipleExposure = $0 }
        )
    }

    private var editingShoot: Binding<ATURI?> {
        Binding(
            get: { model.editingExposure?.draft.shoot },
            set: { model.editingExposure?.draft.shoot = $0 }
        )
    }

    private var editingEIEnabled: Binding<Bool> {
        Binding(
            get: { model.editingExposure?.draft.shotAtISO != nil },
            set: { enabled in
                model.editingExposure?.draft.shotAtISO =
                    enabled ? model.activeRoll.exposureIndex : nil
            }
        )
    }

    private var editingEI: Binding<Int> {
        Binding(
            get: { model.editingExposure?.draft.shotAtISO ?? model.activeRoll.exposureIndex ?? 1 },
            set: { model.editingExposure?.draft.shotAtISO = $0 }
        )
    }
}

private extension FilmRollLifecycleAction {
    var title: String {
        switch self {
        case .loaded: "Load"
        case .firstExposure: "First frame"
        case .finished: "Finish roll"
        case .unloaded: "Unload"
        case .sentToLab: "Send to lab"
        case .developmentStarted: "Start development"
        case .developedAtHome: "Develop at home"
        case .receivedFromLab: "Receive from lab"
        case .scanned: "Scan"
        case .archived: "Archive"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .loaded: "Mark roll loaded now"
        case .firstExposure: "Mark first exposure now"
        case .finished: "Mark roll fully exposed now"
        case .unloaded: "Mark roll unloaded now"
        case .sentToLab: "Mark roll sent to lab now"
        case .developmentStarted: "Mark development started now"
        case .developedAtHome: "Mark roll developed at home now"
        case .receivedFromLab: "Mark roll received from lab now"
        case .scanned: "Mark roll scanned now"
        case .archived: "Mark roll archived now"
        }
    }

    var systemImage: String {
        switch self {
        case .loaded: "camera.aperture"
        case .firstExposure: "1.circle"
        case .finished: "checkered.flag"
        case .unloaded: "eject"
        case .sentToLab: "shippingbox"
        case .developmentStarted: "timer"
        case .developedAtHome: "house"
        case .receivedFromLab: "tray.and.arrow.down"
        case .scanned: "scanner"
        case .archived: "archivebox"
        }
    }
}
