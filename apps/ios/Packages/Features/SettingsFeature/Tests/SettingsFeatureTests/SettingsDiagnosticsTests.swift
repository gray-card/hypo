import ATProtoClient
import DiagnosticsKit
import Foundation
import Testing

@testable import SettingsFeature

private actor DiagnosticsAuthenticationClientFake: SettingsAuthenticationClient {
    func signIn(identifier _: String, sessionID _: OAuthSessionID) async throws -> OAuthSession {
        throw CancellationError()
    }

    func restore(sessionID _: OAuthSessionID) async throws -> OAuthSession? { nil }
    func refresh(sessionID _: OAuthSessionID) async throws -> OAuthSession {
        throw CancellationError()
    }
    func signOut(sessionID _: OAuthSessionID) async throws {}
}

@MainActor
@Test("Settings keeps diagnostics default-off and disabling deletes its local history")
func diagnosticsSettingsLifecycle() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "hypo-settings-diagnostics-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    let fileURL = directory.appending(path: "events.json")
    let suiteName = "hypo-settings-diagnostics-\(UUID().uuidString)"
    defer {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }
    let recorder = LocalDiagnosticsRecorder(
        fileURL: fileURL,
        preferencesSuiteName: suiteName,
        applicationVersion: { "1.0-test" },
        operatingSystem: { "test-os" }
    )
    let model = SettingsFeatureModel(
        client: DiagnosticsAuthenticationClientFake(),
        sessionID: OAuthSessionID(rawValue: "diagnostics-test"),
        diagnosticsRecorder: recorder
    )

    await model.loadDiagnostics()
    #expect(model.diagnosticsEnabled == false)
    #expect(model.diagnosticsEventCount == 0)
    #expect(!FileManager.default.fileExists(atPath: fileURL.path))

    await model.setDiagnosticsEnabled(true)
    try await recorder.record(
        DiagnosticEvent(
            category: .application,
            operation: .applicationStart,
            outcome: .succeeded
        )
    )
    await model.loadDiagnostics()
    #expect(model.diagnosticsEnabled)
    #expect(model.diagnosticsEventCount == 1)
    #expect(await model.prepareDiagnosticsExport())
    let exported = try #require(model.diagnosticsExportData)
    let string = try #require(String(data: exported, encoding: .utf8))
    #expect(string.contains("application.start"))
    #expect(!string.contains("did:plc"))

    await model.setDiagnosticsEnabled(false)
    #expect(model.diagnosticsEnabled == false)
    #expect(model.diagnosticsEventCount == 0)
    #expect(model.diagnosticsExportData == nil)
    #expect(!FileManager.default.fileExists(atPath: fileURL.path))
}

@MainActor
@Test("Deleting diagnostics keeps collection enabled and clears the export")
func diagnosticsDeleteHistory() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "hypo-settings-diagnostics-delete-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    let suiteName = "hypo-settings-diagnostics-delete-\(UUID().uuidString)"
    defer {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }
    let recorder = LocalDiagnosticsRecorder(
        fileURL: directory.appending(path: "events.json"),
        preferencesSuiteName: suiteName,
        applicationVersion: { "1.0-test" },
        operatingSystem: { "test-os" }
    )
    try await recorder.setEnabled(true)
    try await recorder.record(
        DiagnosticEvent(
            category: .application,
            operation: .applicationForeground,
            outcome: .succeeded
        )
    )
    let model = SettingsFeatureModel(
        client: DiagnosticsAuthenticationClientFake(),
        sessionID: OAuthSessionID(rawValue: "diagnostics-delete-test"),
        diagnosticsRecorder: recorder
    )
    await model.loadDiagnostics()
    #expect(await model.prepareDiagnosticsExport())

    await model.deleteDiagnostics()

    #expect(model.diagnosticsEnabled)
    #expect(model.diagnosticsEventCount == 0)
    #expect(model.diagnosticsExportData == nil)
    #expect(try await recorder.events().isEmpty)
}
