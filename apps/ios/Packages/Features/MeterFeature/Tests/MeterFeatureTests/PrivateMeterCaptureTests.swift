import CryptoKit
import Foundation
import MeterEngine
import PhotometryKit
import Testing

@testable import MeterFeature

@MainActor
@Test func privateCaptureIsOffByDefaultAndPublicWriteDoesNotCollectTelemetry() async throws {
    let reading = try privateFixtureReading()
    let collector = RecordingPrivateCollector()
    let store = InMemoryPrivateMeterCaptureContextStore()
    let writer = PrivateBoundaryWriter()
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: reading),
        readingWriter: writer,
        privateCaptureCollector: collector,
        privateCaptureStore: store
    )

    await model.measure()

    #expect(await collector.requests.isEmpty)
    #expect(await store.contexts().isEmpty)
    let publicRequest = try #require(await writer.requests.first)
    #expect(publicRequest.reading == reading)
    #expect(publicRequest.deviceModelName == "Current device")
    #expect(
        Set(Mirror(reflecting: publicRequest).children.compactMap(\.label))
            == ["reading", "spotPoint", "deviceModelName", "requestedAt"]
    )
}

@MainActor
@Test func preciseLocationRequiresItsOwnOptIn() async throws {
    let reading = try privateFixtureReading()
    let collector = RecordingPrivateCollector()
    let store = InMemoryPrivateMeterCaptureContextStore()
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: reading),
        readingWriter: PrivateBoundaryWriter(),
        privateCaptureCollector: collector,
        privateCaptureStore: store,
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore()
    )

    await model.setPrivateCaptureEnabled(true)
    await model.measure()
    await model.flushPrivateCapturePersistence()
    #expect(await collector.requests.map(\.includesLocation) == [false])
    #expect(await store.contexts().first?.location == nil)

    await model.setPrivatePreciseLocationEnabled(true)
    await model.measure()
    await model.flushPrivateCapturePersistence()
    #expect(await collector.requests.map(\.includesLocation) == [false, true])
    #expect(await store.contexts().first?.location?.latitude == 39.3299)
}

@Test func privateCaptureFileIsEncryptedAndWrongKeyCannotOpenIt() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-encryption-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appending(path: "contexts.json")
    let key = SymmetricKey(size: .bits256)
    let context = try privateFixtureContext()
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(key: key)
    )

    try await store.save(context, syncToPrivateCloud: false)

    let bytes = try Data(contentsOf: file)
    let fileText = String(decoding: bytes, as: UTF8.self)
    #expect(!fileText.contains("39.3299"))
    #expect(!fileText.contains("test-device"))
    #expect(try await store.contexts() == [context])

    let wrongKeyStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider()
    )
    await #expect(throws: PrivateMeterCaptureError.corruptLocalStore) {
        _ = try await wrongKeyStore.contexts()
    }
}

@Test func privateContextKeepsReadingCollectionMotionAndLocationTimesDistinct() throws {
    let context = try privateFixtureContext()

    #expect(context.capturedAt == Date(timeIntervalSince1970: 1_800_000_000))
    #expect(context.motionSampledAt == Date(timeIntervalSince1970: 1_800_000_001))
    #expect(context.contextCollectedAt == Date(timeIntervalSince1970: 1_800_000_002))
    #expect(context.location?.capturedAt == Date(timeIntervalSince1970: 1_800_000_003))
}

@Test func privateContextDecodesPayloadsWrittenBeforeTimingFieldsWereAdded() throws {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let encoded = try encoder.encode(privateFixtureContext())
    var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    object["contextCollectedAt"] = nil
    object["motionSampledAt"] = nil
    let legacyData = try JSONSerialization.data(withJSONObject: object)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    let restored = try decoder.decode(PrivateMeterCaptureContext.self, from: legacyData)

    #expect(restored.contextCollectedAt == restored.capturedAt)
    #expect(restored.motionSampledAt == nil)
}

