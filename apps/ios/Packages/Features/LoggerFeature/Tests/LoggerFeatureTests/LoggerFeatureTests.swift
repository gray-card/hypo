import Foundation
import HypoLexicon
import Testing

@testable import LoggerFeature

@MainActor
@Test func loggingWritesWireRecordAndAdvancesFrame() async throws {
    let writer = RecordingWriter()
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: writer,
        now: { Date(timeIntervalSince1970: 1_700_000_000) }
    )

    await model.logFrame()

    #expect(model.activeRoll.exposuresUsed == 4)
    #expect(model.draft.frameNumber == 5)
    let records = await writer.records
    #expect(records.count == 1)
    let object = try #require(JSONSerialization.jsonObject(with: records[0]) as? [String: Any])
    #expect(object["$type"] as? String == "app.graycard.instance.exposure")
    #expect(object["roll"] as? String == "at://did:plc:test/app.graycard.instance.filmRoll/roll")
    #expect(object["frameNumber"] as? Int == 4)
}

@MainActor
@Test func loggingCarriesShootAndOnlyWritesEIWhenOverridden() async throws {
    let writer = RecordingWriter()
    let shoot = try ATURI("at://did:plc:test/app.graycard.session.capture/shoot")
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: writer,
        shoots: [ShootAssociation(uri: shoot, label: "August walk")],
        shoot: shoot,
        now: { Date(timeIntervalSince1970: 1_700_000_000) }
    )

    await model.logFrame()
    var records = await writer.records
    var object = try #require(JSONSerialization.jsonObject(with: records[0]) as? [String: Any])
    #expect(object["shoot"] as? String == shoot.rawValue)
    #expect(object["shotAtIso"] == nil)

    model.setExposureIndexOverrideEnabled(true)
    model.draft.shotAtISO = 800
    await model.logFrame()
    records = await writer.records
    object = try #require(JSONSerialization.jsonObject(with: records[1]) as? [String: Any])
    #expect(object["shotAtIso"] as? Int == 800)
}

@MainActor
@Test func multipleExposureKeepsPhysicalFrame() async throws {
    let model = LoggerFeatureModel(activeRoll: try roll(), writer: RecordingWriter())
    model.draft.multipleExposure = true
    model.draft.frameExposureIndex = 1

    await model.logFrame()

    #expect(model.draft.frameNumber == 4)
    #expect(model.draft.frameExposureIndex == 2)
}

@MainActor
@Test func exposureDialsAreGearConstrainedAndRemainStickyAfterLogging() async throws {
    let controls = ExposureControlOptions(
        apertures: ["2.8", "4", "5.6"],
        shutterSpeeds: ["1/500", "1/250"]
    )
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: RecordingWriter(),
        exposureControls: controls
    )

    #expect(model.draft.aperture == "5.6")
    #expect(model.draft.shutterSpeed == "1/500")
    model.selectAperture(at: 0)
    model.selectShutterSpeed(at: 1)
    await model.logFrame()

    #expect(model.draft.aperture == "2.8")
    #expect(model.draft.shutterSpeed == "1/250")
    #expect(model.apertureIndex == 0)
    #expect(model.shutterSpeedIndex == 1)
}

