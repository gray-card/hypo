import Foundation

/// A validated AT Protocol namespace identifier.
public struct NSID: Hashable, Sendable, Codable, CustomStringConvertible {
    /// The validated identifier.
    public let rawValue: String

    /// Creates an identifier when `rawValue` follows the AT Protocol NSID shape.
    public init(_ rawValue: String) throws {
        guard Self.isValid(rawValue) else {
            throw LexiconValueError.invalidNSID(rawValue)
        }
        self.rawValue = rawValue
    }

    public var description: String { rawValue }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        try self.init(container.decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func isValid(_ value: String) -> Bool {
        guard value.utf8.count <= 317 else { return false }
        let segments = value.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 3 else { return false }

        return segments.allSatisfy { segment in
            guard let first = segment.first, let last = segment.last else { return false }
            guard first.isASCII, first.isLetter, last.isASCII, last.isLetter || last.isNumber else {
                return false
            }
            return segment.allSatisfy { character in
                character.isASCII && (character.isLetter || character.isNumber || character == "-")
            }
        }
    }
}

/// A validated AT URI identifying a repository record.
public struct ATURI: Hashable, Sendable, Codable, CustomStringConvertible {
    /// The complete URI.
    public let rawValue: String

    /// The authority, normally a DID or handle.
    public let authority: String

    /// The record collection when this URI identifies a record.
    public let collection: NSID?

    /// The record key when this URI identifies a record.
    public let recordKey: String?

    /// Creates an AT URI from its wire representation.
    public init(_ rawValue: String) throws {
        guard rawValue.hasPrefix("at://") else {
            throw LexiconValueError.invalidATURI(rawValue)
        }
        let path = String(rawValue.dropFirst("at://".count))
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard let authorityComponent = components.first, !authorityComponent.isEmpty,
            components.count <= 3
        else {
            throw LexiconValueError.invalidATURI(rawValue)
        }

        let authority = String(authorityComponent)
        let collection = components.count >= 2 ? try NSID(String(components[1])) : nil
        let recordKey = components.count == 3 ? String(components[2]) : nil
        guard recordKey.map({ !$0.isEmpty && !$0.contains(where: { $0.isWhitespace }) }) ?? true else {
            throw LexiconValueError.invalidATURI(rawValue)
        }

        self.rawValue = rawValue
        self.authority = authority
        self.collection = collection
        self.recordKey = recordKey
    }

    public var description: String { rawValue }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        try self.init(container.decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Invalid values at the generated-record boundary.
public enum LexiconValueError: Error, Hashable, Sendable, LocalizedError {
    /// An invalid AT Protocol namespace identifier.
    case invalidNSID(String)
    /// An invalid AT URI.
    case invalidATURI(String)
    /// An invalid AT Protocol RFC 3339 timestamp.
    case invalidDate(String)

    public var errorDescription: String? {
        switch self {
        case .invalidNSID(let value): "Invalid NSID: \(value)"
        case .invalidATURI(let value): "Invalid AT URI: \(value)"
        case .invalidDate(let value): "Invalid RFC 3339 timestamp: \(value)"
        }
    }
}
