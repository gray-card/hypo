import Foundation
import MeterEngine
import MeterFeature
import PhotometryKit

public struct SettingsCalibrationSample: Hashable, Sendable {
    public let measuredEV100: Double
    public let identity: CalibrationIdentity
    public let capturedAt: Date

    public init(
        measuredEV100: Double,
        identity: CalibrationIdentity,
        capturedAt: Date
    ) {
        self.measuredEV100 = measuredEV100
        self.identity = identity
        self.capturedAt = capturedAt
    }

    /// Converts a live meter result only when no calibration was applied to it.
    public init(uncorrected reading: Reading, deviceModel: String) throws {
        guard reading.calibrationID == nil else {
            throw SettingsCalibrationManagementError.sampleAlreadyCalibrated
        }
        self.init(
            measuredEV100: reading.ev100.rawValue,
            identity: CalibrationIdentity(
                deviceModel: deviceModel,
                cameraID: reading.camera.id,
                module: reading.camera.module,
                sensorPath: reading.sensorPath
            ),
            capturedAt: reading.takenAt
        )
    }
}

public struct SettingsCalibrationState: Hashable, Sendable {
    public var profiles: [CalibrationProfile]
    public var selectedID: UUID?

    public init(profiles: [CalibrationProfile] = [], selectedID: UUID? = nil) {
        self.profiles = profiles
        self.selectedID = selectedID
    }

    fileprivate init(_ state: CalibrationProfileState) {
        profiles = state.profiles
        selectedID = state.selectedID
    }

    fileprivate var meterFeatureState: CalibrationProfileState {
        CalibrationProfileState(profiles: profiles, selectedID: selectedID)
    }
}

public enum SettingsCalibrationManagementError: Error, Equatable, Sendable {
    case calibrationUnavailable
    case invalidReferenceEV
    case profileNotFound
    case invalidSample
    case sampleAlreadyCalibrated
}

@MainActor
public protocol SettingsCalibrationSampleCapturing: Sendable {
    /// Captures an uncorrected reading and the exact device/module/sensor-path identity it used.
    func captureCalibrationSample() async throws -> SettingsCalibrationSample
}

public struct SettingsCalibrationRecordWriteRequest: Hashable, Sendable {
    public let profile: CalibrationProfile
    public let referenceDetail: String?

    public init(profile: CalibrationProfile, referenceDetail: String? = nil) {
        self.profile = profile
        self.referenceDetail = referenceDetail
    }
}

public protocol SettingsCalibrationRecordWriting: Sendable {
    /// Returns only after the profile create is durable locally or in the sync outbox.
    func storeCalibrationProfile(_ request: SettingsCalibrationRecordWriteRequest) async throws

    /// Returns only after the profile deletion is durable locally or in the sync outbox.
    func deleteCalibrationProfile(_ profile: CalibrationProfile) async throws
}

public struct LocalOnlySettingsCalibrationRecordWriter: SettingsCalibrationRecordWriting {
    public init() {}

    public func storeCalibrationProfile(_: SettingsCalibrationRecordWriteRequest) async throws {}
    public func deleteCalibrationProfile(_: CalibrationProfile) async throws {}
}

public protocol SettingsCalibrationManaging: Sendable {
    func loadCalibrationState() async throws -> SettingsCalibrationState
    func reconcileCalibrationRecords(
        _ records: [SettingsCalibrationRemoteRecord],
        device: SettingsCalibrationDeviceContext
    ) async throws -> SettingsCalibrationReconciliation
    func captureCalibrationSample() async throws -> SettingsCalibrationSample
    func selectCalibration(id: UUID?) async throws -> SettingsCalibrationState
    func createCalibration(
        sample: SettingsCalibrationSample,
        referenceEV100: Double,
        reference: CalibrationReference,
        referenceDetail: String?
    ) async throws -> SettingsCalibrationState
    func deleteCalibration(id: UUID) async throws -> SettingsCalibrationState
}

public struct UnavailableSettingsCalibrationSampleSource: SettingsCalibrationSampleCapturing {
    public init() {}

    public func captureCalibrationSample() async throws -> SettingsCalibrationSample {
        throw SettingsCalibrationManagementError.calibrationUnavailable
    }
}

