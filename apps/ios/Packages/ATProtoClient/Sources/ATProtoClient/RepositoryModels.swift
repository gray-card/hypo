import Foundation

public enum RecordCAS: Hashable, Sendable {
    /// Omit `swapRecord`: update regardless of the current CID.
    case absent
    /// Encode `swapRecord: null`: assert that no current record exists.
    case noRecord
    /// Encode the expected current CID.
    case cid(String)
}

private struct RecordCASKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension KeyedEncodingContainer where Key == RecordCASKey {
    mutating func encodeCAS(_ value: RecordCAS, forKey key: String) throws {
        let codingKey = RecordCASKey(stringValue: key)!
        switch value {
        case .absent: break
        case .noRecord: try encodeNil(forKey: codingKey)
        case let .cid(cid): try encode(cid, forKey: codingKey)
        }
    }
}

public struct RepositoryRecord: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String?
    public var value: JSONValue

    public init(uri: String, cid: String? = nil, value: JSONValue) {
        self.uri = uri
        self.cid = cid
        self.value = value
    }
}

public struct GetRecordRequest: Sendable, Hashable {
    public var repo: String
    public var collection: String
    public var rkey: String
    public var cid: String?

    public init(repo: String, collection: String, rkey: String, cid: String? = nil) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.cid = cid
    }
}

public typealias GetRecordResponse = RepositoryRecord

public struct ListRecordsRequest: Sendable, Hashable {
    public var repo: String
    public var collection: String
    public var limit: Int?
    public var cursor: String?
    public var reverse: Bool?

    public init(
        repo: String,
        collection: String,
        limit: Int? = nil,
        cursor: String? = nil,
        reverse: Bool? = nil
    ) {
        self.repo = repo
        self.collection = collection
        self.limit = limit
        self.cursor = cursor
        self.reverse = reverse
    }
}

public struct ListRecordsResponse: Codable, Hashable, Sendable {
    public var cursor: String?
    public var records: [RepositoryRecord]
}

public struct CreateRecordRequest: Encodable, Hashable, Sendable {
    public var repo: String
    public var collection: String
    public var rkey: String?
    public var record: JSONValue
    public var validate: Bool?
    public var swapCommit: RecordCAS

    public init(
        repo: String,
        collection: String,
        rkey: String? = nil,
        record: JSONValue,
        validate: Bool? = nil,
        swapCommit: RecordCAS = .absent
    ) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.record = record
        self.validate = validate
        self.swapCommit = swapCommit
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: RecordCASKey.self)
        try container.encode(repo, forKey: RecordCASKey(stringValue: "repo")!)
        try container.encode(collection, forKey: RecordCASKey(stringValue: "collection")!)
        try container.encodeIfPresent(rkey, forKey: RecordCASKey(stringValue: "rkey")!)
        try container.encode(record, forKey: RecordCASKey(stringValue: "record")!)
        try container.encodeIfPresent(validate, forKey: RecordCASKey(stringValue: "validate")!)
        try container.encodeCAS(swapCommit, forKey: "swapCommit")
    }
}

public struct PutRecordRequest: Encodable, Hashable, Sendable {
    public var repo: String
    public var collection: String
    public var rkey: String
    public var record: JSONValue
    public var validate: Bool?
    public var swapRecord: RecordCAS
    public var swapCommit: RecordCAS

    public init(
        repo: String,
        collection: String,
        rkey: String,
        record: JSONValue,
        validate: Bool? = nil,
        swapRecord: RecordCAS = .absent,
        swapCommit: RecordCAS = .absent
    ) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.record = record
        self.validate = validate
        self.swapRecord = swapRecord
        self.swapCommit = swapCommit
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: RecordCASKey.self)
        try container.encode(repo, forKey: RecordCASKey(stringValue: "repo")!)
        try container.encode(collection, forKey: RecordCASKey(stringValue: "collection")!)
        try container.encode(rkey, forKey: RecordCASKey(stringValue: "rkey")!)
        try container.encode(record, forKey: RecordCASKey(stringValue: "record")!)
        try container.encodeIfPresent(validate, forKey: RecordCASKey(stringValue: "validate")!)
        try container.encodeCAS(swapRecord, forKey: "swapRecord")
        try container.encodeCAS(swapCommit, forKey: "swapCommit")
    }
}

public struct DeleteRecordRequest: Encodable, Hashable, Sendable {
    public var repo: String
    public var collection: String
    public var rkey: String
    public var swapRecord: RecordCAS
    public var swapCommit: RecordCAS

    public init(
        repo: String,
        collection: String,
        rkey: String,
        swapRecord: RecordCAS = .absent,
        swapCommit: RecordCAS = .absent
    ) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.swapRecord = swapRecord
        self.swapCommit = swapCommit
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: RecordCASKey.self)
        try container.encode(repo, forKey: RecordCASKey(stringValue: "repo")!)
        try container.encode(collection, forKey: RecordCASKey(stringValue: "collection")!)
        try container.encode(rkey, forKey: RecordCASKey(stringValue: "rkey")!)
        try container.encodeCAS(swapRecord, forKey: "swapRecord")
        try container.encodeCAS(swapCommit, forKey: "swapCommit")
    }
}

public struct CommitMetadata: Codable, Hashable, Sendable {
    public var cid: String
    public var rev: String
}

public struct RecordWriteResponse: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var commit: CommitMetadata?
    public var validationStatus: String?
}

public struct DeleteRecordResponse: Codable, Hashable, Sendable {
    public var commit: CommitMetadata?
}

public struct InvalidSwapConflict: Error, Equatable, Sendable {
    public var operation: String
    public var message: String?

    public init(operation: String, message: String? = nil) {
        self.operation = operation
        self.message = message
    }
}
