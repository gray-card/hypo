import ATProtoClient
import CatalogKit
import Foundation
import HypoLexicon
import LoggerFeature
import PersistenceKit
import SyncKit
import Testing

@testable import LibraryFeature

@MainActor
@Test func loadsFiltersAndSearchesCompanionItems() async {
    let model = LibraryFeatureModel(
        provider: StaticLibraryProvider([
            LibraryItem(id: "roll", category: .rolls, title: "Roll 12", subtitle: "Kodak Tri-X 400"),
            LibraryItem(id: "f2", category: .cameras, title: "Nikon F2"),
            LibraryItem(id: "f3", category: .cameras, title: "Nikon F3"),
        ])
    )
    await model.load()
    #expect(model.filteredItems.map(\.id) == ["roll"])

    model.category = .cameras
    model.query = "F3"
    #expect(model.filteredItems.map(\.id) == ["f3"])
}

@MainActor
@Test func anEmptyQueryDoesNotHideCategoryItems() async {
    let model = LibraryFeatureModel(
        provider: StaticLibraryProvider([
            LibraryItem(id: "d76", category: .chemistry, title: "Kodak D-76")
        ])
    )
    await model.load()
    model.category = .chemistry
    model.query = "   "
    #expect(model.filteredItems.map(\.id) == ["d76"])
}

@MainActor
@Test func modelSendsAValidatedRollLoadToTheSemanticWriter() async throws {
    let writer = RecordingLibraryFieldWriter()
    let stockpile = FilmStockpileSelection(
        uri: try ATURI(
            "at://did:plc:field/app.graycard.instance.filmStockpile/reserve"
        ),
        label: "Kodak Tri-X 400",
        quantity: 2
    )
    let model = LibraryFeatureModel(
        provider: StaticLibraryProvider([]),
        fieldWriter: writer
    )
    model.beginFieldAction(.loadFilmRoll(stockpile))
    model.rollLabel = "  Roll 12  "
    model.selectedCameraURI =
        "at://did:plc:field/app.graycard.instance.camera/black-body"

    let now = Date(timeIntervalSince1970: 1_786_000_000)
    await model.savePresentedFieldAction(now: now)

    let requests = await writer.rollLoads
    let request = try #require(requests.first)
    #expect(request.label == "Roll 12")
    #expect(request.camera?.recordKey == "black-body")
    #expect(request.loadedAt == now)
    #expect(model.presentedFieldAction == nil)
    #expect(model.fieldErrorMessage == nil)
    #expect(model.fieldSuccessMessage == "Roll loaded. It is queued for sync.")
}

@MainActor
@Test func modelSurfacesValidationBeforeCallingTheWriter() async throws {
    let writer = RecordingLibraryFieldWriter()
    let selection = CatalogGearSelection(
        kind: .camera,
        stableIdentity: "cameraType:nikon:f2",
        label: "Nikon F2",
        fields: [
            "catalogKind": .string("cameraType"),
            "make": .string("Nikon"),
            "model": .string("F2"),
        ]
    )
    let model = LibraryFeatureModel(
        provider: StaticLibraryProvider([]),
        fieldWriter: writer
    )
    model.beginFieldAction(.quickAddGear(selection))
    model.gearNickname = String(repeating: "x", count: 65)

    await model.savePresentedFieldAction()

    #expect(model.fieldErrorMessage == LibraryFieldError.nicknameTooLong.errorDescription)
    #expect(model.presentedFieldAction != nil)
    #expect(await writer.gearAdds.isEmpty)
}

@MainActor
@Test func webTargetsProduceProductionUniversalLinks() async throws {
    let item = LibraryItem(
        id: "roll",
        category: .rolls,
        title: "Roll 12",
        webTarget: .roll(recordKey: "roll-12")
    )
    let model = LibraryFeatureModel(provider: StaticLibraryProvider([item]))
    await model.load()

    #expect(model.webURL(for: item)?.absoluteString == "https://hypo.graycard.app/roll/roll-12")
    #expect(model.categoryWebURL?.absoluteString == "https://hypo.graycard.app/library/film")
}

