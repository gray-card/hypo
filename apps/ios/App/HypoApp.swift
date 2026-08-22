import SwiftUI

@main
struct HypoApp: App {
    @State private var model: AppModel
    #if DEBUG
        private let acceptanceConfiguration: AcceptanceLaunchConfiguration?
        private let acceptanceFixturePDS: AcceptanceFixturePDS?
    #endif

    init() {
        #if DEBUG
            let configuration = AcceptanceLaunchConfiguration.current
            acceptanceConfiguration = configuration
            if let configuration, configuration.fixture == .synchronization {
                let composition = AcceptanceSynchronizationComposition.make(
                    configuration: configuration
                )
                _model = State(initialValue: composition.model)
                acceptanceFixturePDS = composition.fixturePDS
            } else {
                _model = State(initialValue: AppModel(dependencies: .makeLive()))
                acceptanceFixturePDS = nil
            }
        #else
            _model = State(initialValue: AppModel(dependencies: .makeLive()))
        #endif
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
                if let acceptanceConfiguration,
                    acceptanceConfiguration.fixture == .synchronization,
                    let acceptanceFixturePDS
                {
                    AcceptanceSynchronizationRootView(
                        model: model,
                        fixturePDS: acceptanceFixturePDS
                    )
                } else if let acceptanceConfiguration {
                    AcceptanceHarnessView(configuration: acceptanceConfiguration)
                } else {
                    RootView(model: model)
                }
            #else
                RootView(model: model)
            #endif
        }
        .backgroundTask(.appRefresh(AppModel.backgroundRefreshIdentifier)) {
            await model.performBackgroundRefresh()
        }
    }
}
