import CatalogKit
import Foundation

public enum LibraryCategory: String, CaseIterable, Hashable, Sendable {
    case rolls = "Rolls"
    case film = "Film"
    case cameras = "Cameras"
    case lenses = "Lenses"
    case chemistry = "Chemistry"
    case recipes = "Recipes"
}

public struct LibraryItem: Identifiable, Hashable, Sendable {
    public let id: String
    public let category: LibraryCategory
    public let title: String
    public let subtitle: String?
    public let detail: String?
    public let imageURL: URL?
    public let provenance: String?
    public let fieldAction: LibraryFieldAction?
    public let webTarget: LibraryWebTarget?

    public init(
        id: String,
        category: LibraryCategory,
        title: String,
        subtitle: String? = nil,
        detail: String? = nil,
        imageURL: URL? = nil,
        provenance: String? = nil,
        fieldAction: LibraryFieldAction? = nil,
        webTarget: LibraryWebTarget? = nil
    ) {
        self.id = id
        self.category = category
        self.title = title
        self.subtitle = subtitle
        self.detail = detail
        self.imageURL = imageURL
        self.provenance = provenance
        self.fieldAction = fieldAction
        self.webTarget = webTarget
    }
}

public protocol LibraryProviding: Sendable {
    func items() async throws -> [LibraryItem]
    func warnings() async -> [LibraryDataWarning]
}

public extension LibraryProviding {
    func warnings() async -> [LibraryDataWarning] { [] }
}

public struct LibraryDataWarning: Hashable, Sendable {
    public let collection: String?
    public let message: String

    public init(collection: String? = nil, message: String) {
        self.collection = collection
        self.message = message
    }
}

public struct StaticLibraryProvider: LibraryProviding {
    private let values: [LibraryItem]

    public init(_ values: [LibraryItem]) {
        self.values = values
    }

    public func items() async throws -> [LibraryItem] { values }
}

/// Merges user-owned companion records with the immutable catalog shipped in the app.
public struct BundledCatalogLibraryProvider: LibraryProviding {
    private let userItems: [LibraryItem]

    public init(userItems: [LibraryItem] = []) {
        self.userItems = userItems
    }

    public func items() async throws -> [LibraryItem] {
        let snapshot = try BundledCatalog.load()
        let catalogItems = snapshot.shards.flatMap { domain, shard in
            shard.items.compactMap { Self.libraryItem($0, domain: domain) }
        }
        let userKeys = Set(userItems.map(Self.deduplicationKey))
        return userItems + catalogItems.filter { !userKeys.contains(Self.deduplicationKey($0)) }
    }

    private static func libraryItem(_ item: CatalogItem, domain: String) -> LibraryItem? {
        guard let category = category(domain: domain) else { return nil }
        let subtitle: String?
        let detail: String?
        switch category {
        case .film:
            subtitle = item["iso"]?.stringValue.map { "ISO \($0)" }
            detail = item["formats"].map(strings).flatMap { $0.isEmpty ? nil : $0.joined(separator: " · ") }
        case .cameras, .lenses:
            subtitle = item["mount"]?.stringValue ?? item["format"]?.stringValue
            detail = nil
        case .chemistry:
            subtitle = item["roles"].map(strings).flatMap { $0.isEmpty ? nil : $0.joined(separator: " · ") }
            detail = item["defaultDilution"]?.stringValue
        case .recipes:
            let temperature = item["temps"].flatMap(firstTemperature)
            subtitle = [item["dilution"]?.stringValue, temperature].compactMap { $0 }.joined(separator: " · ")
            detail = item["recommendationStatus"]?.stringValue
        case .rolls:
            return nil
        }
        return LibraryItem(
            id: "catalog:\(item.stableIdentity)",
            category: category,
            title: item.label,
            subtitle: subtitle,
            detail: detail,
            imageURL: item["image"]?.stringValue.flatMap(URL.init(string:)),
            provenance: provenance(item),
            fieldAction: fieldAction(item, category: category),
            webTarget: .library(tab: webTab(category))
        )
    }

    private static func category(domain: String) -> LibraryCategory? {
        switch domain {
        case "cameras": .cameras
        case "lenses": .lenses
        case "film-stocks": .film
        case "darkroom-products": .chemistry
        case "dev-times": .recipes
        default: nil
        }
    }

    private static func strings(_ value: JSONValue) -> [String] {
        guard case .array(let values) = value else { return [] }
        return values.compactMap(\.stringValue)
    }

    private static func firstTemperature(_ value: JSONValue) -> String? {
        guard case .array(let values) = value,
            case .object(let point)? = values.first,
            case .number(let temperature)? = point["tempC10"]
        else { return nil }
        return "\(formatted(temperature / 10)) °C"
    }

    private static func provenance(_ item: CatalogItem) -> String? {
        guard case .array(let sources)? = item["specSources"],
            case .object(let source)? = sources.first,
            case .object(let document)? = source["document"]
        else { return nil }
        return document["publisher"]?.stringValue ?? "Published source"
    }

    private static func formatted(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }

    private static func deduplicationKey(_ item: LibraryItem) -> String {
        "\(item.category.rawValue.lowercased())\u{0}\(item.title.lowercased())"
    }

    private static func fieldAction(
        _ item: CatalogItem,
        category: LibraryCategory
    ) -> LibraryFieldAction? {
        let kind: LibraryGearKind
        switch category {
        case .cameras: kind = .camera
        case .lenses: kind = .lens
        case .rolls, .film, .chemistry, .recipes: return nil
        }
        return .quickAddGear(
            CatalogGearSelection(
                kind: kind,
                stableIdentity: item.stableIdentity,
                label: item.label,
                fields: item.fields
            )
        )
    }

    private static func webTab(_ category: LibraryCategory) -> String {
        switch category {
        case .rolls, .film: "film"
        case .cameras: "cameras"
        case .lenses: "lenses"
        case .chemistry, .recipes: "darkroom"
        }
    }
}