@MainActor
@Test func bundledProviderLoadsCanonicalCatalogDomains() async throws {
    let items = try await BundledCatalogLibraryProvider().items()
    #expect(items.contains { $0.category == .cameras })
    #expect(items.contains { $0.category == .lenses })
    #expect(items.contains { $0.category == .film })
    #expect(items.contains { $0.category == .chemistry })
    #expect(items.contains { $0.category == .recipes })
    #expect(items.contains { $0.title.localizedStandardContains("D-76") })
    #expect(items.contains { $0.provenance != nil })
    #expect(
        items.contains {
            guard case .quickAddGear(let selection) = $0.fieldAction else { return false }
            return selection.kind == .camera && selection.fields["catalogKind"] == .string("cameraType")
        }
    )
    #expect(
        items.contains {
            guard case .quickAddGear(let selection) = $0.fieldAction else { return false }
            return selection.kind == .lens && selection.fields["catalogKind"] == .string("lensType")
        }
    )
}

@Test func filmRollEncoderMatchesTheWebSplitSemanticsAndPreservesReserveFields() throws {
    let stockpileURI = try ATURI(
        "at://did:plc:field/app.graycard.instance.filmStockpile/reserve"
    )
    let cameraURI = try ATURI(
        "at://did:plc:field/app.graycard.instance.camera/black-body"
    )
    let stockpile = Data(
        #"{"$type":"app.graycard.instance.filmStockpile","stock":"at://did:plc:field/app.graycard.catalog.filmStock/tri-x","quantity":3,"format":"35mm","storage":"freezer","expiresAt":"2027-08-01T00:00:00Z","emulsionBatch":"AB-2231","createdAt":"2026-01-01T00:00:00Z","futureField":{"keep":true}}"#
            .utf8
    )
    let loadedAt = Date(timeIntervalSince1970: 1_786_000_000)
    let records = try LibraryFieldRecordEncoder.filmRollLoadRecords(
        stockpileRecord: stockpile,
        request: FilmRollLoadRequest(
            stockpile: FilmStockpileSelection(
                uri: stockpileURI,
                label: "Kodak Tri-X 400",
                quantity: 3
            ),
            camera: cameraURI,
            label: " Roll 12 ",
            loadedAt: loadedAt
        )
    )

    let roll = try JSONDecoder().decode(AppGraycardInstanceFilmRollMain.self, from: records.roll)
    #expect(roll.stock.rawValue.hasSuffix("/tri-x"))
    #expect(roll.stockpile == stockpileURI)
    #expect(roll.camera == cameraURI)
    #expect(roll.label == "Roll 12")
    #expect(roll.status == .loaded)
    #expect(roll.format?.rawValue == "35mm")
    #expect(roll.storage?.rawValue == "freezer")
    #expect(roll.expiresAt?.rawValue == "2027-08-01T00:00:00Z")
    #expect(roll.emulsionBatch == "AB-2231")
    #expect(roll.loadedAt?.date == loadedAt)

    let updated = try #require(
        JSONSerialization.jsonObject(with: records.updatedStockpile) as? [String: Any]
    )
    #expect(updated["quantity"] as? Int == 2)
    #expect((updated["futureField"] as? [String: Any])?["keep"] as? Bool == true)
    #expect(updated["createdAt"] as? String == "2026-01-01T00:00:00Z")
}

