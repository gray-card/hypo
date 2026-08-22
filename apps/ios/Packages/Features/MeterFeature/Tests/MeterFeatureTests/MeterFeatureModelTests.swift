import DesignSystem
import Foundation
import MeterEngine
import PhotometryKit
import Testing

@testable import MeterFeature

@MainActor
@Test func measurePresentsEngineReadingAndCanHoldIt() async throws {
    let reading = try fixtureReading(ev: 12)
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        readingWriter: AcceptingMeterReadingWriter()
    )

    await model.measure()
    model.holdCurrentReading()

    #expect(model.reading == reading)
    #expect(model.heldReadings == [reading])
    #expect(model.errorMessage == nil)
}

@MainActor
@Test func firstMeasurementRequestsCameraAuthorization() async throws {
    let service = PermissionMeterService(reading: try fixtureReading(ev: 12))
    let model = MeterFeatureModel(
        service: service,
        readingWriter: AcceptingMeterReadingWriter()
    )

    await model.measure()

    #expect(await service.authorizationRequestCount == 1)
    #expect(await service.captureCount == 1)
    #expect(model.reading != nil)
    #expect(model.errorMessage == nil)
}

@MainActor
@Test func configurationReflectsSelectedMode() throws {
    let model = MeterFeatureModel(service: FixtureMeterService(reading: try fixtureReading(ev: 10)))
    model.mode = .spot
    model.spotAngleDegrees = 5
    model.averagingCount = 3

    #expect(try model.configuration.mode == .reflectedSpot(nominalAngleDegrees: 5))
    #expect(try model.configuration.averagingCount == 3)
}

@MainActor
@Test func heldReadingsAreBoundedToNine() async throws {
    let store = InMemoryHeldReadingStore()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: try fixtureReading(ev: 11)),
        heldReadingStore: store,
        readingWriter: AcceptingMeterReadingWriter(),
        haptics: RecordingHaptics()
    )
    await model.measure()
    for _ in 0..<12 { model.holdCurrentReading() }
    await model.flushPersistence()
    #expect(model.heldReadings.count == 9)
    #expect(await store.loadHeldReadings().count == 9)
}

@MainActor
@Test func heldReadingsRestoreAndPromotionUsesSemanticBoundary() async throws {
    let held = try fixtureReading(ev: 9)
    let current = try fixtureReading(ev: 12)
    let store = InMemoryHeldReadingStore(readings: [held])
    let promoter = RecordingPromoter()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: current),
        heldReadingStore: store,
        readingWriter: AcceptingMeterReadingWriter(),
        promoter: promoter,
        haptics: RecordingHaptics(),
        now: { Date(timeIntervalSince1970: 1_800_000_000) }
    )

    await model.loadDurableState()
    await model.measure()
    await model.promoteToLogger()

    #expect(model.heldReadings == [held])
    let requests = await promoter.requests
    #expect(requests.count == 1)
    #expect(requests[0].readings == [held, current])
    #expect(requests[0].preferredReadingID == current.id)
    #expect(requests[0].requestedAt == Date(timeIntervalSince1970: 1_800_000_000))
}

@Test func spotAnalysisReportsLinearAverageDeltasContrastAndZonePlacement() throws {
    let dark = try fixtureSpotReading(ev: 8)
    let reference = try fixtureSpotReading(ev: 10)
    let bright = try fixtureSpotReading(ev: 13)

    let analysis = try #require(
        MeterSpotAnalysis(
            readings: [dark, reference, bright, reference],
            referenceReadingID: reference.id,
            referenceZone: try Zone(3)
        )
    )

    let expectedAverage = log2((pow(2.0, 8.0) + pow(2.0, 10.0) + pow(2.0, 13.0)) / 3.0)
    #expect(abs(analysis.averageEV100.rawValue - expectedAverage) < 1e-10)
    #expect(analysis.points.count == 3)
    #expect(analysis.darkestReadingID == dark.id)
    #expect(analysis.brightestReadingID == bright.id)
    #expect(analysis.contrastRange == Stops(5))
    #expect(analysis.placedExposureEV100 == ExposureValue(12))
    #expect(analysis.points[0].deltaFromReferenceStops == Stops(-2))
    #expect(analysis.points[0].placedZone == 1)
    #expect(analysis.points[2].deltaFromReferenceStops == Stops(3))
    #expect(analysis.points[2].placedZone == 6)
}

