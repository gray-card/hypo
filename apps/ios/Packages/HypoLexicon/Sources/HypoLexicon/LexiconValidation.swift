import Foundation

// The validator mirrors the recursive AT Protocol schema grammar in one type.
// swiftlint:disable type_body_length function_body_length cyclomatic_complexity

/// An AT Protocol CID link as represented in JSON records.
public struct LexiconCIDLink: Codable, Hashable, Sendable {
    public var link: String

    public init(link: String) {
        self.link = link
    }

    private enum CodingKeys: String, CodingKey {
        case link = "$link"
    }
}

/// An AT Protocol blob reference.
public struct LexiconBlobRef: Codable, Hashable, Sendable {
    public var ref: LexiconCIDLink
    public var mimeType: String
    public var size: Int
    public var recordType: String?

    public init(
        ref: LexiconCIDLink,
        mimeType: String,
        size: Int,
        recordType: String? = "blob"
    ) {
        self.ref = ref
        self.mimeType = mimeType
        self.size = size
        self.recordType = recordType
    }

    private enum CodingKeys: String, CodingKey {
        case ref
        case mimeType
        case size
        case recordType = "$type"
    }
}

/// A path-specific structural or value constraint violation.
public struct LexiconValidationIssue: Error, Hashable, Sendable {
    public let path: String
    public let message: String

    public init(path: String, message: String) {
        self.path = path
        self.message = message
    }
}

/// Runtime validation generated from the same root lexicons as the Codable models.
public enum GeneratedLexiconValidator {
    /// Validates JSON bytes as the record collection identified by `nsid`.
    public static func validate(_ data: Data, as nsid: NSID) throws -> [LexiconValidationIssue] {
        let record = try JSONDecoder().decode(JSONValue.self, from: data)
        return try validate(record, as: nsid)
    }

    /// Encodes and validates a generated record model.
    public static func validate<T: Encodable>(
        _ record: T,
        as nsid: NSID
    ) throws -> [LexiconValidationIssue] {
        let data = try JSONEncoder().encode(record)
        return try validate(data, as: nsid)
    }

    /// Validates an already-decoded record value.
    public static func validate(
        _ record: JSONValue,
        as nsid: NSID
    ) throws -> [LexiconValidationIssue] {
        guard let root = schemaIndex[nsid.rawValue],
            case .object(let rootObject) = root,
            case .object(let definitions)? = rootObject["defs"],
            case .object(let main)? = definitions["main"],
            let schema = main["record"]
        else {
            return [
                LexiconValidationIssue(
                    path: "$",
                    message: "No generated record schema for \(nsid.rawValue)"
                )
            ]
        }

        var issues: [LexiconValidationIssue] = []
        inspect(schema: schema, value: record, nsid: nsid.rawValue, path: "$", issues: &issues)
        inspectRecordType(record, expected: nsid.rawValue, issues: &issues)
        inspectLifecycle(record, nsid: nsid.rawValue, issues: &issues)
        return issues
    }

