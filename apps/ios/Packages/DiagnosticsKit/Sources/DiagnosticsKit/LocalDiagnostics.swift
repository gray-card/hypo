import Foundation

public enum DiagnosticCategory: String, Codable, CaseIterable, Sendable {
    case application
    case authentication
    case persistence
    case synchronization
    case meter
    case logger
    case timer
    case library
}

public enum DiagnosticOutcome: String, Codable, CaseIterable, Sendable {
    case started
    case succeeded
    case deferred
    case cancelled
    case failed
}

/// Reviewed operation names are closed so call sites cannot place user or record data in exports.
public enum DiagnosticOperation: String, Codable, CaseIterable, Sendable {
    case applicationStart = "application.start"
    case applicationForeground = "application.foreground"
    case accountRefresh = "account.refresh"
    case calibrationRefresh = "calibration.refresh"
    case synchronizationBackgroundRefresh = "synchronization.background-refresh"
}

/// Reviewed failure/defer reasons. Raw errors never enter the diagnostic store.
public enum DiagnosticCode: String, Codable, CaseIterable, Sendable {
    case unavailable
    case offline
    case malformedRecords = "malformed-records"
}

/// An intentionally narrow operational event. It cannot carry record bodies, free-form text,
/// account identifiers, URLs, location, or sensor values.
public struct DiagnosticEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let occurredAt: Date
    public let category: DiagnosticCategory
    public let operation: DiagnosticOperation
    public let outcome: DiagnosticOutcome
    public let code: DiagnosticCode?
    public let durationMilliseconds: Int?

    public init(
        id: UUID = UUID(),
        occurredAt: Date = Date(),
        category: DiagnosticCategory,
        operation: DiagnosticOperation,
        outcome: DiagnosticOutcome,
        code: DiagnosticCode? = nil,
        durationMilliseconds: Int? = nil
    ) throws {
        self.id = id
        self.occurredAt = occurredAt
        self.category = category
        self.operation = operation
        self.outcome = outcome
        self.code = code
        if let durationMilliseconds, durationMilliseconds < 0 {
            throw DiagnosticsError.invalidEvent("durationMilliseconds")
        }
        self.durationMilliseconds = durationMilliseconds
    }

}

public struct DiagnosticsExport: Codable, Equatable, Sendable {
    public let formatVersion: Int
    public let generatedAt: Date
    public let applicationVersion: String
    public let operatingSystem: String
    public let events: [DiagnosticEvent]

    public init(
        generatedAt: Date,
        applicationVersion: String,
        operatingSystem: String,
        events: [DiagnosticEvent]
    ) {
        formatVersion = 1
        self.generatedAt = generatedAt
        self.applicationVersion = applicationVersion
        self.operatingSystem = operatingSystem
        self.events = events
    }
}

public protocol DiagnosticsRecording: Sendable {
    func isEnabled() async -> Bool
    func setEnabled(_ enabled: Bool) async throws
    func record(_ event: DiagnosticEvent) async throws
    func events() async throws -> [DiagnosticEvent]
    func export() async throws -> Data
    func deleteAll() async throws
}

public actor LocalDiagnosticsRecorder: DiagnosticsRecording {
    private struct FileEnvelope: Codable {
        let formatVersion: Int
        var events: [DiagnosticEvent]
    }

    private let fileURL: URL
    private let preferences: UserDefaults
    private let enabledKey: String
    private let maximumEventCount: Int
    private let maximumAge: TimeInterval
    private let applicationVersion: @Sendable () -> String
    private let operatingSystem: @Sendable () -> String
    private let now: @Sendable () -> Date

    public init(
        fileURL: URL,
        preferencesSuiteName: String? = nil,
        enabledKey: String = "diagnostics.local.enabled",
        maximumEventCount: Int = 500,
        maximumAge: TimeInterval = 7 * 24 * 60 * 60,
        applicationVersion: @escaping @Sendable () -> String,
        operatingSystem: @escaping @Sendable () -> String,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        precondition(maximumEventCount > 0)
        precondition(maximumAge > 0)
        self.fileURL = fileURL
        preferences = preferencesSuiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
        self.enabledKey = enabledKey
        self.maximumEventCount = maximumEventCount
        self.maximumAge = maximumAge
        self.applicationVersion = applicationVersion
        self.operatingSystem = operatingSystem
        self.now = now
    }

    public func isEnabled() -> Bool {
        preferences.bool(forKey: enabledKey)
    }

    public func setEnabled(_ enabled: Bool) throws {
        if enabled {
            preferences.set(true, forKey: enabledKey)
        } else {
            try deleteAll()
            preferences.set(false, forKey: enabledKey)
        }
    }

    public func record(_ event: DiagnosticEvent) throws {
        guard isEnabled() else { return }
        var retained = try load()
        retained.append(event)
        try write(pruned(retained, relativeTo: now()))
    }

    public func events() throws -> [DiagnosticEvent] {
        guard isEnabled() else { return [] }
        let retained = pruned(try load(), relativeTo: now())
        try write(retained)
        return retained
    }

    public func export() throws -> Data {
        let generatedAt = now()
        let payload = DiagnosticsExport(
            generatedAt: generatedAt,
            applicationVersion: applicationVersion(),
            operatingSystem: operatingSystem(),
            events: isEnabled() ? pruned(try load(), relativeTo: generatedAt) : []
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(payload)
    }

    public func deleteAll() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do {
            try FileManager.default.removeItem(at: fileURL)
        } catch {
            throw DiagnosticsError.storage(String(describing: error))
        }
    }

    private func pruned(_ events: [DiagnosticEvent], relativeTo date: Date) -> [DiagnosticEvent] {
        let cutoff = date.addingTimeInterval(-maximumAge)
        return Array(
            events
                .filter { $0.occurredAt >= cutoff }
                .sorted { $0.occurredAt < $1.occurredAt }
                .suffix(maximumEventCount)
        )
    }

    private func load() throws -> [DiagnosticEvent] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let envelope = try decoder.decode(
                FileEnvelope.self,
                from: Data(contentsOf: fileURL)
            )
            guard envelope.formatVersion == 1 else {
                throw DiagnosticsError.unsupportedFormat(envelope.formatVersion)
            }
            return envelope.events
        } catch let error as DiagnosticsError {
            throw error
        } catch {
            throw DiagnosticsError.storage(String(describing: error))
        }
    }

    private func write(_ events: [DiagnosticEvent]) throws {
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(FileEnvelope(formatVersion: 1, events: events))
            try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        } catch {
            throw DiagnosticsError.storage(String(describing: error))
        }
    }
}

public enum DiagnosticsError: Error, Equatable, Sendable {
    case invalidEvent(String)
    case unsupportedFormat(Int)
    case storage(String)
}