@MainActor
@Test func spotAnalysisUsesHeldAndCurrentSpotsAndClampsZoneInteraction() async throws {
    let dark = try fixtureSpotReading(ev: 8)
    let reference = try fixtureSpotReading(ev: 10)
    let nonSpot = try fixtureReading(ev: 7)
    let current = try fixtureSpotReading(ev: 13)
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: current),
        heldReadingStore: InMemoryHeldReadingStore(readings: [dark, nonSpot, reference]),
        readingWriter: AcceptingMeterReadingWriter(),
        haptics: RecordingHaptics()
    )

    await model.loadDurableState()
    await model.measure()
    model.selectSpotAnalysisReference(id: reference.id)
    model.setSpotAnalysisReferenceZone(-4)

    #expect(model.spotAnalysisReadings.map(\.id) == [dark.id, reference.id, current.id])
    #expect(model.spotAnalysisReferenceZone == 0)
    #expect(model.spotAnalysis?.referenceReadingID == reference.id)
    #expect(model.spotAnalysis?.contrastRange == Stops(5))

    model.adjustSpotAnalysisReferenceZone(by: 20)
    #expect(model.spotAnalysisReferenceZone == 10)
    #expect(model.spotAnalysis?.placedExposureEV100 == ExposureValue(5))

    model.removeHeldReading(id: reference.id)
    #expect(model.spotAnalysisReferenceReadingID == nil)
    #expect(model.spotAnalysis?.referenceReadingID == dark.id)
}

@MainActor
@Test func spotAnalysisPromotionUsesOnlySpotBankAndPrefersReference() async throws {
    let dark = try storedReading(ev: 8, geometry: .reflectedSpot, cameraName: "Tele Dark")
    let bright = try storedReading(ev: 12, geometry: .reflectedSpot, cameraName: "Tele Bright")
    let nonSpot = try storedReading(ev: 9, geometry: .reflectedAverage, cameraName: "Wide")
    let promoter = RecordingPromoter()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: nonSpot.reading),
        heldReadingStore: InMemoryHeldReadingStore(
            readings: [dark.reading, nonSpot.reading, bright.reading]
        ),
        readingLogStore: InMemoryMeterReadingLogStore(readings: [dark, nonSpot, bright]),
        promoter: promoter,
        haptics: RecordingHaptics()
    )

    await model.loadDurableState()
    model.selectSpotAnalysisReference(id: bright.id)
    await model.promoteSpotAnalysisToLogger()

    let request = try #require(await promoter.requests.first)
    #expect(request.readings.map(\.id) == [dark.id, bright.id])
    #expect(request.preferredReadingID == bright.id)
    #expect(
        request.recordReferences == [
            dark.id: dark.reference,
            bright.id: bright.reference,
        ])
    #expect(model.confirmationMessage == "Reading ready in Logger")
}

@Test func zoneLabelsDescribeInRangeAndClippedPlacementsWithoutHidingTheOffset() {
    #expect(MeterZoneLabel.description(for: 3) == "Zone III")
    #expect(MeterZoneLabel.description(for: 3.4) == "Zone III +0.4")
    #expect(MeterZoneLabel.description(for: -1.25) == "Below Zone 0 by 1.2 stops")
    #expect(MeterZoneLabel.description(for: 11.5) == "Above Zone X by 1.5 stops")
}

@MainActor
@Test func spotReticleAndPreviewZoomMapToSourceGeometry() throws {
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: try fixtureReading(ev: 10)),
        haptics: RecordingHaptics()
    )
    model.mode = .spot
    model.setSpotReticle(x: 1, y: 0)
    model.setPreviewZoom(2)

    let configuration = try model.configuration
    #expect(configuration.spotPointX == 0.75)
    #expect(configuration.spotPointY == 0.25)
    #expect(model.spotReticleX == 1)
    #expect(model.previewZoom == 2)
}

