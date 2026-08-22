import CatalogKit
import Foundation
import HypoLexicon

public enum LibraryGearKind: String, Codable, Hashable, Sendable {
    case camera
    case lens

    public var category: LibraryCategory {
        switch self {
        case .camera: .cameras
        case .lens: .lenses
        }
    }

    public var catalogCollection: NSID {
        switch self {
        case .camera: GeneratedRecordNSID.catalogCameraType
        case .lens: GeneratedRecordNSID.catalogLensType
        }
    }

    public var instanceCollection: NSID {
        switch self {
        case .camera: GeneratedRecordNSID.instanceCamera
        case .lens: GeneratedRecordNSID.instanceLens
        }
    }
}

/// A bundled catalog entry that can be copied into the signed-in account before an owned
/// camera or lens instance is created.
public struct CatalogGearSelection: Codable, Hashable, Sendable {
    public let kind: LibraryGearKind
    public let stableIdentity: String
    public let label: String
    public let fields: [String: CatalogKit.JSONValue]

    public init(
        kind: LibraryGearKind,
        stableIdentity: String,
        label: String,
        fields: [String: CatalogKit.JSONValue]
    ) {
        self.kind = kind
        self.stableIdentity = stableIdentity
        self.label = label
        self.fields = fields
    }
}

public struct FilmStockpileSelection: Codable, Hashable, Sendable {
    public let uri: ATURI
    public let label: String
    public let quantity: Int

    public init(uri: ATURI, label: String, quantity: Int) {
        self.uri = uri
        self.label = label
        self.quantity = quantity
    }
}

public enum LibraryFieldAction: Codable, Hashable, Sendable {
    case loadFilmRoll(FilmStockpileSelection)
    case quickAddGear(CatalogGearSelection)
}

public enum LibraryWebTarget: Codable, Hashable, Sendable {
    case library(tab: String)
    case roll(recordKey: String)
    case gear(kind: String, recordKey: String)

    public func url(relativeTo baseURL: URL) -> URL? {
        let path: String
        switch self {
        case .library(let tab): path = "library/\(tab)"
        case .roll(let recordKey): path = "roll/\(recordKey)"
        case .gear(let kind, let recordKey): path = "gear/\(kind)/\(recordKey)"
        }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}

public struct FilmRollLoadRequest: Hashable, Sendable {
    public let stockpile: FilmStockpileSelection
    public let camera: ATURI?
    public let label: String?
    public let loadedAt: Date

    public init(
        stockpile: FilmStockpileSelection,
        camera: ATURI? = nil,
        label: String? = nil,
        loadedAt: Date = Date()
    ) {
        self.stockpile = stockpile
        self.camera = camera
        self.label = label
        self.loadedAt = loadedAt
    }
}

public struct GearQuickAddRequest: Hashable, Sendable {
    public let selection: CatalogGearSelection
    public let nickname: String?
    public let serialNumber: String?
    public let createdAt: Date

    public init(
        selection: CatalogGearSelection,
        nickname: String? = nil,
        serialNumber: String? = nil,
        createdAt: Date = Date()
    ) {
        self.selection = selection
        self.nickname = nickname
        self.serialNumber = serialNumber
        self.createdAt = createdAt
    }
}

public struct LibraryFieldWriteReceipt: Hashable, Sendable {
    public let createdRecord: ATURI
    public let acceptedAt: Date

    public init(createdRecord: ATURI, acceptedAt: Date) {
        self.createdRecord = createdRecord
        self.acceptedAt = acceptedAt
    }
}

/// Account-bound application composition implements this boundary with its durable sync engine.
/// A return value means every required create/update has been accepted by durable storage.
public protocol LibraryFieldSemanticWriting: Sendable {
    func loadFilmRoll(_ request: FilmRollLoadRequest) async throws -> LibraryFieldWriteReceipt
    func quickAddGear(_ request: GearQuickAddRequest) async throws -> LibraryFieldWriteReceipt
}

public struct UnavailableLibraryFieldWriter: LibraryFieldSemanticWriting {
    public init() {}

    public func loadFilmRoll(_: FilmRollLoadRequest) async throws -> LibraryFieldWriteReceipt {
        throw LibraryFieldError.writerUnavailable
    }

    public func quickAddGear(_: GearQuickAddRequest) async throws -> LibraryFieldWriteReceipt {
        throw LibraryFieldError.writerUnavailable
    }
}

public enum LibraryFieldError: Error, Equatable, Sendable, LocalizedError {
    case writerUnavailable
    case invalidAction
    case invalidStockpile
    case emptyStockpile
    case pendingRecord
    case invalidCamera
    case labelTooLong
    case nicknameTooLong
    case serialNumberTooLong
    case malformedCatalogItem(String)
    case invalidRecord(String)