@MainActor
@Test func localKeyFailureDoesNotInvalidateThePublicMeterReading() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-key-failure-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appending(path: "contexts.json")
    let writer = PrivateBoundaryWriter()
    let collector = RecordingPrivateCollector()
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: FailingPrivateKeyProvider()
    )
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        readingWriter: writer,
        privateCaptureCollector: collector,
        privateCaptureStore: store,
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(
            settings: PrivateMeterCaptureSettings(captureEnabled: true)
        )
    )
    await model.loadDurableState()

    await model.measure()
    await model.flushPrivateCapturePersistence()

    #expect(await writer.requests.count == 1)
    #expect(model.errorMessage == nil)
    #expect(model.privateCaptureMessage?.contains("public reading was saved") == true)
    #expect(!FileManager.default.fileExists(atPath: file.path))
}

@Test func cloudConflictPolicyIsLastWriteWinsAndDeletionWinsAnExactTie() {
    let id = UUID(uuidString: "00000000-0000-0000-0000-000000000999")!
    let older = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: Date(timeIntervalSince1970: 10),
        modifiedAt: Date(timeIntervalSince1970: 20),
        encryptedPayload: Data([1])
    )
    let newer = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: older.capturedAt,
        modifiedAt: Date(timeIntervalSince1970: 21),
        encryptedPayload: Data([2])
    )
    let tiedDeletion = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: older.capturedAt,
        modifiedAt: older.modifiedAt,
        isDeleted: true,
        encryptedPayload: Data()
    )

    #expect(PrivateMeterCaptureCloudConflictPolicy.shouldReplace(existing: older, with: newer))
    #expect(!PrivateMeterCaptureCloudConflictPolicy.shouldReplace(existing: newer, with: older))
    #expect(
        PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
            existing: older,
            with: tiedDeletion
        )
    )
}

@Test func tombstonesDominateClockSkewAndEqualTimeLiveValuesConvergeDeterministically() {
    let id = UUID(uuidString: "00000000-0000-0000-0000-000000000991")!
    let futureLive = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: Date(timeIntervalSince1970: 1),
        modifiedAt: Date(timeIntervalSince1970: 9_999),
        encryptedPayload: Data([1])
    )
    let pastDeletion = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: futureLive.capturedAt,
        modifiedAt: Date(timeIntervalSince1970: 2),
        isDeleted: true,
        encryptedPayload: Data()
    )
    #expect(
        PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
            existing: futureLive,
            with: pastDeletion
        )
    )
    #expect(
        !PrivateMeterCaptureCloudConflictPolicy.shouldReplace(
            existing: pastDeletion,
            with: futureLive
        )
    )

    let tiedA = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: futureLive.capturedAt,
        modifiedAt: futureLive.modifiedAt,
        encryptedPayload: Data([2])
    )
    let tiedB = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: futureLive.capturedAt,
        modifiedAt: futureLive.modifiedAt,
        encryptedPayload: Data([3])
    )
    let aWins = PrivateMeterCaptureCloudConflictPolicy.shouldReplace(existing: tiedB, with: tiedA)
    let bWins = PrivateMeterCaptureCloudConflictPolicy.shouldReplace(existing: tiedA, with: tiedB)
    #expect(aWins != bWins)
}

@MainActor
@Test func publicSaveCompletesWhilePrivateCollectionIsStillWaiting() async throws {
    let collector = BlockingPrivateCollector()
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        readingWriter: PrivateBoundaryWriter(),
        privateCaptureCollector: collector,
        privateCaptureStore: InMemoryPrivateMeterCaptureContextStore(),
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(
            settings: PrivateMeterCaptureSettings(captureEnabled: true)
        )
    )
    await model.loadDurableState()

    await model.measure()

    #expect(model.confirmationMessage == "Reading saved")
    #expect(model.errorMessage == nil)
    #expect(!model.isMeasuring)
    #expect(model.isSavingPrivateCapture)
    for _ in 0..<20 {
        if await collector.hasStarted { break }
        await Task.yield()
    }
    #expect(await collector.hasStarted)
    await collector.release()
    await model.flushPrivateCapturePersistence()
    #expect(!model.isSavingPrivateCapture)
}

@MainActor
@Test func deleteAllPreventsAnInFlightPrivateCollectionFromRecreatingData() async throws {
    let collector = BlockingPrivateCollector()
    let store = InMemoryPrivateMeterCaptureContextStore()
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        readingWriter: PrivateBoundaryWriter(),
        privateCaptureCollector: collector,
        privateCaptureStore: store,
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(
            settings: PrivateMeterCaptureSettings(captureEnabled: true)
        )
    )
    await model.loadDurableState()
    await model.measure()
    for _ in 0..<20 {
        if await collector.hasStarted { break }
        await Task.yield()
    }

    await model.deleteAllPrivateCaptureData()
    await collector.release()
    await model.flushPrivateCapturePersistence()

    #expect(await store.contexts().isEmpty)
    #expect(model.privateCaptureContextCount == 0)
}