@MainActor
@Test func calibrationProfilePersistsSelectionAndAppliesByIdentity() async throws {
    let reading = try fixtureReading(ev: 10)
    let store = InMemoryCalibrationProfileStore()
    let applier = RecordingCalibrationApplier()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        readingWriter: AcceptingMeterReadingWriter(),
        calibrationStore: store,
        calibrationApplier: applier,
        haptics: RecordingHaptics(),
        deviceModelName: "iPhone test",
        now: { Date(timeIntervalSince1970: 1_800_000_000) }
    )

    await model.measure()
    await model.createOnePointCalibration(
        referenceEV100: 11.5,
        reference: .handheldMeter
    )

    let profile = try #require(model.selectedCalibration)
    #expect(profile.identity.deviceModel == "iPhone test")
    #expect(profile.identity.cameraID == reading.camera.id)
    #expect(profile.identity.sensorPath == reading.sensorPath)
    #expect(profile.constantOffsetStops == 1.5)
    let state = await store.loadCalibrationProfileState()
    #expect(state.profiles == [profile])
    #expect(state.selectedID == profile.id)
    #expect(await applier.appliedIDs == [profile.id])

    let restoredApplier = RecordingCalibrationApplier()
    let restored = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        calibrationStore: store,
        calibrationApplier: restoredApplier,
        haptics: RecordingHaptics()
    )
    await restored.loadDurableState()
    #expect(restored.selectedCalibrationID == profile.id)
    #expect(await restoredApplier.appliedIDs == [profile.id])
}

@Test func fileStorePreservesHeldReadingsAndCalibrationTogether() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "meter-feature-state-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appending(path: "meter.json")
    let reading = try fixtureReading(ev: 8)
    let profile = try CalibrationBuilder.constantOffsetProfile(
        identity: CalibrationIdentity(
            deviceModel: "test",
            cameraID: reading.camera.id,
            module: reading.camera.module,
            sensorPath: reading.sensorPath
        ),
        reference: .knownTarget,
        observations: [
            CalibrationObservation(
                measuredEV100: reading.ev100,
                referenceEV100: ExposureValue(8.5)
            )
        ],
        createdAt: Date(timeIntervalSince1970: 1_800_000_000)
    )

    let writer = FileMeterFeatureStateStore(fileURL: url)
    try await writer.saveHeldReadings([reading])
    try await writer.saveCalibrationProfileState(
        CalibrationProfileState(profiles: [profile], selectedID: profile.id)
    )

    let restored = FileMeterFeatureStateStore(fileURL: url)
    #expect(try await restored.loadHeldReadings() == [reading])
    #expect(
        try await restored.loadCalibrationProfileState()
            == CalibrationProfileState(profiles: [profile], selectedID: profile.id)
    )
}

@MainActor
@Test func deliberateSpotMeasureWritesCompleteSemanticRequestAndDurableLog() async throws {
    let requestedAt = Date(timeIntervalSince1970: 1_800_000_001)
    let reading = try fixtureSpotReading()
    let writer = AcceptingMeterReadingWriter()
    let log = InMemoryMeterReadingLogStore()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        readingWriter: writer,
        readingLogStore: log,
        haptics: RecordingHaptics(),
        deviceModelName: "iPhone test",
        now: { requestedAt }
    )
    model.mode = .spot
    model.spotAngleDegrees = 2
    model.setSpotReticle(x: 0.8, y: 0.2)
    model.setPreviewZoom(2)

    await model.measure()

    let request = try #require(await writer.requests.first)
    #expect(request.reading == reading)
    #expect(request.spotPoint == MeterReadingNormalizedPoint(x: 0.65, y: 0.35))
    #expect(request.deviceModelName == "iPhone test")
    #expect(request.requestedAt == requestedAt)
    let entry = try #require(model.readingLog.first)
    #expect(entry.reading == reading)
    #expect(entry.spotPoint == request.spotPoint)
    #expect(entry.reference.uri.hasSuffix(reading.id.uuidString.lowercased()))
    #expect(await log.loadMeterReadingLog() == [entry])
    #expect(model.confirmationMessage == "Reading saved")
    #expect(model.errorMessage == nil)
}

@MainActor
@Test func averagedMeasureAtomicallyPersistsMembersBeforeItsAggregate() async throws {
    let capture = try fixtureAverageCapture()
    let writer = TransactionalMeterReadingWriter()
    let log = InMemoryMeterReadingLogStore()
    let model = MeterFeatureModel(
        service: FixtureMeterService(capture: capture),
        readingWriter: writer,
        readingLogStore: log,
        haptics: RecordingHaptics(),
        now: { Date(timeIntervalSince1970: 1_800_000_200) }
    )

    await model.measure()

    let batch = try #require(await writer.batches.first)
    #expect(batch.records.map(\.reading.id) == capture.constituents.map(\.id) + [capture.reading.id])
    #expect(Set(model.readingLog.map(\.id)) == Set(capture.records.map(\.id)))
    #expect(await writer.acceptedReadingIDs == Set(capture.records.map(\.id)))
    let aggregate = try #require(model.readingLog.first { $0.id == capture.reading.id })
    #expect(aggregate.reading.averagedFrom == capture.constituents.map(\.id))
    #expect(model.confirmationMessage == "Average and 2 source readings saved")
    #expect(model.errorMessage == nil)
}

