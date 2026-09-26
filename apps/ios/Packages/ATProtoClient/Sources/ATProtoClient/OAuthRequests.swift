import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public struct PushedAuthorizationRequest: Hashable, Sendable {
    public var clientID: String
    public var redirectURI: URL
    public var scope: String
    public var state: String
    public var codeChallenge: String
    public var loginHint: String?
    public var dpopJKT: String

    public init(
        clientID: String,
        redirectURI: URL,
        scope: String,
        state: String,
        codeChallenge: String,
        loginHint: String? = nil,
        dpopJKT: String
    ) {
        self.clientID = clientID
        self.redirectURI = redirectURI
        self.scope = scope
        self.state = state
        self.codeChallenge = codeChallenge
        self.loginHint = loginHint
        self.dpopJKT = dpopJKT
    }

    public var formFields: [(String, String)] {
        var fields = [
            ("client_id", clientID),
            ("response_type", "code"),
            ("redirect_uri", redirectURI.absoluteString),
            ("scope", scope),
            ("state", state),
            ("code_challenge", codeChallenge),
            ("code_challenge_method", "S256"),
            ("dpop_jkt", dpopJKT),
        ]
        if let loginHint { fields.append(("login_hint", loginHint)) }
        return fields
    }
}

public struct PushedAuthorizationResponse: Codable, Hashable, Sendable {
    public var requestURI: String
    public var expiresIn: Int

    public init(requestURI: String, expiresIn: Int) {
        self.requestURI = requestURI
        self.expiresIn = expiresIn
    }

    enum CodingKeys: String, CodingKey {
        case requestURI = "request_uri"
        case expiresIn = "expires_in"
    }
}

public struct AuthorizationCodeTokenRequest: Hashable, Sendable {
    public var clientID: String
    public var code: String
    public var redirectURI: URL
    public var codeVerifier: String

    public init(clientID: String, code: String, redirectURI: URL, codeVerifier: String) {
        self.clientID = clientID
        self.code = code
        self.redirectURI = redirectURI
        self.codeVerifier = codeVerifier
    }

    public var formFields: [(String, String)] {
        [
            ("grant_type", "authorization_code"),
            ("client_id", clientID),
            ("code", code),
            ("redirect_uri", redirectURI.absoluteString),
            ("code_verifier", codeVerifier),
        ]
    }
}

public struct RefreshTokenRequest: Hashable, Sendable {
    public var clientID: String
    public var refreshToken: String
    public var scope: String?

    public init(clientID: String, refreshToken: String, scope: String? = nil) {
        self.clientID = clientID
        self.refreshToken = refreshToken
        self.scope = scope
    }

    public var formFields: [(String, String)] {
        var fields = [
            ("grant_type", "refresh_token"),
            ("client_id", clientID),
            ("refresh_token", refreshToken),
        ]
        if let scope { fields.append(("scope", scope)) }
        return fields
    }
}

public struct OAuthTokenResponse: Codable, Hashable, Sendable {
    public var accessToken: String
    public var tokenType: String
    public var expiresIn: Int?
    public var refreshToken: String?
    public var scope: String?
    public var subject: String?

    public init(
        accessToken: String,
        tokenType: String,
        expiresIn: Int? = nil,
        refreshToken: String? = nil,
        scope: String? = nil,
        subject: String? = nil
    ) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.refreshToken = refreshToken
        self.scope = scope
        self.subject = subject
    }

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
        case subject = "sub"
    }

    public func validated(requireSubject: Bool) throws -> OAuthTokenResponse {
        guard tokenType.caseInsensitiveCompare("DPoP") == .orderedSame else {
            throw OAuthProtocolValidationError.unexpectedTokenType(tokenType)
        }
        guard scope?.split(separator: " ").contains("atproto") == true else {
            throw OAuthProtocolValidationError.missingATProtoScope
        }
        if requireSubject, subject == nil {
            throw OAuthProtocolValidationError.missingSubject
        }
        if let expiresIn, expiresIn < 0 {
            throw OAuthProtocolValidationError.invalidExpiration
        }
        return self
    }

    public func makeSession(
        id: OAuthSessionID,
        issuer: URL,
        now: Date = Date()
    ) throws -> OAuthSession {
        let response = try validated(requireSubject: true)
        return OAuthSession(
            id: id,
            issuer: issuer,
            subject: response.subject!,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            scope: response.scope,
            expiresAt: response.expiresIn.map { now.addingTimeInterval(TimeInterval($0)) }
        )
    }

    public func applying(to session: OAuthSession, now: Date = Date()) throws -> OAuthSession {
        let response = try validated(requireSubject: false)
        if let subject = response.subject, subject != session.subject {
            throw OAuthProtocolValidationError.subjectMismatch(
                expected: session.subject,
                actual: subject
            )
        }
        var refreshed = session
        refreshed.accessToken = response.accessToken
        refreshed.refreshToken = response.refreshToken ?? session.refreshToken
        refreshed.scope = response.scope
        refreshed.expiresAt = response.expiresIn.map {
            now.addingTimeInterval(TimeInterval($0))
        }
        return refreshed
    }
}

