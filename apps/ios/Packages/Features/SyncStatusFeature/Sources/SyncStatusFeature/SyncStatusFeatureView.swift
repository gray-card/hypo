import DesignSystem
import SwiftUI

public struct SyncStatusFeatureView: View {
    @Bindable private var model: SyncStatusFeatureModel
    @Environment(\.hypoAppearance) private var appearance
    @State private var confirmation: ConflictConfirmation?

    public init(model: SyncStatusFeatureModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: HypoTheme.Space.five) {
                statusPanel
                offlineExplanation

                if !model.snapshot.conflicts.isEmpty {
                    conflictSection
                }

                pendingSection
            }
            .padding(HypoTheme.Space.four)
        }
        .background(appearance.background)
        .navigationTitle("Sync")
        .refreshable { await model.refresh() }
        .task { await model.start() }
        .confirmationDialog(
            confirmation?.title ?? "",
            isPresented: Binding(
                get: { confirmation != nil },
                set: { if !$0 { confirmation = nil } }
            ),
            titleVisibility: .visible,
            presenting: confirmation
        ) { confirmation in
            switch confirmation.action {
            case .discard:
                Button("Discard my change", role: .destructive) {
                    Task {
                        await model.discardLocalChange(conflictID: confirmation.conflictID)
                    }
                }
            case .rebase:
                Button("Queue my version") {
                    Task {
                        await model.rebaseLocalChange(conflictID: confirmation.conflictID)
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { confirmation in
            Text(confirmation.message)
        }
    }

    private var statusPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                SyncTransportRail(
                    connection: model.connection,
                    availability: model.transportAvailability,
                    localChangeCount: model.localChangeCount
                )

                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(statusHeadline)
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(appearance.text)
                    Text(statusDetail)
                        .font(.body)
                        .foregroundStyle(appearance.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let notice = model.notice {
                    Label(notice, systemImage: "info.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(appearance.text)
                        .accessibilityIdentifier("sync-notice")
                }

                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(HypoTheme.ColorToken.danger)
                        .accessibilityIdentifier("sync-error")
                }

                Button {
                    Task { await model.retryNow() }
                } label: {
                    HStack {
                        if model.isLoading {
                            ProgressView()
                                .tint(appearance.background)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                        Text("Retry now")
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(HypoPrimaryButtonStyle())
                .disabled(model.isLoading || model.snapshot.pending.isEmpty)
                .accessibilityHint("Tries to send every queued change now.")
            }
        }
    }

    private var offlineExplanation: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
            Label("Why changes can wait", systemImage: "iphone.and.arrow.forward")
                .font(.headline)
                .foregroundStyle(appearance.text)
            Text(
                "Hypo keeps the queue on this iPhone, not on a separate Hypo server. It checks the queue when the app opens, after a new change, and when your connection returns."
            )
            .font(.subheadline)
            .foregroundStyle(appearance.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, HypoTheme.Space.two)
    }

    private var conflictSection: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
            sectionHeader(
                title: "Needs attention",
                count: model.snapshot.conflicts.count,
                color: HypoTheme.ColorToken.danger
            )
            Text("Hypo stopped these changes before replacing data from another device.")
                .font(.subheadline)
                .foregroundStyle(appearance.muted)

            ForEach(model.snapshot.conflicts) { conflict in
                conflictCard(conflict)
            }
        }
    }

    private var pendingSection: some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
            sectionHeader(
                title: "Waiting to sync",
                count: model.snapshot.pending.count,
                color: appearance.accent
            )

            if model.snapshot.pending.isEmpty {
                InstrumentPanel {
                    Label("No changes are waiting.", systemImage: "checkmark.circle")
                        .font(.body)
                        .foregroundStyle(appearance.muted)
                        .frame(minHeight: 44)
                }
            } else {
                ForEach(model.snapshot.pending) { item in
                    pendingRow(item)
                }
            }
        }
    }

    private func conflictCard(_ conflict: SyncConflictItem) -> some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text(conflict.title)
                            .font(.headline)
                            .foregroundStyle(appearance.text)
                        Text(conflict.explanation)
                            .font(.subheadline)
                            .foregroundStyle(appearance.muted)
                    }
                    Spacer(minLength: HypoTheme.Space.two)
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(HypoTheme.ColorToken.danger)
                        .accessibilityHidden(true)
                }

                DisclosureGroup("Compare saved copies") {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                        evidenceView(label: "Your version", value: conflict.evidence.local)
                        evidenceView(label: "Server version", value: conflict.evidence.remote)
                    }
                    .padding(.top, HypoTheme.Space.two)
                }
                .tint(appearance.accent)

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: HypoTheme.Space.two) {
                        resolutionButtons(conflict)
                    }
                    VStack(spacing: HypoTheme.Space.two) {
                        resolutionButtons(conflict)
                    }
                }
            }
            .disabled(model.actionConflictID != nil)
            .accessibilityElement(children: .contain)
        }
    }

    @ViewBuilder
    private func resolutionButtons(_ conflict: SyncConflictItem) -> some View {
        Button("Use my version") {
            confirmation = ConflictConfirmation(conflictID: conflict.id, action: .rebase)
        }
        .buttonStyle(.borderedProminent)
        .tint(appearance.accent)
        .disabled(!conflict.canRebase)
        .frame(maxWidth: .infinity, minHeight: 44)

        Button("Discard my change", role: .destructive) {
            confirmation = ConflictConfirmation(conflictID: conflict.id, action: .discard)
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity, minHeight: 44)
    }

    private func evidenceView(label: String, value: String?) -> some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
            Text(label.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(1.1)
                .foregroundStyle(appearance.muted)
            ScrollView(.horizontal) {
                Text(value ?? "No copy was returned.")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(appearance.text)
                    .textSelection(.enabled)
                    .padding(HypoTheme.Space.three)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(appearance.background, in: RoundedRectangle(cornerRadius: HypoTheme.Radius.small))
        }
    }

    private func pendingRow(_ item: PendingSyncItem) -> some View {
        InstrumentPanel {
            HStack(alignment: .top, spacing: HypoTheme.Space.three) {
                Circle()
                    .fill(pendingColor(item.state))
                    .frame(width: 10, height: 10)
                    .padding(.top, 6)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(item.title)
                        .font(.headline)
                        .foregroundStyle(appearance.text)
                    Text(item.state.label)
                        .font(.subheadline)
                        .foregroundStyle(pendingColor(item.state))
                    Text(item.detail)
                        .font(.caption)
                        .foregroundStyle(appearance.muted)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)
        }
    }

    private func sectionHeader(title: String, count: Int, color: Color) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(appearance.text)
            Spacer()
            Text("\(count)")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(color)
                .padding(.horizontal, HypoTheme.Space.two)
                .padding(.vertical, HypoTheme.Space.one)
                .background(color.opacity(0.14), in: Capsule())
                .accessibilityLabel("\(count) \(title.lowercased())")
        }
    }

    private var statusHeadline: String {
        switch model.localChangeCount {
        case 0: "Nothing is waiting"
        case 1: "1 change is on this iPhone"
        default: "\(model.localChangeCount) changes are on this iPhone"
        }
    }

    private var statusDetail: String {
        if model.transportAvailability == .signInRequired {
            return "Sign in before Hypo can send this queue to your personal data server."
        }
        if model.connection == .offline {
            return "You’re offline. Hypo will retry when the connection returns."
        }
        if model.snapshot.conflicts.isEmpty {
            return "Queued changes remain here until your personal data server confirms them."
        }
        return "Resolve the changes below before Hypo retries them."
    }

    private func pendingColor(_ state: PendingSyncState) -> Color {
        switch state {
        case .ready: appearance.accent
        case .syncing: HypoTheme.ColorToken.success
        case .retryScheduled: appearance.muted
        }
    }
}

