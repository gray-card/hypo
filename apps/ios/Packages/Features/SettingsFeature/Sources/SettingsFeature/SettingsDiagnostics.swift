import DiagnosticsKit
import Foundation

public enum SettingsDiagnosticsOperation: Equatable, Sendable {
    case loading
    case updatingPreference
    case exporting
    case deleting
}

public struct SettingsDiagnosticsIssue: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let message: String

    public init(id: UUID = UUID(), message: String) {
        self.id = id
        self.message = message
    }
}

public struct UnavailableSettingsDiagnosticsRecorder: DiagnosticsRecording {
    public init() {}

    public func isEnabled() async -> Bool { false }
    public func setEnabled(_: Bool) async throws {}
    public func record(_: DiagnosticEvent) async throws {}
    public func events() async throws -> [DiagnosticEvent] { [] }
    public func export() async throws -> Data {
        try JSONEncoder().encode(
            DiagnosticsExport(
                generatedAt: Date(),
                applicationVersion: "Unavailable",
                operatingSystem: "Unavailable",
                events: []
            )
        )
    }
    public func deleteAll() async throws {}
}