/// Bridges the existing Meter feature into the guided flow while guaranteeing that the captured
/// comparison has not already been corrected by the profile under test.
@MainActor
public final class MeterFeatureSettingsCalibrationSampleSource:
    SettingsCalibrationSampleCapturing
{
    private let model: MeterFeatureModel
    private let deviceModel: String

    public init(model: MeterFeatureModel, deviceModel: String) {
        self.model = model
        self.deviceModel = deviceModel
    }

    public func captureCalibrationSample() async throws -> SettingsCalibrationSample {
        let previousCalibrationID = model.selectedCalibrationID
        let previousReadingID = model.reading?.id
        await model.selectCalibration(id: nil)
        await model.measure()

        let result: Result<SettingsCalibrationSample, any Error>
        if let reading = model.reading, reading.id != previousReadingID {
            do {
                result = .success(
                    try SettingsCalibrationSample(
                        uncorrected: reading,
                        deviceModel: deviceModel
                    )
                )
            } catch {
                result = .failure(error)
            }
        } else {
            result = .failure(SettingsCalibrationManagementError.calibrationUnavailable)
        }

        if let previousCalibrationID {
            await model.selectCalibration(id: previousCalibrationID)
        }
        return try result.get()
    }
}

public actor DefaultSettingsCalibrationManager: SettingsCalibrationManaging {
    private let store: any CalibrationProfileStoring
    private let applier: any MeterCalibrationApplying
    private let sampleSource: any SettingsCalibrationSampleCapturing
    private let recordWriter: any SettingsCalibrationRecordWriting
    private let now: @Sendable () -> Date
    private let driftCheckInterval: TimeInterval?

    public init(
        store: any CalibrationProfileStoring,
        applier: any MeterCalibrationApplying,
        sampleSource: any SettingsCalibrationSampleCapturing,
        recordWriter: any SettingsCalibrationRecordWriting =
            LocalOnlySettingsCalibrationRecordWriter(),
        driftCheckInterval: TimeInterval? = 180 * 24 * 60 * 60,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.store = store
        self.applier = applier
        self.sampleSource = sampleSource
        self.recordWriter = recordWriter
        self.driftCheckInterval = driftCheckInterval
        self.now = now
    }

    public func loadCalibrationState() async throws -> SettingsCalibrationState {
        let state = normalized(try await store.loadCalibrationProfileState())
        await applier.applyCalibration(selectedProfile(in: state))
        return SettingsCalibrationState(state)
    }

    public func reconcileCalibrationRecords(
        _ records: [SettingsCalibrationRemoteRecord],
        device: SettingsCalibrationDeviceContext
    ) async throws -> SettingsCalibrationReconciliation {
        let previous = normalized(try await store.loadCalibrationProfileState())
        let wasFreshInstall = previous.profiles.isEmpty && previous.selectedID == nil
        var profiles = previous.profiles
        var keys = Set(profiles.map(SettingsCalibrationRemoteDecoder.semanticKey))
        var matchingRemoteIDs: [UUID] = []
        var skipped = 0

        for record in records.sorted(by: { $0.uri < $1.uri }) {
            do {
                let decoded = try SettingsCalibrationRemoteDecoder.decode(
                    record,
                    device: device,
                    driftCheckInterval: driftCheckInterval
                )
                let key = SettingsCalibrationRemoteDecoder.semanticKey(decoded.profile)
                if keys.insert(key).inserted {
                    profiles.append(decoded.profile)
                }
                if decoded.matchesActiveIdentity {
                    let id = profiles.first {
                        SettingsCalibrationRemoteDecoder.semanticKey($0) == key
                    }?.id
                    if let id { matchingRemoteIDs.append(id) }
                }
            } catch {
                skipped += 1
            }
        }

        profiles.sort {
            if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
        let retainedSelection = previous.selectedID.flatMap { selectedID in
            profiles.contains(where: { $0.id == selectedID }) ? selectedID : nil
        }
        let matchingRemoteIDSet = Set(matchingRemoteIDs)
        let selectedID =
            retainedSelection
            ?? (wasFreshInstall ? profiles.first(where: { matchingRemoteIDSet.contains($0.id) })?.id : nil)
        let merged = CalibrationProfileState(profiles: profiles, selectedID: selectedID)
        if merged != previous {
            try await store.saveCalibrationProfileState(merged)
        }
        await applier.applyCalibration(selectedProfile(in: merged))
        return SettingsCalibrationReconciliation(
            state: SettingsCalibrationState(merged),
            skippedMalformedRecordCount: skipped
        )
    }

    public func captureCalibrationSample() async throws -> SettingsCalibrationSample {
        let sample = try await sampleSource.captureCalibrationSample()
        guard sample.measuredEV100.isFinite else {
            throw SettingsCalibrationManagementError.invalidSample
        }
        return sample
    }

    public func selectCalibration(id: UUID?) async throws -> SettingsCalibrationState {
        var state = normalized(try await store.loadCalibrationProfileState())
        if let id, !state.profiles.contains(where: { $0.id == id }) {
            throw SettingsCalibrationManagementError.profileNotFound
        }
        state.selectedID = id
        try await store.saveCalibrationProfileState(state)
        await applier.applyCalibration(selectedProfile(in: state))
        return SettingsCalibrationState(state)
    }

    public func createCalibration(
        sample: SettingsCalibrationSample,
        referenceEV100: Double,
        reference: CalibrationReference,
        referenceDetail: String? = nil
    ) async throws -> SettingsCalibrationState {
        guard sample.measuredEV100.isFinite else {
            throw SettingsCalibrationManagementError.invalidSample
        }
        guard referenceEV100.isFinite else {
            throw SettingsCalibrationManagementError.invalidReferenceEV
        }

        let profile = try CalibrationBuilder.constantOffsetProfile(
            identity: sample.identity,
            reference: reference,
            observations: [
                CalibrationObservation(
                    measuredEV100: ExposureValue(sample.measuredEV100),
                    referenceEV100: ExposureValue(referenceEV100)
                )
            ],
            createdAt: now(),
            driftCheckInterval: driftCheckInterval
        )
        let previous = normalized(try await store.loadCalibrationProfileState())
        var proposed = previous
        proposed.profiles.removeAll { $0.id == profile.id }
        proposed.profiles.append(profile)
        proposed.selectedID = profile.id

        try await recordWriter.storeCalibrationProfile(
            SettingsCalibrationRecordWriteRequest(
                profile: profile,
                referenceDetail: normalizedReferenceDetail(referenceDetail)
            )
        )
        try await store.saveCalibrationProfileState(proposed)
        await applier.applyCalibration(profile)
        return SettingsCalibrationState(proposed)
    }

    public func deleteCalibration(id: UUID) async throws -> SettingsCalibrationState {
        let previous = normalized(try await store.loadCalibrationProfileState())
        guard let profile = previous.profiles.first(where: { $0.id == id }) else {
            throw SettingsCalibrationManagementError.profileNotFound
        }
        var proposed = previous
        proposed.profiles.removeAll { $0.id == id }
        if proposed.selectedID == id {
            proposed.selectedID = nil
        }

        try await recordWriter.deleteCalibrationProfile(profile)
        try await store.saveCalibrationProfileState(proposed)
        await applier.applyCalibration(selectedProfile(in: proposed))
        return SettingsCalibrationState(proposed)
    }

    private func normalized(_ state: CalibrationProfileState) -> CalibrationProfileState {
        guard let selectedID = state.selectedID,
            state.profiles.contains(where: { $0.id == selectedID })
        else {
            return CalibrationProfileState(profiles: state.profiles, selectedID: nil)
        }
        return state
    }

    private func selectedProfile(in state: CalibrationProfileState) -> CalibrationProfile? {
        state.profiles.first { $0.id == state.selectedID }
    }

    private func normalizedReferenceDetail(_ detail: String?) -> String? {
        guard let detail else { return nil }
        let normalized = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : String(normalized.prefix(256))
    }
}

public enum SettingsCalibrationDriftStatus: Equatable, Sendable {
    case due(since: Date)
    case scheduled(for: Date)
    case notScheduled

    public static func status(
        for profile: CalibrationProfile,
        at date: Date
    ) -> SettingsCalibrationDriftStatus {
        guard let dueAt = profile.nextDriftCheckAt else { return .notScheduled }
        return date >= dueAt ? .due(since: dueAt) : .scheduled(for: dueAt)
    }
}
