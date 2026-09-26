import Foundation

#if os(iOS)
    @preconcurrency import ActivityKit
    import AudioToolbox
    import CoreHaptics
    @preconcurrency import UserNotifications

    /// Production delivery for timer notifications, agitation cues, and Live Activities.
    @MainActor
    public final class SystemTimerPlatformPresenter: TimerPlatformPresenting {
        public static let shared = SystemTimerPlatformPresenter()

        private let notificationCenter: UNUserNotificationCenter
        private let cuePlayer: SystemTimerCuePlayer
        private var activeRunID: UUID?
        private var activity: Activity<HypoTimerActivityAttributes>?
        private var lastPresentation: TimerPlatformPresentation?
        private var synchronizationTask: Task<Void, Never>?
        private var generation = 0

        public init(
            notificationCenter: UNUserNotificationCenter = .current(),
            audioEnabled: Bool = true
        ) {
            self.notificationCenter = notificationCenter
            cuePlayer = SystemTimerCuePlayer(audioEnabled: audioEnabled)
        }

        public func synchronize(_ presentation: TimerPlatformPresentation) {
            switch presentation.agitationTransition(from: lastPresentation) {
            case .began:
                cuePlayer.play(.agitationBegin)
            case .ended:
                cuePlayer.play(.agitationEnd)
            case nil:
                break
            }

            guard presentation != lastPresentation else { return }
            let previousRunID = activeRunID
            activeRunID = presentation.runID
            lastPresentation = presentation
            generation += 1
            let requestedGeneration = generation
            synchronizationTask?.cancel()
            synchronizationTask = Task { [weak self] in
                guard let self else { return }
                if let previousRunID, previousRunID != presentation.runID {
                    await self.removeNotifications(runID: previousRunID)
                    await self.endActivity(runID: previousRunID, immediately: true)
                }
                guard !Task.isCancelled, requestedGeneration == self.generation else { return }
                await self.apply(presentation)
            }
        }

        public func invalidate(runID: UUID) {
            guard activeRunID == runID || lastPresentation?.runID == runID else { return }
            generation += 1
            synchronizationTask?.cancel()
            synchronizationTask = Task { [weak self] in
                guard let self else { return }
                await self.removeNotifications(runID: runID)
                await self.endActivity(runID: runID, immediately: true)
            }
            if activeRunID == runID { activeRunID = nil }
            if lastPresentation?.runID == runID { lastPresentation = nil }
        }

        private func apply(_ presentation: TimerPlatformPresentation) async {
            switch presentation.status {
            case .running:
                await scheduleNotifications(presentation)
                await updateActivity(presentation)
            case .paused:
                await removeNotifications(runID: presentation.runID)
                await updateActivity(presentation)
            case .completed:
                await removeNotifications(runID: presentation.runID)
                cuePlayer.play(.timerComplete)
                await finishActivity(presentation)
            case .cancelled:
                await removeNotifications(runID: presentation.runID)
                await endActivity(runID: presentation.runID, immediately: true)
            case .ready:
                await removeNotifications(runID: presentation.runID)
                await endActivity(runID: presentation.runID, immediately: true)
            }
        }

        private func scheduleNotifications(_ presentation: TimerPlatformPresentation) async {
            await removeNotifications(runID: presentation.runID)
            guard !presentation.boundaries.isEmpty else { return }

            do {
                let settings = await notificationCenter.notificationSettings()
                let authorized: Bool
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral:
                    authorized = true
                case .notDetermined:
                    authorized = try await notificationCenter.requestAuthorization(
                        options: [.alert, .sound]
                    )
                case .denied:
                    authorized = false
                @unknown default:
                    authorized = false
                }
                guard authorized else { return }

                for boundary in presentation.boundaries {
                    guard !Task.isCancelled else { return }
                    let content = UNMutableNotificationContent()
                    content.title =
                        boundary.nextStageName.map { "Begin \($0)" }
                        ?? "Development complete"
                    content.body =
                        boundary.nextStageName.map {
                            "\(boundary.completedStageName) is finished. Start \($0)."
                        } ?? "\(presentation.recipeName) is finished."
                    content.sound = .default
                    content.threadIdentifier = "hypo-development-timer"
                    content.userInfo = ["timerRunID": presentation.runID.uuidString]

                    // iOS requires a positive trigger interval. One second is the reliable floor
                    // for a non-repeating local notification.
                    let interval = max(1, boundary.date.timeIntervalSinceNow)
                    let trigger = UNTimeIntervalNotificationTrigger(
                        timeInterval: interval,
                        repeats: false
                    )
                    try await notificationCenter.add(
                        UNNotificationRequest(
                            identifier: Self.notificationIdentifier(
                                runID: presentation.runID,
                                stageIndex: boundary.completedStageIndex
                            ),
                            content: content,
                            trigger: trigger
                        )
                    )
                }
            } catch {
                // The timer and its durable completion pipeline remain authoritative. A denied or
                // failed notification request must not alter timer state.
            }
        }

        private func removeNotifications(runID: UUID) async {
            let prefix = Self.notificationPrefix(runID: runID)
            let pendingIdentifiers = await notificationCenter.pendingNotificationRequests()
                .map(\.identifier)
                .filter { $0.hasPrefix(prefix) }
            if !pendingIdentifiers.isEmpty {
                notificationCenter.removePendingNotificationRequests(
                    withIdentifiers: pendingIdentifiers
                )
            }
            let deliveredIdentifiers = await notificationCenter.deliveredNotifications()
                .map(\.request.identifier)
                .filter { $0.hasPrefix(prefix) }
            if !deliveredIdentifiers.isEmpty {
                notificationCenter.removeDeliveredNotifications(
                    withIdentifiers: deliveredIdentifiers
                )
            }
        }

        private func updateActivity(_ presentation: TimerPlatformPresentation) async {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let content = ActivityContent(
                state: HypoTimerActivityAttributes.ContentState(presentation: presentation),
                staleDate: presentation.stageEndsAt
            )
            if let activity = activity(for: presentation.runID) {
                self.activity = activity
                await activity.update(content)
                return
            }

            for staleActivity in Activity<HypoTimerActivityAttributes>.activities {
                guard staleActivity.attributes.runID != presentation.runID else { continue }
                await staleActivity.end(nil, dismissalPolicy: .immediate)
            }
            do {
                activity = try Activity.request(
                    attributes: HypoTimerActivityAttributes(
                        runID: presentation.runID,
                        recipeName: presentation.recipeName
                    ),
                    content: content,
                    pushType: nil
                )
            } catch {
                // Stage notifications remain the guaranteed presentation floor.
            }
        }

        private func finishActivity(_ presentation: TimerPlatformPresentation) async {
            guard let activity = activity(for: presentation.runID) else { return }
            let content = ActivityContent(
                state: HypoTimerActivityAttributes.ContentState(presentation: presentation),
                staleDate: nil
            )
            await activity.end(
                content,
                dismissalPolicy: .after(Date().addingTimeInterval(5 * 60))
            )
            self.activity = nil
        }

        private func endActivity(runID: UUID, immediately: Bool) async {
            guard let activity = activity(for: runID) else { return }
            await activity.end(
                nil,
                dismissalPolicy: immediately ? .immediate : .default
            )
            self.activity = nil
        }

        private func activity(for runID: UUID) -> Activity<HypoTimerActivityAttributes>? {
            if let activity, activity.attributes.runID == runID {
                return activity
            }
            return Activity<HypoTimerActivityAttributes>.activities.first {
                $0.attributes.runID == runID
            }
        }

        private static func notificationPrefix(runID: UUID) -> String {
            "hypo.timer.\(runID.uuidString).stage."
        }

        private static func notificationIdentifier(runID: UUID, stageIndex: Int) -> String {
            "\(notificationPrefix(runID: runID))\(stageIndex)"
        }
    }

    @MainActor
    private final class SystemTimerCuePlayer {
        enum Cue: Equatable {
            case agitationBegin
            case agitationEnd
            case timerComplete
        }

        private let audioEnabled: Bool
        private var hapticEngine: CHHapticEngine?

        init(audioEnabled: Bool) {
            self.audioEnabled = audioEnabled
            if CHHapticEngine.capabilitiesForHardware().supportsHaptics {
                hapticEngine = try? CHHapticEngine()
                try? hapticEngine?.start()
            }
        }

        func play(_ cue: Cue) {
            playHaptic(cue)
            guard audioEnabled else { return }
            switch cue {
            case .agitationBegin:
                AudioServicesPlaySystemSound(1104)
            case .agitationEnd:
                AudioServicesPlaySystemSound(1103)
            case .timerComplete:
                AudioServicesPlaySystemSound(1025)
            }
        }

        private func playHaptic(_ cue: Cue) {
            guard let hapticEngine else {
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                return
            }
            let intensity: Float = cue == .agitationBegin ? 0.9 : 0.45
            let sharpness: Float = cue == .timerComplete ? 0.25 : 0.75
            let event = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
                ],
                relativeTime: 0
            )
            guard let pattern = try? CHHapticPattern(events: [event], parameters: []) else { return }
            try? hapticEngine.start()
            try? hapticEngine.makePlayer(with: pattern).start(atTime: 0)
        }
    }
#else
    /// No-op implementation for package tests and non-iOS clients.
    @MainActor
    public final class SystemTimerPlatformPresenter: TimerPlatformPresenting {
        public static let shared = SystemTimerPlatformPresenter()

        public init(audioEnabled _: Bool = true) {}

        public func synchronize(_: TimerPlatformPresentation) {}
        public func invalidate(runID _: UUID) {}
    }
#endif
