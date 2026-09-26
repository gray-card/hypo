import Foundation

public struct CatalogManifest: Codable, Hashable, Sendable {
    public let schemaVersion: Int
    public let hashAlgorithm: String
    public let catalogHash: String
    public let shards: [String: CatalogShardDescriptor]
}

public struct CatalogShardDescriptor: Codable, Hashable, Sendable {
    public let path: String
    public let sha256: String
    public let bytes: Int
    public let itemCount: Int
}

public struct CatalogSource: Codable, Hashable, Sendable {
    public let file: String
    public let collection: String
    public let itemCount: Int
    public let metadata: [String: JSONValue]
}

public struct CatalogShard: Codable, Hashable, Sendable {
    public let schemaVersion: Int
    public let domain: String
    public let sources: [CatalogSource]
    public let items: [CatalogItem]
}

public struct CatalogItem: Codable, Hashable, Sendable {
    public let fields: [String: JSONValue]

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        fields = try container.decode([String: JSONValue].self)
    }

    public init(fields: [String: JSONValue]) {
        self.fields = fields
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(fields)
    }

    public subscript(key: String) -> JSONValue? { fields[key] }

    public var label: String {
        for pair in [
            ("make", "model"), ("brand", "name"),
            ("developerMake", "developerName"), ("filmMake", "filmName"),
        ] {
            if let left = fields[pair.0]?.stringValue, let right = fields[pair.1]?.stringValue {
                return "\(left) \(right)"
            }
        }
        for key in ["name", "model", "title", "label"] {
            if let value = fields[key]?.stringValue { return value }
        }
        return "Catalog item"
    }

    /// An identity that remains stable when a newer app ships an updated snapshot.
    public var stableIdentity: String {
        let kind = fields["catalogKind"]?.stringValue ?? "item"
        let parts = [
            "make", "model", "brand", "name", "developerMake", "developerName",
            "filmMake", "filmName", "mount", "format",
        ]
        .compactMap { fields[$0]?.stringValue }
        .map(CatalogSearch.normalize)
        return ([kind] + parts).joined(separator: ":")
    }
}

public struct CatalogSearchResult: Hashable, Sendable {
    public let domain: String
    public let item: CatalogItem
    public let score: Double
}

public enum CatalogError: Error, Equatable, Sendable {
    case malformedManifest(String)
    case unsupportedSchemaVersion(Int)
    case unsupportedHashAlgorithm(String)
    case unsafePath(String)
    case missingShard(String)
    case byteCount(domain: String, expected: Int, actual: Int)
    case digest(domain: String, expected: String, actual: String)
    case itemCount(domain: String, expected: Int, actual: Int)
    case domain(expected: String, actual: String)
}

public struct ProvenanceBadge: Hashable, Sendable {
    public enum Support: String, Hashable, Sendable {
        case manufacturer
        case published
        case derived
        case community
        case unknown
    }

    public let support: Support
    public let publisher: String?
    public let documentTitle: String?
    public let page: String?
    public let table: String?
}