@Test func cameraQuickAddEncoderWritesLinkedSchemaValidRecordsAndCatalogAssets() throws {
    let selection = CatalogGearSelection(
        kind: .camera,
        stableIdentity: "cameraType:nikon:f2",
        label: "Nikon F2",
        fields: [
            "catalogKind": .string("cameraType"),
            "make": .string("Nikon"),
            "model": .string("F2"),
            "cropFactor": .number(1.5),
            "image": .string("https://example.test/f2.jpg"),
            "datasheetUrl": .string("https://example.test/f2.pdf"),
            "wikidata": .string("Q123"),
        ]
    )
    let typeURI = try ATURI(
        "at://did:plc:field/app.graycard.catalog.cameraType/3mtype"
    )
    let records = try LibraryFieldRecordEncoder.gearQuickAddRecords(
        request: GearQuickAddRequest(
            selection: selection,
            nickname: "Black body",
            serialNumber: "7100001",
            createdAt: Date(timeIntervalSince1970: 1_786_000_000)
        ),
        catalogTypeURI: typeURI
    )

    let type = try JSONDecoder().decode(AppGraycardCatalogCameraTypeMain.self, from: records.catalogType)
    #expect(type.make == "Nikon")
    #expect(type.model == "F2")
    #expect(type.cropFactor == 1_500_000)
    #expect(type.image?.url == "https://example.test/f2.jpg")
    #expect(type.datasheet?.url == "https://example.test/f2.pdf")
    #expect(type.links?.externalIds?.first?.value == "Q123")

    let instance = try JSONDecoder().decode(AppGraycardInstanceCameraMain.self, from: records.instance)
    #expect(instance.type == typeURI)
    #expect(instance.nickname == "Black body")
    #expect(instance.serialNumber == "7100001")
}

@Test func lensQuickAddEncoderScalesDisplayMeasurementsLikeWebHypo() throws {
    let selection = CatalogGearSelection(
        kind: .lens,
        stableIdentity: "lensType:nikon:nikkor-50",
        label: "Nikon Nikkor 50mm f/1.4",
        fields: [
            "catalogKind": .string("lensType"),
            "make": .string("Nikon"),
            "model": .string("Nikkor 50mm f/1.4"),
            "focalLengthMin": .number(50),
            "focalLengthMax": .number(50),
            "maxAperture": .number(1.4),
            "apertureSteps": .array([.number(1.4), .number(2), .number(2.8)]),
        ]
    )
    let typeURI = try ATURI(
        "at://did:plc:field/app.graycard.catalog.lensType/3mtype"
    )
    let records = try LibraryFieldRecordEncoder.gearQuickAddRecords(
        request: GearQuickAddRequest(selection: selection),
        catalogTypeURI: typeURI
    )

    let type = try JSONDecoder().decode(AppGraycardCatalogLensTypeMain.self, from: records.catalogType)
    #expect(type.focalLengthMin == 50_000_000)
    #expect(type.focalLengthMax == 50_000_000)
    #expect(type.maxAperture == 1_400_000)
    #expect(type.apertureSteps == [1_400_000, 2_000_000, 2_800_000])
    let instance = try JSONDecoder().decode(AppGraycardInstanceLensMain.self, from: records.instance)
    #expect(instance.type == typeURI)
}

@Test func emptyStockpileAndCrossAccountCameraAreRejectedExplicitly() throws {
    let stockpile = FilmStockpileSelection(
        uri: try ATURI(
            "at://did:plc:field/app.graycard.instance.filmStockpile/reserve"
        ),
        label: "Tri-X",
        quantity: 0
    )
    #expect(throws: LibraryFieldError.emptyStockpile) {
        try LibraryFieldRequestValidator.validate(FilmRollLoadRequest(stockpile: stockpile))
    }

    let available = FilmStockpileSelection(
        uri: stockpile.uri,
        label: stockpile.label,
        quantity: 1
    )
    let anotherAccountCamera = try ATURI(
        "at://did:plc:other/app.graycard.instance.camera/body"
    )
    #expect(throws: LibraryFieldError.invalidCamera) {
        try LibraryFieldRequestValidator.validate(
            FilmRollLoadRequest(stockpile: available, camera: anotherAccountCamera)
        )
    }
}

