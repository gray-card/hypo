import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public struct ATProtoHTTPError: Error, Equatable, Sendable {
    public var statusCode: Int
    public var error: String?
    public var message: String?

    public init(statusCode: Int, error: String? = nil, message: String? = nil) {
        self.statusCode = statusCode
        self.error = error
        self.message = message
    }
}

/// First-party adapter for the narrow `com.atproto.repo` surface used by Hypo.
public struct RepositoryClient: Sendable {
    private let serviceURL: URL
    private let transport: DPoPAuthenticatedTransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(serviceURL: URL, transport: DPoPAuthenticatedTransport) {
        self.serviceURL = serviceURL
        self.transport = transport
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        self.encoder = encoder
        self.decoder = JSONDecoder()
    }

    public func getRecord(_ input: GetRecordRequest, session: OAuthSession) async throws -> GetRecordResponse
    {
        let data = try await query(
            method: "com.atproto.repo.getRecord",
            items: [
                ("repo", input.repo),
                ("collection", input.collection),
                ("rkey", input.rkey),
                ("cid", input.cid),
            ],
            session: session
        )
        return try decoder.decode(GetRecordResponse.self, from: data)
    }

    public func listRecords(_ input: ListRecordsRequest, session: OAuthSession) async throws
        -> ListRecordsResponse
    {
        let data = try await query(
            method: "com.atproto.repo.listRecords",
            items: [
                ("repo", input.repo),
                ("collection", input.collection),
                ("limit", input.limit.map(String.init)),
                ("cursor", input.cursor),
                ("reverse", input.reverse.map(String.init)),
            ],
            session: session
        )
        return try decoder.decode(ListRecordsResponse.self, from: data)
    }

    public func createRecord(
        _ input: CreateRecordRequest,
        session: OAuthSession
    ) async throws -> RecordWriteResponse {
        try await procedure("com.atproto.repo.createRecord", input: input, session: session)
    }

    public func putRecord(_ input: PutRecordRequest, session: OAuthSession) async throws
        -> RecordWriteResponse
    {
        try await procedure("com.atproto.repo.putRecord", input: input, session: session)
    }

    public func deleteRecord(
        _ input: DeleteRecordRequest,
        session: OAuthSession
    ) async throws -> DeleteRecordResponse {
        try await procedure("com.atproto.repo.deleteRecord", input: input, session: session)
    }

    private func query(
        method: String,
        items: [(String, String?)],
        session: OAuthSession
    ) async throws -> Data {
        var components = URLComponents(
            url: serviceURL.appendingPathComponent("xrpc/\(method)"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = items.compactMap { key, value in
            value.map { URLQueryItem(name: key, value: $0) }
        }
        guard let url = components?.url else { throw ATProtoClientError.invalidURL }
        return try await send(URLRequest(url: url), operation: method, session: session)
    }

    private func procedure<Input: Encodable, Output: Decodable>(
        _ method: String,
        input: Input,
        session: OAuthSession
    ) async throws -> Output {
        let url = serviceURL.appendingPathComponent("xrpc/\(method)")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(input)
        let data = try await send(request, operation: method, session: session)
        return try decoder.decode(Output.self, from: data)
    }

    private func send(_ request: URLRequest, operation: String, session: OAuthSession) async throws -> Data {
        let (data, response) = try await transport.data(for: request, session: session)
        guard (200..<300).contains(response.statusCode) else {
            let body = try? decoder.decode(ErrorBody.self, from: data)
            if body?.error == "InvalidSwap" {
                throw InvalidSwapConflict(operation: operation, message: body?.message)
            }
            throw ATProtoHTTPError(
                statusCode: response.statusCode, error: body?.error, message: body?.message)
        }
        return data
    }
}

private struct ErrorBody: Decodable {
    var error: String?
    var message: String?
}
