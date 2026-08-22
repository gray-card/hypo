import AppIntents
import SwiftUI
import SystemIntegrationKit
import WidgetKit

@main
struct SystemIntegrationWidgetBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        HypoStatusWidget()
        HypoQuickLogWidget()
        HypoMeterWidget()
        if #available(iOSApplicationExtension 18.0, *) {
            HypoQuickLogControl()
            HypoMeterControl()
        }
    }
}

private struct SystemSnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: HypoSystemSnapshot?
}

private struct SystemSnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SystemSnapshotEntry {
        SystemSnapshotEntry(
            date: .now,
            snapshot: HypoSystemSnapshot(
                activeRoll: HypoActiveRollSnapshot(
                    label: "Roll 12",
                    stockName: "Tri-X 400",
                    exposuresUsed: 17,
                    exposuresTotal: 36
                ),
                updatedAt: .now
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (SystemSnapshotEntry) -> Void) {
        completion(SystemSnapshotEntry(date: .now, snapshot: loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SystemSnapshotEntry>) -> Void) {
        let entry = SystemSnapshotEntry(date: .now, snapshot: loadSnapshot())
        completion(Timeline(entries: [entry], policy: .after(Date.now.addingTimeInterval(5 * 60))))
    }

    private func loadSnapshot() -> HypoSystemSnapshot? {
        HypoSharedSnapshotStore()?.load()
    }
}

private struct HypoStatusWidget: Widget {
    private let kind = "app.graycard.hypo.status"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SystemSnapshotProvider()) { entry in
            HypoStatusWidgetView(entry: entry)
                .containerBackground(Color(red: 0.055, green: 0.047, blue: 0.043), for: .widget)
        }
        .configurationDisplayName("Active roll and timer")
        .description("Shows the active film roll or running development stage.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct HypoStatusWidgetView: View {
    let entry: SystemSnapshotEntry

    var body: some View {
        if let timer = entry.snapshot?.runningTimer {
            timerView(timer)
                .widgetURL(HypoDeepLink.timer(recipe: nil).url)
        } else if let roll = entry.snapshot?.activeRoll {
            rollView(roll)
                .widgetURL(HypoDeepLink.log(aperture: nil, shutterSpeed: nil).url)
        } else {
            ContentUnavailableView {
                Label("Hypo", systemImage: "camera.aperture")
            } description: {
                Text("Open Hypo to choose an active roll.")
            }
            .widgetURL(HypoDeepLink.library.url)
        }
    }

    private func timerView(_ timer: HypoRunningTimerSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Development", systemImage: "timer")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            Text(timer.stageName)
                .font(.headline)
                .lineLimit(2)
            if timer.isPaused {
                Text("Paused")
                    .font(.title3.weight(.semibold))
            } else if let end = timer.stageEndsAt, end > entry.date {
                Text(timerInterval: entry.date...end, countsDown: true)
                    .font(.title3.monospacedDigit().weight(.semibold))
            }
            Spacer(minLength: 0)
            Text(timer.recipeName)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private func rollView(_ roll: HypoActiveRollSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Active roll", systemImage: "camera.roll")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            Text(roll.label)
                .font(.headline)
                .lineLimit(2)
            Text(roll.stockName)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Text(frameCount(roll))
                .font(.title3.monospacedDigit().weight(.semibold))
                .accessibilityLabel(frameCountAccessibilityLabel(roll))
        }
    }

    private func frameCount(_ roll: HypoActiveRollSnapshot) -> String {
        if let total = roll.exposuresTotal { return "\(roll.exposuresUsed) / \(total)" }
        return "Frame \(roll.exposuresUsed + 1)"
    }

    private func frameCountAccessibilityLabel(_ roll: HypoActiveRollSnapshot) -> String {
        if let total = roll.exposuresTotal {
            return "\(roll.exposuresUsed) of \(total) exposures used"
        }
        return "Next frame \(roll.exposuresUsed + 1)"
    }
}

private struct HypoQuickLogWidget: Widget {
    private let kind = "app.graycard.hypo.quick-log"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SystemSnapshotProvider()) { entry in
            AccessoryActionView(
                title: "Log frame",
                value: activeRollValue(entry.snapshot?.activeRoll),
                systemImage: "square.and.pencil",
                url: HypoDeepLink.log(aperture: nil, shutterSpeed: nil).url
            )
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Quick log")
        .description("Opens the field logger from the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }

    private func activeRollValue(_ roll: HypoActiveRollSnapshot?) -> String {
        guard let roll else { return "Open Hypo" }
        return "\(roll.label) · frame \(roll.exposuresUsed + 1)"
    }
}

private struct HypoMeterWidget: Widget {
    private let kind = "app.graycard.hypo.meter"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SystemSnapshotProvider()) { entry in
            AccessoryActionView(
                title: "Meter",
                value: readingValue(entry.snapshot?.latestReading),
                systemImage: "camera.metering.center.weighted",
                url: HypoDeepLink.meter(mode: .reflected).url
            )
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Light meter")
        .description("Opens the light meter from the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }

    private func readingValue(_ reading: HypoReadingSnapshot?) -> String {
        reading?.spokenSummary ?? "Measure light"
    }
}

private struct AccessoryActionView: View {
    @Environment(\.widgetFamily) private var family
    let title: String
    let value: String
    let systemImage: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            if family == .accessoryCircular {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: systemImage)
                        .font(.title2)
                }
                .accessibilityLabel(title)
            } else {
                HStack {
                    Image(systemName: systemImage)
                    VStack(alignment: .leading) {
                        Text(title).font(.headline)
                        Text(value).font(.caption).lineLimit(1)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

@available(iOSApplicationExtension 18.0, *)
private struct HypoQuickLogControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.graycard.hypo.control.quick-log") {
            ControlWidgetButton(action: OpenQuickLogIntent()) {
                Label("Log frame", systemImage: "square.and.pencil")
            }
        }
        .displayName("Log frame")
        .description("Open Hypo's quick logger.")
    }
}

@available(iOSApplicationExtension 18.0, *)
private struct HypoMeterControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.graycard.hypo.control.meter") {
            ControlWidgetButton(action: StartMeterIntent(mode: .reflected)) {
                Label("Light meter", systemImage: "camera.metering.center.weighted")
            }
        }
        .displayName("Light meter")
        .description("Open Hypo's reflected-light meter.")
    }
}
