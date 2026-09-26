import ActivityKit
import SwiftUI
import TimerFeature
import WidgetKit

@main
struct TimerActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimerActivityWidget()
    }
}

struct TimerActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HypoTimerActivityAttributes.self) { context in
            LockScreenTimerView(context: context)
                .activityBackgroundTint(Color(red: 0.055, green: 0.047, blue: 0.043))
                .activitySystemActionForegroundColor(.orange)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StageOrdinal(state: context.state)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RemainingTime(state: context.state, compact: true)
                        .monospacedDigit()
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.stageName)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        AgitationStatusView(state: context.state)
                        Spacer()
                        if let next = context.state.nextStageName {
                            Text("Next: \(next)")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .font(.caption)
                }
            } compactLeading: {
                Image(systemName: context.state.isAgitating ? "arrow.triangle.2.circlepath" : "timer")
                    .foregroundStyle(context.state.isAgitating ? .orange : .primary)
            } compactTrailing: {
                RemainingTime(state: context.state, compact: true)
                    .monospacedDigit()
                    .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: context.state.isAgitating ? "arrow.triangle.2.circlepath" : "timer")
                    .foregroundStyle(context.state.isAgitating ? .orange : .primary)
            }
            .keylineTint(.orange)
        }
    }
}

private struct LockScreenTimerView: View {
    let context: ActivityViewContext<HypoTimerActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(context.attributes.recipeName)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                StageOrdinal(state: context.state)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(context.state.status == "completed" ? "Complete" : context.state.stageName)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                RemainingTime(state: context.state, compact: false)
                    .font(.title2.monospacedDigit().weight(.semibold))
            }
            HStack {
                AgitationStatusView(state: context.state)
                Spacer()
                if let next = context.state.nextStageName {
                    Text("Next: \(next)")
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .font(.caption)
        }
        .padding(16)
    }
}

private struct StageOrdinal: View {
    let state: HypoTimerActivityAttributes.ContentState

    var body: some View {
        Text("\(min(state.stageIndex + 1, state.stageCount)) / \(state.stageCount)")
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(.secondary)
    }
}

private struct RemainingTime: View {
    let state: HypoTimerActivityAttributes.ContentState
    let compact: Bool

    var body: some View {
        Group {
            if state.status == "completed" {
                Image(systemName: "checkmark")
                    .accessibilityLabel("Complete")
            } else if state.status == "running", let end = state.stageEndsAt {
                Text(timerInterval: Date.now...max(Date.now, end), countsDown: true)
            } else if let remaining = state.remainingWhenPaused {
                Text(duration(remaining))
            } else {
                Text(compact ? "--:--" : "Not running")
            }
        }
    }

    private func duration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.up)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

private struct AgitationStatusView: View {
    let state: HypoTimerActivityAttributes.ContentState

    var body: some View {
        if state.isAgitating {
            Label("Agitate", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.orange)
        } else if let next = state.nextAgitationAt, next > .now {
            Label {
                Text(timerInterval: Date.now...next, countsDown: true)
                    .monospacedDigit()
            } icon: {
                Image(systemName: "arrow.triangle.2.circlepath")
            }
            .accessibilityLabel("Next agitation")
        } else {
            Label("No agitation due", systemImage: "minus")
                .foregroundStyle(.secondary)
        }
    }
}
