import DesignSystem
import MeterEngine
import SwiftUI

public struct MeterFeatureView: View {
    @Bindable private var model: MeterFeatureModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var isShowingCalibration = false
    @State private var isShowingReadingLog = false
    @State private var isShowingPrivateCapture = false
    @State private var zoomAtGestureStart = 1.0

    public init(model: MeterFeatureModel) {
        self.model = model
    }

    public var body: some View {
        ZStack {
            activeAppearance.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    modePicker
                    previewPanel
                    readingPanel
                    configurationPanel
                    controls
                    heldPanel
                    spotAnalysisPanel
                    readingLogPanel
                    accuracyBoundary
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .hypoAppearance(activeAppearance)
        .navigationTitle("Meter")
        .toolbar {
            ToolbarItem(placement: .automatic) { HypoWordmark() }
            ToolbarItem(placement: .automatic) {
                Button {
                    model.darkroomMode.toggle()
                } label: {
                    Label(
                        model.darkroomMode ? "Leave darkroom mode" : "Use darkroom mode",
                        systemImage: model.darkroomMode ? "lightbulb.slash.fill" : "lightbulb.slash"
                    )
                }
                .accessibilityHint("Changes the display palette; it does not change the measurement.")
            }
        }
        .task { await model.loadDurableState() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.synchronizePrivateCaptureIfEnabled() }
        }
        .onDisappear { model.stopContinuous() }
        .sheet(isPresented: $isShowingCalibration) {
            CalibrationProfilesView(model: model)
                .hypoAppearance(activeAppearance)
        }
        .sheet(isPresented: $isShowingReadingLog) {
            MeterReadingLogView(model: model)
                .hypoAppearance(activeAppearance)
        }
        .sheet(isPresented: $isShowingPrivateCapture) {
            PrivateMeterCaptureView(model: model)
                .hypoAppearance(activeAppearance)
        }
    }

    private var activeAppearance: HypoAppearance {
        model.darkroomMode ? .darkroom : .standard
    }

