import DesignSystem
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
                MeterFeatureView(model: model.meterModel)
                    .toolbar { syncStatusToolbar }
            }
            .tabItem {
                Label("Meter", systemImage: "camera.metering.center.weighted")
                    .accessibilityIdentifier("tab.meter")
            }
            .tag(AppModel.Tab.meter)

            NavigationStack {
                Group {
                    if let loggerModel = model.loggerModel {
                        LoggerFeatureView(model: loggerModel)
                    } else if model.isLoadingAccountData {
                        ProgressView("Loading active rolls")
                    } else {
                        ContentUnavailableView {
                            Label("Log unavailable", systemImage: "camera.roll")
                        } description: {
                            Text(model.loggerUnavailableMessage)
                        } actions: {
                            Button("Open Settings") { model.selectedTab = .settings }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                }
                .toolbar { syncStatusToolbar }
            }
            .tabItem {
                Label("Log", systemImage: "square.and.pencil")
                    .accessibilityIdentifier("tab.log")
            }
            .tag(AppModel.Tab.logger)

            NavigationStack {
                TimerFeatureView(model: model.timerModel)
                    .toolbar { syncStatusToolbar }
            }
            .tabItem {
                Label("Timer", systemImage: "timer")
                    .accessibilityIdentifier("tab.timer")
            }
            .tag(AppModel.Tab.timer)

            NavigationStack {
                LibraryFeatureView(model: model.libraryModel)
                    .toolbar { syncStatusToolbar }
            }
            .tabItem {
                Label("Library", systemImage: "rectangle.stack")
                    .accessibilityIdentifier("tab.library")
            }
            .tag(AppModel.Tab.library)

            NavigationStack {
                SettingsFeatureView(model: model.settingsModel)
                    .toolbar { syncStatusToolbar }
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
                    .accessibilityIdentifier("tab.settings")
            }
            .tag(AppModel.Tab.settings)
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
        .safeAreaInset(edge: .top) {
            if !model.dependencies.persistenceIsDurable {
                Label(
                    "Local storage is unavailable. Changes will last only until Hypo closes.",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.background)
                .padding(.horizontal, HypoTheme.Space.three)
                .padding(.vertical, HypoTheme.Space.two)
                .frame(maxWidth: .infinity)
                .background(HypoTheme.ColorToken.danger)
            }
        }
    }

    @ToolbarContentBuilder
    private var syncStatusToolbar: some ToolbarContent {
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

#Preview { RootView(model: AppModel(dependencies: .makeLive())) }
