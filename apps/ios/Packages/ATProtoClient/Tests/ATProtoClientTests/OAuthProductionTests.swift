import CryptoKit
import Foundation
import XCTest
@testable import ATProtoClient

private actor OAuthScriptedTransport: HTTPTransport {
    struct Response: Sendable {
        var statusCode: Int
        var headers: [String: String]
        var data: Data
    }

    private var responses: [Response]
    private var recordedRequests: [URLRequest] = []

    init(_ responses: [Response]) { self.responses = responses }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recordedRequests.append(request)
        let response = responses.removeFirst()
        return (
            response.data,
            HTTPURLResponse(
                url: request.url!,
                statusCode: response.statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: response.headers
            )!
        )
    }

    func requests() -> [URLRequest] { recordedRequests }
}

final class OAuthProductionTests: XCTestCase {
    private let sessionID = OAuthSessionID(rawValue: "oauth-flow-1")

    private func metadata() -> AuthorizationServerMetadata {
        AuthorizationServerMetadata(
            issuer: URL(string: "https://auth.example")!,
            authorizationEndpoint: URL(string: "https://auth.example/authorize")!,
            tokenEndpoint: URL(string: "https://auth.example/token")!,
            pushedAuthorizationRequestEndpoint: URL(string: "https://auth.example/par")!,
            responseTypesSupported: ["code"],
            grantTypesSupported: ["authorization_code", "refresh_token"],
            tokenEndpointAuthMethodsSupported: ["none", "private_key_jwt"],
            tokenEndpointAuthSigningAlgValuesSupported: ["ES256"],
            codeChallengeMethodsSupported: ["S256"],
            scopesSupported: ["atproto", "transition:generic"],
            dpopSigningAlgValuesSupported: ["ES256"],
            authorizationResponseIssuerParameterSupported: true,
            requirePushedAuthorizationRequests: true,
            clientIDMetadataDocumentSupported: true
        )
    }

    private func callbackRequest() -> BrowserAuthorizationRequest {
        BrowserAuthorizationRequest(
            authorizationURL: URL(string: "https://auth.example/authorize?request_uri=urn%3Atest")!,
            redirectURI: URL(string: "com.example.hypo:/oauth/callback")!,
            expectedState: "state-1",
            expectedIssuer: URL(string: "https://auth.example")!
        )
    }

    private func callbackURL(_ items: [URLQueryItem]) -> URL {
        var components = URLComponents(string: "com.example.hypo:/oauth/callback")!
        components.queryItems = items
        return components.url!
    }

