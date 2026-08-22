import Foundation
import Testing

@testable import SystemIntegrationKit

@Test func sharedSnapshotRoundTrips() throws {
    let suite = "SystemIntegrationKitTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = HypoSharedSnapshotStore(defaults: defaults)
    let snapshot = HypoSystemSnapshot(
        activeRoll: HypoActiveRollSnapshot(
            label: "Roll 12",
            stockName: "Tri-X 400",
            exposuresUsed: 17,
            exposuresTotal: 36
        ),
        runningTimer: HypoRunningTimerSnapshot(
            recipeName: "D-76 1+1",
            stageName: "Develop",
            stageEndsAt: Date(timeIntervalSince1970: 600)
        ),
        latestReading: HypoReadingSnapshot(
            mode: .reflected,
            exposureValue: 10.25,
            exposureIndex: 400,
            aperture: "8",
            shutterSpeed: "1/125",
            measuredAt: Date(timeIntervalSince1970: 100)
        ),
        updatedAt: Date(timeIntervalSince1970: 200)
    )

    try store.save(snapshot)
    #expect(store.load() == snapshot)
    store.savePendingRoute(.meter(mode: .spot))
    #expect(store.consumePendingRoute() == .meter(mode: .spot))
    #expect(store.consumePendingRoute() == nil)
    store.clear()
    #expect(store.load() == nil)
}

@Test func readingSummaryContainsPhotographicValues() {
    let reading = HypoReadingSnapshot(
        mode: .spot,
        exposureValue: 11,
        exposureIndex: 100,
        aperture: "5.6",
        shutterSpeed: "1/250",
        measuredAt: .now
    )

    #expect(reading.spokenSummary == "EV 11, at ISO 100, f/5.6, 1/250")
}
