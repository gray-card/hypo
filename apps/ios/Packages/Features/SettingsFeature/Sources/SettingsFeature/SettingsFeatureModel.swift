import ATProtoClient
import DiagnosticsKit
import Foundation
import MeterEngine
import MeterFeature
import Observation

public protocol SettingsAuthenticationClient: Sendable {
    func signIn(identifier: String, sessionID: OAuthSessionID) async throws -> OAuthSession
    func restore(sessionID: OAuthSessionID) async throws -> OAuthSession?
    func refresh(sessionID: OAuthSessionID) async throws -> OAuthSession
    func signOut(sessionID: OAuthSessionID) async throws
}

extension OAuthFlowCoordinator: SettingsAuthenticationClient {}

public enum SettingsAuthenticationOperation: Hashable, Sendable {
    case restoring
    case signingIn
    case refreshing
    case signingOut

    public var progressTitle: String {
        switch self {
        case .restoring: "Checking this device"
        case .signingIn: "Connecting to your PDS"
        case .refreshing: "Refreshing the session"
        case .signingOut: "Removing the session"
        }
    }

    public var progressDetail: String {
        switch self {
        case .restoring: "Looking for a saved Hypo session."
        case .signingIn: "Hypo will open your authorization server to finish sign-in."
        case .refreshing: "Your queued changes remain on this device while Hypo reconnects."
        case .signingOut: "Queued changes are kept. Account credentials are removed."
        }
    }
}

public struct SettingsAuthenticationError: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var title: String
    public var message: String

    public init(id: UUID = UUID(), title: String, message: String) {
        self.id = id
        self.title = title
        self.message = message
    }
}

public enum SettingsCalibrationOperation: Equatable, Sendable {
    case loading
    case capturing
    case saving
    case selecting
    case deleting
}

public struct SettingsCalibrationIssue: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var title: String
    public var message: String

    public init(id: UUID = UUID(), title: String, message: String) {
        self.id = id
        self.title = title
        self.message = message
    }
}

@MainActor
@Observable
public final class SettingsFeatureModel {
    public typealias SessionChangeHandler = @MainActor @Sendable (OAuthSession?) -> Void
    public typealias CalibrationStateChangeHandler =
        @MainActor @Sendable (SettingsCalibrationState) -> Void

    public var identifier = ""
    public private(set) var session: OAuthSession?
    public private(set) var operation: SettingsAuthenticationOperation?
    public private(set) var authenticationError: SettingsAuthenticationError?
    public private(set) var calibrationProfiles: [CalibrationProfile] = []
    public private(set) var selectedCalibrationID: UUID?
    public private(set) var calibrationOperation: SettingsCalibrationOperation?
    public private(set) var calibrationIssue: SettingsCalibrationIssue?
    public private(set) var calibrationConfirmationMessage: String?
    public private(set) var diagnosticsEnabled = false
    public private(set) var diagnosticsEventCount = 0
    public private(set) var diagnosticsOperation: SettingsDiagnosticsOperation?
    public private(set) var diagnosticsIssue: SettingsDiagnosticsIssue?
    public private(set) var diagnosticsExportData: Data?
    public var isShowingCalibrationGuide = false
    public var calibrationReference = CalibrationReference.handheldMeter
    public var calibrationReferenceEV100Text = ""
    public var calibrationReferenceDetail = ""
    public private(set) var calibrationSample: SettingsCalibrationSample?

    @ObservationIgnored private let client: any SettingsAuthenticationClient
    @ObservationIgnored private let sessionID: OAuthSessionID
    @ObservationIgnored private let onSessionChange: SessionChangeHandler
    @ObservationIgnored private let calibrationManager: any SettingsCalibrationManaging
    @ObservationIgnored private let diagnosticsRecorder: any DiagnosticsRecording
    @ObservationIgnored private let onCalibrationStateChange: CalibrationStateChangeHandler
    @ObservationIgnored private let now: @MainActor @Sendable () -> Date
    @ObservationIgnored private var operationTask: Task<Void, Never>?
    @ObservationIgnored private var operationID = UUID()