@MainActor
@Test func averagedMeasureFailureLeavesNoPartialDurableOrLocalBatch() async throws {
    let capture = try fixtureAverageCapture()
    let rejectedID = try #require(capture.constituents.last?.id)
    let writer = TransactionalMeterReadingWriter(rejectedReadingID: rejectedID)
    let log = InMemoryMeterReadingLogStore()
    let model = MeterFeatureModel(
        service: FixtureMeterService(capture: capture),
        readingWriter: writer,
        readingLogStore: log,
        haptics: RecordingHaptics()
    )

    await model.measure()

    #expect(await writer.acceptedReadingIDs.isEmpty)
    #expect(model.readingLog.isEmpty)
    #expect(await log.loadMeterReadingLog().isEmpty)
    #expect(model.confirmationMessage == nil)
    #expect(model.errorMessage?.contains("recordRejected") == true)
}

@MainActor
@Test func retryingTheSameAveragedCaptureIsIdempotent() async throws {
    let capture = try fixtureAverageCapture()
    let writer = TransactionalMeterReadingWriter()
    let model = MeterFeatureModel(
        service: FixtureMeterService(capture: capture),
        readingWriter: writer,
        readingLogStore: InMemoryMeterReadingLogStore(),
        haptics: RecordingHaptics()
    )

    await model.measure()
    let firstReferences = await writer.acceptedReferences
    await model.measure()

    #expect(await writer.batches.count == 2)
    #expect(await writer.acceptedReferences == firstReferences)
    #expect(await writer.acceptedReadingIDs.count == capture.records.count)
    #expect(model.readingLog.count == capture.records.count)
    #expect(Set(model.readingLog.map(\.id)) == Set(capture.records.map(\.id)))
}

@MainActor
@Test func serializationOrWriteFailureDoesNotClaimPersistence() async throws {
    let reading = try fixtureReading(ev: 12)
    let log = InMemoryMeterReadingLogStore()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        readingWriter: FailingMeterReadingWriter(),
        readingLogStore: log,
        haptics: RecordingHaptics()
    )

    await model.measure()

    #expect(model.reading == reading)
    #expect(model.readingLog.isEmpty)
    #expect(await log.loadMeterReadingLog().isEmpty)
    #expect(model.confirmationMessage == nil)
    #expect(model.errorMessage?.contains("serializationRejected") == true)
}

@MainActor
@Test func localLogFailureReportsThatSyncAcceptedTheRecordWithoutShowingALogEntry() async throws {
    let reading = try fixtureReading(ev: 12)
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reading),
        readingWriter: AcceptingMeterReadingWriter(),
        readingLogStore: FailingMeterReadingLogStore(),
        haptics: RecordingHaptics()
    )

    await model.measure()

    #expect(model.readingLog.isEmpty)
    #expect(model.confirmationMessage == nil)
    #expect(model.errorMessage?.contains("queued for sync") == true)
    #expect(model.errorMessage?.contains("local log") == true)
}

@MainActor
@Test func readingLogCanBeSearchedFilteredSelectedAndPromotedByStableReferences() async throws {
    let reflected = try storedReading(ev: 8, geometry: .reflectedAverage, cameraName: "Wide")
    let spot = try storedReading(ev: 11, geometry: .reflectedSpot, cameraName: "Telephoto")
    let promoter = RecordingPromoter()
    let model = MeterFeatureModel(
        service: FixtureMeterService(reading: reflected.reading),
        readingLogStore: InMemoryMeterReadingLogStore(readings: [reflected, spot]),
        promoter: promoter,
        haptics: RecordingHaptics(),
        now: { Date(timeIntervalSince1970: 1_900_000_000) }
    )
    await model.loadDurableState()

    model.readingLogQuery = "telephoto"
    #expect(model.filteredReadingLog.map(\.id) == [spot.id])
    model.readingLogQuery = ""
    model.readingLogFilter = .reflected
    #expect(model.filteredReadingLog.map(\.id) == [reflected.id])

    model.toggleReadingLogSelection(id: reflected.id)
    model.toggleReadingLogSelection(id: spot.id)
    await model.promoteSelectedReadingLog()

    let request = try #require(await promoter.requests.first)
    #expect(Set(request.readings.map(\.id)) == [reflected.id, spot.id])
    #expect(request.preferredReadingID == spot.id)
    #expect(
        request.recordReferences == [
            reflected.id: reflected.reference,
            spot.id: spot.reference,
        ])
    #expect(model.selectedReadingLogIDs.isEmpty)
}