    private var modePicker: some View {
        Picker("Metering mode", selection: $model.mode) {
            ForEach(MeterFeatureMode.allCases, id: \.self) { mode in
                Text(mode.rawValue).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .frame(minHeight: 44)
        .onChange(of: model.mode) { _, _ in
            model.stopContinuous()
        }
    }

    @ViewBuilder
    private var previewPanel: some View {
        if model.mode != .incident {
            InstrumentPanel {
                VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                    HStack {
                        Text("Scene")
                            .font(.headline)
                        Spacer()
                        if model.mode == .spot {
                            Text("\(model.previewZoom, format: .number.precision(.fractionLength(1)))×")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(activeAppearance.muted)
                        }
                    }
                    cameraPreview
                        .frame(minHeight: 220, idealHeight: 280, maxHeight: 340)
                        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
                        .overlay {
                            RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                                .stroke(activeAppearance.border, lineWidth: 1)
                        }
                    if model.mode == .spot {
                        Text("Drag the reticle or use its VoiceOver actions. Pinch to inspect framing.")
                            .font(.caption)
                            .foregroundStyle(activeAppearance.muted)
                    }
                }
            }
        }
    }

    private var cameraPreview: some View {
        GeometryReader { proxy in
            ZStack {
                #if canImport(AVFoundation)
                    if let session = model.previewSession {
                        MeterCameraPreview(session: session)
                            .scaleEffect(model.previewZoom)
                            .accessibilityHidden(true)
                    } else {
                        previewUnavailable
                    }
                #else
                    previewUnavailable
                #endif

                if model.mode == .spot {
                    spotReticle
                        .position(
                            x: proxy.size.width * model.spotReticleX,
                            y: proxy.size.height * model.spotReticleY
                        )
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    guard proxy.size.width > 0, proxy.size.height > 0 else { return }
                                    model.setSpotReticle(
                                        x: value.location.x / proxy.size.width,
                                        y: value.location.y / proxy.size.height
                                    )
                                }
                        )
                }
            }
            .contentShape(Rectangle())
            .clipped()
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        model.setPreviewZoom(zoomAtGestureStart * value.magnification)
                    }
                    .onEnded { _ in
                        zoomAtGestureStart = model.previewZoom
                    }
            )
        }
    }

    private var previewUnavailable: some View {
        ZStack {
            activeAppearance.background
            VStack(spacing: HypoTheme.Space.two) {
                Image(systemName: "camera.viewfinder")
                    .font(.largeTitle)
                Text("Camera preview unavailable")
                    .font(.headline)
                Text("Metering remains available. A preview requires the meter’s own capture session.")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(activeAppearance.muted)
                    .padding(.horizontal, HypoTheme.Space.four)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var spotReticle: some View {
        ZStack {
            Circle()
                .stroke(.black.opacity(0.75), lineWidth: 5)
                .frame(width: 32, height: 32)
            Circle()
                .stroke(activeAppearance.accent, lineWidth: 2)
                .frame(width: 32, height: 32)
            Rectangle()
                .fill(activeAppearance.accent)
                .frame(width: 2, height: 48)
            Rectangle()
                .fill(activeAppearance.accent)
                .frame(width: 48, height: 2)
        }
        .frame(width: 56, height: 56)
        .contentShape(Circle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Spot meter reticle")
        .accessibilityValue(
            "\(Int((model.spotReticleX * 100).rounded())) percent from left, "
                + "\(Int((model.spotReticleY * 100).rounded())) percent from top"
        )
        .accessibilityHint("Use the custom actions to move the metering point.")
        .accessibilityAction(named: "Move left") {
            model.moveSpotReticle(horizontal: -0.05, vertical: 0)
        }
        .accessibilityAction(named: "Move right") {
            model.moveSpotReticle(horizontal: 0.05, vertical: 0)
        }
        .accessibilityAction(named: "Move up") {
            model.moveSpotReticle(horizontal: 0, vertical: -0.05)
        }
        .accessibilityAction(named: "Move down") {
            model.moveSpotReticle(horizontal: 0, vertical: 0.05)
        }
        .accessibilityAction(named: "Center") {
            model.setSpotReticle(x: 0.5, y: 0.5)
        }
    }

    private var readingPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack(alignment: .firstTextBaseline) {
                    Text(model.reading.map { String(format: "%.1f", $0.ev100.rawValue) } ?? "—")
                        .font(.system(size: 72, weight: .medium, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                    Text("EV 100")
                        .font(.headline)
                        .foregroundStyle(activeAppearance.muted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Meter reading")
                .accessibilityValue(
                    model.reading.map { "\($0.ev100.rawValue, specifier: "%.1f") EV 100" }
                        ?? "No reading"
                )

                if let reading = model.reading {
                    HStack {
                        Text(reading.camera.name)
                        Spacer()
                        Text(reading.accuracyTier.rawValue.capitalized)
                    }
                    .font(.callout)
                    .foregroundStyle(activeAppearance.muted)

                    if let angle = reading.achievedSpotAngleDegrees {
                        Text("Achieved spot: \(angle, format: .number.precision(.fractionLength(1)))°")
                            .font(.callout)
                    }

                    if !reading.flags.isEmpty {
                        Text(reading.flags.sorted().map(\.rawValue).joined(separator: " · "))
                            .font(.caption.monospaced())
                            .foregroundStyle(HypoTheme.ColorToken.danger)
                    }
                } else {
                    Text("Measure to read the scene")
                        .foregroundStyle(activeAppearance.muted)
                }
            }
        }
    }

    private var configurationPanel: some View {
        InstrumentPanel {
            VStack(spacing: HypoTheme.Space.three) {
                Stepper(value: $model.averagingCount, in: 1...9) {
                    LabeledContent("Average") {
                        Text("\(model.averagingCount) reading\(model.averagingCount == 1 ? "" : "s")")
                    }
                }
                .frame(minHeight: 44)

                if model.mode == .spot {
                    LabeledContent("Requested spot") {
                        Text("\(model.spotAngleDegrees, format: .number.precision(.fractionLength(0...1)))°")
                    }
                    Slider(value: $model.spotAngleDegrees, in: 1...10, step: 1)
                        .accessibilityLabel("Requested spot angle")
                }

                if model.mode == .incident {
                    Picker("Receptor", selection: $model.incidentReceptor) {
                        Text("Flat").tag(IncidentReceptor.flat)
                        Text("Dome").tag(IncidentReceptor.dome)
                    }
                    .pickerStyle(.segmented)
                    Text(
                        "Phone-only incident readings remain approximate. Hypo does not claim "
                            + "diffuser characterization that has not been performed."
                    )
                    .font(.footnote)
                    .foregroundStyle(activeAppearance.muted)
                }

                Button {
                    isShowingCalibration = true
                } label: {
                    LabeledContent("Calibration") {
                        Text(model.selectedCalibration == nil ? "None" : "Applied")
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Manage device-, camera-, and sensor-path-specific profiles.")

                Button {
                    isShowingPrivateCapture = true
                } label: {
                    LabeledContent("Private context") {
                        Text(
                            model.privateCaptureSettings.captureEnabled
                                ? "On · \(model.privateCaptureContextCount) saved" : "Off"
                        )
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Choose whether Hypo keeps encrypted device and sensor context.")
            }
        }
    }

    private var controls: some View {
        VStack(spacing: HypoTheme.Space.three) {
            Button {
                Task { await model.measure() }
            } label: {
                Label(
                    model.isMeasuring ? "Measuring…" : "Measure",
                    systemImage: "camera.metering.center.weighted"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(HypoPrimaryButtonStyle())
            .disabled(model.isMeasuring)

            ViewThatFits(in: .horizontal) {
                controlButtons
                VStack(spacing: HypoTheme.Space.two) { controlButtons }
            }

            if let confirmationMessage = model.confirmationMessage {
                Label(confirmationMessage, systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.success)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let errorMessage = model.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var controlButtons: some View {
        HStack(spacing: HypoTheme.Space.two) {
            Button(model.isMeasuring ? "Stop tracking" : "Track continuously") {
                model.isMeasuring ? model.stopContinuous() : model.startContinuous()
            }
            .frame(minHeight: 44)
            .buttonStyle(.bordered)

            Button("Hold") { model.holdCurrentReading() }
                .frame(minHeight: 44)
                .buttonStyle(.bordered)
                .disabled(model.reading == nil)

            Button("Use in Logger") {
                Task { await model.promoteToLogger() }
            }
            .frame(minHeight: 44)
            .buttonStyle(.bordered)
            .disabled(model.reading == nil || model.isPromoting)
            .accessibilityHint("Makes this reading available to the exposure logger.")
        }
    }

    @ViewBuilder
    private var heldPanel: some View {
        if !model.heldReadings.isEmpty {
            InstrumentPanel {
                VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                    HStack {
                        Text("Held readings").font(.headline)
                        Spacer()
                        Button("Clear") { model.clearHeldReadings() }
                            .frame(minHeight: 44)
                    }
                    ForEach(Array(model.heldReadings.enumerated()), id: \.element.id) {
                        index,
                        reading in
                        HStack(spacing: HypoTheme.Space.three) {
                            Text("\(index + 1)").foregroundStyle(activeAppearance.muted)
                            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                                Text(
                                    "EV \(reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))"
                                )
                                .monospacedDigit()
                                Text(reading.geometry.rawValue)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(activeAppearance.muted)
                            }
                            Spacer()
                            Button("Use") {
                                Task { await model.promoteToLogger(reading) }
                            }
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Use held reading \(index + 1) in Logger")
                            Button(role: .destructive) {
                                model.removeHeldReading(id: reading.id)
                            } label: {
                                Image(systemName: "trash")
                                    .frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("Delete held reading \(index + 1)")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var spotAnalysisPanel: some View {
        if let analysis = model.spotAnalysis {
            InstrumentPanel {
                VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                            Text("Spot analysis")
                                .font(.headline)
                            Text(
                                analysis.points.count == 1
                                    ? "Hold another spot to measure scene contrast."
                                    : "\(analysis.points.count) spots · average EV "
                                        + String(format: "%.1f", analysis.averageEV100.rawValue)
                            )
                            .font(.footnote)
                            .foregroundStyle(activeAppearance.muted)
                        }
                        Spacer()
                        if analysis.points.count > 1 {
                            VStack(alignment: .trailing, spacing: HypoTheme.Space.one) {
                                Text(
                                    analysis.contrastRange.rawValue,
                                    format: .number.precision(.fractionLength(1))
                                )
                                .font(.title2.monospacedDigit().weight(.semibold))
                                Text("stop range")
                                    .font(.caption)
                                    .foregroundStyle(activeAppearance.muted)
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("Scene contrast range")
                            .accessibilityValue(
                                "\(analysis.contrastRange.rawValue, specifier: "%.1f") stops"
                            )
                        }
                    }

                    if analysis.points.count > 1 {
                        contrastEndpoints(analysis)
                    }

                    Divider()

                    Text("Reference spot")
                        .font(.subheadline.weight(.semibold))
                    ForEach(Array(analysis.points.enumerated()), id: \.element.id) { index, point in
                        Button {
                            model.selectSpotAnalysisReference(id: point.id)
                        } label: {
                            spotAnalysisRow(point, number: index + 1, analysis: analysis)
                        }
                        .buttonStyle(.plain)
                        .frame(minHeight: 44)
                        .accessibilityHint(
                            point.id == analysis.referenceReadingID
                                ? "This is the reference for EV differences and Zone placement."
                                : "Makes this spot the reference for EV differences and Zone placement."
                        )
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Place reference on Zone")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(MeterZoneLabel.numeral(for: model.spotAnalysisReferenceZone))
                                .font(.title2.monospacedDigit().weight(.semibold))
                                .foregroundStyle(activeAppearance.accent)
                        }
                        MeterZoneRuler(
                            selectedZone: model.spotAnalysisReferenceZone,
                            onSelect: model.setSpotAnalysisReferenceZone
                        )
                        .accessibilityAdjustableAction { direction in
                            switch direction {
                            case .increment:
                                model.adjustSpotAnalysisReferenceZone(by: 1)
                            case .decrement:
                                model.adjustSpotAnalysisReferenceZone(by: -1)
                            @unknown default:
                                break
                            }
                        }

                        LabeledContent("Camera exposure") {
                            Text(
                                "EV \(analysis.placedExposureEV100.rawValue, format: .number.precision(.fractionLength(1)))"
                            )
                            .monospacedDigit()
                        }
                        .accessibilityHint(
                            "Exposure value after placing the reference spot on the selected Zone."
                        )
                    }

                    Button {
                        Task { await model.promoteSpotAnalysisToLogger() }
                    } label: {
                        Label(
                            analysis.points.count == 1
                                ? "Use spot in Logger" : "Use spot bank in Logger",
                            systemImage: "square.and.arrow.down"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(model.isPromoting)
                    .accessibilityHint(
                        "Sends every analyzed spot to Logger with the reference spot preferred."
                    )
                }
            }
        }
    }

    private func contrastEndpoints(_ analysis: MeterSpotAnalysis) -> some View {
        let darkest = analysis.points.first { $0.id == analysis.darkestReadingID }
        let brightest = analysis.points.first { $0.id == analysis.brightestReadingID }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: HypoTheme.Space.four) {
                contrastEndpoint("Darkest", point: darkest)
                Spacer(minLength: HypoTheme.Space.two)
                contrastEndpoint("Brightest", point: brightest)
            }
            VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                contrastEndpoint("Darkest", point: darkest)
                contrastEndpoint("Brightest", point: brightest)
            }
        }
    }

    private func contrastEndpoint(
        _ label: String,
        point: MeterSpotAnalysis.Point?
    ) -> some View {
        LabeledContent(label) {
            Text(
                point.map {
                    "EV \($0.reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))"
                } ?? "—"
            )
            .monospacedDigit()
        }
    }

    private func spotAnalysisRow(
        _ point: MeterSpotAnalysis.Point,
        number: Int,
        analysis: MeterSpotAnalysis
    ) -> some View {
        HStack(spacing: HypoTheme.Space.three) {
            Image(
                systemName: point.id == analysis.referenceReadingID
                    ? "scope" : "circle"
            )
            .foregroundStyle(
                point.id == analysis.referenceReadingID
                    ? activeAppearance.accent : activeAppearance.muted
            )
            .frame(width: 28)
            VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                HStack {
                    Text("Spot \(number)")
                        .font(.subheadline.weight(.semibold))
                    Text(
                        "EV \(point.reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))"
                    )
                    .font(.subheadline.monospacedDigit())
                }
                Text(
                    "Δ avg \(MeterZoneLabel.signed(point.deltaFromAverageStops.rawValue)) · "
                        + "Δ ref \(MeterZoneLabel.signed(point.deltaFromReferenceStops.rawValue)) · "
                        + MeterZoneLabel.description(for: point.placedZone)
                )
                .font(.caption.monospacedDigit())
                .foregroundStyle(activeAppearance.muted)
            }
            Spacer()
            if point.id == analysis.referenceReadingID {
                Text("REF")
                    .font(.caption2.monospaced().weight(.semibold))
                    .foregroundStyle(activeAppearance.accent)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Spot \(number)\(point.id == analysis.referenceReadingID ? ", reference" : "")"
        )
        .accessibilityValue(
            String(
                format: "%.1f EV 100, delta from average %+.1f stops, delta from reference %+.1f stops, %@",
                point.reading.ev100.rawValue, point.deltaFromAverageStops.rawValue,
                point.deltaFromReferenceStops.rawValue, MeterZoneLabel.description(for: point.placedZone))
        )
    }

    private var readingLogPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text("Reading log")
                            .font(.headline)
                        Text(
                            model.readingLog.isEmpty
                                ? "Deliberate measurements appear here after they are saved."
                                : "\(model.readingLog.count) saved measurement"
                                    + (model.readingLog.count == 1 ? "" : "s")
                        )
                        .font(.footnote)
                        .foregroundStyle(activeAppearance.muted)
                    }
                    Spacer()
                    Image(systemName: "book.pages")
                        .foregroundStyle(activeAppearance.accent)
                }

                if let latest = model.readingLog.first {
                    HStack {
                        Text(
                            "EV \(latest.reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))"
                        )
                        .font(.title3.monospacedDigit().weight(.semibold))
                        Spacer()
                        Text(latest.reading.takenAt, style: .relative)
                            .font(.caption)
                            .foregroundStyle(activeAppearance.muted)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Latest saved reading")
                    .accessibilityValue(
                        String(
                            format: "%.1f EV 100, %@",
                            latest.reading.ev100.rawValue,
                            latest.reading.takenAt.formatted(
                                date: .abbreviated,
                                time: .shortened
                            )
                        )
                    )
                }

                Button {
                    isShowingReadingLog = true
                } label: {
                    Label("Open reading log", systemImage: "list.bullet.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
                .accessibilityHint("Shows saved meter readings and their measurement details.")
            }
        }
    }

    private var accuracyBoundary: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                Label("Measurement limits", systemImage: "scope")
                    .font(.headline)
                Text(
                    "The preview and reticle show the requested area. The reading reports its "
                        + "actual sensor path, achieved spot angle, calibration, and warnings. "
                        + "RAW accuracy and incident diffusers require separate device characterization."
                )
                .font(.footnote)
                .foregroundStyle(activeAppearance.muted)
            }
        }
    }
}

private struct MeterZoneRuler: View {
    let selectedZone: Int
    let onSelect: (Int) -> Void
    @Environment(\.hypoAppearance) private var appearance

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: HypoTheme.Space.one) {
                ForEach(0...10, id: \.self) { zone in
                    zoneButton(zone)
                }
            }
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Zone placement ruler")
        .accessibilityValue("Zone \(MeterZoneLabel.numeral(for: selectedZone)) selected")
        .accessibilityHint("Choose a Zone or swipe up and down to adjust the placement.")
    }

    private func zoneButton(_ zone: Int) -> some View {
        let isSelected = zone == selectedZone
        let tickColor = isSelected ? appearance.accent : appearance.border
        let textColor = isSelected ? appearance.accent : appearance.text
        return Button {
            onSelect(zone)
        } label: {
            VStack(spacing: HypoTheme.Space.one) {
                Rectangle()
                    .fill(tickColor)
                    .frame(width: isSelected ? 3 : 1, height: 18)
                Text(MeterZoneLabel.numeral(for: zone))
                    .font(.caption2.monospaced().weight(isSelected ? .bold : .regular))
                    .foregroundStyle(textColor)
            }
            .frame(width: 44)
            .frame(minHeight: 52)
            .background {
                RoundedRectangle(cornerRadius: HypoTheme.Radius.small)
                    .fill(isSelected ? appearance.accent.opacity(0.12) : Color.clear)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Zone \(MeterZoneLabel.numeral(for: zone))")
        .accessibilityValue(isSelected ? "Selected" : "")
    }
}

private struct PrivateMeterCaptureView: View {
    @Bindable var model: MeterFeatureModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.hypoAppearance) private var appearance
    @State private var confirmsDeletion = false

    var body: some View {
        NavigationStack {
            ZStack {
                appearance.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: HypoTheme.Space.four) {
                        dataForkPanel
                        capturePanel
                        devicePanel
                        storedDataPanel
                        if let message = model.privateCaptureMessage {
                            InstrumentPanel {
                                Label(message, systemImage: "info.circle")
                                    .font(.footnote)
                                    .foregroundStyle(appearance.muted)
                            }
                        }
                    }
                    .padding(HypoTheme.Space.four)
                }
            }
            .navigationTitle("Private meter data")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Delete private meter data?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete everywhere", role: .destructive) {
                    Task { await model.deleteAllPrivateCaptureData() }
                }
            } message: {
                Text("This removes local data and sends encrypted deletion markers to private iCloud sync.")
            }
        }
    }

    private var dataForkPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Text("ONE READING · TWO DATA PATHS")
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(appearance.muted)
                Label("Meter reading", systemImage: "camera.metering.center.weighted")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(appearance.text)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(
                        appearance.background,
                        in: RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                    )

                Image(systemName: "arrow.triangle.branch")
                    .font(.title2)
                    .foregroundStyle(appearance.accent)
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: HypoTheme.Space.three) {
                        publicBranch
                        privateBranch
                    }
                    VStack(spacing: HypoTheme.Space.three) {
                        publicBranch
                        privateBranch
                    }
                }

                Label(
                    "Sensor, motion, and precise location data never enter the public record.",
                    systemImage: "lock.shield.fill"
                )
                .font(.footnote.weight(.semibold))
                .foregroundStyle(appearance.accent)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(
                "A meter reading forks into two separate data paths. The public projection goes to "
                    + "your PDS. Private sensor context is encrypted on this iPhone and may sync "
                    + "with private iCloud. Private context never enters the public record."
            )
        }
    }

    private var publicBranch: some View {
        branchCard(
            eyebrow: "PUBLIC BRANCH",
            title: "Photographic projection",
            detail: "EV, geometry, meter provenance, and calibration",
            destination: "PDS",
            systemImage: "network"
        )
    }

    private var privateBranch: some View {
        branchCard(
            eyebrow: "PRIVATE BRANCH",
            title: "Sensor context",
            detail: "Device, camera, orientation, attitude, motion, and optional location",
            destination: "Encrypted on this iPhone ↔ Private iCloud",
            systemImage: "lock.iphone"
        )
    }

    private func branchCard(
        eyebrow: String,
        title: String,
        detail: String,
        destination: String,
        systemImage: String
    ) -> some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            Text(eyebrow)
                .font(.caption2.monospaced().weight(.semibold))
                .foregroundStyle(appearance.muted)
            Label(title, systemImage: systemImage)
                .font(.headline)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(appearance.muted)
            Divider()
            Label(destination, systemImage: "arrow.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(appearance.accent)
        }
        .padding(HypoTheme.Space.three)
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
        .background(
            appearance.background,
            in: RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
        )
        .overlay {
            RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                .stroke(appearance.border, lineWidth: 1)
        }
    }

    private var capturePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Label("Capture", systemImage: "sensor.tag.radiowaves.forward")
                    .font(.headline)
                Toggle(
                    "Keep private sensor context",
                    isOn: Binding(
                        get: { model.privateCaptureSettings.captureEnabled },
                        set: { enabled in
                            Task { await model.setPrivateCaptureEnabled(enabled) }
                        }
                    )
                )
                .tint(appearance.accent)
                .frame(minHeight: 44)
                Text(
                    "Off by default. When enabled, the primary saved capture also keeps encrypted "
                        + "device, camera, orientation, attitude, and motion measurements locally. "
                        + "For an averaged capture, its source readings do not each get a separate "
                        + "private context. "
                        + "Reading, motion, context, and location times remain distinct."
                )
                .font(.footnote)
                .foregroundStyle(appearance.muted)

                Divider()

                Toggle(
                    "Include precise location",
                    isOn: Binding(
                        get: { model.privateCaptureSettings.preciseLocationEnabled },
                        set: { enabled in
                            Task { await model.setPrivatePreciseLocationEnabled(enabled) }
                        }
                    )
                )
                .tint(appearance.accent)
                .frame(minHeight: 44)
                .disabled(!model.privateCaptureSettings.captureEnabled)
                Text(
                    "A separate opt-in adds coordinates, altitude, accuracy, course, speed, floor, "
                        + "source flags, and heading."
                )
                .font(.footnote)
                .foregroundStyle(appearance.muted)
            }
        }
    }

    private var devicePanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Label("Your devices", systemImage: "icloud")
                    .font(.headline)
                Toggle(
                    "Sync encrypted context with iCloud",
                    isOn: Binding(
                        get: { model.privateCaptureSettings.privateCloudSyncEnabled },
                        set: { enabled in
                            Task { await model.setPrivateCloudSyncEnabled(enabled) }
                        }
                    )
                )
                .tint(appearance.accent)
                .frame(minHeight: 44)
                Text(
                    "Local capture uses a device-only key and works without iCloud. If you enable "
                        + "sync, a separate key follows your iCloud Keychain. CloudKit stores the "
                        + "AES-GCM-encrypted sensor payload in your private database; record IDs, "
                        + "times, and deletion flags support merging. Hypo turns sync off if the "
                        + "iCloud account changes."
                )
                .font(.footnote)
                .foregroundStyle(appearance.muted)
            }
        }
    }

    private var storedDataPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack {
                    Label("Stored data", systemImage: "externaldrive.fill")
                        .font(.headline)
                    Spacer()
                    Text("\(model.privateCaptureContextCount)")
                        .font(.title3.monospacedDigit().weight(.semibold))
                        .foregroundStyle(appearance.accent)
                        .accessibilityLabel("\(model.privateCaptureContextCount) captures")
                }

                if model.isSavingPrivateCapture {
                    Label("Saving private context…", systemImage: "lock.rotation")
                        .font(.footnote)
                        .foregroundStyle(appearance.muted)
                }

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: HypoTheme.Space.two) { exportButtons }
                    VStack(spacing: HypoTheme.Space.two) { exportButtons }
                }

                Button("Delete all private capture data", role: .destructive) {
                    confirmsDeletion = true
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity, minHeight: 44)
                .disabled(!model.privateCaptureDataMayExist)
            }
        }
    }

    @ViewBuilder
    private var exportButtons: some View {
        Button {
            Task { await model.exportPrivateCaptureData() }
        } label: {
            Label("Prepare JSON", systemImage: "doc.badge.gearshape")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .frame(minHeight: 44)
        .disabled(model.privateCaptureContextCount == 0)

        if let export = model.privateCaptureExport {
            ShareLink(item: export) {
                Label("Share export", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
        }
    }
}

private struct CalibrationProfilesView: View {
    @Bindable var model: MeterFeatureModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.hypoAppearance) private var appearance
    @State private var referenceEV100 = 12.0
    @State private var reference = CalibrationReference.handheldMeter

    var body: some View {
        NavigationStack {
            Form {
                calibrationExplanation
                appliedProfiles
                newProfile
                characterizationBoundary
            }
            .navigationTitle("Calibration")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var calibrationExplanation: some View {
        Section {
            Text(
                "Profiles match one device, camera module, and sensor path. A one-point "
                    + "profile corrects offset near the tested light level; it does not "
                    + "characterize the full range."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }

    private var appliedProfiles: some View {
        Section("Applied profile") {
            Button("No calibration") {
                Task { await model.selectCalibration(id: nil) }
            }
            .frame(minHeight: 44)
            ForEach(model.calibrationProfiles) { profile in
                CalibrationProfileRow(model: model, profile: profile)
            }
        }
    }

    private var newProfile: some View {
        Section("New one-point profile") {
            Picker("Reference", selection: $reference) {
                Text("Handheld meter").tag(CalibrationReference.handheldMeter)
                Text("Known target").tag(CalibrationReference.knownTarget)
                Text("Sunny 16").tag(CalibrationReference.sunny16)
            }
            TextField(
                "Reference EV 100",
                value: $referenceEV100,
                format: .number.precision(.fractionLength(1...2))
            )
            .accessibilityLabel("Reference exposure value at ISO 100")
            Button("Save from current reading") {
                Task {
                    await model.createOnePointCalibration(
                        referenceEV100: referenceEV100,
                        reference: reference
                    )
                }
            }
            .disabled(model.reading == nil)
            .frame(minHeight: 44)
        }
    }

    private var characterizationBoundary: some View {
        Section {
            Text(
                "Diffuser factors, camera-module response curves, and device drift checks "
                    + "must come from physical characterization. This screen does not infer them."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}

private struct CalibrationProfileRow: View {
    @Bindable var model: MeterFeatureModel
    let profile: CalibrationProfile
    @Environment(\.hypoAppearance) private var appearance

    var body: some View {
        HStack {
            Button {
                Task { await model.selectCalibration(id: profile.id) }
            } label: {
                VStack(alignment: .leading) {
                    Text(profile.identity.deviceModel)
                    Text(profileSummary)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)
            if model.selectedCalibrationID == profile.id {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(appearance.accent)
                    .accessibilityLabel("Applied")
            }
            Button(role: .destructive) {
                Task { await model.deleteCalibration(id: profile.id) }
            } label: {
                Image(systemName: "trash").frame(width: 44, height: 44)
            }
            .accessibilityLabel("Delete calibration profile")
        }
    }

    private var profileSummary: String {
        let offset = String(format: "%+.2f", profile.constantOffsetStops)
        return "\(profile.identity.module.rawValue) · \(profile.identity.sensorPath.rawValue) · "
            + "\(offset) stops"
    }
}