public enum OAuthProtocolValidationError: Error, Equatable, Sendable {
    case unexpectedTokenType(String)
    case missingATProtoScope
    case missingSubject
    case invalidExpiration
    case subjectMismatch(expected: String, actual: String)
    case dpopKeyMismatch
    case invalidResponseContentType
    case unexpectedRedirect(expected: String, actual: String)
}

public struct OAuthEndpointError: Error, Equatable, Sendable {
    public var statusCode: Int
    public var error: String?
    public var errorDescription: String?

    public init(statusCode: Int, error: String? = nil, errorDescription: String? = nil) {
        self.statusCode = statusCode
        self.error = error
        self.errorDescription = errorDescription
    }
}

public enum OAuthRequestBuilder {
    public static func pushedAuthorization(
        endpoint: URL,
        request: PushedAuthorizationRequest
    ) -> URLRequest {
        formRequest(endpoint: endpoint, fields: request.formFields)
    }

    public static func authorizationURL(
        endpoint: URL,
        clientID: String,
        requestURI: String
    ) throws -> URL {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw ATProtoClientError.invalidURL
        }
        components.queryItems =
            (components.queryItems ?? []) + [
                URLQueryItem(name: "client_id", value: clientID),
                URLQueryItem(name: "request_uri", value: requestURI),
            ]
        guard let url = components.url else { throw ATProtoClientError.invalidURL }
        return url
    }

    public static func authorizationCodeToken(
        endpoint: URL,
        request: AuthorizationCodeTokenRequest
    ) -> URLRequest {
        formRequest(endpoint: endpoint, fields: request.formFields)
    }

    public static func refreshToken(endpoint: URL, request: RefreshTokenRequest) -> URLRequest {
        formRequest(endpoint: endpoint, fields: request.formFields)
    }

    private static func formRequest(endpoint: URL, fields: [(String, String)]) -> URLRequest {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Data(FormURLEncoder.encode(fields).utf8)
        return request
    }
}

public enum FormURLEncoder {
    public static func encode(_ fields: [(String, String)]) -> String {
        fields.map { "\(escape($0.0))=\(escape($0.1))" }.joined(separator: "&")
    }

    private static func escape(_ value: String) -> String {
        value.utf8.map { byte -> String in
            switch byte {
            case 0x2A, 0x2D, 0x2E, 0x30...0x39, 0x41...0x5A, 0x5F, 0x61...0x7A:
                String(UnicodeScalar(byte))
            case 0x20:
                "+"
            default:
                String(format: "%%%02X", byte)
            }
        }.joined()
    }
}

public extension DPoPJSONWebKey {
    /// RFC 7638 SHA-256 JWK thumbprint using the required lexicographic member order.
    var thumbprint: String {
        let canonical = "{\"crv\":\"\(crv)\",\"kty\":\"\(kty)\",\"x\":\"\(x)\",\"y\":\"\(y)\"}"
        return Base64URL.encode(SHA256Digest.hash(Data(canonical.utf8)))
    }
}

public protocol OAuthAuthorizationServerNetworking: Sendable {
    func pushAuthorization(
        metadata: AuthorizationServerMetadata,
        request: PushedAuthorizationRequest,
        sessionID: OAuthSessionID
    ) async throws -> PushedAuthorizationResponse
    func exchangeAuthorizationCode(
        metadata: AuthorizationServerMetadata,
        request: AuthorizationCodeTokenRequest,
        sessionID: OAuthSessionID
    ) async throws -> OAuthTokenResponse
    func refreshToken(
        metadata: AuthorizationServerMetadata,
        request: RefreshTokenRequest,
        sessionID: OAuthSessionID
    ) async throws -> OAuthTokenResponse
}