@Test func queuedWriterDurablyOrdersCatalogTypeBeforeOwnedGear() async throws {
    let store = InMemoryPersistenceStore()
    let engine = SyncEngine(store: store, transport: NeverSyncTransport())
    let writer = QueuedLibraryFieldWriter(
        engine: engine,
        store: store,
        hydrator: FixtureHydrator(records: [:]),
        sessionProvider: testSessionProvider(),
        recordKeyGenerator: FixedLibraryRecordKeyGenerator(["type-key", "camera-key"])
    )
    let selection = CatalogGearSelection(
        kind: .camera,
        stableIdentity: "cameraType:nikon:f2",
        label: "Nikon F2",
        fields: [
            "catalogKind": .string("cameraType"),
            "make": .string("Nikon"),
            "model": .string("F2"),
        ]
    )
    let now = Date(timeIntervalSince1970: 1_786_000_000)

    let receipt = try await writer.quickAddGear(
        GearQuickAddRequest(selection: selection, nickname: "Black body", createdAt: now)
    )

    #expect(receipt.createdRecord.recordKey == "camera-key")
    let snapshot = await store.snapshot()
    #expect(
        snapshot.outbox.map(\.collection) == [
            GeneratedRecordNSID.catalogCameraType.rawValue,
            GeneratedRecordNSID.instanceCamera.rawValue,
        ]
    )
    #expect(snapshot.outbox.map(\.rkey) == ["type-key", "camera-key"])
    let instanceData = try #require(snapshot.outbox.last?.record)
    let instance = try JSONDecoder().decode(AppGraycardInstanceCameraMain.self, from: instanceData)
    #expect(
        instance.type.rawValue
            == "at://did:plc:field/app.graycard.catalog.cameraType/type-key"
    )
    let projection = try await LiveCompanionLibraryProvider(
        repo: "did:plc:field",
        hydrator: FixtureHydrator(records: [:]),
        store: store
    ).snapshot()
    #expect(
        projection.items.contains {
            $0.category == .cameras && $0.title == "Black body" && $0.subtitle == "Nikon F2"
        }
    )
}

@Test func queuedWriterLoadsFromCachedReserveBeforeQueuingItsCASUpdate() async throws {
    let repo = "did:plc:field"
    let stockpile = remote(
        repo: repo,
        collection: GeneratedRecordNSID.instanceFilmStockpile.rawValue,
        rkey: "reserve",
        json:
            #"{"$type":"app.graycard.instance.filmStockpile","stock":"at://did:plc:field/app.graycard.catalog.filmStock/tri-x","quantity":2,"createdAt":"2026-01-01T00:00:00Z"}"#
    )
    let store = InMemoryPersistenceStore(
        snapshot: PersistenceSnapshot(records: [stockpile.cached()])
    )
    let engine = SyncEngine(store: store, transport: NeverSyncTransport())
    let writer = QueuedLibraryFieldWriter(
        engine: engine,
        store: store,
        hydrator: FixtureHydrator(records: [:], failingCollections: [stockpile.collection]),
        sessionProvider: testSessionProvider(),
        recordKeyGenerator: FixedLibraryRecordKeyGenerator(["roll-key"])
    )
    let now = Date(timeIntervalSince1970: 1_786_000_000)

    let receipt = try await writer.loadFilmRoll(
        FilmRollLoadRequest(
            stockpile: FilmStockpileSelection(
                uri: try ATURI(stockpile.uri),
                label: "Kodak Tri-X 400",
                quantity: 2
            ),
            label: "Roll 12",
            loadedAt: now
        )
    )

    #expect(receipt.createdRecord.recordKey == "roll-key")
    let snapshot = await store.snapshot()
    #expect(
        snapshot.outbox.map(\.collection) == [
            GeneratedRecordNSID.instanceFilmRoll.rawValue,
            GeneratedRecordNSID.instanceFilmStockpile.rawValue,
        ]
    )
    #expect(snapshot.outbox.last?.swapRecord == stockpile.cid)
    let updated = try #require(snapshot.outbox.last?.record)
    let reserve = try JSONDecoder().decode(
        AppGraycardInstanceFilmStockpileMain.self,
        from: updated
    )
    #expect(reserve.quantity == 1)
}

