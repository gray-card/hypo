#if os(iOS)
    import ActivityKit
    import Foundation

    /// Stable schema shared by the app and the TimerActivity widget extension.
    public struct HypoTimerActivityAttributes: ActivityAttributes {
        public struct ContentState: Codable, Hashable, Sendable {
            public let status: String
            public let stageName: String
            public let nextStageName: String?
            public let stageIndex: Int
            public let stageCount: Int
            public let stageStartedAt: Date?
            public let stageEndsAt: Date?
            public let remainingWhenPaused: TimeInterval?
            public let isAgitating: Bool
            public let nextAgitationAt: Date?

            public init(presentation: TimerPlatformPresentation) {
                status = presentation.status.rawValue
                stageName = presentation.stageName
                nextStageName = presentation.nextStageName
                stageIndex = presentation.stageIndex
                stageCount = presentation.stageCount
                stageStartedAt = presentation.stageStartedAt
                stageEndsAt = presentation.stageEndsAt
                remainingWhenPaused = presentation.remainingWhenPaused
                isAgitating = presentation.isAgitating
                nextAgitationAt = presentation.nextAgitationAt
            }
        }

        public let runID: UUID
        public let recipeName: String

        public init(runID: UUID, recipeName: String) {
            self.runID = runID
            self.recipeName = recipeName
        }
    }
#endif
