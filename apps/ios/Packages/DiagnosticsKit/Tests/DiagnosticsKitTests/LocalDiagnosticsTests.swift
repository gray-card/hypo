import Foundation
import Testing

@testable import DiagnosticsKit

@Test("Diagnostics stay disabled and leave no file until the user opts in")
func defaultOff() async throws {
    let fixture = try Fixture()
    defer { fixture.remove() }
    let recorder = fixture.recorder()

    try await recorder.record(fixture.event(operation: .accountRefresh))

    #expect(await recorder.isEnabled() == false)
    #expect(try await recorder.events().isEmpty)
    #expect(!FileManager.default.fileExists(atPath: fixture.fileURL.path))
}

@Test("The recorder retains a bounded, time-limited operational history")
func retention() async throws {
    let fixture = try Fixture(now: Date(timeIntervalSince1970: 10_000))
    defer { fixture.remove() }
    let recorder = fixture.recorder(maximumEventCount: 2, maximumAge: 100)
    try await recorder.setEnabled(true)
    try await recorder.record(
        fixture.event(operation: .applicationStart, occurredAt: Date(timeIntervalSince1970: 9_000))
    )
    try await recorder.record(
        fixture.event(operation: .accountRefresh, occurredAt: Date(timeIntervalSince1970: 9_910))
    )
    try await recorder.record(
        fixture.event(operation: .calibrationRefresh, occurredAt: Date(timeIntervalSince1970: 9_920))
    )
    try await recorder.record(
        fixture.event(
            operation: .synchronizationBackgroundRefresh,
            occurredAt: Date(timeIntervalSince1970: 9_930)
        )
    )

    #expect(
        try await recorder.events().map(\.operation)
            == [.calibrationRefresh, .synchronizationBackgroundRefresh]
    )
}

@Test("Export contains reviewed fields and disabling deletes the local history")
func exportAndDelete() async throws {
    let fixture = try Fixture(now: Date(timeIntervalSince1970: 20_000))
    defer { fixture.remove() }
    let recorder = fixture.recorder()
    try await recorder.setEnabled(true)
    try await recorder.record(
        fixture.event(
            operation: .accountRefresh,
            outcome: .failed,
            code: .unavailable
        )
    )

    let exportedData = try await recorder.export()
    let export = try JSONSerialization.jsonObject(with: exportedData)
    let object = try #require(export as? [String: Any])
    let events = try #require(object["events"] as? [[String: Any]])
    #expect(object["applicationVersion"] as? String == "1.0-test")
    #expect(events.first?["operation"] as? String == "account.refresh")
    #expect(events.first?["code"] as? String == "unavailable")
    #expect(String(data: exportedData, encoding: .utf8)?.contains("did:plc") == false)

    try await recorder.setEnabled(false)
    #expect(try await recorder.events().isEmpty)
    #expect(!FileManager.default.fileExists(atPath: fixture.fileURL.path))
}

@Test("Only reviewed operation and code values decode")
func reviewedTokenDecoding() throws {
    let valid = try JSONEncoder().encode(
        try DiagnosticEvent(
            category: .synchronization,
            operation: .accountRefresh,
            outcome: .failed,
            code: .offline
        )
    )
    let invalidOperation = Data(
        String(decoding: valid, as: UTF8.self)
            .replacingOccurrences(of: "account.refresh", with: "did.plc.private").utf8
    )
    let invalidCode = Data(
        String(decoding: valid, as: UTF8.self)
            .replacingOccurrences(of: "offline", with: "record-payload").utf8
    )

    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(DiagnosticEvent.self, from: invalidOperation)
    }
    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(DiagnosticEvent.self, from: invalidCode)
    }
}

private struct Fixture {
    let directory: URL
    let fileURL: URL
    let preferences: UserDefaults
    let suiteName: String
    let now: Date

    init(now: Date = Date(timeIntervalSince1970: 10_000)) throws {
        directory = FileManager.default.temporaryDirectory.appending(
            path: "hypo-diagnostics-\(UUID().uuidString)",
            directoryHint: .isDirectory
        )
        fileURL = directory.appending(path: "events.json")
        suiteName = "hypo-diagnostics-tests-\(UUID().uuidString)"
        preferences = try #require(UserDefaults(suiteName: suiteName))
        self.now = now
    }

    func recorder(
        maximumEventCount: Int = 500,
        maximumAge: TimeInterval = 7 * 24 * 60 * 60
    ) -> LocalDiagnosticsRecorder {
        let currentDate = now
        return LocalDiagnosticsRecorder(
            fileURL: fileURL,
            preferencesSuiteName: suiteName,
            enabledKey: "enabled",
            maximumEventCount: maximumEventCount,
            maximumAge: maximumAge,
            applicationVersion: { "1.0-test" },
            operatingSystem: { "test-os" },
            now: { currentDate }
        )
    }

    func event(
        operation: DiagnosticOperation,
        occurredAt: Date? = nil,
        outcome: DiagnosticOutcome = .succeeded,
        code: DiagnosticCode? = nil
    ) throws -> DiagnosticEvent {
        try DiagnosticEvent(
            occurredAt: occurredAt ?? now,
            category: .synchronization,
            operation: operation,
            outcome: outcome,
            code: code
        )
    }

    func remove() {
        preferences.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }
}