    public var errorDescription: String? {
        switch self {
        case .writerUnavailable: "Sign in before changing your library."
        case .invalidAction: "This item does not support that field action."
        case .invalidStockpile: "The film reserve is not a valid stockpile record."
        case .emptyStockpile: "This reserve has no rolls left to load."
        case .pendingRecord: "Finish syncing this reserve before loading another roll."
        case .invalidCamera: "The selected camera is not an owned camera record."
        case .labelTooLong: "The roll label can contain at most 128 characters."
        case .nicknameTooLong: "The nickname can contain at most 64 characters."
        case .serialNumberTooLong: "The serial number can contain at most 128 characters."
        case .malformedCatalogItem(let detail): "The catalog item cannot be added: \(detail)"
        case .invalidRecord(let detail): "The record is not valid: \(detail)"
        }
    }
}

public enum LibraryFieldRequestValidator {
    public static func validate(_ request: FilmRollLoadRequest) throws {
        guard request.stockpile.uri.collection == GeneratedRecordNSID.instanceFilmStockpile else {
            throw LibraryFieldError.invalidStockpile
        }
        guard request.stockpile.quantity > 0 else { throw LibraryFieldError.emptyStockpile }
        if let camera = request.camera,
            camera.collection != GeneratedRecordNSID.instanceCamera
                || camera.authority != request.stockpile.uri.authority
        {
            throw LibraryFieldError.invalidCamera
        }
        if request.label?.count ?? 0 > 128 { throw LibraryFieldError.labelTooLong }
    }

    public static func validate(_ request: GearQuickAddRequest) throws {
        guard request.nickname?.count ?? 0 <= 64 else { throw LibraryFieldError.nicknameTooLong }
        guard request.serialNumber?.count ?? 0 <= 128 else {
            throw LibraryFieldError.serialNumberTooLong
        }
        let expectedKind = request.selection.fields["catalogKind"]?.stringValue
        let actualKind = request.selection.kind == .camera ? "cameraType" : "lensType"
        guard expectedKind == actualKind else {
            throw LibraryFieldError.malformedCatalogItem("The selected item has the wrong catalog kind.")
        }
    }
}

public struct FilmRollLoadRecords: Hashable, Sendable {
    public let roll: Data
    public let updatedStockpile: Data

    public init(roll: Data, updatedStockpile: Data) {
        self.roll = roll
        self.updatedStockpile = updatedStockpile
    }
}

public struct GearQuickAddRecords: Hashable, Sendable {
    public let catalogType: Data
    public let instance: Data

    public init(catalogType: Data, instance: Data) {
        self.catalogType = catalogType
        self.instance = instance
    }
}

/// Wire helpers shared by account-bound writers. Each method validates the exact lexicon before
/// returning data, so composition cannot accidentally enqueue a partial or misshapen record.
public enum LibraryFieldRecordEncoder {
    public static func filmRollLoadRecords(
        stockpileRecord: Data,
        request: FilmRollLoadRequest
    ) throws -> FilmRollLoadRecords {
        try LibraryFieldRequestValidator.validate(request)
        try validate(stockpileRecord, as: GeneratedRecordNSID.instanceFilmStockpile)
        let stockpile = try JSONDecoder().decode(
            AppGraycardInstanceFilmStockpileMain.self,
            from: stockpileRecord
        )
        guard stockpile.quantity > 0 else { throw LibraryFieldError.emptyStockpile }

        let timestamp = try wireDate(request.loadedAt)
        let roll = AppGraycardInstanceFilmRollMain(
            stock: stockpile.stock,
            createdAt: timestamp,
            label: trimmed(request.label),
            emulsionBatch: stockpile.emulsionBatch,
            expiresAt: stockpile.expiresAt,
            status: .loaded,
            storage: stockpile.storage,
            format: stockpile.format,
            stockpile: request.stockpile.uri,
            camera: request.camera,
            loadedAt: timestamp
        )
        let rollData = try JSONEncoder.hypo.encode(roll)
        try validate(rollData, as: GeneratedRecordNSID.instanceFilmRoll)

        guard var object = try JSONSerialization.jsonObject(with: stockpileRecord) as? [String: Any]
        else { throw LibraryFieldError.invalidStockpile }
        object["quantity"] = stockpile.quantity - 1
        object["updatedAt"] = timestamp.rawValue
        let updated = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        try validate(updated, as: GeneratedRecordNSID.instanceFilmStockpile)
        return FilmRollLoadRecords(roll: rollData, updatedStockpile: updated)
    }