private struct SyncTransportRail: View {
    let connection: SyncConnectionState
    let availability: SyncTransportAvailability
    let localChangeCount: Int

    @Environment(\.hypoAppearance) private var appearance

    var body: some View {
        VStack(spacing: HypoTheme.Space.two) {
            HStack(spacing: 0) {
                railStop(systemImage: "iphone", active: true)
                railLine(active: localChangeCount > 0)
                railStop(systemImage: "tray.full", active: localChangeCount > 0)
                railLine(active: serverIsReachable)
                railStop(systemImage: "externaldrive", active: serverIsReachable)
            }
            HStack {
                Text("THIS IPHONE")
                Spacer()
                Text("QUEUE")
                Spacer()
                Text("SERVER")
            }
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(appearance.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(railAccessibilityLabel)
    }

    private var serverIsReachable: Bool {
        connection == .online && availability == .available
    }

    private var railAccessibilityLabel: String {
        if localChangeCount == 0 { return "Sync queue is empty" }
        if availability == .signInRequired { return "Changes are stored on this iPhone until you sign in" }
        if connection == .offline { return "Changes are stored on this iPhone while offline" }
        return "Changes are queued for your personal data server"
    }

    private func railStop(systemImage: String, active: Bool) -> some View {
        Image(systemName: systemImage)
            .font(.caption.weight(.bold))
            .foregroundStyle(active ? appearance.background : appearance.muted)
            .frame(width: 30, height: 30)
            .background(active ? appearance.accent : appearance.border, in: Circle())
    }

    private func railLine(active: Bool) -> some View {
        Rectangle()
            .fill(active ? appearance.accent : appearance.border)
            .frame(maxWidth: .infinity, minHeight: 2, maxHeight: 2)
            .overlay {
                HStack(spacing: 9) {
                    ForEach(0..<5, id: \.self) { _ in
                        Capsule()
                            .fill(appearance.background)
                            .frame(width: 5, height: 2)
                    }
                }
            }
            .accessibilityHidden(true)
    }
}

private struct ConflictConfirmation: Identifiable {
    enum Action {
        case rebase
        case discard
    }

    let conflictID: UUID
    let action: Action
    var id: String { "\(conflictID)-\(String(describing: action))" }

    var title: String {
        switch action {
        case .rebase: "Queue your version?"
        case .discard: "Discard your local change?"
        }
    }

    var message: String {
        switch action {
        case .rebase:
            "Hypo will retry your version against the latest server copy. If that copy changes again, Hypo will stop and ask you."
        case .discard:
            "This removes your unsynced version from this iPhone and keeps the server copy. This cannot be undone."
        }
    }
}