@Test func deletionErasesLocalCiphertextBeforeAKeyOrCloudIsAvailable() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-offline-delete-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appending(path: "contexts.json")
    let writable = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider()
    )
    try await writable.save(try privateFixtureContext(), syncToPrivateCloud: false)
    let before = try String(contentsOf: file, encoding: .utf8)
    let orphaned = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: FailingPrivateKeyProvider(),
        cloud: UnavailablePrivateMeterCaptureCloudSync()
    )

    do {
        try await orphaned.deleteAll(syncToPrivateCloud: true)
        Issue.record("Expected the unavailable cloud deletion to remain pending")
    } catch PrivateMeterCaptureError.privateCloudDeletionPending(_) {
        // The local replacement must already have happened.
    }

    let after = try String(contentsOf: file, encoding: .utf8)
    #expect(after != before)
    #expect(after.contains("\"isDeleted\":true"))
    #expect(after.contains("\"encryptedPayload\":\"\""))
    #expect(!(await orphaned.containsLocalPrivateData()))
}

@MainActor
@Test func corruptStoreCanStillBeDeletedThroughTheModel() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-corrupt-delete-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appending(path: "contexts.json")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("precise-private-secret".utf8).write(to: file)
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: FailingPrivateKeyProvider()
    )
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        privateCaptureStore: store
    )

    await model.loadDurableState()
    #expect(model.privateCaptureContextCount == 0)
    #expect(model.privateCaptureDataMayExist)

    await model.deleteAllPrivateCaptureData()

    #expect(!model.privateCaptureDataMayExist)
    #expect(!String(decoding: try Data(contentsOf: file), as: UTF8.self).contains("private-secret"))
}

@Test func versionTwoEnvelopeRejectsMetadataTampering() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-metadata-tamper-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appending(path: "contexts.json")
    let key = SymmetricKey(size: .bits256)
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(key: key)
    )
    try await store.save(try privateFixtureContext(), syncToPrivateCloud: false)
    var envelope = try #require(
        JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var records = try #require(envelope["records"] as? [[String: Any]])
    records[0]["modifiedAt"] = (try #require(records[0]["modifiedAt"] as? Double)) + 5_000
    envelope["records"] = records
    try JSONSerialization.data(withJSONObject: envelope).write(to: file, options: .atomic)

    await #expect(throws: PrivateMeterCaptureError.corruptLocalStore) {
        _ = try await store.contexts()
    }
}

@Test func versionOneEnvelopeOpensAndMigratesToAuthenticatedVersionTwo() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-v1-migration-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appending(path: "contexts.json")
    let key = SymmetricKey(size: .bits256)
    let context = try privateFixtureContext()
    let payloadEncoder = JSONEncoder()
    payloadEncoder.dateEncodingStrategy = .iso8601
    let box = try AES.GCM.seal(try payloadEncoder.encode(context), using: key)
    let legacy = LegacyPrivateMeterFile(
        version: 1,
        records: [
            LegacySealedPrivateMeterContext(
                id: context.id,
                capturedAt: context.capturedAt,
                modifiedAt: context.capturedAt,
                isDeleted: false,
                keyFingerprint: nil,
                encryptedPayload: try #require(box.combined)
            )
        ]
    )
    let fileEncoder = JSONEncoder()
    fileEncoder.dateEncodingStrategy = .iso8601
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try fileEncoder.encode(legacy).write(to: file)
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: file,
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(key: key)
    )

    #expect(try await store.contexts() == [context])
    let migrated = try String(contentsOf: file, encoding: .utf8)
    #expect(migrated.contains("\"version\":2"))
    #expect(migrated.contains("\"envelopeVersion\":2"))
}