@Test func queuedWriterReusesAnExistingCatalogType() async throws {
    let typeURI = "at://did:plc:field/app.graycard.catalog.lensType/nikkor"
    let type = CachedRecord(
        uri: typeURI,
        cid: "bafy-type",
        collection: GeneratedRecordNSID.catalogLensType.rawValue,
        rkey: "nikkor",
        value: Data(
            #"{"$type":"app.graycard.catalog.lensType","make":"Nikon","model":"Nikkor 50mm f/1.4","createdAt":"2026-01-01T00:00:00Z"}"#
                .utf8
        )
    )
    let store = InMemoryPersistenceStore(snapshot: PersistenceSnapshot(records: [type]))
    let writer = QueuedLibraryFieldWriter(
        engine: SyncEngine(store: store, transport: NeverSyncTransport()),
        store: store,
        hydrator: FixtureHydrator(records: [:]),
        sessionProvider: testSessionProvider(),
        recordKeyGenerator: FixedLibraryRecordKeyGenerator(["lens-copy"])
    )
    let selection = CatalogGearSelection(
        kind: .lens,
        stableIdentity: "lensType:nikon:nikkor-50",
        label: "Nikon Nikkor 50mm f/1.4",
        fields: [
            "catalogKind": .string("lensType"),
            "make": .string("Nikon"),
            "model": .string("Nikkor 50mm f/1.4"),
        ]
    )

    _ = try await writer.quickAddGear(GearQuickAddRequest(selection: selection))

    let outbox = await store.snapshot().outbox
    #expect(outbox.count == 1)
    #expect(outbox[0].collection == GeneratedRecordNSID.instanceLens.rawValue)
    let instance = try JSONDecoder().decode(
        AppGraycardInstanceLensMain.self,
        from: try #require(outbox[0].record)
    )
    #expect(instance.type.rawValue == typeURI)
}

@Test func tidGeneratorProducesSortableLexiconRecordKeys() async {
    let generator = TIDLibraryRecordKeyGenerator(clockID: 7)
    let date = Date(timeIntervalSince1970: 1_786_000_000)
    let first = await generator.nextRecordKey(at: date)
    let second = await generator.nextRecordKey(at: date)

    #expect(first.count == 13)
    #expect(first.allSatisfy { "234567abcdefghijklmnopqrstuvwxyz".contains($0) })
    #expect(first < second)
}

