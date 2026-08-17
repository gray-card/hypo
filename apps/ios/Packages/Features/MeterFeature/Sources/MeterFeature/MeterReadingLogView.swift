import DesignSystem
import Foundation
import MeterEngine
import SwiftUI

struct MeterReadingLogView: View {
    @Bindable var model: MeterFeatureModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.hypoAppearance) private var appearance

    var body: some View {
        NavigationStack {
            Group {
                if model.filteredReadingLog.isEmpty {
                    emptyLog
                } else {
                    readingList
                }
            }
            .navigationTitle("Reading log")
            .searchable(
                text: $model.readingLogQuery,
                prompt: "EV, camera, geometry, or warning"
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                if !model.selectedReadingLogIDs.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Clear selection") { model.clearReadingLogSelection() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !model.selectedReadingLogIDs.isEmpty {
                    selectionBar
                }
            }
        }
    }

    private var readingList: some View {
        List {
            Section {
                Picker("Reading geometry", selection: $model.readingLogFilter) {
                    ForEach(MeterReadingLogFilter.allCases, id: \.self) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityHint("Filters the reading log by measurement geometry.")
            }

            Section("Measurements") {
                ForEach(model.filteredReadingLog) { entry in
                    HStack(spacing: HypoTheme.Space.three) {
                        Button {
                            model.toggleReadingLogSelection(id: entry.id)
                        } label: {
                            Image(
                                systemName: model.selectedReadingLogIDs.contains(entry.id)
                                    ? "checkmark.circle.fill" : "circle"
                            )
                            .font(.title3)
                            .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(
                            model.selectedReadingLogIDs.contains(entry.id)
                                ? appearance.accent : appearance.muted
                        )
                        .accessibilityLabel(
                            model.selectedReadingLogIDs.contains(entry.id)
                                ? "Deselect reading from \(entry.reading.takenAt.formatted())"
                                : "Select reading from \(entry.reading.takenAt.formatted())"
                        )

                        NavigationLink {
                            StoredMeterReadingDetailView(entry: entry, model: model)
                        } label: {
                            MeterReadingLogRow(
                                entry: entry,
                                isAveragingSource: model.readingLog.contains {
                                    $0.reading.averagedFrom.contains(entry.id)
                                }
                            )
                        }
                        .accessibilityHint("Shows the complete measurement and record details.")
                    }
                }
            }
        }
        .listStyle(.inset)
    }

    private var emptyLog: some View {
        ContentUnavailableView {
            Label("No saved readings", systemImage: "book.pages")
        } description: {
            Text(
                model.readingLog.isEmpty
                    ? "Tap Measure in the meter to save a reading."
                    : "No readings match this search and geometry filter."
            )
        } actions: {
            if !model.readingLog.isEmpty {
                Button("Clear filters") {
                    model.readingLogQuery = ""
                    model.readingLogFilter = .all
                }
            }
        }
    }

    private var selectionBar: some View {
        VStack(spacing: HypoTheme.Space.two) {
            Button {
                Task { await model.promoteSelectedReadingLog() }
            } label: {
                Label(
                    "Use \(model.selectedReadingLogIDs.count) in Logger",
                    systemImage: "square.and.arrow.down"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(HypoPrimaryButtonStyle())
            .disabled(model.isPromoting)
            .accessibilityHint("Attaches the selected saved readings to the next logged exposure.")

            if let errorMessage = model.errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(HypoTheme.ColorToken.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(HypoTheme.Space.three)
        .background(.bar)
    }
}

private struct MeterReadingLogRow: View {
    let entry: StoredMeterReading
    let isAveragingSource: Bool
    @Environment(\.hypoAppearance) private var appearance

    var body: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
            HStack(alignment: .firstTextBaseline) {
                Text(
                    "EV \(entry.reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))"
                )
                .font(.title3.monospacedDigit().weight(.semibold))
                Spacer()
                Text(entry.reading.takenAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                    .font(.caption)
                    .foregroundStyle(appearance.muted)
            }
            HStack(spacing: HypoTheme.Space.two) {
                Text(entry.reading.geometry.displayName)
                    .font(.subheadline)
                if entry.reading.role == .average {
                    Text("Average of \(entry.reading.averagedFrom.count)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(appearance.accent)
                } else if isAveragingSource {
                    Text("Averaging source")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(appearance.muted)
                }
            }
            Text(
                "\(entry.reading.camera.name) · \(entry.reading.sensorPath.displayName) · "
                    + entry.reading.accuracyTier.rawValue.capitalized
            )
            .font(.caption)
            .foregroundStyle(appearance.muted)
            .lineLimit(2)
        }
        .padding(.vertical, HypoTheme.Space.one)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Saved meter reading")
        .accessibilityValue(
            String(
                format: "%.1f EV 100, %@, %@",
                entry.reading.ev100.rawValue,
                entry.reading.geometry.displayName,
                entry.reading.takenAt.formatted(date: .abbreviated, time: .shortened)
            )
        )
    }
}

private struct StoredMeterReadingDetailView: View {
    let entry: StoredMeterReading
    @Bindable var model: MeterFeatureModel

    var body: some View {
        List {
            measurementSection
            exposureSection
            instrumentSection
            spotSection
            provenanceSection
            recordSection
            loggerSection
        }
        .navigationTitle("Meter reading")
    }

    private var measurementSection: some View {
        Section("Measurement") {
            LabeledContent("EV 100") {
                Text(entry.reading.ev100.rawValue, format: .number.precision(.fractionLength(1)))
                    .monospacedDigit()
            }
            LabeledContent("Geometry", value: entry.reading.geometry.displayName)
            if let illuminance = entry.reading.illuminance {
                LabeledContent("Illuminance") {
                    Text("\(illuminance.lux, format: .number.precision(.fractionLength(1))) lx")
                        .monospacedDigit()
                }
            }
            if let luminance = entry.reading.luminance {
                LabeledContent("Luminance") {
                    Text(
                        "\(luminance.candelaPerSquareMetre, format: .number.precision(.fractionLength(2))) cd/m²"
                    )
                    .monospacedDigit()
                }
            }
            LabeledContent("Taken", value: entry.reading.takenAt.formatted())
            LabeledContent("Role", value: entry.reading.role.rawValue.capitalized)
        }
    }

    @ViewBuilder
    private var exposureSection: some View {
        if let exposure = entry.reading.exposure {
            Section("Exposure sample") {
                LabeledContent("ISO") {
                    Text(exposure.sensitivity.iso, format: .number.precision(.fractionLength(0...1)))
                        .monospacedDigit()
                }
                LabeledContent("Aperture") {
                    Text(
                        "ƒ/\(exposure.aperture.rawValue, format: .number.precision(.fractionLength(1)))"
                    )
                    .monospacedDigit()
                }
                LabeledContent("Shutter") {
                    Text(
                        "\(exposure.duration.seconds, format: .number.precision(.significantDigits(1...4))) s"
                    )
                    .monospacedDigit()
                }
            }
        }
    }

    private var instrumentSection: some View {
        Section("Instrument") {
            LabeledContent("Device", value: entry.deviceModelName)
            LabeledContent("Camera", value: entry.reading.camera.name)
            LabeledContent("Module", value: entry.reading.camera.module.displayName)
            LabeledContent("Sensor path", value: entry.reading.sensorPath.displayName)
            LabeledContent("Accuracy", value: entry.reading.accuracyTier.rawValue.capitalized)
            LabeledContent("Calibration constant") {
                Text(
                    entry.reading.calibrationConstant,
                    format: .number.precision(.fractionLength(1...3))
                )
                .monospacedDigit()
            }
            if let calibrationID = entry.reading.calibrationID {
                LabeledContent("Calibration ID", value: calibrationID.uuidString.lowercased())
            }
        }
    }

    @ViewBuilder
    private var spotSection: some View {
        if entry.reading.geometry == .reflectedSpot {
            Section("Spot geometry") {
                if let nominal = entry.reading.nominalSpotAngleDegrees {
                    LabeledContent("Requested angle") {
                        Text("\(nominal, format: .number.precision(.fractionLength(1)))°")
                    }
                }
                if let achieved = entry.reading.achievedSpotAngleDegrees {
                    LabeledContent("Achieved angle") {
                        Text("\(achieved, format: .number.precision(.fractionLength(1)))°")
                    }
                }
                if let point = entry.spotPoint {
                    LabeledContent("Preview point") {
                        Text(
                            "\(point.x * 100, format: .number.precision(.fractionLength(0)))% × \(point.y * 100, format: .number.precision(.fractionLength(0)))%"
                        )
                        .monospacedDigit()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var provenanceSection: some View {
        if !entry.reading.flags.isEmpty || !entry.reading.averagedFrom.isEmpty
            || averagingUseCount > 0
        {
            Section("Provenance") {
                if !entry.reading.flags.isEmpty {
                    LabeledContent(
                        "Warnings",
                        value: entry.reading.flags.sorted().map(\.rawValue).joined(separator: ", ")
                    )
                }
                if !entry.reading.averagedFrom.isEmpty {
                    LabeledContent(
                        "Averaged from",
                        value: "\(entry.reading.averagedFrom.count) readings"
                    )
                }
                if averagingUseCount > 0 {
                    LabeledContent(
                        "Used by",
                        value: "\(averagingUseCount) saved average\(averagingUseCount == 1 ? "" : "s")"
                    )
                }
            }
        }
    }

    private var averagingUseCount: Int {
        model.readingLog.count { $0.reading.averagedFrom.contains(entry.id) }
    }

    private var recordSection: some View {
        Section("Record") {
            Text(entry.reference.uri)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .accessibilityLabel("Meter reading record URI")
                .accessibilityValue(entry.reference.uri)
            LabeledContent("Accepted", value: entry.acceptedAt.formatted())
        }
    }

    private var loggerSection: some View {
        Section {
            Button {
                Task { await model.promoteStoredReading(id: entry.id) }
            } label: {
                Label("Use in Logger", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .disabled(model.isPromoting)
            .accessibilityHint("Attaches this saved meter reading to the next logged exposure.")
        }
    }
}

private extension MeasurementGeometry {
    var displayName: String {
        switch self {
        case .reflectedAverage: "Reflected average"
        case .reflectedSpot: "Reflected spot"
        case .incidentFlat: "Incident, flat receptor"
        case .incidentDome: "Incident, dome receptor"
        }
    }
}

private extension SensorPath {
    var displayName: String {
        switch self {
        case .aeMetadata: "AE metadata"
        case .rawPatch: "RAW patch"
        case .processedPatch: "Processed patch"
        case .ambientSensor: "Ambient sensor"
        case .manual: "Manual"
        case .simulated: "Simulated"
        }
    }
}

private extension CameraModule {
    var displayName: String {
        switch self {
        case .front: "Front"
        case .ultraWide: "Ultra wide"
        case .wide: "Wide"
        case .telephoto: "Telephoto"
        case .external: "External"
        case .unknown: "Unknown"
        }
    }
}
