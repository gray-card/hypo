import DesignSystem
import Foundation
import HypoLexicon
import LoggerFeature
import LibraryFeature
import MeterFeature
import SettingsFeature
import SwiftUI
import SyncStatusFeature
import TimerFeature

struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var syncStatusIsPresented = false

    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack {
                MeterFeatureView(
                    model: model.meterModel,
                    onOpenAccountSettings: { model.isSettingsPresented = true }
                )
                .toolbar { appToolbar }
            }
            .tabItem {
                Label("Meter", systemImage: "camera.metering.center.weighted")
                    .accessibilityIdentifier("tab.meter")
            }
            .tag(AppModel.Tab.meter)

            NavigationStack(path: $model.sessionsPath) {
                SessionsHomeView(
                    model: model,
                    onOpenAccountSettings: { model.isSettingsPresented = true }
                )
                .navigationDestination(for: AppModel.SessionDestination.self) { destination in
                    switch destination {
                    case .logger:
                        loggerDestination
                            .toolbar { appToolbar }
                    case .timer:
                        TimerFeatureView(
                            model: model.timerModel,
                            onOpenAccountSettings: { model.isSettingsPresented = true }
                        )
                        .toolbar { appToolbar }
                    }
                }
                .toolbar { appToolbar }
            }
            .tabItem {
                Label("Sessions", systemImage: "clock.arrow.circlepath")
                    .accessibilityIdentifier("tab.sessions")
            }
            .tag(AppModel.Tab.sessions)

            NavigationStack {
                LibraryFeatureView(
                    model: model.libraryModel,
                    onOpenAccountSettings: { model.isSettingsPresented = true }
                )
                .toolbar { appToolbar }
            }
            .tabItem {
                Label("Library", systemImage: "rectangle.stack")
                    .accessibilityIdentifier("tab.library")
            }
            .tag(AppModel.Tab.library)
        }
        .tint(HypoTheme.ColorToken.accent)
        .preferredColorScheme(.dark)
        .onOpenURL { model.open($0) }
        .task { await model.start() }
        .onChange(of: model.meterModel.reading) { _, _ in
            model.publishSystemSnapshot()
        }
        .onChange(of: model.loggerModel?.activeRoll) { _, _ in
            model.publishSystemSnapshot()
        }
        .onChange(of: model.timerModel.snapshot) { _, _ in
            model.publishSystemSnapshot()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await model.didEnterForeground() }
            case .background:
                model.scheduleBackgroundRefresh()
            default:
                break
            }
        }
        .sheet(isPresented: $syncStatusIsPresented) {
            NavigationStack {
                SyncStatusFeatureView(model: model.syncStatusModel)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { syncStatusIsPresented = false }
                        }
                    }
            }
            .hypoAppearance(.standard)
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $model.isSettingsPresented) {
            NavigationStack {
                SettingsFeatureView(model: model.settingsModel)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { model.isSettingsPresented = false }
                        }
                    }
            }
            .hypoAppearance(.standard)
            .preferredColorScheme(.dark)
        }
        .safeAreaInset(edge: .top) {
            if !model.dependencies.persistenceIsDurable {
                HypoErrorNotice(
                    HypoErrorPresenter.presentation(for: .localStorageUnavailable)
                )
                .padding(.horizontal, HypoTheme.Space.three)
                .padding(.vertical, HypoTheme.Space.two)
                .background(.ultraThinMaterial)
            }
        }
    }

    @ViewBuilder
    private var loggerDestination: some View {
        if let loggerModel = model.loggerModel {
            LoggerFeatureView(
                model: loggerModel,
                onOpenAccountSettings: { model.isSettingsPresented = true }
            )
        } else if model.isLoadingAccountData {
            ProgressView("Loading active rolls")
                .navigationTitle("Log frames")
        } else {
            ContentUnavailableView {
                Label("Frame logging unavailable", systemImage: "camera.roll")
            } description: {
                Text(model.loggerUnavailableMessage)
            } actions: {
                Button("Open Settings") { model.isSettingsPresented = true }
                    .buttonStyle(.borderedProminent)
            }
            .navigationTitle("Log frames")
        }
    }

    @ToolbarContentBuilder
    private var appToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                model.isSettingsPresented = true
            } label: {
                Image(systemName: "gearshape")
                    .frame(width: 30, height: 30)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("app.settings")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                syncStatusIsPresented = true
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .frame(width: 30, height: 30)
                    if model.syncStatusModel.localChangeCount > 0 {
                        Text(compactCount(model.syncStatusModel.localChangeCount))
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(
                                model.syncStatusModel.attentionCount > 0
                                    ? HypoTheme.ColorToken.danger
                                    : HypoTheme.ColorToken.accent,
                                in: Capsule()
                            )
                            .offset(x: 6, y: -3)
                    }
                }
            }
            .accessibilityLabel("Sync status")
            .accessibilityValue(syncAccessibilityValue)
            .accessibilityIdentifier("sync.status")
        }
    }

    private var syncAccessibilityValue: String {
        let count = model.syncStatusModel.localChangeCount
        let attention = model.syncStatusModel.attentionCount
        if attention > 0 { return "\(attention) changes need attention" }
        if count == 0 { return "No changes waiting" }
        return count == 1 ? "1 change waiting" : "\(count) changes waiting"
    }

    private func compactCount(_ count: Int) -> String {
        count > 99 ? "99+" : String(count)
    }
}

