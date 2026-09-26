import DesignSystem
import MeterEngine
import SwiftUI

struct SettingsCalibrationPanel: View {
    @Bindable var model: SettingsFeatureModel
    @State private var pendingDeletion: CalibrationProfile?

    var body: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                heading
                if let issue = model.calibrationIssue {
                    issueView(issue)
                }
                if let message = model.calibrationConfirmationMessage {
                    confirmationView(message)
                }
                profiles
                Button {
                    model.startCalibration()
                } label: {
                    Label("Run calibration", systemImage: "scope")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(HypoPrimaryButtonStyle())
                .disabled(model.calibrationOperation != nil)
            }
        }
        .confirmationDialog(
            "Delete this calibration?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { profile in
            Button("Delete calibration", role: .destructive) {
                pendingDeletion = nil
                Task { await model.deleteCalibration(id: profile.id) }
            }
        } message: { _ in
            Text(
                "Readings that already cite this profile keep that reference. New readings will use another selected profile or no calibration."
            )
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text("METER CALIBRATION")
                        .font(.caption.monospaced().weight(.semibold))
                        .tracking(1.4)
                        .foregroundStyle(HypoTheme.ColorToken.accent)
                    Text("Profiles and drift checks")
                        .font(.title2.weight(.semibold))
                }
                Spacer()
                if model.calibrationOperation == .loading {
                    ProgressView()
                        .accessibilityLabel("Loading calibration profiles")
                }
            }
            Text(
                "A profile applies only to the device, camera module, and sensor path used to create it."
            )
            .font(.footnote)
            .foregroundStyle(HypoTheme.ColorToken.muted)
        }
    }

    @ViewBuilder
    private var profiles: some View {
        if model.calibrationProfiles.isEmpty && model.calibrationOperation != .loading {
            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                Text("No calibration profiles")
                    .font(.headline)
                Text("Run a comparison against a known reference to create one.")
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(HypoTheme.Space.three)
            .background(HypoTheme.ColorToken.elevated)
            .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
        } else {
            VStack(spacing: HypoTheme.Space.two) {
                if !model.calibrationProfiles.isEmpty {
                    noCalibrationRow
                }
                ForEach(model.calibrationProfiles) { profile in
                    profileRow(profile)
                }
            }
        }
    }

    private var noCalibrationRow: some View {
        Button {
            Task { await model.selectCalibration(id: nil) }
        } label: {
            HStack(spacing: HypoTheme.Space.three) {
                Image(systemName: model.selectedCalibrationID == nil ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(
                        model.selectedCalibrationID == nil
                            ? HypoTheme.ColorToken.accent : HypoTheme.ColorToken.muted
                    )
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text("No calibration")
                        .font(.headline)
                    Text("Use the meter's uncorrected response")
                        .font(.caption)
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, HypoTheme.Space.three)
        }
        .buttonStyle(.plain)
        .background(HypoTheme.ColorToken.elevated)
        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
        .accessibilityLabel(
            model.selectedCalibrationID == nil
                ? "No calibration, selected" : "No calibration"
        )
    }

    private func profileRow(_ profile: CalibrationProfile) -> some View {
        HStack(alignment: .center, spacing: HypoTheme.Space.three) {
            Button {
                Task { await model.selectCalibration(id: profile.id) }
            } label: {
                HStack(spacing: HypoTheme.Space.three) {
                    Image(
                        systemName: model.selectedCalibrationID == profile.id
                            ? "checkmark.circle.fill" : "circle"
                    )
                    .foregroundStyle(
                        model.selectedCalibrationID == profile.id
                            ? HypoTheme.ColorToken.accent : HypoTheme.ColorToken.muted
                    )
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text(profile.identity.deviceModel)
                            .font(.headline)
                        Text(profileIdentity(profile))
                            .font(.caption.monospaced())
                            .foregroundStyle(HypoTheme.ColorToken.muted)
                        driftLabel(for: profile)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(profileAccessibilityLabel(profile))
            .accessibilityHint("Applies this profile to matching meter readings")

            Menu {
                Button("Run drift check") { model.startCalibration(for: profile) }
                Button("Delete", role: .destructive) { pendingDeletion = profile }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Actions for \(profile.identity.deviceModel) calibration")
        }
        .padding(.horizontal, HypoTheme.Space.three)
        .padding(.vertical, HypoTheme.Space.one)
        .background(HypoTheme.ColorToken.elevated)
        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
    }

    @ViewBuilder
    private func driftLabel(for profile: CalibrationProfile) -> some View {
        switch model.driftStatus(for: profile) {
        case let .due(since):
            Label(
                "Drift check due \(since.formatted(date: .abbreviated, time: .omitted))",
                systemImage: "exclamationmark.circle.fill"
            )
            .font(.caption)
            .foregroundStyle(HypoTheme.ColorToken.accent)
        case let .scheduled(date):
            Label(
                "Check \(date.formatted(date: .abbreviated, time: .omitted))",
                systemImage: "calendar"
            )
            .font(.caption)
            .foregroundStyle(HypoTheme.ColorToken.muted)
        case .notScheduled:
            Label("No drift check scheduled", systemImage: "calendar.badge.minus")
                .font(.caption)
                .foregroundStyle(HypoTheme.ColorToken.muted)
        }
    }

    private func issueView(_ issue: SettingsCalibrationIssue) -> some View {
        HStack(alignment: .top, spacing: HypoTheme.Space.three) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(HypoTheme.ColorToken.danger)
            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                Text(issue.title).font(.headline)
                Text(issue.message)
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.muted)
            }
            Spacer()
            Button {
                model.dismissCalibrationIssue()
            } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss calibration error")
        }
        .padding(HypoTheme.Space.three)
        .background(HypoTheme.ColorToken.danger.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
    }

    private func confirmationView(_ message: String) -> some View {
        HStack(spacing: HypoTheme.Space.three) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(HypoTheme.ColorToken.success)
            Text(message).font(.footnote)
            Spacer()
            Button {
                model.dismissCalibrationConfirmation()
            } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss calibration confirmation")
        }
    }

    private func profileIdentity(_ profile: CalibrationProfile) -> String {
        let offset = profile.constantOffsetStops.formatted(
            .number.sign(strategy: .always()).precision(.fractionLength(2))
        )
        return
            "\(profile.identity.module.rawValue) · \(profile.identity.sensorPath.rawValue) · \(offset) stops"
    }

    private func profileAccessibilityLabel(_ profile: CalibrationProfile) -> String {
        let selected = model.selectedCalibrationID == profile.id ? ", selected" : ""
        let drift: String =
            switch model.driftStatus(for: profile) {
            case .due: ", drift check due"
            case let .scheduled(date):
                ", drift check scheduled \(date.formatted(date: .long, time: .omitted))"
            case .notScheduled: ", no drift check scheduled"
            }
        return "\(profile.identity.deviceModel), \(profileIdentity(profile))\(selected)\(drift)"
    }
}