@Test func existingCloudRecordsNeverAuthorizeCreatingAReplacementEncryptionKey() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-key-gate-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let cloudKey = SymmetricKey(size: .bits256)
    let seedStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "seed.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: cloudKey),
        cloud: cloud
    )
    try await seedStore.save(try privateFixtureContext(), syncToPrivateCloud: true)
    let delayedKey = GatedPrivateCloudKeyProvider()
    let receivingStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "receiving.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: delayedKey,
        cloud: cloud
    )

    await #expect(throws: PrivateMeterCaptureError.privateCloudKeyUnavailable) {
        try await receivingStore.synchronizePrivateCloud()
    }
    #expect(await delayedKey.creationPermissions == [false])
    #expect(try await receivingStore.contexts().isEmpty)
}

@Test func emptyCloudCanBootstrapAKeyAndPublishesItsFingerprint() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-key-bootstrap-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let gatedKey = GatedPrivateCloudKeyProvider()
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "local.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: gatedKey,
        cloud: cloud
    )
    try await store.save(try privateFixtureContext(), syncToPrivateCloud: false)

    try await store.synchronizePrivateCloud()

    #expect(await gatedKey.creationPermissions == [true])
    #expect(try #require(await cloud.records().first).keyFingerprint != nil)
}

@Test func keylessCloudDeletionMarkerIsAuthenticatedWhenTheKeyReturns() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-tombstone-upgrade-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let id = UUID(uuidString: "00000000-0000-0000-0000-000000000992")!
    let unsigned = SealedPrivateMeterCaptureContext(
        id: id,
        capturedAt: Date(timeIntervalSince1970: 10),
        modifiedAt: Date(timeIntervalSince1970: 20),
        isDeleted: true,
        encryptedPayload: Data()
    )
    let cloud = InMemoryPrivateMeterCaptureCloudSync(records: [unsigned])
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "local.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: cloud
    )

    try await store.synchronizePrivateCloud()

    let upgraded = try #require(await cloud.records().first)
    #expect(upgraded.isDeleted)
    #expect(upgraded.envelopeVersion == 2)
    #expect(upgraded.keyFingerprint != nil)
    #expect(!upgraded.encryptedPayload.isEmpty)
}

@Test func aCloudKeyFingerprintMismatchFailsBeforeDecryptingRemoteData() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-key-mismatch-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let seedStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "seed.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: cloud
    )
    try await seedStore.save(try privateFixtureContext(), syncToPrivateCloud: true)
    let receivingStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "receiving.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: cloud
    )

    await #expect(throws: PrivateMeterCaptureError.privateCloudKeyMismatch) {
        try await receivingStore.synchronizePrivateCloud()
    }
    #expect(try await receivingStore.contexts().isEmpty)
}

@Test func privateCloudMergeUsesNewestCiphertextAndDeletionMarkersPreventResurrection() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-merge-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let key = SymmetricKey(size: .bits256)
    let secondLocalKey = SymmetricKey(size: .bits256)
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let firstStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "first.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(key: key),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: key),
        cloud: cloud
    )
    let secondStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "second.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(key: secondLocalKey),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: key),
        cloud: cloud
    )
    let original = try privateFixtureContext()
    try await firstStore.save(original, syncToPrivateCloud: true)
    try await secondStore.synchronizePrivateCloud()
    #expect(try await secondStore.contexts() == [original])

    let changed = try privateFixtureContext(id: original.id, deviceModel: "second-device")
    try await Task.sleep(for: .milliseconds(2))
    try await secondStore.save(changed, syncToPrivateCloud: true)
    try await firstStore.synchronizePrivateCloud()
    #expect(try await firstStore.contexts() == [changed])

    try await firstStore.delete(id: original.id, syncToPrivateCloud: true)
    try await secondStore.synchronizePrivateCloud()
    #expect(try await secondStore.contexts().isEmpty)
    try await firstStore.synchronizePrivateCloud()
    #expect(try await firstStore.contexts().isEmpty)
}

@Test func deleteEverywhereFirstFindsRecordsCreatedOnlyOnAnotherDevice() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-delete-all-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloudKey = SymmetricKey(size: .bits256)
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let firstStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "first.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: cloudKey),
        cloud: cloud
    )
    let secondStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "second.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: cloudKey),
        cloud: cloud
    )
    let remoteOnly = try privateFixtureContext()
    try await firstStore.save(remoteOnly, syncToPrivateCloud: true)
    #expect(try await secondStore.contexts().isEmpty)

    try await secondStore.deleteAll(syncToPrivateCloud: true)

    #expect(try await secondStore.contexts().isEmpty)
    try await firstStore.synchronizePrivateCloud()
    #expect(try await firstStore.contexts().isEmpty)
    let remoteRecord = try #require(await cloud.records().first { $0.id == remoteOnly.id })
    #expect(remoteRecord.isDeleted)
    #expect(remoteRecord.envelopeVersion == 2)
    #expect(!remoteRecord.encryptedPayload.isEmpty)
}