@Test func liveProviderHydratesProjectsAndCachesCompanionRecords() async throws {
    let repo = "did:plc:field"
    let records = [
        remote(
            repo: repo,
            collection: "app.graycard.catalog.cameraType",
            rkey: "f2",
            json:
                #"{"$type":"app.graycard.catalog.cameraType","make":"Nikon","model":"F2","createdAt":"2026-08-01T00:00:00Z"}"#
        ),
        remote(
            repo: repo,
            collection: "app.graycard.instance.camera",
            rkey: "black-body",
            json:
                #"{"$type":"app.graycard.instance.camera","type":"at://did:plc:field/app.graycard.catalog.cameraType/f2","nickname":"Black body","serialNumber":"7100001","createdAt":"2026-08-02T00:00:00Z"}"#
        ),
        remote(
            repo: repo,
            collection: "app.graycard.catalog.filmStock",
            rkey: "tri-x",
            json:
                #"{"$type":"app.graycard.catalog.filmStock","brand":"Kodak","name":"Tri-X 400","iso":400,"exposuresPerRoll":36,"createdAt":"2026-08-01T00:00:00Z"}"#
        ),
        remote(
            repo: repo,
            collection: "app.graycard.instance.filmStockpile",
            rkey: "reserve",
            json:
                #"{"$type":"app.graycard.instance.filmStockpile","stock":"at://did:plc:field/app.graycard.catalog.filmStock/tri-x","quantity":2,"format":"135","createdAt":"2026-08-02T00:00:00Z"}"#
        ),
        remote(
            repo: repo,
            collection: "app.graycard.instance.filmRoll",
            rkey: "roll-12",
            json:
                #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:field/app.graycard.catalog.filmStock/tri-x","label":"Roll 12","status":"partial","exposuresUsed":3,"shotAtIso":800,"camera":"at://did:plc:field/app.graycard.instance.camera/black-body","loadedAt":"2026-08-03T00:00:00Z","partialAt":"2026-08-03T01:00:00Z","createdAt":"2026-08-03T00:00:00Z"}"#
        ),
        remote(
            repo: repo,
            collection: "app.graycard.catalog.devRecipe",
            rkey: "tri-x-d76",
            json:
                #"{"$type":"app.graycard.catalog.devRecipe","developerMake":"Kodak","developerName":"D-76","dilution":"1+1","filmMake":"Kodak","filmName":"Tri-X 400","process":"bw","temps":[{"tempC10":200,"timeSec":570}],"source":"https://example.test/datasheet","createdAt":"2026-08-02T00:00:00Z"}"#
        ),
    ]
    let hydrator = FixtureHydrator(records: Dictionary(grouping: records, by: \.collection))
    let store = InMemoryPersistenceStore()
    let provider = LiveCompanionLibraryProvider(repo: repo, hydrator: hydrator, store: store)

    let snapshot = try await provider.snapshot()

    #expect(snapshot.items.contains { $0.id.hasSuffix("/black-body") && $0.title == "Black body" })
    #expect(snapshot.items.contains { $0.id.hasSuffix("/reserve") && $0.subtitle == "2 on hand" })
    #expect(snapshot.items.contains { $0.id.hasSuffix("/roll-12") && $0.subtitle == "Kodak Tri-X 400" })
    #expect(snapshot.items.contains { $0.id.hasSuffix("/tri-x-d76") && $0.provenance == "Your recipe" })
    let active = try #require(snapshot.activeRolls.first)
    #expect(active.label == "Roll 12")
    #expect(active.stockName == "Kodak Tri-X 400")
    #expect(active.exposureIndex == 800)
    #expect(active.exposuresTotal == 36)
    #expect(active.exposuresUsed == 3)
    #expect(active.cameraName == "Black body")
    #expect(snapshot.warnings.isEmpty)
    #expect(await store.snapshot().records.count == records.count)
    let reserve = try #require(snapshot.items.first { $0.id.hasSuffix("/reserve") })
    guard case .loadFilmRoll(let selection) = reserve.fieldAction else {
        Issue.record("The live stockpile did not project a load-roll action.")
        return
    }
    #expect(selection.quantity == 2)
    #expect(selection.uri.recordKey == "reserve")
    #expect(reserve.webTarget == .gear(kind: "filmStockpile", recordKey: "reserve"))
}

@Test func failedRefreshUsesCachedRecordsAndReportsAWarning() async throws {
    let repo = "did:plc:offline"
    let stock = remote(
        repo: repo,
        collection: "app.graycard.catalog.filmStock",
        rkey: "hp5",
        json:
            #"{"$type":"app.graycard.catalog.filmStock","brand":"Ilford","name":"HP5 Plus","iso":400,"createdAt":"2026-08-01T00:00:00Z"}"#
    )
    let roll = remote(
        repo: repo,
        collection: "app.graycard.instance.filmRoll",
        rkey: "loaded",
        json:
            #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:offline/app.graycard.catalog.filmStock/hp5","status":"loaded","loadedAt":"2026-08-03T00:00:00Z","createdAt":"2026-08-03T00:00:00Z"}"#
    )
    let store = InMemoryPersistenceStore(
        snapshot: PersistenceSnapshot(records: [stock.cached(), roll.cached()])
    )
    let hydrator = FixtureHydrator(
        records: [:],
        failingCollections: [stock.collection, roll.collection]
    )
    let provider = LiveCompanionLibraryProvider(repo: repo, hydrator: hydrator, store: store)

    let snapshot = try await provider.snapshot()

    #expect(snapshot.activeRolls.count == 1)
    #expect(snapshot.activeRolls[0].stockName == "Ilford HP5 Plus")
    #expect(snapshot.warnings.contains { $0.collection == roll.collection })
    #expect(await store.snapshot().records.count == 2)
}