struct SettingsCalibrationGuide: View {
    @Bindable var model: SettingsFeatureModel

    var body: some View {
        NavigationStack {
            Form {
                referenceSection
                measurementSection
                if let sample = model.calibrationSample {
                    comparisonSection(sample)
                }
                limitationSection
            }
            .navigationTitle("Calibrate meter")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancelCalibrationGuide() }
                        .disabled(model.calibrationOperation != nil)
                }
            }
            .interactiveDismissDisabled(model.calibrationOperation != nil)
        }
    }

    private var referenceSection: some View {
        Section("1. Choose a reference") {
            Picker("Reference", selection: $model.calibrationReference) {
                Text("Handheld meter").tag(CalibrationReference.handheldMeter)
                Text("Known target").tag(CalibrationReference.knownTarget)
                Text("Sunny 16").tag(CalibrationReference.sunny16)
            }
            TextField(referenceDetailPrompt, text: $model.calibrationReferenceDetail)
                .accessibilityLabel("Reference details")
            Text(referenceInstructions)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var measurementSection: some View {
        Section("2. Measure the same target") {
            Text(
                "Keep the phone and reference aimed at the same evenly lit area. Avoid glare, shadows, and changing light."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            Button {
                Task { await model.captureCalibrationSample() }
            } label: {
                if model.calibrationOperation == .capturing {
                    HStack {
                        ProgressView()
                        Text("Measuring…")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Label("Measure target", systemImage: "scope")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .disabled(model.calibrationOperation != nil)
        }
    }

    private func comparisonSection(_ sample: SettingsCalibrationSample) -> some View {
        Section("3. Enter the reference reading") {
            LabeledContent("Hypo measured") {
                Text(sample.measuredEV100.formatted(.number.precision(.fractionLength(2))))
                    .monospacedDigit()
            }
            LabeledContent("Camera module", value: sample.identity.module.rawValue)
            LabeledContent("Sensor path", value: sample.identity.sensorPath.rawValue)
            TextField("Reference EV 100", text: $model.calibrationReferenceEV100Text)
                .accessibilityLabel("Reference exposure value at ISO 100")
                #if os(iOS)
                    .keyboardType(.decimalPad)
                #endif
            Text("Enter the EV 100 shown by the reference, not an ISO-adjusted exposure value.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button {
                Task { await model.saveCalibration() }
            } label: {
                if model.calibrationOperation == .saving {
                    HStack {
                        ProgressView()
                        Text("Saving…")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Text("Save and apply calibration")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .disabled(!model.canSaveCalibration)
        }
    }

    private var limitationSection: some View {
        Section {
            Text(
                "This creates a one-point offset profile near the tested light level. It does not characterize the camera across its full measurement range."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }

    private var referenceInstructions: String {
        switch model.calibrationReference {
        case .handheldMeter:
            "Use a trusted meter in reflected mode, with both meters covering the same target."
        case .knownTarget:
            "Use a gray card or uniform target under illumination whose EV 100 you know."
        case .sunny16:
            "Use direct, unobstructed sunlight and treat the result as an approximate field reference."
        case .factory, .manufacturerSpecification:
            "Use a trusted meter in reflected mode, with both meters covering the same target."
        }
    }

    private var referenceDetailPrompt: String {
        switch model.calibrationReference {
        case .handheldMeter: "Meter model or serial number (optional)"
        case .knownTarget: "Target or illuminant (optional)"
        case .sunny16: "Conditions and location (optional)"
        case .factory, .manufacturerSpecification: "Reference details (optional)"
        }
    }
}