    public static func gearQuickAddRecords(
        request: GearQuickAddRequest,
        catalogTypeURI: ATURI
    ) throws -> GearQuickAddRecords {
        try LibraryFieldRequestValidator.validate(request)
        guard catalogTypeURI.collection == request.selection.kind.catalogCollection else {
            throw LibraryFieldError.malformedCatalogItem(
                "The reserved type URI uses the wrong collection."
            )
        }
        let typeData = try catalogTypeRecord(request)
        let timestamp = try wireDate(request.createdAt)
        let instanceData: Data
        switch request.selection.kind {
        case .camera:
            instanceData = try JSONEncoder.hypo.encode(
                AppGraycardInstanceCameraMain(
                    type: catalogTypeURI,
                    createdAt: timestamp,
                    nickname: trimmed(request.nickname),
                    serialNumber: trimmed(request.serialNumber)
                )
            )
        case .lens:
            instanceData = try JSONEncoder.hypo.encode(
                AppGraycardInstanceLensMain(
                    type: catalogTypeURI,
                    createdAt: timestamp,
                    nickname: trimmed(request.nickname),
                    serialNumber: trimmed(request.serialNumber)
                )
            )
        }
        try validate(instanceData, as: request.selection.kind.instanceCollection)
        return GearQuickAddRecords(catalogType: typeData, instance: instanceData)
    }

    private static func catalogTypeRecord(_ request: GearQuickAddRequest) throws -> Data {
        var object = try jsonObject(request.selection.fields)
        object.removeValue(forKey: "catalogKind")
        object.removeValue(forKey: "source")
        let wikidata = object.removeValue(forKey: "wikidata") as? String
        let datasheetURL = object.removeValue(forKey: "datasheetUrl") as? String
        if let imageURL = object["image"] as? String {
            object["image"] = ["url": imageURL]
        } else if object["image"] is NSNull {
            object.removeValue(forKey: "image")
        }
        if let datasheetURL, object["datasheet"] == nil {
            object["datasheet"] = ["url": datasheetURL]
        }
        if let wikidata, object["links"] == nil {
            object["links"] = [
                "externalIds": [["scheme": "wikidata", "value": wikidata]]
            ]
        }
        normalizeDisplayScales(in: &object, kind: request.selection.kind)
        object["createdAt"] = try wireDate(request.createdAt).rawValue
        object["$type"] = request.selection.kind.catalogCollection.rawValue
        let untyped = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )

        let typed: Data
        switch request.selection.kind {
        case .camera:
            typed = try JSONEncoder.hypo.encode(
                JSONDecoder().decode(AppGraycardCatalogCameraTypeMain.self, from: untyped)
            )
        case .lens:
            typed = try JSONEncoder.hypo.encode(
                JSONDecoder().decode(AppGraycardCatalogLensTypeMain.self, from: untyped)
            )
        }
        try validate(typed, as: request.selection.kind.catalogCollection)
        return typed
    }

    private static func normalizeDisplayScales(
        in object: inout [String: Any],
        kind: LibraryGearKind
    ) {
        switch kind {
        case .camera:
            for key in ["cropFactor", "effectiveMegapixels"] {
                scaleNumber(at: key, in: &object, onlyWhenMagnitudeBelow: 1_000)
            }
        case .lens:
            for key in ["focalLengthMin", "focalLengthMax", "maxAperture", "minAperture"] {
                scaleNumber(at: key, in: &object)
            }
            if let values = object["apertureSteps"] as? [NSNumber] {
                object["apertureSteps"] = values.map { Int(($0.doubleValue * 1_000_000).rounded()) }
            }
        }
    }

    private static func scaleNumber(
        at key: String,
        in object: inout [String: Any],
        onlyWhenMagnitudeBelow limit: Double? = nil
    ) {
        guard let number = object[key] as? NSNumber else { return }
        let value = number.doubleValue
        guard limit.map({ abs(value) < $0 }) ?? true else { return }
        object[key] = Int((value * 1_000_000).rounded())
    }

    private static func jsonObject(_ fields: [String: CatalogKit.JSONValue]) throws -> [String: Any] {
        let data = try JSONEncoder().encode(fields)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LibraryFieldError.malformedCatalogItem("The item is not a JSON object.")
        }
        return object
    }

    private static func validate(_ data: Data, as nsid: NSID) throws {
        do {
            let issues = try GeneratedLexiconValidator.validate(data, as: nsid)
            if let issue = issues.first { throw LibraryFieldError.invalidRecord(issue.message) }
        } catch let error as LibraryFieldError {
            throw error
        } catch {
            throw LibraryFieldError.invalidRecord(String(describing: error))
        }
    }

    private static func trimmed(_ value: String?) -> String? {
        let value = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    private static func wireDate(_ date: Date) throws -> ATProtoDate {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return try ATProtoDate(formatter.string(from: date))
    }
}

private extension JSONEncoder {
    static var hypo: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
