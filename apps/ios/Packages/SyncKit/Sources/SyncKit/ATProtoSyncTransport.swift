import ATProtoClient
import Foundation
import PersistenceKit

public struct ATProtoRepositoryWriteReceipt: Hashable, Sendable {
    public var uri: String
    public var cid: String?

    public init(uri: String, cid: String? = nil) {
        self.uri = uri
        self.cid = cid
    }
}

public struct ATProtoRepositoryPage: Hashable, Sendable {
    public var cursor: String?
    public var records: [RepositoryRecord]

    public init(cursor: String? = nil, records: [RepositoryRecord]) {
        self.cursor = cursor
        self.records = records
    }
}

/// Narrow repository boundary shared by the outbox writer and record hydrator.
public protocol ATProtoRepositoryAccessing: Sendable {
    func putRecord(
        _ request: PutRecordRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryWriteReceipt
    func deleteRecord(_ request: DeleteRecordRequest, session: OAuthSession) async throws
    func getRecord(_ request: GetRecordRequest, session: OAuthSession) async throws -> RepositoryRecord
    func listRecords(
        _ request: ListRecordsRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryPage
}

/// Production bridge from SyncKit's repository boundary to ATProtoClient.
public struct ATProtoRepositoryClientGateway: ATProtoRepositoryAccessing, Sendable {
    private let client: RepositoryClient

    public init(client: RepositoryClient) {
        self.client = client
    }

    public func putRecord(
        _ request: PutRecordRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryWriteReceipt {
        let response = try await client.putRecord(request, session: session)
        return ATProtoRepositoryWriteReceipt(uri: response.uri, cid: response.cid)
    }

    public func deleteRecord(_ request: DeleteRecordRequest, session: OAuthSession) async throws {
        let _: DeleteRecordResponse = try await client.deleteRecord(request, session: session)
    }

    public func getRecord(
        _ request: GetRecordRequest,
        session: OAuthSession
    ) async throws -> RepositoryRecord {
        try await client.getRecord(request, session: session)
    }

    public func listRecords(
        _ request: ListRecordsRequest,
        session: OAuthSession
    ) async throws -> ATProtoRepositoryPage {
        let response = try await client.listRecords(request, session: session)
        return ATProtoRepositoryPage(cursor: response.cursor, records: response.records)
    }
}

public protocol SyncOAuthSessionProviding: Sendable {
    func session() async throws -> OAuthSession
}

public struct FixedSyncOAuthSessionProvider: SyncOAuthSessionProviding, Sendable {
    private let value: OAuthSession

    public init(_ value: OAuthSession) { self.value = value }
    public func session() -> OAuthSession { value }
}

/// Loads the latest token values on every operation so a refresh can replace Keychain custody.
public struct StoredSyncOAuthSessionProvider: SyncOAuthSessionProviding, Sendable {
    private let store: any OAuthSessionStore
    private let id: OAuthSessionID

    public init(store: any OAuthSessionStore, id: OAuthSessionID) {
        self.store = store
        self.id = id
    }

    public func session() async throws -> OAuthSession {
        guard let session = try await store.load(id: id) else {
            throw ATProtoSyncAdapterError.missingSession(id.rawValue)
        }
        return session
    }
}

public enum ATProtoSyncAdapterError: Error, Equatable, Sendable {
    case missingSession(String)
    case missingRecord(UUID)
    case missingRKey(UUID)
    case recordMustBeJSONObject
    case malformedRemoteURI(String)
}

public enum ATProtoJSONValueCodec {
    public static func decodeRecord(_ data: Data) throws -> JSONValue {
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        guard case .object = value else {
            throw ATProtoSyncAdapterError.recordMustBeJSONObject
        }
        return value
    }

    public static func encodeRecord(_ value: JSONValue) throws -> Data {
        guard case .object = value else {
            throw ATProtoSyncAdapterError.recordMustBeJSONObject
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }
}

public enum StableOperationRKey {
    /// AT Protocol rkeys permit UUID hyphens; retaining them matches the optimistic cache key.
    public static func make(for operationID: UUID) -> String {
        operationID.uuidString.lowercased()
    }
}

/// Production outbox transport backed by ATProtoClient's repository API.
public struct ATProtoSyncTransport: SyncTransport, Sendable {
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

    public func execute(_ operation: OutboxOperation) async throws -> RemoteWriteResult {
        let session: OAuthSession
        do {
            session = try await sessionProvider.session()
        } catch let error as ATProtoSyncAdapterError {
            throw SyncTransportError.permanent(message: String(describing: error))
        } catch let error as URLError {
            throw SyncTransportError.transient(message: error.localizedDescription)
        } catch {
            throw SyncTransportError.transient(message: String(describing: error))
        }

        do {
            return try await perform(operation, session: session)
        } catch let error as SyncTransportError {
            throw error
        } catch let conflict as InvalidSwapConflict {
            throw await invalidSwapError(conflict, operation: operation, session: session)
        } catch let error as ATProtoHTTPError {
            throw Self.classify(error)
        } catch let error as ATProtoSyncAdapterError {
            throw SyncTransportError.permanent(message: String(describing: error))
        } catch let error as URLError {
            throw SyncTransportError.transient(message: error.localizedDescription)
        } catch let error as DecodingError {
            throw SyncTransportError.permanent(message: String(describing: error))
        } catch let error as EncodingError {
            throw SyncTransportError.permanent(message: String(describing: error))
        }
    }

    private func perform(
        _ operation: OutboxOperation,
        session: OAuthSession
    ) async throws -> RemoteWriteResult {
        switch operation.kind {
        case .create:
            let data = try requiredRecord(operation)
            let record = try ATProtoJSONValueCodec.decodeRecord(data)
            let rkey = operation.rkey ?? StableOperationRKey.make(for: operation.id)
            // A stable rkey plus `swapRecord: null` makes a replay observable through the
            // protocol's typed InvalidSwap error. createRecord has no typed duplicate error.
            let request = PutRecordRequest(
                repo: operation.repo,
                collection: operation.collection,
                rkey: rkey,
                record: record,
                swapRecord: .noRecord
            )
            do {
                let receipt = try await repository.putRecord(request, session: session)
                return RemoteWriteResult(uri: receipt.uri, cid: receipt.cid, record: data)
            } catch let conflict as InvalidSwapConflict {
                return try await recoverIdempotentCreate(
                    operation: operation,
                    rkey: rkey,
                    localRecord: record,
                    session: session,
                    conflict: conflict
                )
            }

        case .put:
            let rkey = try requiredRKey(operation)
            let data = try requiredRecord(operation)
            let record = try ATProtoJSONValueCodec.decodeRecord(data)
            let request = PutRecordRequest(
                repo: operation.repo,
                collection: operation.collection,
                rkey: rkey,
                record: record,
                swapRecord: Self.recordCAS(operation.swapRecord)
            )
            let receipt = try await repository.putRecord(request, session: session)
            return RemoteWriteResult(uri: receipt.uri, cid: receipt.cid, record: data)

        case .delete:
            let rkey = try requiredRKey(operation)
            let request = DeleteRecordRequest(
                repo: operation.repo,
                collection: operation.collection,
                rkey: rkey,
                swapRecord: Self.recordCAS(operation.swapRecord)
            )
            try await repository.deleteRecord(request, session: session)
            let uri = operation.uri ?? "at://\(operation.repo)/\(operation.collection)/\(rkey)"
            return RemoteWriteResult(uri: uri)
        }
    }

    /// A missing persisted CID is an unconditional write (`swapRecord` omitted), not JSON null.
    private static func recordCAS(_ cid: String?) -> RecordCAS {
        cid.map(RecordCAS.cid) ?? .absent
    }

    private func recoverIdempotentCreate(
        operation: OutboxOperation,
        rkey: String,
        localRecord: JSONValue,
        session: OAuthSession,
        conflict: InvalidSwapConflict
    ) async throws -> RemoteWriteResult {
        let remote = try await repository.getRecord(
            GetRecordRequest(
                repo: operation.repo,
                collection: operation.collection,
                rkey: rkey
            ),
            session: session
        )
        let remoteData = try ATProtoJSONValueCodec.encodeRecord(remote.value)
        guard remote.value == localRecord else {
            throw SyncTransportError.conflict(
                remoteCID: remote.cid,
                remoteRecord: remoteData,
                message: conflict.message ?? "The stable create rkey already has another record."
            )
        }
        return RemoteWriteResult(uri: remote.uri, cid: remote.cid, record: remoteData)
    }

    private func invalidSwapError(
        _ conflict: InvalidSwapConflict,
        operation: OutboxOperation,
        session: OAuthSession
    ) async -> SyncTransportError {
        let message = conflict.message ?? "InvalidSwap"
        guard let rkey = operation.rkey else {
            return .conflict(remoteCID: nil, remoteRecord: nil, message: message)
        }
        do {
            let remote = try await repository.getRecord(
                GetRecordRequest(
                    repo: operation.repo,
                    collection: operation.collection,
                    rkey: rkey
                ),
                session: session
            )
            return .conflict(
                remoteCID: remote.cid,
                remoteRecord: try ATProtoJSONValueCodec.encodeRecord(remote.value),
                message: message
            )
        } catch {
            return .conflict(remoteCID: nil, remoteRecord: nil, message: message)
        }
    }

    private func requiredRecord(_ operation: OutboxOperation) throws -> Data {
        guard let record = operation.record else {
            throw ATProtoSyncAdapterError.missingRecord(operation.id)
        }
        return record
    }

    private func requiredRKey(_ operation: OutboxOperation) throws -> String {
        guard let rkey = operation.rkey, !rkey.isEmpty else {
            throw ATProtoSyncAdapterError.missingRKey(operation.id)
        }
        return rkey
    }

    private static func classify(_ error: ATProtoHTTPError) -> SyncTransportError {
        let detail = [error.error, error.message].compactMap { $0 }.joined(separator: ": ")
        let message = detail.isEmpty ? "AT Protocol HTTP \(error.statusCode)" : detail
        if error.statusCode == 408 || error.statusCode == 425 || error.statusCode == 429
            || error.statusCode >= 500
        {
            return .transient(message: message)
        }
        return .permanent(message: message)
    }
}