@MainActor
@Test func launchPullsEncryptedContextsCreatedOnAnotherDeviceWhenSyncIsEnabled() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-launch-sync-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloudKey = SymmetricKey(size: .bits256)
    let cloud = InMemoryPrivateMeterCaptureCloudSync()
    let firstStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "first.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: cloudKey),
        cloud: cloud
    )
    let secondStore = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "second.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(key: cloudKey),
        cloud: cloud
    )
    let remoteContext = try privateFixtureContext()
    try await firstStore.save(remoteContext, syncToPrivateCloud: true)
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        privateCaptureStore: secondStore,
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(
            settings: PrivateMeterCaptureSettings(
                privateCloudSyncEnabled: true,
                privateCloudAccountIdentifier: "in-memory-private-cloud"
            )
        )
    )

    await model.loadDurableState()

    #expect(model.errorMessage == nil)
    #expect(model.privateCaptureContextCount == 1)
    #expect(try await secondStore.contexts() == [remoteContext])
}

@MainActor
@Test func changingCloudAccountsDisablesSyncBeforeLocalContextsCanUpload() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-account-change-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloud = InMemoryPrivateMeterCaptureCloudSync(accountIdentifier: "account-a")
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "local.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: cloud
    )
    try await store.save(try privateFixtureContext(), syncToPrivateCloud: false)
    await cloud.setAccountIdentifier("account-b")
    let settingsStore = InMemoryPrivateMeterCaptureSettingsStore(
        settings: PrivateMeterCaptureSettings(
            privateCloudSyncEnabled: true,
            privateCloudAccountIdentifier: "account-a"
        )
    )
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        privateCaptureStore: store,
        privateCaptureSettingsStore: settingsStore
    )

    await model.loadDurableState()

    #expect(!model.privateCaptureSettings.privateCloudSyncEnabled)
    #expect(model.privateCaptureSettings.privateCloudAccountIdentifier == nil)
    #expect(model.privateCaptureMessage?.contains("iCloud account changed") == true)
    #expect(try await cloud.records().isEmpty)
    #expect(!(await settingsStore.settings()).privateCloudSyncEnabled)
    #expect(try await store.contexts().count == 1)
}

@MainActor
@Test func accountChangeDuringCloudReadIsRejectedAndDisablesSync() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-account-race-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let cloud = AccountChangingPrivateCloud()
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "local.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: cloud
    )
    try await store.save(try privateFixtureContext(), syncToPrivateCloud: false)
    let settingsStore = InMemoryPrivateMeterCaptureSettingsStore(
        settings: PrivateMeterCaptureSettings(
            privateCloudSyncEnabled: true,
            privateCloudAccountIdentifier: "account-a"
        )
    )
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        privateCaptureStore: store,
        privateCaptureSettingsStore: settingsStore
    )

    await model.loadDurableState()

    #expect(!model.privateCaptureSettings.privateCloudSyncEnabled)
    #expect(model.privateCaptureSettings.privateCloudAccountIdentifier == nil)
    #expect(model.privateCaptureMessage?.contains("iCloud account changed") == true)
    #expect(await cloud.savedCount == 0)
}

