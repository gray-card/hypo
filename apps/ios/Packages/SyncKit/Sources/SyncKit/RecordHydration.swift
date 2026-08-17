import ATProtoClient
import Foundation
import PersistenceKit

public struct RecordHydrationRequest: Hashable, Sendable {
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

public struct RecordListHydrationRequest: Hashable, Sendable {
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

public struct HydratedRepositoryRecord: Hashable, Sendable {
    public var uri: String
    public var cid: String?
    public var collection: String
    public var rkey: String
    public var value: Data

    public init(uri: String, cid: String?, collection: String, rkey: String, value: Data) {
        self.uri = uri
        self.cid = cid
        self.collection = collection
        self.rkey = rkey
        self.value = value
    }

    public func cached(at date: Date = Date()) -> CachedRecord {
        CachedRecord(
            uri: uri,
            cid: cid,
            collection: collection,
            rkey: rkey,
            value: value,
            cachedAt: date
        )
    }
}

public struct HydratedRepositoryPage: Hashable, Sendable {
    public var cursor: String?
    public var records: [HydratedRepositoryRecord]

    public init(cursor: String? = nil, records: [HydratedRepositoryRecord]) {
        self.cursor = cursor
        self.records = records
    }
}

public protocol RecordHydrating: Sendable {
    func get(_ request: RecordHydrationRequest) async throws -> HydratedRepositoryRecord
    func list(_ request: RecordListHydrationRequest) async throws -> HydratedRepositoryPage
}

/// Protocol-bounded get/list hydration through ATProtoClient.
public struct ATProtoRecordHydrator: RecordHydrating, Sendable {
    private let repository: any ATProtoRepositoryAccessing
    private let sessionProvider: any SyncOAuthSessionProviding

    public init(
        repository: any ATProtoRepositoryAccessing,
        sessionProvider: any SyncOAuthSessionProviding
    ) {
        self.repository = repository
        self.sessionProvider = sessionProvider
    }

    public init(client: RepositoryClient, sessionProvider: any SyncOAuthSessionProviding) {
        self.init(
            repository: ATProtoRepositoryClientGateway(client: client),
            sessionProvider: sessionProvider
        )
    }

    public func get(_ request: RecordHydrationRequest) async throws -> HydratedRepositoryRecord {
        let session = try await sessionProvider.session()
        let remote = try await repository.getRecord(
            GetRecordRequest(
                repo: request.repo,
                collection: request.collection,
                rkey: request.rkey,
                cid: request.cid
            ),
            session: session
        )
        return HydratedRepositoryRecord(
            uri: remote.uri,
            cid: remote.cid,
            collection: request.collection,
            rkey: request.rkey,
            value: try ATProtoJSONValueCodec.encodeRecord(remote.value)
        )
    }

    public func list(_ request: RecordListHydrationRequest) async throws -> HydratedRepositoryPage {
        let session = try await sessionProvider.session()
        let page = try await repository.listRecords(
            ListRecordsRequest(
                repo: request.repo,
                collection: request.collection,
                limit: request.limit,
                cursor: request.cursor,
                reverse: request.reverse
            ),
            session: session
        )
        return HydratedRepositoryPage(
            cursor: page.cursor,
            records: try page.records.map { remote in
                HydratedRepositoryRecord(
                    uri: remote.uri,
                    cid: remote.cid,
                    collection: request.collection,
                    rkey: try Self.rkey(from: remote.uri),
                    value: try ATProtoJSONValueCodec.encodeRecord(remote.value)
                )
            }
        )
    }

    private static func rkey(from uri: String) throws -> String {
        guard uri.hasPrefix("at://"), let value = uri.split(separator: "/").last, !value.isEmpty else {
            throw ATProtoSyncAdapterError.malformedRemoteURI(uri)
        }
        return String(value)
    }
}