private struct SessionsHomeView: View {
    @Bindable var model: AppModel
    let onOpenAccountSettings: () -> Void

    var body: some View {
        ZStack {
            HypoTheme.ColorToken.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                    if hasActiveDevelopment { activeDevelopmentPanel }
                    Text("Start work")
                        .font(.headline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    sessionAction(
                        destination: .logger,
                        title: "Log frames",
                        detail: loggerDetail,
                        systemImage: "camera.shutter.button"
                    )
                    sessionAction(
                        destination: .timer,
                        title: "Develop film",
                        detail: model.timerModel.selectedRecipe.plan.name,
                        systemImage: "timer"
                    )
                    if model.loggerModel == nil, !model.isLoadingAccountData {
                        Button("Manage account access", action: onOpenAccountSettings)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(HypoTheme.ColorToken.accent)
                            .frame(minHeight: 44)
                    }
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .foregroundStyle(HypoTheme.ColorToken.text)
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItem(placement: .automatic) { HypoToolbarWordmark() }
        }
    }

    private var hasActiveDevelopment: Bool {
        model.timerModel.run.status == .running || model.timerModel.run.status == .paused
    }

    private var loggerDetail: String {
        guard let loggerModel = model.loggerModel else {
            return model.isLoadingAccountData ? "Loading active rolls…" : model.loggerUnavailableMessage
        }
        return "\(loggerModel.activeRoll.label) · frame \(loggerModel.draft.frameNumber)"
    }

    private var activeDevelopmentPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                Label("Development in progress", systemImage: "timer")
                    .font(.headline)
                    .foregroundStyle(HypoTheme.ColorToken.accent)
                Text(model.timerModel.selectedRecipe.plan.name)
                    .font(.title3.weight(.semibold))
                if let snapshot = model.timerModel.snapshot {
                    Text("\(snapshot.stage.name) · \(duration(snapshot.remaining)) remaining")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
                NavigationLink(value: AppModel.SessionDestination.timer) {
                    Label("Resume development", systemImage: "arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(HypoPrimaryButtonStyle())
                .accessibilityIdentifier("sessions.resume-development")
            }
        }
    }

    private func sessionAction(
        destination: AppModel.SessionDestination,
        title: String,
        detail: String,
        systemImage: String
    ) -> some View {
        NavigationLink(value: destination) {
            InstrumentPanel {
                HStack(spacing: HypoTheme.Space.three) {
                    Image(systemName: systemImage)
                        .font(.title2)
                        .foregroundStyle(HypoTheme.ColorToken.accent)
                        .frame(width: 36)
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(HypoTheme.ColorToken.text)
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(HypoTheme.ColorToken.muted)
                            .lineLimit(2)
                    }
                    Spacer(minLength: HypoTheme.Space.two)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(
            destination == .logger ? "sessions.log-frames" : "sessions.develop-film"
        )
    }

    private func duration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

#Preview { RootView(model: AppModel(dependencies: .makeLive())) }