@Test func malformedOrWrongTypeRollIsNeverProjectedAsLiveData() async throws {
    let repo = "did:plc:invalid"
    let wrongType = remote(
        repo: repo,
        collection: "app.graycard.instance.filmRoll",
        rkey: "not-a-roll",
        json:
            #"{"$type":"app.graycard.instance.camera","stock":"at://did:plc:invalid/app.graycard.catalog.filmStock/film","createdAt":"2026-08-03T00:00:00Z"}"#
    )
    let hydrator = FixtureHydrator(records: [wrongType.collection: [wrongType]])
    let provider = LiveCompanionLibraryProvider(
        repo: repo,
        hydrator: hydrator,
        store: InMemoryPersistenceStore()
    )

    let snapshot = try await provider.snapshot()

    #expect(snapshot.activeRolls.isEmpty)
    #expect(!snapshot.items.contains { $0.id.hasSuffix("/not-a-roll") })
    #expect(snapshot.warnings.contains { $0.collection == wrongType.collection })
}

@Test func exposureRecordsDeriveTheNextPhysicalFrameAcrossRelaunch() async throws {
    let repo = "did:plc:frames"
    let roll = remote(
        repo: repo,
        collection: "app.graycard.instance.filmRoll",
        rkey: "loaded",
        json:
            #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:frames/app.graycard.catalog.filmStock/hp5","status":"partial","exposuresUsed":2,"loadedAt":"2026-08-03T00:00:00Z","createdAt":"2026-08-03T00:00:00Z"}"#
    )
    let first = remote(
        repo: repo,
        collection: "app.graycard.instance.exposure",
        rkey: "first",
        json:
            #"{"$type":"app.graycard.instance.exposure","roll":"at://did:plc:frames/app.graycard.instance.filmRoll/loaded","frameNumber":3,"multipleExposure":true,"frameExposureIndex":1,"createdAt":"2026-08-03T01:00:00Z"}"#
    )
    let second = remote(
        repo: repo,
        collection: "app.graycard.instance.exposure",
        rkey: "second",
        json:
            #"{"$type":"app.graycard.instance.exposure","roll":"at://did:plc:frames/app.graycard.instance.filmRoll/loaded","frameNumber":3,"multipleExposure":true,"frameExposureIndex":2,"createdAt":"2026-08-03T01:01:00Z"}"#
    )
    let records = [roll, first, second]
    let provider = LiveCompanionLibraryProvider(
        repo: repo,
        hydrator: FixtureHydrator(records: Dictionary(grouping: records, by: \.collection)),
        store: InMemoryPersistenceStore()
    )

    let active = try #require(try await provider.activeRolls().first)

    #expect(active.exposuresUsed == 3)
    #expect(active.nextFrameNumber == 4)
}

@Test func pendingExposureWinsOverStaleRemoteCopyWhenDerivingNextFrame() async throws {
    let repo = "did:plc:pending"
    let roll = remote(
        repo: repo,
        collection: "app.graycard.instance.filmRoll",
        rkey: "loaded",
        json:
            #"{"$type":"app.graycard.instance.filmRoll","stock":"at://did:plc:pending/app.graycard.catalog.filmStock/hp5","status":"partial","loadedAt":"2026-08-03T00:00:00Z","createdAt":"2026-08-03T00:00:00Z"}"#
    )
    let stale = remote(
        repo: repo,
        collection: "app.graycard.instance.exposure",
        rkey: "edited",
        json:
            #"{"$type":"app.graycard.instance.exposure","roll":"at://did:plc:pending/app.graycard.instance.filmRoll/loaded","frameNumber":4,"createdAt":"2026-08-03T01:00:00Z"}"#
    )
    let operationID = UUID()
    var pending = stale.cached()
    pending.value = Data(
        #"{"$type":"app.graycard.instance.exposure","roll":"at://did:plc:pending/app.graycard.instance.filmRoll/loaded","frameNumber":6,"createdAt":"2026-08-03T01:00:00Z","updatedAt":"2026-08-03T02:00:00Z"}"#
            .utf8
    )
    pending.pendingOperationID = operationID
    let outbox = OutboxOperation(
        id: operationID,
        kind: .put,
        repo: repo,
        collection: stale.collection,
        rkey: stale.rkey,
        uri: stale.uri,
        record: pending.value,
        swapRecord: stale.cid
    )
    let store = InMemoryPersistenceStore(
        snapshot: PersistenceSnapshot(records: [pending], outbox: [outbox])
    )
    let records = [roll, stale]
    let provider = LiveCompanionLibraryProvider(
        repo: repo,
        hydrator: FixtureHydrator(records: Dictionary(grouping: records, by: \.collection)),
        store: store
    )

    let active = try #require(try await provider.activeRolls().first)

    #expect(active.exposuresUsed == 6)
    #expect(active.nextFrameNumber == 7)
    let persisted = try #require(await store.snapshot().records.first { $0.uri == stale.uri })
    #expect(persisted.pendingOperationID == operationID)
    let object = try #require(
        JSONSerialization.jsonObject(with: persisted.value) as? [String: Any]
    )
    #expect(object["frameNumber"] as? Int == 6)
}

