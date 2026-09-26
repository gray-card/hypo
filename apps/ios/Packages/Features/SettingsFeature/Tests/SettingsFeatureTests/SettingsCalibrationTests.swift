import ATProtoClient
import Foundation
import HypoLexicon
import MeterEngine
import MeterFeature
import PhotometryKit
import XCTest

@testable import SettingsFeature

private enum CalibrationTestError: Error {
    case writeFailed
}

@MainActor
private final class CalibrationSampleSourceFake: SettingsCalibrationSampleCapturing {
    var sample: SettingsCalibrationSample
    private(set) var captureCount = 0

    init(sample: SettingsCalibrationSample) {
        self.sample = sample
    }

    func captureCalibrationSample() -> SettingsCalibrationSample {
        captureCount += 1
        return sample
    }
}

private actor CalibrationRecordWriterFake: SettingsCalibrationRecordWriting {
    var error: Error?
    private(set) var stored: [SettingsCalibrationRecordWriteRequest] = []
    private(set) var deleted: [CalibrationProfile] = []

    func storeCalibrationProfile(_ request: SettingsCalibrationRecordWriteRequest) throws {
        if let error { throw error }
        stored.append(request)
    }

    func deleteCalibrationProfile(_ profile: CalibrationProfile) throws {
        if let error { throw error }
        deleted.append(profile)
    }

    func setError(_ error: Error?) { self.error = error }
    func storedRequests() -> [SettingsCalibrationRecordWriteRequest] { stored }
    func deletedProfiles() -> [CalibrationProfile] { deleted }
}

private actor CalibrationApplierFake: MeterCalibrationApplying {
    private(set) var appliedIDs: [UUID?] = []

    func applyCalibration(_ profile: CalibrationProfile?) {
        appliedIDs.append(profile?.id)
    }

    func receivedIDs() -> [UUID?] { appliedIDs }
}

private actor CalibrationAuthenticationClientFake: SettingsAuthenticationClient {
    func signIn(identifier: String, sessionID: OAuthSessionID) async throws -> OAuthSession {
        throw CalibrationTestError.writeFailed
    }

    func restore(sessionID: OAuthSessionID) async throws -> OAuthSession? { nil }

    func refresh(sessionID: OAuthSessionID) async throws -> OAuthSession {
        throw CalibrationTestError.writeFailed
    }

    func signOut(sessionID: OAuthSessionID) async throws {}
}

private actor CalibrationMeterServiceFake: MeterService {
    let reading: Reading

    init(reading: Reading) {
        self.reading = reading
    }

    func readings(configuration _: MeterConfiguration) async throws
        -> AsyncThrowingStream<Reading, any Error>
    {
        AsyncThrowingStream { continuation in
            continuation.yield(reading)
            continuation.finish()
        }
    }

    func capture(configuration _: MeterConfiguration) async throws -> Reading { reading }
}

@MainActor
final class SettingsCalibrationTests: XCTestCase, @unchecked Sendable {
    private let now = Date(timeIntervalSince1970: 2_000_000_000)

    func testManagerCreatesSelectsAndDurablyWritesOnePointProfile() async throws {
        let store = InMemoryCalibrationProfileStore()
        let applier = CalibrationApplierFake()
        let source = CalibrationSampleSourceFake(sample: sample(measuredEV100: 11.25))
        let writer = CalibrationRecordWriterFake()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: applier,
            sampleSource: source,
            recordWriter: writer,
            now: { self.now }
        )

        let captured = try await manager.captureCalibrationSample()
        let state = try await manager.createCalibration(
            sample: captured,
            referenceEV100: 12,
            reference: .handheldMeter,
            referenceDetail: "  Sekonic L-758DR  "
        )

