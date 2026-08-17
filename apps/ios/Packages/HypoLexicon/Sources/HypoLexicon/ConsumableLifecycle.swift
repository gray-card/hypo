import Foundation

/// A validated RFC 3339 timestamp that preserves its original wire spelling.
public struct ATProtoDate: Hashable, Sendable, Codable, CustomStringConvertible {
    public let rawValue: String
    public let date: Date

    public init(_ rawValue: String) throws {
        guard let date = Self.parse(rawValue) else {
            throw LexiconValueError.invalidDate(rawValue)
        }
        self.rawValue = rawValue
        self.date = date
    }

    public init(_ date: Date) {
        self.date = date
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        rawValue = formatter.string(from: date)
    }

    public var description: String { rawValue }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        try self.init(container.decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

/// Optional film-roll milestones. Their absence carries no implied date.
public struct FilmRollMilestones: Hashable, Sendable, Codable {
    public var loadedAt: ATProtoDate?
    public var partialAt: ATProtoDate?
    public var exposedAt: ATProtoDate?
    public var unloadedAt: ATProtoDate?
    public var sentToLabAt: ATProtoDate?
    public var developmentStartedAt: ATProtoDate?
    public var developedAt: ATProtoDate?
    public var receivedFromLabAt: ATProtoDate?
    public var scannedAt: ATProtoDate?
    public var archivedAt: ATProtoDate?

    public init(
        loadedAt: ATProtoDate? = nil,
        partialAt: ATProtoDate? = nil,
        exposedAt: ATProtoDate? = nil,
        unloadedAt: ATProtoDate? = nil,
        sentToLabAt: ATProtoDate? = nil,
        developmentStartedAt: ATProtoDate? = nil,
        developedAt: ATProtoDate? = nil,
        receivedFromLabAt: ATProtoDate? = nil,
        scannedAt: ATProtoDate? = nil,
        archivedAt: ATProtoDate? = nil
    ) {
        self.loadedAt = loadedAt
        self.partialAt = partialAt
        self.exposedAt = exposedAt
        self.unloadedAt = unloadedAt
        self.sentToLabAt = sentToLabAt
        self.developmentStartedAt = developmentStartedAt
        self.developedAt = developedAt
        self.receivedFromLabAt = receivedFromLabAt
        self.scannedAt = scannedAt
        self.archivedAt = archivedAt
    }
}

/// Optional chemistry milestones. Acquisition and expiry are intentionally not ordered
/// against mixing because users may acquire an opened or mixed working solution.
public struct ChemistryMilestones: Hashable, Sendable, Codable {
    public var acquiredAt: ATProtoDate?
    public var openedAt: ATProtoDate?
    public var mixedAt: ATProtoDate?
    public var replenishedAt: ATProtoDate?
    public var exhaustedAt: ATProtoDate?
    public var discardedAt: ATProtoDate?

    public init(
        acquiredAt: ATProtoDate? = nil,
        openedAt: ATProtoDate? = nil,
        mixedAt: ATProtoDate? = nil,
        replenishedAt: ATProtoDate? = nil,
        exhaustedAt: ATProtoDate? = nil,
        discardedAt: ATProtoDate? = nil
    ) {
        self.acquiredAt = acquiredAt
        self.openedAt = openedAt
        self.mixedAt = mixedAt
        self.replenishedAt = replenishedAt
        self.exhaustedAt = exhaustedAt
        self.discardedAt = discardedAt
    }
}

public struct ConsumableLifecycleIssue: Error, Hashable, Sendable {
    public let earlierField: String
    public let laterField: String

    public init(earlierField: String, laterField: String) {
        self.earlierField = earlierField
        self.laterField = laterField
    }

    public var message: String {
        "$.\(earlierField) must not be after $.\(laterField)"
    }
}

/// Cross-field chronology validation shared by the web and native authoring paths.
public enum ConsumableLifecycleValidator {
    public static func validate(_ milestones: FilmRollMilestones) -> [ConsumableLifecycleIssue] {
        validate(
            dates: [
                "loadedAt": milestones.loadedAt,
                "partialAt": milestones.partialAt,
                "exposedAt": milestones.exposedAt,
                "unloadedAt": milestones.unloadedAt,
                "sentToLabAt": milestones.sentToLabAt,
                "developmentStartedAt": milestones.developmentStartedAt,
                "developedAt": milestones.developedAt,
                "receivedFromLabAt": milestones.receivedFromLabAt,
                "scannedAt": milestones.scannedAt,
                "archivedAt": milestones.archivedAt,
            ],
            edges: [
                ("loadedAt", "partialAt"),
                ("partialAt", "exposedAt"),
                ("exposedAt", "unloadedAt"),
                ("unloadedAt", "sentToLabAt"),
                ("unloadedAt", "developmentStartedAt"),
                ("sentToLabAt", "developmentStartedAt"),
                ("developmentStartedAt", "developedAt"),
                ("developedAt", "receivedFromLabAt"),
                ("developedAt", "scannedAt"),
                ("receivedFromLabAt", "archivedAt"),
                ("scannedAt", "archivedAt"),
            ]
        )
    }

    public static func validate(_ milestones: ChemistryMilestones) -> [ConsumableLifecycleIssue] {
        validate(
            dates: [
                "acquiredAt": milestones.acquiredAt,
                "openedAt": milestones.openedAt,
                "mixedAt": milestones.mixedAt,
                "replenishedAt": milestones.replenishedAt,
                "exhaustedAt": milestones.exhaustedAt,
                "discardedAt": milestones.discardedAt,
            ],
            edges: [
                ("openedAt", "mixedAt"),
                ("mixedAt", "replenishedAt"),
                ("mixedAt", "exhaustedAt"),
                ("acquiredAt", "discardedAt"),
                ("openedAt", "discardedAt"),
                ("mixedAt", "discardedAt"),
                ("replenishedAt", "discardedAt"),
                ("exhaustedAt", "discardedAt"),
            ]
        )
    }

    private static func validate(
        dates: [String: ATProtoDate?],
        edges: [(String, String)]
    ) -> [ConsumableLifecycleIssue] {
        let pairs = transitivePairs(edges)
        return pairs.compactMap { earlier, later in
            guard let earlierDate = dates[earlier] ?? nil,
                let laterDate = dates[later] ?? nil,
                earlierDate.date > laterDate.date
            else {
                return nil
            }
            return ConsumableLifecycleIssue(earlierField: earlier, laterField: later)
        }
    }

    private static func transitivePairs(_ edges: [(String, String)]) -> [(String, String)] {
        var successors: [String: Set<String>] = [:]
        for (earlier, later) in edges {
            successors[earlier, default: []].insert(later)
        }

        var pairs: [(String, String)] = []
        for earlier in successors.keys.sorted() {
            var seen: Set<String> = []
            var pending = Array(successors[earlier] ?? []).sorted()
            while let later = pending.popLast() {
                guard seen.insert(later).inserted else { continue }
                pairs.append((earlier, later))
                pending.append(contentsOf: successors[later] ?? [])
            }
        }
        return pairs
    }
}
