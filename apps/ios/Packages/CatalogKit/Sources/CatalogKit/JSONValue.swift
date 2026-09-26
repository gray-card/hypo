import Foundation

/// A lossless, `Sendable` JSON value used for catalog fields that evolve independently.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public var stringValue: String? {
        switch self {
        case .string(let value): value
        case .number(let value): value.formatted()
        case .bool(let value): value ? "true" : "false"
        case .null, .array, .object: nil
        }
    }

    func scalarStrings(depth: Int = 0) -> [String] {
        if let stringValue { return [stringValue] }
        guard depth < 2 else { return [] }
        switch self {
        case .array(let values):
            return values.flatMap { $0.scalarStrings(depth: depth + 1) }
        case .object(let values):
            return values.values.flatMap { $0.scalarStrings(depth: depth + 1) }
        case .null, .bool, .number, .string:
            return []
        }
    }
}