@MainActor
@Test func cloudFailureMessageDoesNotClaimPrivateContextWasLostLocally() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
        path: "private-meter-partial-save-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let store = EncryptedPrivateMeterCaptureContextStore(
        fileURL: root.appending(path: "local.json"),
        keyProvider: EphemeralPrivateMeterCaptureKeyProvider(),
        cloudKeyProvider: EphemeralPrivateMeterCaptureCloudKeyProvider(),
        cloud: FailingReadPrivateCloud()
    )
    let model = MeterFeatureModel(
        service: PrivateFixtureMeterService(reading: try privateFixtureReading()),
        readingWriter: PrivateBoundaryWriter(),
        privateCaptureCollector: RecordingPrivateCollector(),
        privateCaptureStore: store,
        privateCaptureSettingsStore: InMemoryPrivateMeterCaptureSettingsStore(
            settings: PrivateMeterCaptureSettings(
                captureEnabled: true,
                privateCloudSyncEnabled: true,
                privateCloudAccountIdentifier: "account-a"
            )
        )
    )
    await model.loadDurableState()

    await model.measure()
    await model.flushPrivateCapturePersistence()

    #expect(model.confirmationMessage == "Reading saved")
    #expect(model.errorMessage == nil)
    #expect(model.privateCaptureContextCount == 1)
    #expect(model.privateCaptureMessage?.contains("local private context were saved") == true)
}