    private func proofGenerator() throws -> DPoPProofGenerator {
        let key = try P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 1, count: 32))
        return DPoPProofGenerator(
            privateKey: key,
            now: { Date(timeIntervalSince1970: 1_700_000_000) },
            makeJTI: { "fixed-jti" }
        )
    }

    func testKeychainSessionRoundTripRemovalAndAccessibility() async throws {
        let keychain = InMemoryKeychainDataStore()
        let store = KeychainOAuthSessionStore(
            keychain: keychain,
            service: "com.example.hypo.oauth"
        )
        let session = OAuthSession(
            id: sessionID,
            issuer: URL(string: "https://auth.example")!,
            subject: "did:plc:alice",
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: Date(timeIntervalSince1970: 1_700_000_300)
        )

        try await store.save(session)
        let loaded = try await store.load(id: sessionID)
        XCTAssertEqual(loaded, session)
        let itemKey = KeychainItemKey(
            service: "com.example.hypo.oauth",
            account: "oauth-session:oauth-flow-1"
        )
        let item = await keychain.item(for: itemKey)
        XCTAssertEqual(item?.accessibility, .afterFirstUnlockThisDeviceOnly)

        try await store.remove(id: sessionID)
        let removed = try await store.load(id: sessionID)
        XCTAssertNil(removed)
    }

    func testDPoPKeyCustodyLoadsSoftwareKeyAndAppliesThisDeviceOnlyPolicy() async throws {
        let keychain = InMemoryKeychainDataStore()
        let custody = KeychainDPoPKeyCustody(
            keychain: keychain,
            service: "com.example.hypo.dpop",
            accessibility: .whenUnlockedThisDeviceOnly
        )
        let expected = try P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 1, count: 32))
        let itemKey = KeychainItemKey(
            service: "com.example.hypo.dpop",
            account: "dpop-p256:oauth-flow-1"
        )
        await keychain.write(
            expected.rawRepresentation,
            for: itemKey,
            accessibility: .whenUnlockedThisDeviceOnly
        )

        let first = try await custody.loadOrCreate(sessionID: sessionID)
        let second = try await custody.loadOrCreate(sessionID: sessionID)
        XCTAssertEqual(first.rawRepresentation, expected.rawRepresentation)
        XCTAssertEqual(second.rawRepresentation, expected.rawRepresentation)
        let item = await keychain.item(for: itemKey)
        XCTAssertEqual(item?.accessibility, .whenUnlockedThisDeviceOnly)

        try await custody.remove(sessionID: sessionID)
        let removedItem = await keychain.item(for: itemKey)
        XCTAssertNil(removedItem)
    }

    func testMetadataDiscoveryAndATProtoValidation() async throws {
        let expected = metadata()
        let transport = OAuthScriptedTransport([
            .init(
                statusCode: 200,
                headers: ["Content-Type": "application/json; charset=utf-8"],
                data: try JSONEncoder().encode(expected)
            )
        ])
        let client = AuthorizationServerMetadataClient(transport: transport)

        let discovered = try await client.discover(issuer: expected.issuer)
        XCTAssertEqual(discovered, expected)
        let requests = await transport.requests()
        XCTAssertEqual(
            requests.first?.url?.absoluteString,
            "https://auth.example/.well-known/oauth-authorization-server"
        )
    }

    func testMetadataValidationRejectsProfileViolations() throws {
        var missingScope = metadata()
        missingScope.scopesSupported = ["transition:generic"]
        XCTAssertThrowsError(
            try AuthorizationServerMetadataValidator.validate(
                missingScope,
                expectedIssuer: missingScope.issuer
            )
        ) { XCTAssertEqual($0 as? OAuthMetadataValidationError, .missingATProtoScope) }

        var optionalRequestURIRegistration = metadata()
        optionalRequestURIRegistration.requireRequestURIRegistration = nil
        XCTAssertNoThrow(
            try AuthorizationServerMetadataValidator.validate(
                optionalRequestURIRegistration,
                expectedIssuer: optionalRequestURIRegistration.issuer
            )
        )

        var disabledRequestURIRegistration = metadata()
        disabledRequestURIRegistration.requireRequestURIRegistration = false
        XCTAssertThrowsError(
            try AuthorizationServerMetadataValidator.validate(
                disabledRequestURIRegistration,
                expectedIssuer: disabledRequestURIRegistration.issuer
            )
        ) { XCTAssertEqual($0 as? OAuthMetadataValidationError, .requestURIRegistrationDisabled) }

        let invalidIssuer = URL(string: "https://auth.example/path")!
        XCTAssertThrowsError(try AuthorizationServerMetadataClient.discoveryURL(for: invalidIssuer)) {
            XCTAssertEqual(
                $0 as? OAuthMetadataValidationError,
                .invalidIssuer("https://auth.example/path")
            )
        }
    }

    func testMetadataDiscoveryRequiresExact200AndJSONContentType() async throws {
        let responseData = try JSONEncoder().encode(metadata())
        let wrongStatus = OAuthScriptedTransport([
            .init(
                statusCode: 204,
                headers: ["Content-Type": "application/json"],
                data: responseData
            )
        ])
        do {
            _ = try await AuthorizationServerMetadataClient(transport: wrongStatus)
                .discover(issuer: metadata().issuer)
            XCTFail("Expected exact-status rejection")
        } catch let error as ATProtoHTTPError {
            XCTAssertEqual(error.statusCode, 204)
        }

        let wrongType = OAuthScriptedTransport([
            .init(statusCode: 200, headers: ["Content-Type": "text/plain"], data: responseData)
        ])
        do {
            _ = try await AuthorizationServerMetadataClient(transport: wrongType)
                .discover(issuer: metadata().issuer)
            XCTFail("Expected content-type rejection")
        } catch let error as OAuthMetadataValidationError {
            XCTAssertEqual(error, .invalidMetadataContentType)
        }
    }

    func testFormAndAuthorizationRequestGoldenSnapshots() throws {
        let pushed = PushedAuthorizationRequest(
            clientID: "https://app.example/oauth-client.json",
            redirectURI: URL(string: "com.example.app:/callback")!,
            scope: "atproto transition:generic",
            state: "state-1",
            codeChallenge: "challenge-1",
            loginHint: "alice.test",
            dpopJKT: "thumbprint-1"
        )
        let parRequest = OAuthRequestBuilder.pushedAuthorization(
            endpoint: URL(string: "https://auth.example/par")!,
            request: pushed
        )
        XCTAssertEqual(parRequest.httpMethod, "POST")
        XCTAssertEqual(
            parRequest.value(forHTTPHeaderField: "Content-Type"),
            "application/x-www-form-urlencoded"
        )
        XCTAssertEqual(
            String(decoding: try XCTUnwrap(parRequest.httpBody), as: UTF8.self),
            "client_id=https%3A%2F%2Fapp.example%2Foauth-client.json&response_type=code"
                + "&redirect_uri=com.example.app%3A%2Fcallback&scope=atproto+transition%3Ageneric"
                + "&state=state-1&code_challenge=challenge-1&code_challenge_method=S256"
                + "&dpop_jkt=thumbprint-1&login_hint=alice.test"
        )

        let authorizationURL = try OAuthRequestBuilder.authorizationURL(
            endpoint: URL(string: "https://auth.example/authorize?tenant=hypo")!,
            clientID: pushed.clientID,
            requestURI: "urn:ietf:params:oauth:request_uri:abc"
        )
        let authorizationItems = URLComponents(
            url: authorizationURL,
            resolvingAgainstBaseURL: false
        )?.queryItems
        XCTAssertEqual(authorizationItems?.map(\.name), ["tenant", "client_id", "request_uri"])
        XCTAssertEqual(authorizationItems?.first?.value, "hypo")
        XCTAssertEqual(authorizationItems?[1].value, pushed.clientID)
        XCTAssertEqual(authorizationItems?.last?.value, "urn:ietf:params:oauth:request_uri:abc")

        let tokenRequest = OAuthRequestBuilder.authorizationCodeToken(
            endpoint: URL(string: "https://auth.example/token")!,
            request: AuthorizationCodeTokenRequest(
                clientID: pushed.clientID,
                code: "code value",
                redirectURI: pushed.redirectURI,
                codeVerifier: "verifier-1"
            )
        )
        XCTAssertEqual(
            String(decoding: try XCTUnwrap(tokenRequest.httpBody), as: UTF8.self),
            "grant_type=authorization_code&client_id=https%3A%2F%2Fapp.example%2Foauth-client.json"
                + "&code=code+value&redirect_uri=com.example.app%3A%2Fcallback"
                + "&code_verifier=verifier-1"
        )

        let refreshRequest = OAuthRequestBuilder.refreshToken(
            endpoint: URL(string: "https://auth.example/token")!,
            request: RefreshTokenRequest(
                clientID: pushed.clientID,
                refreshToken: "refresh/1",
                scope: "atproto transition:generic"
            )
        )
        XCTAssertEqual(
            String(decoding: try XCTUnwrap(refreshRequest.httpBody), as: UTF8.self),
            "grant_type=refresh_token&client_id=https%3A%2F%2Fapp.example%2Foauth-client.json"
                + "&refresh_token=refresh%2F1&scope=atproto+transition%3Ageneric"
        )
    }

    func testJWKThumbprintGoldenVector() throws {
        let generator = try proofGenerator()
        XCTAssertEqual(
            try generator.publicJWK.thumbprint,
            "Nrqg3-M_Xwtx-1tbtc1J7Xul2DyeC0bUSy9u_5NSG6g"
        )
    }

    func testCallbackValidationChecksRedirectStateIssuerAndOAuthError() throws {
        let request = callbackRequest()
        let success = callbackURL([
            URLQueryItem(name: "code", value: "code-1"),
            URLQueryItem(name: "state", value: "state-1"),
            URLQueryItem(name: "iss", value: "https://auth.example"),
        ])
        XCTAssertEqual(
            try OAuthCallbackValidator.validate(success, for: request),
            OAuthAuthorizationCallback(
                code: "code-1",
                state: "state-1",
                issuer: URL(string: "https://auth.example")!
            )
        )

        let wrongState = callbackURL([
            URLQueryItem(name: "code", value: "code-1"),
            URLQueryItem(name: "state", value: "other"),
            URLQueryItem(name: "iss", value: "https://auth.example"),
        ])
        XCTAssertThrowsError(try OAuthCallbackValidator.validate(wrongState, for: request)) {
            XCTAssertEqual($0 as? OAuthCallbackValidationError, .stateMismatch)
        }

        let wrongIssuer = callbackURL([
            URLQueryItem(name: "code", value: "code-1"),
            URLQueryItem(name: "state", value: "state-1"),
            URLQueryItem(name: "iss", value: "https://evil.example"),
        ])
        XCTAssertThrowsError(try OAuthCallbackValidator.validate(wrongIssuer, for: request)) {
            XCTAssertEqual(
                $0 as? OAuthCallbackValidationError,
                .issuerMismatch(
                    expected: "https://auth.example",
                    actual: "https://evil.example"
                )
            )
        }

        let denied = callbackURL([
            URLQueryItem(name: "error", value: "access_denied"),
            URLQueryItem(name: "error_description", value: "Not now"),
            URLQueryItem(name: "state", value: "state-1"),
            URLQueryItem(name: "iss", value: "https://auth.example"),
        ])
        XCTAssertThrowsError(try OAuthCallbackValidator.validate(denied, for: request)) {
            XCTAssertEqual(
                $0 as? OAuthCallbackValidationError,
                .authorizationError(code: "access_denied", description: "Not now")
            )
        }
    }

    func testCallbackValidationRejectsRedirectAndDuplicateSecurityParameters() throws {
        let request = callbackRequest()
        let wrongRedirect = URL(
            string: "com.example.hypo:/other?code=c&state=state-1&iss=https%3A%2F%2Fauth.example"
        )!
        XCTAssertThrowsError(try OAuthCallbackValidator.validate(wrongRedirect, for: request)) {
            guard case .redirectMismatch = $0 as? OAuthCallbackValidationError else {
                return XCTFail("Expected redirect mismatch, received \($0)")
            }
        }

        let duplicate = callbackURL([
            URLQueryItem(name: "code", value: "code-1"),
            URLQueryItem(name: "state", value: "state-1"),
            URLQueryItem(name: "state", value: "state-2"),
            URLQueryItem(name: "iss", value: "https://auth.example"),
        ])
        XCTAssertThrowsError(try OAuthCallbackValidator.validate(duplicate, for: request)) {
            XCTAssertEqual(
                $0 as? OAuthCallbackValidationError,
                .duplicateParameter("state")
            )
        }
    }

    func testTokenResponsesBuildAndRefreshSessionsSafely() throws {
        let issued = OAuthTokenResponse(
            accessToken: "access-1",
            tokenType: "DPoP",
            expiresIn: 300,
            refreshToken: "refresh-1",
            scope: "atproto transition:generic",
            subject: "did:plc:alice"
        )
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let session = try issued.makeSession(id: sessionID, issuer: metadata().issuer, now: now)
        XCTAssertEqual(session.subject, "did:plc:alice")
        XCTAssertEqual(session.expiresAt, Date(timeIntervalSince1970: 1_700_000_300))

        let refresh = OAuthTokenResponse(
            accessToken: "access-2",
            tokenType: "dpop",
            expiresIn: 120,
            scope: "atproto"
        )
        let refreshed = try refresh.applying(to: session, now: now)
        XCTAssertEqual(refreshed.accessToken, "access-2")
        XCTAssertEqual(refreshed.refreshToken, "refresh-1")
        XCTAssertEqual(refreshed.subject, "did:plc:alice")

        let swappedSubject = OAuthTokenResponse(
            accessToken: "access-3",
            tokenType: "DPoP",
            scope: "atproto",
            subject: "did:plc:mallory"
        )
        XCTAssertThrowsError(try swappedSubject.applying(to: session)) {
            XCTAssertEqual(
                $0 as? OAuthProtocolValidationError,
                .subjectMismatch(expected: "did:plc:alice", actual: "did:plc:mallory")
            )
        }
    }

    func testAuthorizationServerClientCarriesPARNonceIntoBoundedTokenRetry() async throws {
        let generator = try proofGenerator()
        let metadata = metadata()
        let tokenResponse = OAuthTokenResponse(
            accessToken: "access-1",
            tokenType: "DPoP",
            expiresIn: 300,
            refreshToken: "refresh-1",
            scope: "atproto transition:generic",
            subject: "did:plc:alice"
        )
        let transport = OAuthScriptedTransport([
            .init(
                statusCode: 201,
                headers: [
                    "Content-Type": "application/json",
                    "DPoP-Nonce": "nonce-from-par",
                ],
                data: Data(
                    "{\"request_uri\":\"urn:ietf:params:oauth:request_uri:abc\",\"expires_in\":90}"
                        .utf8)
            ),
            .init(
                statusCode: 400,
                headers: [
                    "Content-Type": "application/json",
                    "DPoP-Nonce": "nonce-after-challenge",
                ],
                data: Data("{\"error\":\"use_dpop_nonce\"}".utf8)
            ),
            .init(
                statusCode: 200,
                headers: [
                    "Content-Type": "application/json",
                    "DPoP-Nonce": "nonce-after-token",
                ],
                data: try JSONEncoder().encode(tokenResponse)
            ),
        ])
        let client = OAuthAuthorizationServerClient(
            transport: transport,
            proofGenerator: generator,
            maximumNonceRetries: 1
        )
        let pushedRequest = PushedAuthorizationRequest(
            clientID: "https://app.example/oauth-client.json",
            redirectURI: URL(string: "com.example.app:/callback")!,
            scope: "atproto transition:generic",
            state: "state-1",
            codeChallenge: "challenge-1",
            dpopJKT: try generator.publicJWK.thumbprint
        )

        let pushed = try await client.pushAuthorization(
            metadata: metadata,
            request: pushedRequest,
            sessionID: sessionID
        )
        XCTAssertEqual(pushed.requestURI, "urn:ietf:params:oauth:request_uri:abc")
        let token = try await client.exchangeAuthorizationCode(
            metadata: metadata,
            request: AuthorizationCodeTokenRequest(
                clientID: pushedRequest.clientID,
                code: "code-1",
                redirectURI: pushedRequest.redirectURI,
                codeVerifier: "verifier-1"
            ),
            sessionID: sessionID
        )
        XCTAssertEqual(token, tokenResponse)

        let requests = await transport.requests()
        XCTAssertEqual(requests.count, 3)
        XCTAssertNil(try dpopClaims(from: requests[0]).nonce)
        XCTAssertEqual(try dpopClaims(from: requests[1]).nonce, "nonce-from-par")
        XCTAssertEqual(try dpopClaims(from: requests[2]).nonce, "nonce-after-challenge")
        XCTAssertNil(try dpopClaims(from: requests[2]).ath)
    }

    func testAuthorizationServerTokenRetryStopsAndRequiresResponseNonce() async throws {
        let challenge = Data("{\"error\":\"use_dpop_nonce\"}".utf8)
        let transport = OAuthScriptedTransport([
            .init(
                statusCode: 400,
                headers: ["Content-Type": "application/json", "DPoP-Nonce": "nonce-1"],
                data: challenge
            ),
            .init(
                statusCode: 400,
                headers: ["Content-Type": "application/json", "DPoP-Nonce": "nonce-2"],
                data: challenge
            ),
        ])
        let client = OAuthAuthorizationServerClient(
            transport: transport,
            proofGenerator: try proofGenerator(),
            maximumNonceRetries: 1
        )
        do {
            _ = try await client.refreshToken(
                metadata: metadata(),
                request: RefreshTokenRequest(
                    clientID: "https://app.example/oauth-client.json",
                    refreshToken: "refresh-1"
                ),
                sessionID: sessionID
            )
            XCTFail("Expected bounded retry failure")
        } catch let error as ATProtoClientError {
            XCTAssertEqual(error, .authenticationRetryLimitExceeded)
        }
        let retryRequests = await transport.requests()
        XCTAssertEqual(retryRequests.count, 2)

        let missingNonceTransport = OAuthScriptedTransport([
            .init(
                statusCode: 200,
                headers: ["Content-Type": "application/json"],
                data: try JSONEncoder().encode(
                    OAuthTokenResponse(
                        accessToken: "access",
                        tokenType: "DPoP",
                        scope: "atproto"
                    ))
            )
        ])
        let missingNonceClient = OAuthAuthorizationServerClient(
            transport: missingNonceTransport,
            proofGenerator: try proofGenerator()
        )
        do {
            _ = try await missingNonceClient.refreshToken(
                metadata: metadata(),
                request: RefreshTokenRequest(
                    clientID: "https://app.example/oauth-client.json",
                    refreshToken: "refresh-1"
                ),
                sessionID: sessionID
            )
            XCTFail("Expected mandatory response nonce failure")
        } catch let error as ATProtoClientError {
            XCTAssertEqual(error, .missingDPoPNonce)
        }
    }

    private func dpopClaims(from request: URLRequest) throws -> DPoPClaims {
        let compactJWT = try XCTUnwrap(request.value(forHTTPHeaderField: "DPoP"))
        let segments = compactJWT.split(separator: ".")
        XCTAssertEqual(segments.count, 3)
        return try JSONDecoder().decode(
            DPoPClaims.self,
            from: try XCTUnwrap(Base64URL.decode(String(segments[1])))
        )
    }
}