    public init(
        client: any SettingsAuthenticationClient,
        sessionID: OAuthSessionID,
        onSessionChange: @escaping SessionChangeHandler = { _ in },
        calibrationManager: any SettingsCalibrationManaging = DefaultSettingsCalibrationManager(
            store: InMemoryCalibrationProfileStore(),
            applier: DiscardingMeterCalibrationApplier(),
            sampleSource: UnavailableSettingsCalibrationSampleSource()
        ),
        diagnosticsRecorder: any DiagnosticsRecording = UnavailableSettingsDiagnosticsRecorder(),
        onCalibrationStateChange: @escaping CalibrationStateChangeHandler = { _ in },
        now: @escaping @MainActor @Sendable () -> Date = Date.init
    ) {
        self.client = client
        self.sessionID = sessionID
        self.onSessionChange = onSessionChange
        self.calibrationManager = calibrationManager
        self.diagnosticsRecorder = diagnosticsRecorder
        self.onCalibrationStateChange = onCalibrationStateChange
        self.now = now
    }

    public var canSignIn: Bool {
        operation == nil && session == nil
            && !identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var selectedCalibration: CalibrationProfile? {
        calibrationProfiles.first { $0.id == selectedCalibrationID }
    }

    public var canSaveCalibration: Bool {
        calibrationSample != nil && parsedCalibrationReferenceEV100 != nil
            && calibrationOperation == nil
    }

    public func driftStatus(for profile: CalibrationProfile) -> SettingsCalibrationDriftStatus {
        SettingsCalibrationDriftStatus.status(for: profile, at: now())
    }

    public func loadCalibrations() async {
        guard beginCalibrationOperation(.loading) else { return }
        defer { calibrationOperation = nil }
        do {
            applyCalibrationState(try await calibrationManager.loadCalibrationState())
            calibrationIssue = nil
        } catch is CancellationError {
            return
        } catch {
            calibrationIssue = Self.presentCalibration(error)
        }
    }

    @discardableResult
    public func reconcileCalibrationRecords(
        _ records: [SettingsCalibrationRemoteRecord],
        device: SettingsCalibrationDeviceContext
    ) async -> SettingsCalibrationReconciliation? {
        guard beginCalibrationOperation(.loading) else { return nil }
        defer { calibrationOperation = nil }
        do {
            let result = try await calibrationManager.reconcileCalibrationRecords(
                records,
                device: device
            )
            try Task.checkCancellation()
            applyCalibrationState(result.state)
            calibrationIssue = nil
            return result
        } catch is CancellationError {
            return nil
        } catch {
            calibrationIssue = Self.presentCalibration(error)
            return nil
        }
    }

    public func startCalibration(for profile: CalibrationProfile? = nil) {
        guard calibrationOperation == nil else { return }
        calibrationSample = nil
        if let reference = profile?.reference {
            calibrationReference =
                switch reference {
                case .sunny16: .sunny16
                case .handheldMeter: .handheldMeter
                case .knownTarget: .knownTarget
                case .factory, .manufacturerSpecification: .handheldMeter
                }
        } else {
            calibrationReference = .handheldMeter
        }
        calibrationReferenceEV100Text = ""
        calibrationReferenceDetail = ""
        calibrationIssue = nil
        calibrationConfirmationMessage = nil
        isShowingCalibrationGuide = true
    }

    public func cancelCalibrationGuide() {
        guard calibrationOperation == nil else { return }
        calibrationSample = nil
        isShowingCalibrationGuide = false
    }

    public func captureCalibrationSample() async {
        guard beginCalibrationOperation(.capturing) else { return }
        defer { calibrationOperation = nil }
        do {
            let sample = try await calibrationManager.captureCalibrationSample()
            try Task.checkCancellation()
            calibrationSample = sample
            calibrationReferenceEV100Text = ""
            calibrationIssue = nil
        } catch is CancellationError {
            return
        } catch {
            calibrationIssue = Self.presentCalibration(error)
        }
    }

    public func saveCalibration() async {
        guard let sample = calibrationSample,
            let referenceEV100 = parsedCalibrationReferenceEV100,
            beginCalibrationOperation(.saving)
        else {
            if calibrationSample != nil {
                calibrationIssue = Self.presentCalibration(
                    SettingsCalibrationManagementError.invalidReferenceEV
                )
            }
            return
        }
        defer { calibrationOperation = nil }
        do {
            let state = try await calibrationManager.createCalibration(
                sample: sample,
                referenceEV100: referenceEV100,
                reference: calibrationReference,
                referenceDetail: calibrationReferenceDetail
            )
            try Task.checkCancellation()
            applyCalibrationState(state)
            calibrationSample = nil
            isShowingCalibrationGuide = false
            calibrationIssue = nil
            calibrationConfirmationMessage = "Calibration saved and applied"
        } catch is CancellationError {
            return
        } catch {
            calibrationIssue = Self.presentCalibration(error)
        }
    }

    public func selectCalibration(id: UUID?) async {
        guard beginCalibrationOperation(.selecting) else { return }
        defer { calibrationOperation = nil }
        do {
            let state = try await calibrationManager.selectCalibration(id: id)
            try Task.checkCancellation()
            applyCalibrationState(state)
            calibrationIssue = nil
            calibrationConfirmationMessage =
                id == nil ? "Calibration disabled" : "Calibration applied"
        } catch is CancellationError {
            return
        } catch {
            calibrationIssue = Self.presentCalibration(error)
        }
    }

    public func deleteCalibration(id: UUID) async {
        guard beginCalibrationOperation(.deleting) else { return }
        defer { calibrationOperation = nil }
        do {
            let state = try await calibrationManager.deleteCalibration(id: id)
            try Task.checkCancellation()
            applyCalibrationState(state)
            calibrationIssue = nil
            calibrationConfirmationMessage = "Calibration deleted"
        } catch is CancellationError {
            return
        } catch {
            calibrationIssue = Self.presentCalibration(error)
        }
    }

    public func dismissCalibrationIssue() {
        calibrationIssue = nil
    }

    public func dismissCalibrationConfirmation() {
        calibrationConfirmationMessage = nil
    }

    public func loadDiagnostics() async {
        guard diagnosticsOperation == nil else { return }
        diagnosticsOperation = .loading
        defer { diagnosticsOperation = nil }
        do {
            diagnosticsEnabled = await diagnosticsRecorder.isEnabled()
            diagnosticsEventCount =
                diagnosticsEnabled
                ? try await diagnosticsRecorder.events().count : 0
            if !diagnosticsEnabled { diagnosticsExportData = nil }
            diagnosticsIssue = nil
        } catch {
            diagnosticsIssue = SettingsDiagnosticsIssue(
                message: "Hypo could not read the local diagnostic history."
            )
        }
    }

    public func setDiagnosticsEnabled(_ enabled: Bool) async {
        guard diagnosticsOperation == nil, diagnosticsEnabled != enabled else { return }
        diagnosticsOperation = .updatingPreference
        defer { diagnosticsOperation = nil }
        do {
            try await diagnosticsRecorder.setEnabled(enabled)
            diagnosticsEnabled = enabled
            diagnosticsEventCount = enabled ? try await diagnosticsRecorder.events().count : 0
            if !enabled { diagnosticsExportData = nil }
            diagnosticsIssue = nil
        } catch {
            diagnosticsIssue = SettingsDiagnosticsIssue(
                message: "Hypo could not update the local diagnostics setting."
            )
        }
    }

    @discardableResult
    public func prepareDiagnosticsExport() async -> Bool {
        guard diagnosticsOperation == nil, diagnosticsEnabled else { return false }
        diagnosticsOperation = .exporting
        defer { diagnosticsOperation = nil }
        do {
            diagnosticsExportData = try await diagnosticsRecorder.export()
            diagnosticsEventCount = try await diagnosticsRecorder.events().count
            diagnosticsIssue = nil
            return true
        } catch {
            diagnosticsIssue = SettingsDiagnosticsIssue(
                message: "Hypo could not prepare the local diagnostic export."
            )
            return false
        }
    }

    public func deleteDiagnostics() async {
        guard diagnosticsOperation == nil else { return }
        diagnosticsOperation = .deleting
        defer { diagnosticsOperation = nil }
        do {
            try await diagnosticsRecorder.deleteAll()
            diagnosticsEventCount = 0
            diagnosticsExportData = nil
            diagnosticsIssue = nil
        } catch {
            diagnosticsIssue = SettingsDiagnosticsIssue(
                message: "Hypo could not delete the local diagnostic history."
            )
        }
    }

    public func dismissDiagnosticsIssue() {
        diagnosticsIssue = nil
    }

    public func restore() {
        guard operation == nil, session == nil else { return }
        start(.restoring) { [client, sessionID] in
            try await client.restore(sessionID: sessionID)
        }
    }

    public func signIn() {
        let identifier = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !identifier.isEmpty, operation == nil, session == nil else { return }
        start(.signingIn) { [client, sessionID] in
            try await client.signIn(identifier: identifier, sessionID: sessionID)
        }
    }

    public func refresh() {
        guard operation == nil, session != nil else { return }
        start(.refreshing) { [client, sessionID] in
            try await client.refresh(sessionID: sessionID)
        }
    }

    public func signOut() {
        guard operation == nil, session != nil else { return }
        let id = begin(.signingOut)
        operationTask = Task { [weak self, client, sessionID] in
            do {
                try await client.signOut(sessionID: sessionID)
                try Task.checkCancellation()
                self?.complete(id: id, session: nil)
            } catch is CancellationError {
                self?.finishCancellation(id: id)
            } catch {
                self?.fail(id: id, error: error)
            }
        }
    }

    public func cancelCurrentOperation() {
        operationID = UUID()
        operationTask?.cancel()
        operationTask = nil
        operation = nil
        authenticationError = nil
    }

    public func dismissError() {
        authenticationError = nil
    }

    /// Handles a callback delivered outside the active AuthenticationServices session.
    public func receiveExpiredCallback() {
        guard operation != .signingIn else { return }
        authenticationError = SettingsAuthenticationError(
            title: "Sign-in link expired",
            message: "Start sign-in again so Hypo can match the callback to this device."
        )
    }

    public func waitForCurrentOperation() async {
        let task = operationTask
        await task?.value
    }

    private func beginCalibrationOperation(_ operation: SettingsCalibrationOperation) -> Bool {
        guard calibrationOperation == nil else { return false }
        calibrationOperation = operation
        calibrationIssue = nil
        return true
    }

    private var parsedCalibrationReferenceEV100: Double? {
        let normalized =
            calibrationReferenceEV100Text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite else { return nil }
        return value
    }

    private func applyCalibrationState(_ state: SettingsCalibrationState) {
        selectedCalibrationID = state.selectedID
        calibrationProfiles = state.profiles.sorted { lhs, rhs in
            let lhsSelected = lhs.id == state.selectedID
            let rhsSelected = rhs.id == state.selectedID
            if lhsSelected != rhsSelected { return lhsSelected }

            let lhsDue = lhs.needsDriftCheck(at: now())
            let rhsDue = rhs.needsDriftCheck(at: now())
            if lhsDue != rhsDue { return lhsDue }
            return lhs.createdAt > rhs.createdAt
        }
        onCalibrationStateChange(state)
    }

    private func start(
        _ operation: SettingsAuthenticationOperation,
        action: @escaping @Sendable () async throws -> OAuthSession?
    ) {
        let id = begin(operation)
        operationTask = Task { [weak self] in
            do {
                let session = try await action()
                try Task.checkCancellation()
                self?.complete(id: id, session: session)
            } catch is CancellationError {
                self?.finishCancellation(id: id)
            } catch {
                self?.fail(id: id, error: error)
            }
        }
    }

    private func begin(_ operation: SettingsAuthenticationOperation) -> UUID {
        let id = UUID()
        operationID = id
        self.operation = operation
        authenticationError = nil
        return id
    }

    private func complete(id: UUID, session: OAuthSession?) {
        guard operationID == id else { return }
        operationTask = nil
        operation = nil
        self.session = session
        onSessionChange(session)
    }

    private func finishCancellation(id: UUID) {
        guard operationID == id else { return }
        operationTask = nil
        operation = nil
    }

    private func fail(id: UUID, error: Error) {
        guard operationID == id else { return }
        operationTask = nil
        operation = nil
        authenticationError = Self.present(error)
    }

    private static func present(_ error: Error) -> SettingsAuthenticationError {
        if let error = error as? OAuthBrowserPresentationError {
            switch error {
            case .cancelled:
                return SettingsAuthenticationError(
                    title: "Sign-in cancelled",
                    message: "No account information was saved."
                )
            case .authorizationAlreadyInProgress:
                return SettingsAuthenticationError(
                    title: "Sign-in already open",
                    message: "Finish or close the current sign-in window before trying again."
                )
            case .httpsCallbackRequiresIOS17_4:
                return SettingsAuthenticationError(
                    title: "Update iOS to sign in",
                    message: "This account callback requires iOS 17.4 or later."
                )
            case .invalidCallbackURI, .missingCallback, .presentationFailed:
                return SettingsAuthenticationError(
                    title: "Sign-in could not finish",
                    message: "Close the sign-in window, check your connection, and try again."
                )
            }
        }
        if let error = error as? OAuthCallbackValidationError {
            switch error {
            case .authorizationError(let code, let description):
                return SettingsAuthenticationError(
                    title: "Access was not granted",
                    message: description ?? "The authorization server returned \(code)."
                )
            default:
                return SettingsAuthenticationError(
                    title: "Sign-in response did not match",
                    message: "Start sign-in again. Hypo rejected a callback it could not verify."
                )
            }
        }
        if let error = error as? OAuthFlowCoordinatorError {
            switch error {
            case .subjectMismatch:
                return SettingsAuthenticationError(
                    title: "A different account responded",
                    message: "Sign in with the same handle or DID you entered in Hypo."
                )
            case .missingRefreshToken, .missingStoredScope, .missingDPoPKey, .missingPDS,
                .sessionNotFound, .sessionIdentifierMismatch:
                return SettingsAuthenticationError(
                    title: "Sign in again",
                    message: "The saved session is incomplete and cannot be refreshed."
                )
            default:
                return SettingsAuthenticationError(
                    title: "Account connection failed",
                    message: "Check the account identifier and your connection, then try again."
                )
            }
        }
        if error is ATProtoIdentityResolutionError {
            return SettingsAuthenticationError(
                title: "Account not found",
                message: "Enter a full handle such as alice.example, or an account DID."
            )
        }
        return SettingsAuthenticationError(
            title: "Account connection failed",
            message: "Check your connection and try again."
        )
    }

    private static func presentCalibration(_ error: Error) -> SettingsCalibrationIssue {
        if let error = error as? SettingsCalibrationManagementError {
            switch error {
            case .calibrationUnavailable:
                return SettingsCalibrationIssue(
                    title: "Meter is not ready",
                    message: "Open Meter once, allow camera access, and try calibration again."
                )
            case .invalidReferenceEV:
                return SettingsCalibrationIssue(
                    title: "Check the reference value",
                    message: "Enter a finite EV 100 value reported by the reference."
                )
            case .profileNotFound:
                return SettingsCalibrationIssue(
                    title: "Calibration changed",
                    message: "Reload the profiles and try again."
                )
            case .invalidSample, .sampleAlreadyCalibrated:
                return SettingsCalibrationIssue(
                    title: "Reading could not be used",
                    message: "Hypo needs an uncorrected reading. Measure the target again under steady light."
                )
            }
        }
        return SettingsCalibrationIssue(
            title: "Calibration could not be updated",
            message: "The existing profile is unchanged. Check the connection and try again."
        )
    }
}