private struct PrivateFixtureMeterService: MeterService {
    let reading: Reading

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

private actor PrivateBoundaryWriter: MeterReadingSemanticWriting {
    private(set) var requests: [MeterReadingWriteRequest] = []

    func storeMeterReadings(_ request: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
    {
        requests.append(contentsOf: request.records)
        return try MeterReadingBatchPersistenceReceipt(
            records: Dictionary(
                uniqueKeysWithValues: request.records.map { record in
                    (
                        record.reading.id,
                        MeterReadingPersistenceReceipt(
                            reference: try MeterReadingRecordReference(
                                uri: "at://did:plc:test/app.graycard.meter.reading/"
                                    + record.reading.id.uuidString.lowercased()
                            ),
                            acceptedAt: record.requestedAt
                        )
                    )
                }
            )
        )
    }
}

private actor RecordingPrivateCollector: PrivateMeterCaptureContextCollecting {
    struct Request: Sendable { let includesLocation: Bool }
    private(set) var requests: [Request] = []

    func context(
        for reading: Reading,
        publicReadingURI: String,
        includePreciseLocation: Bool
    ) async throws -> PrivateMeterCaptureContext {
        requests.append(Request(includesLocation: includePreciseLocation))
        return try privateFixtureContext(
            reading: reading,
            publicReadingURI: publicReadingURI,
            includesLocation: includePreciseLocation
        )
    }
}

private actor BlockingPrivateCollector: PrivateMeterCaptureContextCollecting {
    private(set) var hasStarted = false
    private var continuation: CheckedContinuation<Void, Never>?

    func context(
        for reading: Reading,
        publicReadingURI: String,
        includePreciseLocation: Bool
    ) async throws -> PrivateMeterCaptureContext {
        hasStarted = true
        await withCheckedContinuation { continuation in self.continuation = continuation }
        return try privateFixtureContext(
            reading: reading,
            publicReadingURI: publicReadingURI,
            includesLocation: includePreciseLocation
        )
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

private struct LegacyPrivateMeterFile: Codable {
    let version: Int
    let records: [LegacySealedPrivateMeterContext]
}

private struct LegacySealedPrivateMeterContext: Codable {
    let id: UUID
    let capturedAt: Date
    let modifiedAt: Date
    let isDeleted: Bool
    let keyFingerprint: String?
    let encryptedPayload: Data
}

private struct FailingPrivateKeyProvider: PrivateMeterCaptureKeyProviding {
    func key() async throws -> SymmetricKey {
        throw PrivateMeterCaptureError.keyUnavailable
    }
}

private actor GatedPrivateCloudKeyProvider: PrivateMeterCaptureCloudKeyProviding {
    private var storedKey: SymmetricKey?
    private(set) var creationPermissions: [Bool] = []

    func key(allowCreation: Bool) throws -> SymmetricKey {
        creationPermissions.append(allowCreation)
        if let storedKey { return storedKey }
        guard allowCreation else {
            throw PrivateMeterCaptureError.privateCloudKeyUnavailable
        }
        let key = SymmetricKey(size: .bits256)
        storedKey = key
        return key
    }
}

private actor AccountChangingPrivateCloud: PrivateMeterCaptureCloudSyncing {
    private var accountID = "account-a"
    private(set) var savedCount = 0

    func accountIdentifier() -> String { accountID }

    func records(expectedAccountIdentifier: String?) throws
        -> [SealedPrivateMeterCaptureContext]
    {
        accountID = "account-b"
        guard expectedAccountIdentifier == nil || expectedAccountIdentifier == accountID else {
            throw PrivateMeterCaptureError.privateCloudAccountChanged
        }
        return []
    }

    func save(
        _: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier: String?
    ) throws {
        guard expectedAccountIdentifier == nil || expectedAccountIdentifier == accountID else {
            throw PrivateMeterCaptureError.privateCloudAccountChanged
        }
        savedCount += 1
    }

    func delete(id _: UUID, expectedAccountIdentifier _: String?) {}
    func deleteAll(expectedAccountIdentifier _: String?) {}
}

private struct FailingReadPrivateCloud: PrivateMeterCaptureCloudSyncing {
    func accountIdentifier() -> String { "account-a" }

    func records(expectedAccountIdentifier _: String?) throws
        -> [SealedPrivateMeterCaptureContext]
    {
        throw PrivateMeterCaptureError.privateCloudUnavailable("fixture offline")
    }

    func save(
        _: SealedPrivateMeterCaptureContext,
        expectedAccountIdentifier _: String?
    ) {}

    func delete(id _: UUID, expectedAccountIdentifier _: String?) {}
    func deleteAll(expectedAccountIdentifier _: String?) {}
}

private func privateFixtureReading() throws -> Reading {
    Reading(
        id: UUID(uuidString: "00000000-0000-0000-0000-000000000123")!,
        takenAt: Date(timeIntervalSince1970: 1_800_000_000),
        geometry: .reflectedAverage,
        ev100: ExposureValue(12),
        camera: CameraDescriptor(
            id: "camera-1",
            name: "Wide",
            module: .wide,
            horizontalFieldOfViewDegrees: 68
        ),
        sensorPath: .processedPatch,
        accuracyTier: .approximate,
        calibrationConstant: 12.5
    )
}

private func privateFixtureContext(
    id: UUID = UUID(uuidString: "00000000-0000-0000-0000-000000000456")!,
    deviceModel: String = "test-device",
    reading: Reading? = nil,
    publicReadingURI: String =
        "at://did:plc:test/app.graycard.meter.reading/00000000-0000-0000-0000-000000000123",
    includesLocation: Bool = true
) throws -> PrivateMeterCaptureContext {
    let reading = try reading ?? privateFixtureReading()
    return PrivateMeterCaptureContext(
        id: id,
        readingID: reading.id,
        publicReadingURI: publicReadingURI,
        capturedAt: reading.takenAt,
        contextCollectedAt: reading.takenAt.addingTimeInterval(2),
        motionSampledAt: reading.takenAt.addingTimeInterval(1),
        device: PrivateMeterDeviceContext(
            modelIdentifier: deviceModel,
            operatingSystemVersion: "17.0",
            appVersion: "1.0",
            deviceOrientation: "portrait"
        ),
        camera: PrivateMeterCameraContext(
            uniqueID: reading.camera.id,
            name: reading.camera.name,
            module: reading.camera.module.rawValue,
            sensorPath: reading.sensorPath.rawValue,
            lensPosition: 0.4,
            fieldOfViewDegrees: 68
        ),
        attitude: PrivateMeterAttitude(
            rollRadians: 0.1,
            pitchRadians: 0.2,
            yawRadians: 0.3,
            quaternionX: 0,
            quaternionY: 0,
            quaternionZ: 0,
            quaternionW: 1
        ),
        gravity: PrivateMeterVector(x: 0, y: -1, z: 0),
        userAcceleration: PrivateMeterVector(x: 0.01, y: 0.02, z: 0.03),
        rotationRate: PrivateMeterVector(x: 0.04, y: 0.05, z: 0.06),
        magneticField: PrivateMeterMagneticField(
            microtesla: PrivateMeterVector(x: 20, y: 30, z: 40),
            accuracy: "high"
        ),
        headingDegrees: includesLocation ? 180 : nil,
        location: includesLocation
            ? PrivateMeterLocation(
                latitude: 39.3299,
                longitude: -76.6205,
                altitudeMetres: 30,
                horizontalAccuracyMetres: 3,
                verticalAccuracyMetres: 5,
                speedMetresPerSecond: 0,
                courseDegrees: 180,
                floor: 2,
                isSimulated: false,
                isProducedByAccessory: false,
                capturedAt: reading.takenAt.addingTimeInterval(3)
            ) : nil
    )
}