@MainActor
@Test func locationBoundaryIsUntouchedUntilShootOptInAndOptInIsShootScoped() async throws {
    let firstShoot = try ATURI("at://did:plc:test/app.graycard.session.capture/first")
    let secondShoot = try ATURI("at://did:plc:test/app.graycard.session.capture/second")
    let provider = RecordingLocationProvider()
    let writer = RecordingWriter()
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: writer,
        locationProvider: provider,
        shoots: [
            ShootAssociation(uri: firstShoot, label: "Morning walk"),
            ShootAssociation(uri: secondShoot, label: "Evening walk"),
        ],
        shoot: firstShoot,
        now: { Date(timeIntervalSince1970: 1_700_000_000) }
    )

    await model.logFrame()
    #expect(await provider.authorizationRequests == 0)
    #expect(await provider.locationRequests == 0)

    await model.setLocationCaptureEnabled(true)
    #expect(model.isLocationCaptureEnabledForSelectedShoot)
    await model.logFrame()
    #expect(await provider.authorizationRequests == 1)
    #expect(await provider.locationRequests == 1)

    model.associateWithShoot(secondShoot)
    #expect(model.isLocationCaptureEnabledForSelectedShoot == false)
    await model.logFrame()
    #expect(await provider.locationRequests == 1)

    let records = await writer.records
    let firstObject = try #require(
        JSONSerialization.jsonObject(with: records[0]) as? [String: Any]
    )
    #expect(firstObject["location"] == nil)
    let optedInObject = try #require(
        JSONSerialization.jsonObject(with: records[1]) as? [String: Any]
    )
    let location = try #require(optedInObject["location"] as? [String: Any])
    #expect(location["latitude"] as? Int == 43_157_8900)
    #expect(location["longitude"] as? Int == -77_615_8200)
    let secondShootObject = try #require(
        JSONSerialization.jsonObject(with: records[2]) as? [String: Any]
    )
    #expect(secondShootObject["location"] == nil)
}

@MainActor
@Test func refreshedShootListClearsASelectionThatNoLongerExists() async throws {
    let first = try ATURI("at://did:plc:test/app.graycard.session.capture/first")
    let second = try ATURI("at://did:plc:test/app.graycard.session.capture/second")
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: RecordingWriter(),
        shoots: [ShootAssociation(uri: first, label: "First")],
        shoot: first
    )

    model.replaceShoots([ShootAssociation(uri: second, label: "Second")])

    #expect(model.draft.shoot == nil)
    #expect(model.shoots.map(\.uri) == [second])
}

@MainActor
@Test func deniedLocationOptInDoesNotCaptureOrBlockOrdinaryLogging() async throws {
    let shoot = try ATURI("at://did:plc:test/app.graycard.session.capture/denied")
    let provider = RecordingLocationProvider(allowsAuthorization: false)
    let writer = RecordingWriter()
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: writer,
        locationProvider: provider,
        shoots: [ShootAssociation(uri: shoot, label: "No location")],
        shoot: shoot
    )

    await model.setLocationCaptureEnabled(true)
    #expect(model.isLocationCaptureEnabledForSelectedShoot == false)
    #expect(await provider.locationRequests == 0)
    guard case .locationUnavailable = model.error else {
        Issue.record("Expected a location permission error")
        return
    }

    await model.logFrame()
    #expect(await writer.records.count == 1)
}

@MainActor
@Test func firstMultipleExposureWritesSequenceIndexOneWhenDraftIndexIsUnset() async throws {
    let writer = RecordingWriter()
    let model = LoggerFeatureModel(activeRoll: try roll(), writer: writer)
    model.draft.multipleExposure = true
    model.draft.frameExposureIndex = nil

    await model.logFrame()

    let records = await writer.records
    let object = try #require(JSONSerialization.jsonObject(with: records[0]) as? [String: Any])
    #expect(object["multipleExposure"] as? Bool == true)
    #expect(object["frameExposureIndex"] as? Int == 1)
    #expect(model.draft.frameNumber == 4)
    #expect(model.draft.frameExposureIndex == 2)
}

@MainActor
@Test func selectingAnotherHydratedRollRetargetsTheDraftWithoutCarryingFrameState() throws {
    let first = try roll()
    let second = ActiveRoll(
        uri: try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/second"),
        label: "Roll 13",
        stockName: "Ilford HP5 Plus",
        exposureIndex: nil,
        exposuresTotal: nil,
        exposuresUsed: 8,
        camera: try ATURI("at://did:plc:test/app.graycard.instance.camera/f3")
    )
    let model = LoggerFeatureModel(
        activeRoll: first,
        availableRolls: [first, second],
        writer: RecordingWriter()
    )
    model.draft.note = "Does not belong to the next roll"
    model.draft.multipleExposure = true
    model.draft.frameExposureIndex = 3
    model.draft.shotAtISO = 1600

    model.selectActiveRoll(second.uri)

    #expect(model.activeRoll == second)
    #expect(model.draft.roll == second.uri)
    #expect(model.draft.frameNumber == 9)
    #expect(model.draft.camera == second.camera)
    #expect(model.draft.note.isEmpty)
    #expect(model.draft.multipleExposure == false)
    #expect(model.draft.frameExposureIndex == nil)
    #expect(model.draft.shotAtISO == nil)
}

