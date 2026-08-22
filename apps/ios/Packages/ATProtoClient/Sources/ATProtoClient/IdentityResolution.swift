import Foundation

public enum ATProtoIdentityResolutionError: Error, Equatable, Sendable {
    case invalidIdentifier(String)
    case unsupportedDIDMethod(String)
    case invalidResponse(URL)
    case handleNotConfirmed(handle: String, did: String)
    case missingPDS(String)
    case missingAuthorizationServer(URL)
}

/// Identity facts verified together before an OAuth authorization is started.
public struct ATProtoResolvedIdentity: Hashable, Sendable {
    public var did: String
    public var handle: String?
    public var pdsURL: URL
    public var authorizationIssuer: URL

    public init(did: String, handle: String?, pdsURL: URL, authorizationIssuer: URL) {
        self.did = did
        self.handle = handle
        self.pdsURL = pdsURL
        self.authorizationIssuer = authorizationIssuer
    }
}

/// Resolves a handle or DID through its DID document and OAuth protected-resource metadata.
public struct ATProtoIdentityResolver: OAuthIdentityResolving, ATProtoAccountIdentityResolving,
    Sendable
{
    private let transport: any HTTPTransport
    private let directoryURL: URL?

    /// - Parameter directoryURL: Optional handle-resolution fallback. The direct
    ///   `/.well-known/atproto-did` method is attempted first.
    public init(
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        directoryURL: URL? = URL(string: "https://public.api.bsky.app")
    ) {
        self.transport = transport
        self.directoryURL = directoryURL
    }

    public func resolveAuthorizationIssuer(identifier: String) async throws -> URL {
        try await resolveIdentity(identifier: identifier).authorizationIssuer
    }

    /// Resolves and binds an account's DID, verified handle, PDS, and OAuth issuer.
    public func resolveIdentity(identifier: String) async throws -> ATProtoResolvedIdentity {
        let normalized = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            throw ATProtoIdentityResolutionError.invalidIdentifier(identifier)
        }

        let handle = normalized.hasPrefix("did:") ? nil : Self.normalizeHandle(normalized)
        let did: String
        if let handle {
            did = try await resolveHandle(handle)
        } else {
            did = normalized
        }
        let document = try await resolveDIDDocument(did)

        if let handle {
            let expected = "at://" + handle.lowercased()
            let confirmed =
                document.alsoKnownAs?.contains {
                    $0.lowercased() == expected
                } ?? false
            guard confirmed else {
                throw ATProtoIdentityResolutionError.handleNotConfirmed(handle: handle, did: did)
            }
        }

        let pds = try document.pdsEndpoint()
        let metadataURL = pds.appending(path: ".well-known/oauth-protected-resource")
        let metadata: ProtectedResourceMetadata = try await getJSON(metadataURL)
        guard let issuer = metadata.authorizationServers.first else {
            throw ATProtoIdentityResolutionError.missingAuthorizationServer(pds)
        }
        try Self.requireSecureHTTPURL(issuer)
        return ATProtoResolvedIdentity(
            did: did,
            handle: handle,
            pdsURL: pds,
            authorizationIssuer: issuer
        )
    }

    private func resolveHandle(_ handle: String) async throws -> String {
        guard Self.isValidHandle(handle) else {
            throw ATProtoIdentityResolutionError.invalidIdentifier(handle)
        }

        let directURL = URL(string: "https://" + handle + "/.well-known/atproto-did")
        if let directURL,
            let did = try? await getText(directURL),
            did.hasPrefix("did:")
        {
            return did
        }

        guard let directoryURL else {
            throw ATProtoIdentityResolutionError.invalidIdentifier(handle)
        }
        let endpoint = directoryURL.appending(path: "xrpc/com.atproto.identity.resolveHandle")
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw ATProtoIdentityResolutionError.invalidResponse(endpoint)
        }
        components.queryItems = [URLQueryItem(name: "handle", value: handle)]
        guard let url = components.url else {
            throw ATProtoIdentityResolutionError.invalidResponse(endpoint)
        }
        let response: HandleResolution = try await getJSON(url)
        guard response.did.hasPrefix("did:") else {
            throw ATProtoIdentityResolutionError.invalidResponse(url)
        }
        return response.did
    }

    private func resolveDIDDocument(_ did: String) async throws -> DIDDocument {
        let url: URL
        if did.hasPrefix("did:plc:") {
            guard let value = URL(string: "https://plc.directory/" + did) else {
                throw ATProtoIdentityResolutionError.invalidIdentifier(did)
            }
            url = value
        } else if did.hasPrefix("did:web:") {
            url = try Self.didWebDocumentURL(did)
        } else {
            throw ATProtoIdentityResolutionError.unsupportedDIDMethod(did)
        }

        let document: DIDDocument = try await getJSON(url)
        guard document.id == did else {
            throw ATProtoIdentityResolutionError.invalidResponse(url)
        }
        return document
    }

    private func getText(_ url: URL) async throws -> String {
        let (data, response) = try await transport.data(for: URLRequest(url: url))
        try Self.requireSuccess(response, requestedURL: url)
        guard
            let value = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty
        else {
            throw ATProtoIdentityResolutionError.invalidResponse(url)
        }
        return value
    }

    private func getJSON<Value: Decodable>(_ url: URL) async throws -> Value {
        let (data, response) = try await transport.data(for: URLRequest(url: url))
        try Self.requireSuccess(response, requestedURL: url)
        do {
            return try JSONDecoder().decode(Value.self, from: data)
        } catch {
            throw ATProtoIdentityResolutionError.invalidResponse(url)
        }
    }

    private static func requireSuccess(_ response: HTTPURLResponse, requestedURL: URL) throws {
        guard (200..<300).contains(response.statusCode),
            let finalURL = response.url,
            finalURL.scheme?.lowercased() == "https"
        else {
            throw ATProtoIdentityResolutionError.invalidResponse(requestedURL)
        }
    }

    private static func normalizeHandle(_ value: String) -> String {
        String(value.drop(while: { $0 == "@" })).lowercased()
    }

    private static func isValidHandle(_ handle: String) -> Bool {
        guard handle.count <= 253, !handle.hasPrefix("."), !handle.hasSuffix(".") else {
            return false
        }
        let labels = handle.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2 else { return false }
        return labels.allSatisfy { label in
            guard !label.isEmpty, label.count <= 63,
                label.first != "-", label.last != "-"
            else {
                return false
            }
            return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        }
    }

    private static func didWebDocumentURL(_ did: String) throws -> URL {
        let methodSpecific = String(did.dropFirst("did:web:".count))
        let segments = methodSpecific.split(separator: ":", omittingEmptySubsequences: false)
        guard let encodedHost = segments.first,
            !encodedHost.isEmpty,
            let host = String(encodedHost).removingPercentEncoding,
            !host.isEmpty
        else {
            throw ATProtoIdentityResolutionError.invalidIdentifier(did)
        }

        guard var url = URL(string: "https://" + host), url.host != nil else {
            throw ATProtoIdentityResolutionError.invalidIdentifier(did)
        }
        let path = try segments.dropFirst().map { segment in
            guard let value = String(segment).removingPercentEncoding, !value.isEmpty else {
                throw ATProtoIdentityResolutionError.invalidIdentifier(did)
            }
            return value
        }
        if path.isEmpty {
            url.append(path: ".well-known/did.json")
        } else {
            path.forEach { url.append(path: $0) }
            url.append(path: "did.json")
        }
        try requireSecureHTTPURL(url)
        return url
    }

    fileprivate static func requireSecureHTTPURL(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https",
            url.host != nil,
            url.user == nil,
            url.password == nil,
            url.query == nil,
            url.fragment == nil
        else {
            throw ATProtoIdentityResolutionError.invalidResponse(url)
        }
    }
}

private struct HandleResolution: Decodable {
    let did: String
}

private struct ProtectedResourceMetadata: Decodable {
    let authorizationServers: [URL]

    enum CodingKeys: String, CodingKey {
        case authorizationServers = "authorization_servers"
    }
}

private struct DIDDocument: Decodable {
    let id: String
    let alsoKnownAs: [String]?
    let service: [DIDService]?

    func pdsEndpoint() throws -> URL {
        let entry = service?.first {
            $0.id == "#atproto_pds" || $0.type == "AtprotoPersonalDataServer"
        }
        guard let endpoint = entry?.serviceEndpoint else {
            throw ATProtoIdentityResolutionError.missingPDS(id)
        }
        try ATProtoIdentityResolver.requireSecureHTTPURL(endpoint)
        return endpoint
    }
}

private struct DIDService: Decodable {
    let id: String
    let type: String
    let serviceEndpoint: URL
}
