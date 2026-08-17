import Foundation

/// A stable identifier used to connect a timer stage to its recipe step.
public struct TimerStageID: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }
}

/// A single wall-clock stage in a photographic process.
public struct TimerStage: Codable, Hashable, Sendable {
    public let id: TimerStageID
    public var name: String
    public var duration: TimeInterval
    public var agitation: AgitationSchedule

    public init(
        id: TimerStageID,
        name: String,
        duration: TimeInterval,
        agitation: AgitationSchedule = .none
    ) throws(TimerError) {
        guard !id.rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw .invalidStage("A stage identifier cannot be empty.")
        }
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw .invalidStage("A stage name cannot be empty.")
        }
        guard duration.isFinite, duration > 0 else {
            throw .invalidDuration(duration)
        }
        try agitation.validate()
        self.id = id
        self.name = name
        self.duration = duration
        self.agitation = agitation
    }
}

/// An ordered process such as black-and-white development or a C-41 chain.
public struct TimerPlan: Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var stages: [TimerStage]

    public init(id: String, name: String, stages: [TimerStage]) throws(TimerError) {
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw .invalidPlan("A plan identifier cannot be empty.")
        }
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw .invalidPlan("A plan name cannot be empty.")
        }
        guard !stages.isEmpty else {
            throw .invalidPlan("A timer plan needs at least one stage.")
        }
        guard Set(stages.map(\.id)).count == stages.count else {
            throw .invalidPlan("Stage identifiers must be unique within a plan.")
        }
        self.id = id
        self.name = name
        self.stages = stages
    }
}

/// The durable lifecycle of a timer run.
public enum TimerRunStatus: String, Codable, Hashable, Sendable {
    case ready
    case running
    case paused
    case completed
    case cancelled
}

/// A presentation-safe view of the current stage at one instant.
public struct TimerSnapshot: Codable, Hashable, Sendable {
    public let status: TimerRunStatus
    public let stageIndex: Int
    public let stage: TimerStage
    public let elapsed: TimeInterval
    public let remaining: TimeInterval
    public let progress: Double
    public let stageStartedAt: Date?
    public let stageEndsAt: Date?
    public let nextStage: TimerStage?
    public let agitation: AgitationStatus
}

/// Errors raised by the pure timer state machine and its persistence boundary.
public enum TimerError: Error, Equatable, Sendable {
    case invalidPlan(String)
    case invalidStage(String)
    case invalidDuration(TimeInterval)
    case invalidTransition(from: TimerRunStatus, action: String)
    case invalidTimeOrder(previous: Date, next: Date)
    case noPersistedRun
    case persistence(String)
}