        let profile = try XCTUnwrap(state.profiles.first)
        XCTAssertEqual(profile.constantOffsetStops, 0.75, accuracy: 0.000_001)
        XCTAssertEqual(profile.createdAt, now)
        XCTAssertEqual(
            profile.nextDriftCheckAt,
            now.addingTimeInterval(180 * 24 * 60 * 60)
        )
        XCTAssertEqual(state.selectedID, profile.id)
        let storedRequests = await writer.storedRequests()
        let appliedIDs = await applier.receivedIDs()
        let persistedState = await store.loadCalibrationProfileState()
        XCTAssertEqual(
            storedRequests,
            [
                SettingsCalibrationRecordWriteRequest(
                    profile: profile,
                    referenceDetail: "Sekonic L-758DR"
                )
            ]
        )
        XCTAssertEqual(appliedIDs, [profile.id])
        XCTAssertEqual(persistedState.selectedID, profile.id)
    }

    func testManagerRollsBackLocalCreateWhenDurableWriterFails() async throws {
        let existing = try profile(id: UUID(), createdAt: now.addingTimeInterval(-100))
        let store = InMemoryCalibrationProfileStore(
            state: CalibrationProfileState(profiles: [existing], selectedID: existing.id)
        )
        let writer = CalibrationRecordWriterFake()
        await writer.setError(CalibrationTestError.writeFailed)
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample()),
            recordWriter: writer,
            now: { self.now }
        )

        do {
            _ = try await manager.createCalibration(
                sample: sample(),
                referenceEV100: 13,
                reference: .knownTarget
            )
            XCTFail("Expected the record writer to fail")
        } catch CalibrationTestError.writeFailed {
            // Expected.
        }

        let persistedState = await store.loadCalibrationProfileState()
        XCTAssertEqual(
            persistedState,
            CalibrationProfileState(profiles: [existing], selectedID: existing.id)
        )
    }

    func testDeletingSelectedProfileClearsAppliedCalibration() async throws {
        let existing = try profile(id: UUID(), createdAt: now)
        let store = InMemoryCalibrationProfileStore(
            state: CalibrationProfileState(profiles: [existing], selectedID: existing.id)
        )
        let applier = CalibrationApplierFake()
        let writer = CalibrationRecordWriterFake()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: applier,
            sampleSource: CalibrationSampleSourceFake(sample: sample()),
            recordWriter: writer
        )

        let state = try await manager.deleteCalibration(id: existing.id)

        XCTAssertTrue(state.profiles.isEmpty)
        XCTAssertNil(state.selectedID)
        let deletedProfiles = await writer.deletedProfiles()
        let appliedIDs = await applier.receivedIDs()
        XCTAssertEqual(deletedProfiles, [existing])
        XCTAssertEqual(appliedIDs, [nil])
    }

    func testManagerRejectsMissingProfileAndInvalidSample() async throws {
        let manager = DefaultSettingsCalibrationManager(
            store: InMemoryCalibrationProfileStore(),
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(
                sample: sample(measuredEV100: .infinity)
            )
        )

        do {
            _ = try await manager.captureCalibrationSample()
            XCTFail("Expected an invalid sample")
        } catch SettingsCalibrationManagementError.invalidSample {
            // Expected.
        }

        do {
            _ = try await manager.selectCalibration(id: UUID())
            XCTFail("Expected a missing profile")
        } catch SettingsCalibrationManagementError.profileNotFound {
            // Expected.
        }
    }

    func testLiveReadingConversionRejectsAnAlreadyCalibratedValue() throws {
        let camera = CameraDescriptor(id: "wide", name: "Wide", module: .wide)
        let uncorrected = Reading(
            takenAt: now,
            geometry: .reflectedAverage,
            ev100: ExposureValue(11.5),
            camera: camera,
            sensorPath: .aeMetadata,
            accuracyTier: .unknown,
            calibrationConstant: 12.5
        )
        let sample = try SettingsCalibrationSample(
            uncorrected: uncorrected,
            deviceModel: "iPhone Test"
        )
        XCTAssertEqual(sample.measuredEV100, 11.5)
        XCTAssertEqual(sample.identity.cameraID, "wide")

        let calibrated = Reading(
            takenAt: now,
            geometry: .reflectedAverage,
            ev100: ExposureValue(12),
            camera: camera,
            sensorPath: .aeMetadata,
            accuracyTier: .calibrated,
            calibrationID: UUID(),
            calibrationConstant: 12.5
        )
        XCTAssertThrowsError(
            try SettingsCalibrationSample(
                uncorrected: calibrated,
                deviceModel: "iPhone Test"
            )
        ) { error in
            XCTAssertEqual(
                error as? SettingsCalibrationManagementError,
                .sampleAlreadyCalibrated
            )
        }
    }

    func testMeterFeatureSampleSourceTemporarilyDisablesAndRestoresCalibration() async throws {
        let existing = try profile(id: UUID(), createdAt: now)
        let store = InMemoryCalibrationProfileStore(
            state: CalibrationProfileState(profiles: [existing], selectedID: existing.id)
        )
        let applier = CalibrationApplierFake()
        let camera = CameraDescriptor(id: "wide", name: "Wide", module: .wide)
        let reading = Reading(
            takenAt: now,
            geometry: .reflectedAverage,
            ev100: ExposureValue(11.5),
            camera: camera,
            sensorPath: .aeMetadata,
            accuracyTier: .unknown,
            calibrationConstant: 12.5
        )
        let meterModel = MeterFeatureModel(
            service: CalibrationMeterServiceFake(reading: reading),
            calibrationStore: store,
            calibrationApplier: applier,
            deviceModelName: "iPhone Test"
        )
        await meterModel.loadDurableState()
        let source = MeterFeatureSettingsCalibrationSampleSource(
            model: meterModel,
            deviceModel: "iPhone Test"
        )

        let captured = try await source.captureCalibrationSample()

        XCTAssertEqual(captured.measuredEV100, 11.5)
        XCTAssertEqual(meterModel.selectedCalibrationID, existing.id)
        let appliedIDs = await applier.receivedIDs()
        XCTAssertEqual(appliedIDs, [existing.id, nil, existing.id])
    }

    func testModelGuidesCaptureSaveAndSortsSelectedProfileFirst() async throws {
        let oldDue = try profile(
            id: UUID(),
            createdAt: now.addingTimeInterval(-1_000),
            nextDriftCheckAt: now.addingTimeInterval(-1)
        )
        let store = InMemoryCalibrationProfileStore(
            state: CalibrationProfileState(profiles: [oldDue], selectedID: nil)
        )
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample(measuredEV100: 10)),
            now: { self.now }
        )
        var publishedStates: [SettingsCalibrationState] = []
        let model = SettingsFeatureModel(
            client: CalibrationAuthenticationClientFake(),
            sessionID: OAuthSessionID(rawValue: "calibration-test"),
            calibrationManager: manager,
            onCalibrationStateChange: { publishedStates.append($0) },
            now: { self.now }
        )

        await model.loadCalibrations()
        XCTAssertEqual(model.calibrationProfiles, [oldDue])
        XCTAssertEqual(model.driftStatus(for: oldDue), .due(since: now.addingTimeInterval(-1)))

        model.startCalibration(for: oldDue)
        XCTAssertTrue(model.isShowingCalibrationGuide)
        XCTAssertEqual(model.calibrationReference, oldDue.reference)
        await model.captureCalibrationSample()
        XCTAssertNotNil(model.calibrationSample)
        XCTAssertFalse(model.canSaveCalibration)

        model.calibrationReferenceEV100Text = "10,67"
        XCTAssertTrue(model.canSaveCalibration)
        await model.saveCalibration()

        XCTAssertFalse(model.isShowingCalibrationGuide)
        XCTAssertEqual(model.calibrationConfirmationMessage, "Calibration saved and applied")
        XCTAssertEqual(model.calibrationProfiles.first?.id, model.selectedCalibrationID)
        XCTAssertEqual(publishedStates.count, 2)
    }

    func testDriftStatusDistinguishesDueScheduledAndUnscheduled() throws {
        let due = try profile(
            id: UUID(),
            createdAt: now,
            nextDriftCheckAt: now.addingTimeInterval(-10)
        )
        let scheduled = try profile(
            id: UUID(),
            createdAt: now,
            nextDriftCheckAt: now.addingTimeInterval(10)
        )
        let unscheduled = try profile(
            id: UUID(),
            createdAt: now,
            nextDriftCheckAt: nil
        )

        XCTAssertEqual(
            SettingsCalibrationDriftStatus.status(for: due, at: now),
            .due(since: now.addingTimeInterval(-10))
        )
        XCTAssertEqual(
            SettingsCalibrationDriftStatus.status(for: scheduled, at: now),
            .scheduled(for: now.addingTimeInterval(10))
        )
        XCTAssertEqual(
            SettingsCalibrationDriftStatus.status(for: unscheduled, at: now),
            .notScheduled
        )
    }

    func testFreshInstallRestoresAndAppliesNewestMatchingRemoteProfile() async throws {
        let store = InMemoryCalibrationProfileStore()
        let applier = CalibrationApplierFake()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: applier,
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let older = try remoteRecord(
            rkey: "older",
            createdAt: now.addingTimeInterval(-100),
            offset: 0.1
        )
        let newer = try remoteRecord(rkey: "newer", createdAt: now, offset: 0.35)
        do {
            _ = try SettingsCalibrationRemoteDecoder.decode(
                newer,
                device: deviceContext(active: true),
                driftCheckInterval: 180 * 24 * 60 * 60
            )
        } catch {
            XCTFail("Expected the generated calibration record to decode: \(error)")
        }

        let result = try await manager.reconcileCalibrationRecords(
            [older, newer],
            device: deviceContext(active: true)
        )
        let appliedIDs = await applier.receivedIDs()
        let storedState = await store.loadCalibrationProfileState()

        XCTAssertEqual(result.state.profiles.count, 2)
        XCTAssertEqual(
            try XCTUnwrap(result.state.profiles.first).constantOffsetStops,
            0.35,
            accuracy: 0.000_001
        )
        XCTAssertEqual(result.state.selectedID, result.state.profiles.first?.id)
        XCTAssertEqual(appliedIDs, [result.state.selectedID])
        XCTAssertEqual(
            storedState,
            CalibrationProfileState(
                profiles: result.state.profiles,
                selectedID: result.state.selectedID
            )
        )
    }

    func testRemoteMergeDeduplicatesSemanticProfileAndRetainsValidSelection() async throws {
        let preciseCreatedAt = now.addingTimeInterval(0.000_4)
        let selected = try profile(id: UUID(), createdAt: preciseCreatedAt)
        let store = InMemoryCalibrationProfileStore(
            state: CalibrationProfileState(profiles: [selected], selectedID: selected.id)
        )
        let applier = CalibrationApplierFake()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: applier,
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let duplicate = try remoteRecord(
            rkey: "duplicate",
            createdAt: preciseCreatedAt,
            offset: 0.25
        )
        let foreign = try remoteRecord(
            rkey: "foreign",
            createdAt: now.addingTimeInterval(10),
            offset: 0.5,
            deviceModel: "iPhone Elsewhere"
        )

        let result = try await manager.reconcileCalibrationRecords(
            [foreign, duplicate],
            device: deviceContext(active: true)
        )
        let appliedIDs = await applier.receivedIDs()

        XCTAssertEqual(result.state.profiles.count, 2)
        XCTAssertEqual(result.state.selectedID, selected.id)
        XCTAssertEqual(
            result.state.profiles.filter { $0.createdAt == preciseCreatedAt }.map(\.id),
            [selected.id]
        )
        XCTAssertEqual(appliedIDs, [selected.id])
    }

    func testFreshInstallDoesNotSelectMismatchedRemoteProfile() async throws {
        let store = InMemoryCalibrationProfileStore()
        let applier = CalibrationApplierFake()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: applier,
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )

        let result = try await manager.reconcileCalibrationRecords(
            [
                try remoteRecord(
                    rkey: "other-device",
                    createdAt: now,
                    deviceModel: "iPhone Elsewhere"
                ),
                try remoteRecord(
                    rkey: "other-module",
                    createdAt: now.addingTimeInterval(1),
                    module: .telephoto
                ),
                try remoteRecord(
                    rkey: "other-path",
                    createdAt: now.addingTimeInterval(2),
                    sensorPath: .rawPatch
                ),
            ],
            device: deviceContext(active: true)
        )
        let appliedIDs = await applier.receivedIDs()

        XCTAssertEqual(result.state.profiles.count, 3)
        XCTAssertNil(result.state.selectedID)
        XCTAssertEqual(appliedIDs, [nil])
        XCTAssertTrue(
            result.state.profiles.contains { $0.identity.cameraID.hasPrefix("remote:") }
        )
    }

    func testMalformedRemoteRecordsAreSkippedWithoutLosingValidProfiles() async throws {
        let manager = DefaultSettingsCalibrationManager(
            store: InMemoryCalibrationProfileStore(),
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let missingDevice = try remoteRecord(
            rkey: "missing-device",
            createdAt: now,
            deviceModel: nil
        )
        let invalidJSON = SettingsCalibrationRemoteRecord(
            uri: "at://did:plc:test/app.graycard.meter.calibration/invalid-json",
            value: Data("not-json".utf8)
        )
        let valid = try remoteRecord(rkey: "valid", createdAt: now)

        let result = try await manager.reconcileCalibrationRecords(
            [invalidJSON, valid, missingDevice],
            device: deviceContext(active: false)
        )

        XCTAssertEqual(result.skippedMalformedRecordCount, 2)
        XCTAssertEqual(result.state.profiles.count, 1)
    }

    func testRemoteRefreshIsIdempotent() async throws {
        let store = InMemoryCalibrationProfileStore()
        let manager = DefaultSettingsCalibrationManager(
            store: store,
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let record = try remoteRecord(rkey: "stable", createdAt: now)
        let first = try await manager.reconcileCalibrationRecords(
            [record],
            device: deviceContext(active: true)
        )
        let second = try await manager.reconcileCalibrationRecords(
            [record],
            device: deviceContext(active: true)
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.state.profiles.map(\.id), second.state.profiles.map(\.id))
    }

    func testWireProjectionMatchesRestoredProfileForDurableDeletion() async throws {
        let manager = DefaultSettingsCalibrationManager(
            store: InMemoryCalibrationProfileStore(),
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let record = try remoteRecord(rkey: "remote-key", createdAt: now, offset: 0.4)
        let restored = try await manager.reconcileCalibrationRecords(
            [record],
            device: deviceContext(active: true)
        )
        let profile = try XCTUnwrap(restored.state.profiles.first)

        XCTAssertTrue(SettingsCalibrationRecordProjection.isSemanticallyEquivalent(record, to: profile))
        XCTAssertFalse(
            SettingsCalibrationRecordProjection.isSemanticallyEquivalent(
                record,
                to: try self.profile(id: UUID(), createdAt: now)
            )
        )
    }

    func testGeneratedFactoryReferenceValuesRemainDistinctWhenRestored() async throws {
        let manager = DefaultSettingsCalibrationManager(
            store: InMemoryCalibrationProfileStore(),
            applier: CalibrationApplierFake(),
            sampleSource: CalibrationSampleSourceFake(sample: sample())
        )
        let result = try await manager.reconcileCalibrationRecords(
            [
                try remoteRecord(
                    rkey: "factory",
                    createdAt: now,
                    reference: .factory
                ),
                try remoteRecord(
                    rkey: "manufacturer",
                    createdAt: now.addingTimeInterval(1),
                    reference: .manufacturerSpec
                ),
            ],
            device: deviceContext(active: false)
        )

        XCTAssertEqual(
            Set(result.state.profiles.map(\.reference)),
            [.factory, .manufacturerSpecification]
        )
    }

    private func sample(measuredEV100: Double = 12) -> SettingsCalibrationSample {
        SettingsCalibrationSample(
            measuredEV100: measuredEV100,
            identity: CalibrationIdentity(
                deviceModel: "iPhone Test",
                cameraID: "back-wide",
                module: .wide,
                sensorPath: .aeMetadata
            ),
            capturedAt: now
        )
    }

    private func profile(
        id: UUID,
        createdAt: Date,
        nextDriftCheckAt: Date? = nil
    ) throws -> CalibrationProfile {
        try CalibrationProfile(
            id: id,
            identity: sample().identity,
            reference: .handheldMeter,
            createdAt: createdAt,
            nextDriftCheckAt: nextDriftCheckAt,
            constantOffsetStops: 0.25,
            validatedEVRange: 12...12
        )
    }

    private func deviceContext(active: Bool) -> SettingsCalibrationDeviceContext {
        let camera = CameraDescriptor(id: "back-wide", name: "Wide", module: .wide)
        return SettingsCalibrationDeviceContext(
            deviceModel: "iPhone Test",
            cameras: [camera],
            activeIdentity: active
                ? CalibrationIdentity(
                    deviceModel: "iPhone Test",
                    cameraID: camera.id,
                    module: camera.module,
                    sensorPath: .aeMetadata
                )
                : nil
        )
    }

    private func remoteRecord(
        rkey: String,
        createdAt: Date,
        offset: Double = 0.25,
        deviceModel: String? = "iPhone Test",
        module: AppGraycardMeterDefsCameraModule = .wide,
        sensorPath: AppGraycardMeterDefsSensorPath = .aeMetadata,
        reference: AppGraycardMeterDefsCalibrationReference = .referenceMeter
    ) throws -> SettingsCalibrationRemoteRecord {
        let record = AppGraycardMeterCalibrationMain(
            meter: try ATURI("at://did:plc:test/app.graycard.instance.meter/phone"),
            createdAt: ATProtoDate(createdAt),
            cameraModule: module,
            sensorPath: sensorPath,
            reference: reference,
            offsetStops: measure(offset, unit: "stops"),
            constantK: measure(12.5, unit: "cd·s/(m2·ISO)"),
            constantCFlat: measure(250, unit: "lx·s/ISO"),
            validEvMin: measure(12, unit: "EV"),
            validEvMax: measure(12, unit: "EV"),
            deviceModel: deviceModel
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SettingsCalibrationRemoteRecord(
            uri: "at://did:plc:test/app.graycard.meter.calibration/\(rkey)",
            value: try encoder.encode(record)
        )
    }

    private func measure(_ value: Double, unit: String) -> AppGraycardDefsMeasure {
        AppGraycardDefsMeasure(
            value: Int((value * 10_000).rounded()),
            unit: unit,
            scale: 4
        )
    }
}