private actor FixtureHydrator: RecordHydrating {
    enum Failure: Error { case offline }

    let records: [String: [HydratedRepositoryRecord]]
    let failingCollections: Set<String>

    init(
        records: [String: [HydratedRepositoryRecord]],
        failingCollections: Set<String> = []
    ) {
        self.records = records
        self.failingCollections = failingCollections
    }

    func get(_ request: RecordHydrationRequest) async throws -> HydratedRepositoryRecord {
        guard !failingCollections.contains(request.collection),
            let record = records[request.collection]?.first(where: { $0.rkey == request.rkey })
        else { throw Failure.offline }
        return record
    }

    func list(_ request: RecordListHydrationRequest) async throws -> HydratedRepositoryPage {
        guard !failingCollections.contains(request.collection) else { throw Failure.offline }
        return HydratedRepositoryPage(records: request.cursor == nil ? records[request.collection] ?? [] : [])
    }
}

private actor RecordingLibraryFieldWriter: LibraryFieldSemanticWriting {
    private(set) var rollLoads: [FilmRollLoadRequest] = []
    private(set) var gearAdds: [GearQuickAddRequest] = []

    func loadFilmRoll(_ request: FilmRollLoadRequest) async throws -> LibraryFieldWriteReceipt {
        rollLoads.append(request)
        return LibraryFieldWriteReceipt(
            createdRecord: try ATURI(
                "at://did:plc:field/app.graycard.instance.filmRoll/created"
            ),
            acceptedAt: request.loadedAt
        )
    }

    func quickAddGear(_ request: GearQuickAddRequest) async throws -> LibraryFieldWriteReceipt {
        gearAdds.append(request)
        return LibraryFieldWriteReceipt(
            createdRecord: try ATURI(
                "at://did:plc:field/\(request.selection.kind.instanceCollection.rawValue)/created"
            ),
            acceptedAt: request.createdAt
        )
    }
}

private actor FixedLibraryRecordKeyGenerator: LibraryRecordKeyGenerating {
    private var values: [String]

    init(_ values: [String]) {
        self.values = values
    }

    func nextRecordKey(at _: Date) -> String {
        precondition(!values.isEmpty)
        return values.removeFirst()
    }
}

private actor NeverSyncTransport: SyncTransport {
    func execute(_: OutboxOperation) async throws -> RemoteWriteResult {
        throw SyncTransportError.permanent(message: "The test writer must remain offline.")
    }
}

private func testSessionProvider() -> FixedSyncOAuthSessionProvider {
    FixedSyncOAuthSessionProvider(
        OAuthSession(
            id: OAuthSessionID(rawValue: "library-field-test"),
            issuer: URL(string: "https://auth.example.test")!,
            subject: "did:plc:field",
            accessToken: "access-token"
        )
    )
}

private func remote(
    repo: String,
    collection: String,
    rkey: String,
    json: String
) -> HydratedRepositoryRecord {
    HydratedRepositoryRecord(
        uri: "at://\(repo)/\(collection)/\(rkey)",
        cid: "bafy-\(rkey)",
        collection: collection,
        rkey: rkey,
        value: Data(json.utf8)
    )
}