@Test func fileStorePersistsReadingLogAndReadsVersionOneFilesWithoutTheNewField() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
        path: "meter-feature-log-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appending(path: "meter.json")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(#"{"version":1,"heldReadings":[],"calibration":{"profiles":[]}}"#.utf8)
        .write(to: url)

    let migrated = FileMeterFeatureStateStore(fileURL: url)
    #expect(try await migrated.loadMeterReadingLog().isEmpty)

    let entry = try storedReading(ev: 7, geometry: .incidentFlat, cameraName: "Ambient")
    try await migrated.saveMeterReadingLog([entry])
    let restored = FileMeterFeatureStateStore(fileURL: url)
    #expect(try await restored.loadMeterReadingLog() == [entry])
}

@Test func recordReferenceRejectsValuesThatAreNotATURIs() {
    #expect(throws: MeterFeatureBoundaryError.self) {
        try MeterReadingRecordReference(uri: "https://example.com/reading")
    }
    #expect(throws: MeterFeatureBoundaryError.self) {
        try MeterReadingRecordReference(
            uri: "at://did:plc:test/app.graycard.instance.exposure/3mtest"
        )
    }
}

private struct FixtureMeterService: MeterService {
    let reading: Reading
    let explicitCapture: MeterCapture?

    init(reading: Reading) {
        self.reading = reading
        self.explicitCapture = nil
    }

