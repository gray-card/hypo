import ATProtoClient
import DesignSystem
import SwiftUI
import UniformTypeIdentifiers

public struct SettingsFeatureView: View {
    @Bindable private var model: SettingsFeatureModel
    @State private var isExportingDiagnostics = false

    public init(model: SettingsFeatureModel) {
        self.model = model
    }

    public var body: some View {
        ZStack {
            HypoTheme.ColorToken.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: HypoTheme.Space.four) {
                    if let operation = model.operation {
                        progressPanel(operation)
                    }
                    if let error = model.authenticationError {
                        errorPanel(error)
                    }
                    if let session = model.session {
                        accountPanel(session)
                    } else if model.operation != .restoring {
                        signInPanel
                    }
                    SettingsCalibrationPanel(model: model)
                    diagnosticsPanel
                    syncPanel
                }
                .padding(HypoTheme.Space.four)
            }
        }
        .foregroundStyle(HypoTheme.ColorToken.text)
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem(placement: .automatic) { HypoWordmark() }
        }
        .task {
            model.restore()
            await model.loadCalibrations()
            await model.loadDiagnostics()
        }
        .sheet(isPresented: $model.isShowingCalibrationGuide) {
            SettingsCalibrationGuide(model: model)
        }
        .fileExporter(
            isPresented: $isExportingDiagnostics,
            document: model.diagnosticsExportData.map(SettingsDiagnosticsExportDocument.init),
            contentType: .json,
            defaultFilename: "Hypo diagnostics"
        ) { _ in }
    }

    private var signInPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                    Text("ACCOUNT")
                        .font(.caption.monospaced().weight(.semibold))
                        .tracking(1.4)
                        .foregroundStyle(HypoTheme.ColorToken.accent)
                    Text("Connect your photography records")
                        .font(.title2.weight(.semibold))
                    Text(
                        "Use the handle or DID you use on Bluesky or Grain. Hypo connects through your PDS and keeps the session on this device."
                    )
                    .foregroundStyle(HypoTheme.ColorToken.muted)
                }

                ConnectionPath(isConnected: false)

                VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                    Text("HANDLE OR DID")
                        .font(.caption.monospaced())
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                    identifierField
                        .padding(HypoTheme.Space.three)
                        .background(HypoTheme.ColorToken.elevated)
                        .clipShape(RoundedRectangle(cornerRadius: HypoTheme.Radius.regular))
                        .overlay {
                            RoundedRectangle(cornerRadius: HypoTheme.Radius.regular)
                                .stroke(HypoTheme.ColorToken.border)
                        }
                }

                Button("Sign in") { model.signIn() }
                    .buttonStyle(HypoPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(!model.canSignIn)
                    .opacity(model.canSignIn ? 1 : 0.45)

                Label(
                    "Hypo requests access to its photography records and Grain galleries. It does not request account-management access.",
                    systemImage: "checkmark.shield"
                )
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.muted)
            }
        }
    }

    @ViewBuilder
    private var identifierField: some View {
        #if os(iOS)
            TextField("alice.example", text: $model.identifier)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)
                .submitLabel(.continue)
                .onSubmit { model.signIn() }
        #else
            TextField("alice.example", text: $model.identifier)
                .onSubmit { model.signIn() }
        #endif
    }

    private func accountPanel(_ session: OAuthSession) -> some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.four) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                        Text("CONNECTED ACCOUNT")
                            .font(.caption.monospaced().weight(.semibold))
                            .tracking(1.4)
                            .foregroundStyle(HypoTheme.ColorToken.success)
                        Text(displayName(session.subject))
                            .font(.title2.weight(.semibold))
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(HypoTheme.ColorToken.success)
                        .accessibilityLabel("Connected")
                }

                ConnectionPath(isConnected: true)

                accountFact(label: "DID", value: session.subject)
                accountFact(label: "PDS", value: session.pdsURL?.host ?? "Unavailable")
                accountFact(label: "SESSION", value: "Stored in Keychain")

                HStack(spacing: HypoTheme.Space.three) {
                    Button {
                        model.refresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)

                    Button(role: .destructive) {
                        model.signOut()
                    } label: {
                        Text("Sign out")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }
                .disabled(model.operation != nil)
            }
        }
    }

    private func progressPanel(_ operation: SettingsAuthenticationOperation) -> some View {
        InstrumentPanel {
            HStack(spacing: HypoTheme.Space.four) {
                ProgressView()
                    .controlSize(.large)
                    .tint(HypoTheme.ColorToken.accent)
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(operation.progressTitle).font(.headline)
                    Text(operation.progressDetail)
                        .font(.footnote)
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
                Spacer(minLength: HypoTheme.Space.two)
                Button("Cancel") { model.cancelCurrentOperation() }
                    .buttonStyle(.bordered)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func errorPanel(_ error: SettingsAuthenticationError) -> some View {
        InstrumentPanel {
            HStack(alignment: .top, spacing: HypoTheme.Space.three) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(HypoTheme.ColorToken.danger)
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text(error.title).font(.headline)
                    Text(error.message)
                        .font(.footnote)
                        .foregroundStyle(HypoTheme.ColorToken.muted)
                }
                Spacer()
                Button {
                    model.dismissError()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss error")
            }
        }
    }

    private var syncPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.two) {
                Label("Offline queue", systemImage: "arrow.up.arrow.down.circle")
                    .font(.headline)
                Text(
                    "Changes are saved on this device first. If Hypo cannot reach your PDS, they stay queued until the connection returns."
                )
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.muted)
            }
        }
    }

    private var diagnosticsPanel: some View {
        InstrumentPanel {
            VStack(alignment: .leading, spacing: HypoTheme.Space.three) {
                VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
                    Text("LOCAL DIAGNOSTICS")
                        .font(.caption.monospaced().weight(.semibold))
                        .tracking(1.4)
                        .foregroundStyle(HypoTheme.ColorToken.accent)
                    Text("Private troubleshooting history")
                        .font(.headline)
                }

                Text(
                    "Off by default. When enabled, Hypo keeps up to 500 reviewed operation results for seven days on this device. It does not include analytics, account identifiers, URLs, record contents, location, or camera and meter sensor data."
                )
                .font(.footnote)
                .foregroundStyle(HypoTheme.ColorToken.muted)

                Toggle(
                    "Collect local diagnostics",
                    isOn: Binding(
                        get: { model.diagnosticsEnabled },
                        set: { enabled in
                            Task { await model.setDiagnosticsEnabled(enabled) }
                        }
                    )
                )
                .frame(minHeight: 44)
                .disabled(model.diagnosticsOperation != nil)

                if model.diagnosticsEnabled {
                    Text(
                        "\(model.diagnosticsEventCount) saved event"
                            + (model.diagnosticsEventCount == 1 ? "" : "s")
                    )
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(HypoTheme.ColorToken.muted)

                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: HypoTheme.Space.three) {
                            diagnosticsExportButton
                            diagnosticsDeleteButton
                        }
                        VStack(spacing: HypoTheme.Space.two) {
                            diagnosticsExportButton
                            diagnosticsDeleteButton
                        }
                    }
                }

                if let issue = model.diagnosticsIssue {
                    HStack(alignment: .top, spacing: HypoTheme.Space.two) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(HypoTheme.ColorToken.danger)
                        Text(issue.message)
                            .font(.footnote)
                        Spacer()
                        Button("Dismiss") { model.dismissDiagnosticsIssue() }
                            .font(.footnote)
                    }
                }
            }
        }
    }

    private var diagnosticsExportButton: some View {
        Button {
            Task {
                if await model.prepareDiagnosticsExport() {
                    isExportingDiagnostics = true
                }
            }
        } label: {
            Label("Export JSON", systemImage: "square.and.arrow.up")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .disabled(model.diagnosticsOperation != nil)
    }

    private var diagnosticsDeleteButton: some View {
        Button(role: .destructive) {
            Task { await model.deleteDiagnostics() }
        } label: {
            Text("Delete history")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .disabled(model.diagnosticsOperation != nil || model.diagnosticsEventCount == 0)
    }

    private func accountFact(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: HypoTheme.Space.one) {
            Text(label)
                .font(.caption2.monospaced())
                .foregroundStyle(HypoTheme.ColorToken.muted)
            Text(value)
                .font(.footnote.monospaced())
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func displayName(_ did: String) -> String {
        did.split(separator: ":").last.map(String.init) ?? did
    }
}

private struct SettingsDiagnosticsExportDocument: FileDocument {
    static let readableContentTypes = [UTType.json]

    let data: Data

    init(_ data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct ConnectionPath: View {
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 0) {
            node("person.crop.circle", label: "Identity")
            connector
            node("externaldrive.connected.to.line.below", label: "PDS")
            connector
            node("key.horizontal", label: "This device")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            isConnected
                ? "Identity, PDS, and this device are connected"
                : "Sign-in connects your identity and PDS to this device"
        )
    }

    private func node(_ image: String, label: String) -> some View {
        VStack(spacing: HypoTheme.Space.one) {
            Image(systemName: isConnected ? "checkmark.circle.fill" : image)
                .font(.body.weight(.semibold))
                .foregroundStyle(
                    isConnected ? HypoTheme.ColorToken.success : HypoTheme.ColorToken.accent
                )
                .frame(width: 32, height: 32)
            Text(label)
                .font(.caption2.monospaced())
                .foregroundStyle(HypoTheme.ColorToken.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }

    private var connector: some View {
        Rectangle()
            .fill(isConnected ? HypoTheme.ColorToken.success : HypoTheme.ColorToken.border)
            .frame(height: 1)
            .offset(y: -8)
            .accessibilityHidden(true)
    }
}