    private static let schemaIndex: [String: JSONValue] = {
        guard let url = Bundle.module.url(forResource: "LexiconSchemas", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let value = try? JSONDecoder().decode([String: JSONValue].self, from: data)
        else {
            preconditionFailure("The generated lexicon schema resource is missing or invalid")
        }
        return value
    }()

    private static func inspect(
        schema: JSONValue,
        value: JSONValue,
        nsid: String,
        path: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .object(let shape) = schema, case .string(let type)? = shape["type"] else {
            return
        }

        switch type {
        case "ref":
            guard case .string(let reference)? = shape["ref"],
                let target = resolve(reference: reference, from: nsid)
            else {
                issues.append(.init(path: path, message: "Unresolved lexicon reference"))
                return
            }
            inspect(
                schema: target.schema,
                value: value,
                nsid: target.nsid,
                path: path,
                issues: &issues
            )
        case "union":
            guard case .array(let references)? = shape["refs"] else { return }
            let matches = references.contains { item in
                guard case .string(let reference) = item,
                    let target = resolve(reference: reference, from: nsid)
                else { return false }
                var branch: [LexiconValidationIssue] = []
                inspect(
                    schema: target.schema,
                    value: value,
                    nsid: target.nsid,
                    path: path,
                    issues: &branch
                )
                return branch.isEmpty
            }
            if !matches {
                issues.append(.init(path: path, message: "Value does not match a union member"))
            }
        case "object":
            inspectObject(schema: shape, value: value, nsid: nsid, path: path, issues: &issues)
        case "array":
            guard case .array(let values) = value else {
                issues.append(.init(path: path, message: "Expected array"))
                return
            }
            inspectLength(shape, count: values.count, path: path, unit: "items", issues: &issues)
            if let itemSchema = shape["items"] {
                for (index, item) in values.enumerated() {
                    inspect(
                        schema: itemSchema,
                        value: item,
                        nsid: nsid,
                        path: "\(path)[\(index)]",
                        issues: &issues
                    )
                }
            }
        case "string":
            inspectString(schema: shape, value: value, path: path, issues: &issues)
        case "integer":
            inspectInteger(schema: shape, value: value, path: path, issues: &issues)
        case "boolean":
            if case .bool = value { return }
            issues.append(.init(path: path, message: "Expected boolean"))
        case "blob":
            if case .object = value { return }
            issues.append(.init(path: path, message: "Expected blob reference"))
        case "bytes":
            if case .string = value { return }
            issues.append(.init(path: path, message: "Expected encoded bytes"))
        case "unknown":
            return
        default:
            return
        }
    }

    private static func inspectObject(
        schema: [String: JSONValue],
        value: JSONValue,
        nsid: String,
        path: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .object(let object) = value else {
            issues.append(.init(path: path, message: "Expected object"))
            return
        }
        let required: Set<String>
        if case .array(let names)? = schema["required"] {
            required = Set(names.compactMap(\.stringValue))
        } else {
            required = []
        }
        for name in required where object[name] == nil || object[name] == .null {
            issues.append(.init(path: "\(path).\(name)", message: "Required value is missing"))
        }
        guard case .object(let properties)? = schema["properties"] else { return }
        for (name, propertySchema) in properties.sorted(by: { $0.key < $1.key }) {
            guard let propertyValue = object[name], propertyValue != .null else { continue }
            inspect(
                schema: propertySchema,
                value: propertyValue,
                nsid: nsid,
                path: "\(path).\(name)",
                issues: &issues
            )
        }
    }

    private static func inspectString(
        schema: [String: JSONValue],
        value: JSONValue,
        path: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .string(let string) = value else {
            issues.append(.init(path: path, message: "Expected string"))
            return
        }
        inspectLength(schema, count: string.utf8.count, path: path, unit: "UTF-8 bytes", issues: &issues)
        if let maximumGraphemes = schema["maxGraphemes"]?.integerValue,
            string.count > maximumGraphemes
        {
            issues.append(
                .init(path: path, message: "Expected at most \(maximumGraphemes) graphemes")
            )
        }
        guard case .string(let format)? = schema["format"] else { return }
        let valid: Bool
        let message: String
        switch format {
        case "at-uri":
            valid = (try? ATURI(string)) != nil
            message = "Expected AT URI"
        case "datetime":
            valid = (try? ATProtoDate(string)) != nil
            message = "Expected datetime"
        case "did":
            valid = string.hasPrefix("did:") && string.split(separator: ":").count >= 3
            message = "Expected DID"
        case "uri":
            valid = URL(string: string)?.scheme != nil
            message = "Expected URI"
        default:
            return
        }
        if !valid { issues.append(.init(path: path, message: message)) }
    }

    private static func inspectInteger(
        schema: [String: JSONValue],
        value: JSONValue,
        path: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .number(let number) = value, number.isFinite, number.rounded() == number else {
            issues.append(.init(path: path, message: "Expected integer"))
            return
        }
        if let minimum = schema["minimum"]?.numberValue, number < minimum {
            issues.append(.init(path: path, message: "Expected value greater than or equal to \(minimum)"))
        }
        if let maximum = schema["maximum"]?.numberValue, number > maximum {
            issues.append(.init(path: path, message: "Expected value less than or equal to \(maximum)"))
        }
    }

    private static func inspectLength(
        _ schema: [String: JSONValue],
        count: Int,
        path: String,
        unit: String,
        issues: inout [LexiconValidationIssue]
    ) {
        if let minimum = schema["minLength"]?.integerValue, count < minimum {
            issues.append(.init(path: path, message: "Expected at least \(minimum) \(unit)"))
        }
        if let maximum = schema["maxLength"]?.integerValue, count > maximum {
            issues.append(.init(path: path, message: "Expected at most \(maximum) \(unit)"))
        }
    }

    private static func resolve(
        reference: String,
        from currentNsid: String
    ) -> (nsid: String, schema: JSONValue)? {
        let components = reference.split(separator: "#", maxSplits: 1).map(String.init)
        let targetNsid = reference.hasPrefix("#") ? currentNsid : components[0]
        let definition =
            reference.hasPrefix("#")
            ? String(reference.dropFirst()) : (components.count == 2 ? components[1] : "main")
        guard let lexicon = schemaIndex[targetNsid],
            case .object(let root) = lexicon,
            case .object(let definitions)? = root["defs"],
            case .object(let definitionObject)? = definitions[definition]
        else { return nil }
        return (targetNsid, definitionObject["record"] ?? .object(definitionObject))
    }

    private static func inspectRecordType(
        _ record: JSONValue,
        expected: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .object(let object) = record, let type = object["$type"] else { return }
        guard type == .string(expected) else {
            issues.append(.init(path: "$.$type", message: "Expected \(expected)"))
            return
        }
    }

    private static func inspectLifecycle(
        _ record: JSONValue,
        nsid: String,
        issues: inout [LexiconValidationIssue]
    ) {
        guard case .object(let object) = record else { return }
        if nsid == "app.graycard.instance.filmRoll" {
            let milestones = FilmRollMilestones(
                loadedAt: object.date("loadedAt"),
                partialAt: object.date("partialAt"),
                exposedAt: object.date("exposedAt"),
                unloadedAt: object.date("unloadedAt"),
                sentToLabAt: object.date("sentToLabAt"),
                developmentStartedAt: object.date("developmentStartedAt"),
                developedAt: object.date("developedAt"),
                receivedFromLabAt: object.date("receivedFromLabAt"),
                scannedAt: object.date("scannedAt"),
                archivedAt: object.date("archivedAt")
            )
            issues.append(
                contentsOf: ConsumableLifecycleValidator.validate(milestones).map {
                    .init(path: "$", message: $0.message)
                }
            )
        } else if nsid == "app.graycard.instance.chemistry" {
            let milestones = ChemistryMilestones(
                acquiredAt: object.date("acquiredAt"),
                openedAt: object.date("openedAt"),
                mixedAt: object.date("mixedAt"),
                replenishedAt: object.date("replenishedAt"),
                exhaustedAt: object.date("exhaustedAt"),
                discardedAt: object.date("discardedAt")
            )
            issues.append(
                contentsOf: ConsumableLifecycleValidator.validate(milestones).map {
                    .init(path: "$", message: $0.message)
                }
            )
        }
    }
}

extension JSONValue {
    fileprivate var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    fileprivate var numberValue: Double? {
        guard case .number(let value) = self else { return nil }
        return value
    }

    fileprivate var integerValue: Int? {
        guard let value = numberValue, value.rounded() == value else { return nil }
        return Int(exactly: value)
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    fileprivate func date(_ key: String) -> ATProtoDate? {
        guard let value = self[key]?.stringValue else { return nil }
        return try? ATProtoDate(value)
    }
}