/// Protocol-bounded authorization-server client with a single bounded DPoP nonce retry.
public actor OAuthAuthorizationServerClient: OAuthAuthorizationServerNetworking {
    private let transport: any HTTPTransport
    private let proofGenerator: DPoPProofGenerator
    private let nonceStore: DPoPNonceStore
    private let maximumNonceRetries: Int
    private let decoder = JSONDecoder()

    public init(
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        proofGenerator: DPoPProofGenerator,
        nonceStore: DPoPNonceStore = DPoPNonceStore(),
        maximumNonceRetries: Int = 1
    ) {
        precondition(maximumNonceRetries >= 0)
        self.transport = transport
        self.proofGenerator = proofGenerator
        self.nonceStore = nonceStore
        self.maximumNonceRetries = maximumNonceRetries
    }

    public func pushAuthorization(
        metadata: AuthorizationServerMetadata,
        request: PushedAuthorizationRequest,
        sessionID: OAuthSessionID
    ) async throws -> PushedAuthorizationResponse {
        _ = try AuthorizationServerMetadataValidator.validate(
            metadata,
            expectedIssuer: metadata.issuer
        )
        guard request.dpopJKT == (try proofGenerator.publicJWK.thumbprint) else {
            throw OAuthProtocolValidationError.dpopKeyMismatch
        }
        guard let endpoint = metadata.pushedAuthorizationRequestEndpoint else {
            throw OAuthMetadataValidationError.missingPushedAuthorizationRequestEndpoint
        }
        let urlRequest = OAuthRequestBuilder.pushedAuthorization(endpoint: endpoint, request: request)
        // The AT Protocol OAuth profile initiates DPoP with PAR. This also allows
        // an authorization server to challenge the first request with a nonce.
        let result = try await sendDPoP(urlRequest, sessionID: sessionID)
        guard (200..<300).contains(result.1.statusCode) else {
            throw endpointError(data: result.0, response: result.1)
        }
        try validateJSON(response: result.1)
        return try decoder.decode(PushedAuthorizationResponse.self, from: result.0)
    }

    public func exchangeAuthorizationCode(
        metadata: AuthorizationServerMetadata,
        request: AuthorizationCodeTokenRequest,
        sessionID: OAuthSessionID
    ) async throws -> OAuthTokenResponse {
        _ = try AuthorizationServerMetadataValidator.validate(
            metadata,
            expectedIssuer: metadata.issuer
        )
        let urlRequest = OAuthRequestBuilder.authorizationCodeToken(
            endpoint: metadata.tokenEndpoint,
            request: request
        )
        let result = try await sendDPoP(urlRequest, sessionID: sessionID)
        try validateSuccess(data: result.0, response: result.1)
        return try decoder.decode(OAuthTokenResponse.self, from: result.0)
            .validated(requireSubject: true)
    }

    public func refreshToken(
        metadata: AuthorizationServerMetadata,
        request: RefreshTokenRequest,
        sessionID: OAuthSessionID
    ) async throws -> OAuthTokenResponse {
        _ = try AuthorizationServerMetadataValidator.validate(
            metadata,
            expectedIssuer: metadata.issuer
        )
        let urlRequest = OAuthRequestBuilder.refreshToken(
            endpoint: metadata.tokenEndpoint,
            request: request
        )
        let result = try await sendDPoP(urlRequest, sessionID: sessionID)
        try validateSuccess(data: result.0, response: result.1)
        return try decoder.decode(OAuthTokenResponse.self, from: result.0)
            .validated(requireSubject: false)
    }

    private func sendDPoP(
        _ request: URLRequest,
        sessionID: OAuthSessionID
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw ATProtoClientError.invalidURL }
        let key = DPoPNonceKey(origin: try DPoPOrigin(url: url), sessionID: sessionID)
        var retryCount = 0
        while true {
            let nonce = await nonceStore.nonce(for: key)
            let proof = try proofGenerator.proof(
                method: request.httpMethod ?? "POST",
                url: url,
                nonce: nonce
            )
            var signed = request
            signed.setValue(proof.compactJWT, forHTTPHeaderField: "DPoP")
            let result = try await transport.data(for: signed)
            try validateResponseURL(result.1, expected: url)
            let responseNonce = result.1.value(forHTTPHeaderField: "DPoP-Nonce")
            if let responseNonce { await nonceStore.set(responseNonce, for: key) }
            if Self.requiresNonceRetry(data: result.0, response: result.1) {
                guard retryCount < maximumNonceRetries else {
                    throw ATProtoClientError.authenticationRetryLimitExceeded
                }
                guard responseNonce != nil else { throw ATProtoClientError.missingDPoPNonce }
                retryCount += 1
                continue
            }
            guard responseNonce != nil else { throw ATProtoClientError.missingDPoPNonce }
            return result
        }
    }

    private func validateSuccess(data: Data, response: HTTPURLResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            throw endpointError(data: data, response: response)
        }
        try validateJSON(response: response)
    }

    private func validateJSON(response: HTTPURLResponse) throws {
        guard response.mimeType?.lowercased() == "application/json" else {
            throw OAuthProtocolValidationError.invalidResponseContentType
        }
    }

    private func validateResponseURL(_ response: HTTPURLResponse, expected: URL) throws {
        guard response.url == expected else {
            throw OAuthProtocolValidationError.unexpectedRedirect(
                expected: expected.absoluteString,
                actual: response.url?.absoluteString ?? "missing response URL"
            )
        }
    }

    private func endpointError(data: Data, response: HTTPURLResponse) -> OAuthEndpointError {
        struct Body: Decodable {
            var error: String?
            var errorDescription: String?

            enum CodingKeys: String, CodingKey {
                case error
                case errorDescription = "error_description"
            }
        }
        let body = try? decoder.decode(Body.self, from: data)
        return OAuthEndpointError(
            statusCode: response.statusCode,
            error: body?.error,
            errorDescription: body?.errorDescription
        )
    }

    private static func requiresNonceRetry(data: Data, response: HTTPURLResponse) -> Bool {
        guard response.statusCode == 400 || response.statusCode == 401 else { return false }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return object["error"] as? String == "use_dpop_nonce"
    }
}