@MainActor
@Test func rejectsImpossibleRollDatesBeforeMutation() throws {
    let model = LoggerFeatureModel(activeRoll: try roll(), writer: RecordingWriter())
    let late = try ATProtoDate("2026-08-02T00:00:00Z")
    let early = try ATProtoDate("2026-08-01T00:00:00Z")

    #expect(throws: LoggerError.self) {
        try model.updateMilestones(FilmRollMilestones(loadedAt: late, developedAt: early))
    }
    #expect(model.activeRoll.milestones.loadedAt == nil)
}

@MainActor
@Test func lifecycleActionPersistsHomeDevelopmentSemantics() async throws {
    let writer = RecordingLifecycleWriter()
    let timestamp = Date(timeIntervalSince1970: 1_750_000_000)
    let unloaded = ATProtoDate(timestamp.addingTimeInterval(-3_600))
    let model = LoggerFeatureModel(
        activeRoll: try roll(
            milestones: FilmRollMilestones(unloadedAt: unloaded)
        ),
        writer: RecordingWriter(),
        lifecycleWriter: writer,
        now: { timestamp }
    )

    try await model.applyLifecycleAction(.developedAtHome)

    #expect(model.activeRoll.milestones.developedAt?.date == timestamp)
    #expect(model.activeRoll.developmentLocation == .home)
    let updates = await writer.updates
    #expect(updates.count == 1)
    #expect(updates[0].roll == model.activeRoll.uri)
    #expect(updates[0].developmentLocation == .home)
}

@MainActor
@Test func lifecycleActionRejectsEarlierStatusAfterLaterStatusWithoutWriting() async throws {
    let writer = RecordingLifecycleWriter()
    let sent = Date(timeIntervalSince1970: 1_750_000_000)
    let model = LoggerFeatureModel(
        activeRoll: try roll(
            milestones: FilmRollMilestones(sentToLabAt: ATProtoDate(sent))
        ),
        writer: RecordingWriter(),
        lifecycleWriter: writer,
        now: { sent.addingTimeInterval(3_600) }
    )

    await #expect(throws: LoggerError.self) {
        try await model.applyLifecycleAction(.unloaded)
    }

    #expect(model.activeRoll.milestones.unloadedAt == nil)
    #expect(await writer.updates.isEmpty)
    guard case let .lifecycle(issues) = model.error else {
        Issue.record("Expected a lifecycle validation error")
        return
    }
    #expect(
        issues.contains(
            ConsumableLifecycleIssue(earlierField: "unloadedAt", laterField: "sentToLabAt")
        )
    )
}

@MainActor
@Test func frameDetailBoundaryLoadsAndUpdatesWithoutChangingCreatedAt() async throws {
    let timestamp = Date(timeIntervalSince1970: 1_750_000_000)
    let createdAt = ATProtoDate(timestamp.addingTimeInterval(-7_200))
    let detailURI = try ATURI("at://did:plc:test/app.graycard.instance.exposure/detail")
    let detail = ExposureDetail(
        uri: detailURI,
        draft: ExposureDraft(
            roll: try roll().uri,
            frameNumber: 3,
            aperture: "8",
            shutterSpeed: "1/250",
            multipleExposure: true,
            frameExposureIndex: 1
        ),
        createdAt: createdAt,
        takenAt: createdAt
    )
    let store = RecordingFrameDetailStore(
        details: [detail],
        frames: [
            FrameSummary(
                frameNumber: 3,
                exposureCount: 1,
                latestTakenAt: createdAt,
                aperture: "8",
                shutterSpeed: "1/250"
            )
        ]
    )
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: RecordingWriter(),
        frameDetailStore: store,
        now: { timestamp }
    )

    await model.loadFrameDetails(frameNumber: 3)
    #expect(model.frameDetails == [detail])
    model.beginEditing(detail)
    model.editingExposure?.draft.note = "Keep this frame"
    await model.saveEditingExposure()

    let updates = await store.updates
    #expect(updates.count == 1)
    #expect(updates[0].uri == detailURI)
    let object = try #require(
        JSONSerialization.jsonObject(with: updates[0].record) as? [String: Any]
    )
    #expect(object["createdAt"] as? String == createdAt.rawValue)
    #expect(object["updatedAt"] as? String == ATProtoDate(timestamp).rawValue)
    #expect(object["note"] as? String == "Keep this frame")
    #expect(model.editingExposure == nil)
}

