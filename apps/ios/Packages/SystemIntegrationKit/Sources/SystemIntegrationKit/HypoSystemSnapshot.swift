import Foundation

public struct HypoReadingSnapshot: Codable, Hashable, Sendable {
    public var mode: HypoMeterMode
    public var exposureValue: Double
    public var exposureIndex: Int
    public var aperture: String?
    public var shutterSpeed: String?
    public var measuredAt: Date

    public init(
        mode: HypoMeterMode,
        exposureValue: Double,
        exposureIndex: Int,
        aperture: String? = nil,
        shutterSpeed: String? = nil,
        measuredAt: Date
    ) {
        self.mode = mode
        self.exposureValue = exposureValue
        self.exposureIndex = exposureIndex
        self.aperture = aperture
        self.shutterSpeed = shutterSpeed
        self.measuredAt = measuredAt
    }

    public var spokenSummary: String {
        var parts = [
            "EV \(Self.numberFormatter.string(from: NSNumber(value: exposureValue)) ?? String(exposureValue))",
            "at ISO \(exposureIndex)",
        ]
        if let aperture { parts.append("f/\(aperture)") }
        if let shutterSpeed { parts.append(shutterSpeed) }
        return parts.joined(separator: ", ")
    }

    private static let numberFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.maximumFractionDigits = 1
        formatter.minimumFractionDigits = 0
        return formatter
    }()
}

public struct HypoActiveRollSnapshot: Codable, Hashable, Sendable {
    public var label: String
    public var stockName: String
    public var exposuresUsed: Int
    public var exposuresTotal: Int?

    public init(
        label: String,
        stockName: String,
        exposuresUsed: Int,
        exposuresTotal: Int? = nil
    ) {
        self.label = label
        self.stockName = stockName
        self.exposuresUsed = exposuresUsed
        self.exposuresTotal = exposuresTotal
    }
}

public struct HypoRunningTimerSnapshot: Codable, Hashable, Sendable {
    public var recipeName: String
    public var stageName: String
    public var stageEndsAt: Date?
    public var isPaused: Bool

    public init(
        recipeName: String,
        stageName: String,
        stageEndsAt: Date? = nil,
        isPaused: Bool = false
    ) {
        self.recipeName = recipeName
        self.stageName = stageName
        self.stageEndsAt = stageEndsAt
        self.isPaused = isPaused
    }
}

public struct HypoSystemSnapshot: Codable, Hashable, Sendable {
    public var activeRoll: HypoActiveRollSnapshot?
    public var runningTimer: HypoRunningTimerSnapshot?
    public var latestReading: HypoReadingSnapshot?
    public var updatedAt: Date

    public init(
        activeRoll: HypoActiveRollSnapshot? = nil,
        runningTimer: HypoRunningTimerSnapshot? = nil,
        latestReading: HypoReadingSnapshot? = nil,
        updatedAt: Date
    ) {
        self.activeRoll = activeRoll
        self.runningTimer = runningTimer
        self.latestReading = latestReading
        self.updatedAt = updatedAt
    }
}

public struct HypoSharedSnapshotStore: @unchecked Sendable {
    public static let appGroupIdentifier = "group.app.graycard.hypo"
    public static let snapshotKey = "system-integration.snapshot.v1"
    public static let pendingRouteKey = "system-integration.pending-route.v1"

    private let defaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init?(appGroupIdentifier: String = Self.appGroupIdentifier) {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else { return nil }
        self.init(defaults: defaults)
    }

    public init(defaults: UserDefaults) {
        self.defaults = defaults
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    public func load() -> HypoSystemSnapshot? {
        guard let data = defaults.data(forKey: Self.snapshotKey) else { return nil }
        return try? decoder.decode(HypoSystemSnapshot.self, from: data)
    }

    public func save(_ snapshot: HypoSystemSnapshot) throws {
        defaults.set(try encoder.encode(snapshot), forKey: Self.snapshotKey)
    }

    public func clear() {
        defaults.removeObject(forKey: Self.snapshotKey)
    }

    public func savePendingRoute(_ route: HypoDeepLink) {
        defaults.set(route.url.absoluteString, forKey: Self.pendingRouteKey)
    }

    /// Returns and clears the route in one serialized `UserDefaults` operation sequence.
    /// The composition root should call this before its first visible screen appears and
    /// again whenever the app becomes active after an App Intent invocation.
    public func consumePendingRoute() -> HypoDeepLink? {
        guard let value = defaults.string(forKey: Self.pendingRouteKey) else { return nil }
        defaults.removeObject(forKey: Self.pendingRouteKey)
        guard let url = URL(string: value) else { return nil }
        return HypoDeepLink(url: url)
    }
}