    init(capture: MeterCapture) {
        self.reading = capture.reading
        self.explicitCapture = capture
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

    func captureBatch(configuration _: MeterConfiguration) async throws -> MeterCapture {
        if let explicitCapture { return explicitCapture }
        return try MeterCapture(reading: reading)
    }
}

private actor PermissionMeterService: MeterService {
    let reading: Reading
    private(set) var authorizationRequestCount = 0
    private(set) var captureCount = 0
    private var authorization: CameraAuthorization = .notDetermined

    init(reading: Reading) {
        self.reading = reading
    }

    func authorizationStatus() async -> CameraAuthorization { authorization }

    func requestAuthorization() async -> Bool {
        authorizationRequestCount += 1
        authorization = .authorized
        return true
    }

    func readings(configuration _: MeterConfiguration) async throws
        -> AsyncThrowingStream<Reading, any Error>
    {
        AsyncThrowingStream { continuation in
            continuation.yield(reading)
            continuation.finish()
        }
    }

    func capture(configuration _: MeterConfiguration) async throws -> Reading {
        captureCount += 1
        return reading
    }
}

private actor RecordingPromoter: LoggerExposureMeterPromoting {
    private(set) var requests: [LoggerExposureMeterPromotionRequest] = []

    func promoteMeterReadings(_ request: LoggerExposureMeterPromotionRequest) async throws {
        requests.append(request)
    }
}

private actor AcceptingMeterReadingWriter: MeterReadingSemanticWriting {
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
                        try MeterReadingPersistenceReceipt(
                            reference: MeterReadingRecordReference(
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

private actor TransactionalMeterReadingWriter: MeterReadingSemanticWriting {
    let rejectedReadingID: UUID?
    private(set) var batches: [MeterReadingBatchWriteRequest] = []
    private(set) var acceptedReferences: [UUID: MeterReadingRecordReference] = [:]

    init(rejectedReadingID: UUID? = nil) {
        self.rejectedReadingID = rejectedReadingID
    }

    var acceptedReadingIDs: Set<UUID> { Set(acceptedReferences.keys) }

    func storeMeterReadings(_ request: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
    {
        batches.append(request)
        if let rejectedReadingID,
            request.records.contains(where: { $0.reading.id == rejectedReadingID })
        {
            throw TestFailure.recordRejected(rejectedReadingID)
        }

        var staged = acceptedReferences
        var receipts: [UUID: MeterReadingPersistenceReceipt] = [:]
        for record in request.records {
            let reference: MeterReadingRecordReference
            if let accepted = staged[record.reading.id] {
                reference = accepted
            } else {
                reference = try MeterReadingRecordReference(
                    uri: "at://did:plc:test/app.graycard.meter.reading/"
                        + record.reading.id.uuidString.lowercased()
                )
                staged[record.reading.id] = reference
            }
            receipts[record.reading.id] = MeterReadingPersistenceReceipt(
                reference: reference,
                acceptedAt: record.requestedAt
            )
        }
        acceptedReferences = staged
        return MeterReadingBatchPersistenceReceipt(records: receipts)
    }
}

private struct FailingMeterReadingWriter: MeterReadingSemanticWriting {
    func storeMeterReadings(_: MeterReadingBatchWriteRequest) async throws
        -> MeterReadingBatchPersistenceReceipt
    {
        throw TestFailure.serializationRejected
    }
}

private struct FailingMeterReadingLogStore: MeterReadingLogStoring {
    func loadMeterReadingLog() async throws -> [StoredMeterReading] { [] }

    func saveMeterReadingLog(_: [StoredMeterReading]) async throws {
        throw TestFailure.logRejected
    }
}

private enum TestFailure: Error {
    case serializationRejected
    case logRejected
    case recordRejected(UUID)
}

private actor RecordingCalibrationApplier: MeterCalibrationApplying {
    private(set) var appliedIDs: [UUID?] = []

    func applyCalibration(_ profile: CalibrationProfile?) async {
        appliedIDs.append(profile?.id)
    }
}

@MainActor
private final class RecordingHaptics: HypoHapticPlaying {
    private(set) var cues: [HypoHapticCue] = []

    func play(_ cue: HypoHapticCue) {
        cues.append(cue)
    }
}

private func fixtureReading(ev: Double) throws -> Reading {
    Reading(
        takenAt: Date(timeIntervalSince1970: 1_700_000_000),
        geometry: .reflectedAverage,
        ev100: ExposureValue(ev),
        luminance: try ExposureMath.luminance(fromEV100: ExposureValue(ev)),
        camera: CameraDescriptor(id: "wide", name: "Wide Camera", module: .wide),
        sensorPath: .simulated,
        accuracyTier: .characterized,
        calibrationConstant: 12.5
    )
}

private func fixtureAverageCapture() throws -> MeterCapture {
    let members = [try fixtureReading(ev: 9), try fixtureReading(ev: 11)]
    return try MeterCapture(
        reading: ReadingAverager.average(members),
        constituents: members
    )
}

private func fixtureSpotReading(ev rawEV: Double = 11) throws -> Reading {
    let ev = ExposureValue(rawEV)
    return Reading(
        takenAt: Date(timeIntervalSince1970: 1_700_000_100),
        geometry: .reflectedSpot,
        ev100: ev,
        luminance: try ExposureMath.luminance(fromEV100: ev),
        exposure: ExposureSnapshot(
            sensitivity: try Sensitivity(iso: 400),
            duration: try ExposureDuration(seconds: 1 / 125),
            aperture: try Aperture(5.6)
        ),
        camera: CameraDescriptor(
            id: "tele",
            name: "Telephoto Camera",
            module: .telephoto,
            horizontalFieldOfViewDegrees: 24,
            supportsCustomExposure: true,
            supportsRAWPhoto: true
        ),
        sensorPath: .rawPatch,
        accuracyTier: .calibrated,
        calibrationID: UUID(uuidString: "11111111-1111-1111-1111-111111111111"),
        calibrationConstant: 12.5,
        nominalSpotAngleDegrees: 2,
        achievedSpotAngleDegrees: 2.4,
        flags: [.flareRisk],
        role: .midtone
    )
}

private func storedReading(
    ev: Double,
    geometry: MeasurementGeometry,
    cameraName: String
) throws -> StoredMeterReading {
    let reading = Reading(
        takenAt: Date(timeIntervalSince1970: 1_700_000_000 + ev),
        geometry: geometry,
        ev100: ExposureValue(ev),
        luminance: geometry == .incidentFlat || geometry == .incidentDome
            ? nil : try ExposureMath.luminance(fromEV100: ExposureValue(ev)),
        camera: CameraDescriptor(id: cameraName.lowercased(), name: cameraName, module: .wide),
        sensorPath: .processedPatch,
        accuracyTier: .characterized,
        calibrationConstant: 12.5
    )
    return try StoredMeterReading(
        reading: reading,
        reference: MeterReadingRecordReference(
            uri: "at://did:plc:test/app.graycard.meter.reading/"
                + reading.id.uuidString.lowercased()
        ),
        spotPoint: geometry == .reflectedSpot ? MeterReadingNormalizedPoint(x: 0.4, y: 0.6) : nil,
        deviceModelName: "iPhone test",
        acceptedAt: reading.takenAt
    )
}