@MainActor
@Test func frameBrowserLoadsACompleteNewestFirstRollIndexBeforeDetail() async throws {
    let store = RecordingFrameDetailStore(
        details: [],
        frames: [
            FrameSummary(frameNumber: 2, exposureCount: 2),
            FrameSummary(frameNumber: 5, exposureCount: 1),
            FrameSummary(frameNumber: 3, exposureCount: 1),
        ]
    )
    let model = LoggerFeatureModel(
        activeRoll: try roll(),
        writer: RecordingWriter(),
        frameDetailStore: store
    )

    await model.loadFrameList()

    #expect(model.frameSummaries.map(\.frameNumber) == [5, 3, 2])
    #expect(model.selectedFrameNumber == nil)
    await model.loadFrameDetails(frameNumber: 3)
    #expect(model.selectedFrameNumber == 3)
    model.closeSelectedFrame()
    #expect(model.selectedFrameNumber == nil)
}

private actor RecordingWriter: ExposureWriting {
    private(set) var records: [Data] = []

    func createExposure(record: Data) async throws {
        records.append(record)
    }
}

private actor RecordingLifecycleWriter: FilmRollLifecycleWriting {
    private(set) var updates: [FilmRollLifecycleUpdate] = []

    func updateFilmRollLifecycle(_ update: FilmRollLifecycleUpdate) async throws {
        updates.append(update)
    }
}

private actor RecordingFrameDetailStore: FrameDetailStoring {
    struct Update: Sendable {
        let uri: ATURI
        let record: Data
    }

    let details: [ExposureDetail]
    let frameValues: [FrameSummary]
    private(set) var updates: [Update] = []

    init(details: [ExposureDetail], frames: [FrameSummary] = []) {
        self.details = details
        frameValues = frames
    }

    func frames(roll _: ATURI) async throws -> [FrameSummary] { frameValues }

    func exposures(roll _: ATURI, frameNumber _: Int) async throws -> [ExposureDetail] {
        details
    }

    func updateExposure(uri: ATURI, record: Data) async throws {
        updates.append(Update(uri: uri, record: record))
    }
}

private actor RecordingLocationProvider: ShootLocationProviding {
    let allowsAuthorization: Bool
    private(set) var authorizationRequests = 0
    private(set) var locationRequests = 0

    init(allowsAuthorization: Bool = true) {
        self.allowsAuthorization = allowsAuthorization
    }

    func requestWhenInUseAuthorization() async -> Bool {
        authorizationRequests += 1
        return allowsAuthorization
    }

    func currentLocation() async throws -> AppGraycardDefsGeoLocation {
        locationRequests += 1
        return AppGraycardDefsGeoLocation(
            latitude: 43_157_8900,
            longitude: -77_615_8200,
            accuracy: 5_000,
            capturedAt: ATProtoDate(Date(timeIntervalSince1970: 1_700_000_000))
        )
    }
}

private func roll(milestones: FilmRollMilestones = FilmRollMilestones()) throws -> ActiveRoll {
    ActiveRoll(
        uri: try ATURI("at://did:plc:test/app.graycard.instance.filmRoll/roll"),
        label: "Roll 12",
        stockName: "Kodak Tri-X 400",
        exposureIndex: 400,
        exposuresTotal: 36,
        exposuresUsed: 3,
        cameraName: "Nikon F2",
        lensName: "Nikkor 50mm f/1.4",
        milestones: milestones
    )
}
