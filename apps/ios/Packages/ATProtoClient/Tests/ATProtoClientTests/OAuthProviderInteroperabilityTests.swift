import CryptoKit
import Foundation
import XCTest

@testable import ATProtoClient

private struct OAuthProviderFixture: Decodable, Sendable {
    var name: String
    var identifier: String
    var did: String
    var handle: String
    var pdsURL: URL
    var challengePARNonce: Bool
    var challengeTokenNonce: Bool
    var metadata: AuthorizationServerMetadata

    enum CodingKeys: String, CodingKey {
        case name, identifier, did, handle
        case pdsURL = "pds_url"
        case challengePARNonce = "challenge_par_nonce"
        case challengeTokenNonce = "challenge_token_nonce"
        case metadata = "authorization_server_metadata"
    }
}

private struct LoadedOAuthProviderFixture: Sendable {
    var fixture: OAuthProviderFixture
    var metadataData: Data

    static func load(_ resource: String) throws -> LoadedOAuthProviderFixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: resource, withExtension: "json"))
        let data = try Data(contentsOf: url)
        let fixture = try JSONDecoder().decode(OAuthProviderFixture.self, from: data)
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let metadata = try XCTUnwrap(root["authorization_server_metadata"])
        return LoadedOAuthProviderFixture(
            fixture: fixture,
            metadataData: try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])
        )
    }
}

private enum OAuthProviderFixtureError: Error {
    case unexpectedRequest(String)
    case missingDPoP(String)
    case invalidForm
}

private actor OAuthProviderFixtureTransport: HTTPTransport {
    private let loaded: LoadedOAuthProviderFixture
    private var requests: [URLRequest] = []
    private var parAttempts = 0
    private var codeAttempts = 0

    init(loaded: LoadedOAuthProviderFixture) {
        self.loaded = loaded
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard let url = request.url else { throw OAuthProviderFixtureError.unexpectedRequest("nil") }
        let fixture = loaded.fixture

        if url.absoluteString == "https://\(fixture.handle)/.well-known/atproto-did" {
            return response(url: url, contentType: "text/plain", body: Data(fixture.did.utf8))
        }
        if url.absoluteString == "https://plc.directory/\(fixture.did)" {
            return response(url: url, body: try didDocumentData(fixture))
        }
        if url == fixture.pdsURL.appending(path: ".well-known/oauth-protected-resource") {
            let body = try JSONSerialization.data(withJSONObject: [
                "authorization_servers": [fixture.metadata.issuer.absoluteString]
            ])
            return response(url: url, body: body)
        }
        if url == (try AuthorizationServerMetadataClient.discoveryURL(for: fixture.metadata.issuer)) {
            return response(url: url, body: loaded.metadataData)
        }
        if url == fixture.metadata.pushedAuthorizationRequestEndpoint {
            try requireDPoP(request)
            let attempt = parAttempts
            parAttempts += 1
            if fixture.challengePARNonce, attempt == 0 {
                return response(
                    url: url,
                    status: 400,
                    headers: ["DPoP-Nonce": "\(fixture.did)-par-challenge"],
                    body: Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                )
            }
            return response(
                url: url,
                status: 201,
                headers: ["DPoP-Nonce": "\(fixture.did)-par-issued"],
                body: Data(
                    "{\"request_uri\":\"urn:ietf:params:oauth:request_uri:\(fixture.did)\",\"expires_in\":90}"
                        .utf8
                )
            )
        }
        if url == fixture.metadata.tokenEndpoint {
            try requireDPoP(request)
            let fields = try formFields(request)
            switch fields["grant_type"] {
            case "authorization_code":
                let attempt = codeAttempts
                codeAttempts += 1
                if fixture.challengeTokenNonce, attempt == 0 {
                    return response(
                        url: url,
                        status: 400,
                        headers: ["DPoP-Nonce": "\(fixture.did)-token-challenge"],
                        body: Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                    )
                }
                return response(
                    url: url,
                    headers: ["DPoP-Nonce": "\(fixture.did)-token-issued"],
                    body: try tokenData(
                        access: "\(fixture.name)-access-1",
                        refresh: "\(fixture.name)-refresh-1",
                        subject: fixture.did
                    )
                )
            case "refresh_token":
                return response(
                    url: url,
                    headers: ["DPoP-Nonce": "\(fixture.did)-refresh-issued"],
                    body: try tokenData(
                        access: "\(fixture.name)-access-2",
                        refresh: "\(fixture.name)-refresh-2",
                        subject: fixture.did
                    )
                )
            default:
                throw OAuthProviderFixtureError.invalidForm
            }
        }
        throw OAuthProviderFixtureError.unexpectedRequest(url.absoluteString)
    }

    func recordedRequests() -> [URLRequest] { requests }

    private func requireDPoP(_ request: URLRequest) throws {
        guard request.value(forHTTPHeaderField: "DPoP") != nil else {
            throw OAuthProviderFixtureError.missingDPoP(request.url?.absoluteString ?? "nil")
        }
    }

    private func response(
        url: URL,
        status: Int = 200,
        contentType: String = "application/json",
        headers: [String: String] = [:],
        body: Data
    ) -> (Data, HTTPURLResponse) {
        var allHeaders = headers
        allHeaders["Content-Type"] = contentType
        return (
            body,
            HTTPURLResponse(
                url: url,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: allHeaders
            )!
        )
    }

    private func didDocumentData(_ fixture: OAuthProviderFixture) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "id": fixture.did,
            "alsoKnownAs": ["at://\(fixture.handle)"],
            "service": [
                [
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": fixture.pdsURL.absoluteString,
                ]
            ],
        ])
    }

    private func tokenData(
        access: String,
        refresh: String,
        subject: String
    ) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "access_token": access,
            "token_type": "DPoP",
            "expires_in": 300,
            "refresh_token": refresh,
            "scope": "atproto repo:app.graycard.roll",
            "sub": subject,
        ])
    }

    private func formFields(_ request: URLRequest) throws -> [String: String] {
        guard let body = request.httpBody, let encoded = String(data: body, encoding: .utf8) else {
            throw OAuthProviderFixtureError.invalidForm
        }
        return try encoded.split(separator: "&").reduce(into: [:]) { fields, pair in
            let components = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard components.count == 2,
                let name = String(components[0]).removingPercentEncoding,
                let value = String(components[1]).replacingOccurrences(of: "+", with: " ")
                    .removingPercentEncoding
            else { throw OAuthProviderFixtureError.invalidForm }
            fields[name] = value
        }
    }
}

@MainActor
private final class OAuthProviderFixtureBrowser: OAuthBrowserPresenting, @unchecked Sendable {
    private(set) var requests: [BrowserAuthorizationRequest] = []

    func authorize(_ request: BrowserAuthorizationRequest) async throws -> URL {
        requests.append(request)
        var callback = URLComponents(url: request.redirectURI, resolvingAgainstBaseURL: false)!
        callback.queryItems = [
            URLQueryItem(name: "code", value: "fixture-authorization-code"),
            URLQueryItem(name: "state", value: request.expectedState),
            URLQueryItem(name: "iss", value: request.expectedIssuer.absoluteString),
        ]
        return try XCTUnwrap(callback.url)
    }
}

@MainActor
final class OAuthProviderInteroperabilityTests: XCTestCase, @unchecked Sendable {
    private let clientID = "https://hypo.graycard.app/oauth-client.json"
    private let redirectURI = URL(string: "app.graycard.hypo:/oauth/callback")!
    private let scope = "atproto repo:app.graycard.roll"

    func testBlueskyHostedProviderLifecycle() async throws {
        try await assertLifecycle(resource: "bluesky-hosted")
    }

    func testFederatedEntrywayProviderLifecycle() async throws {
        try await assertLifecycle(resource: "federated-entryway")
    }

    private func assertLifecycle(resource: String) async throws {
        let loaded = try LoadedOAuthProviderFixture.load(resource)
        let fixture = loaded.fixture
        _ = try AuthorizationServerMetadataValidator.validate(
            fixture.metadata,
            expectedIssuer: fixture.metadata.issuer
        )

        let transport = OAuthProviderFixtureTransport(loaded: loaded)
        let keychain = InMemoryKeychainDataStore()
        let sessionStore = KeychainOAuthSessionStore(
            keychain: keychain,
            service: "app.hypo.oauth.interop.\(resource)"
        )
        let keyCustody = KeychainDPoPKeyCustody(
            keychain: keychain,
            service: "app.hypo.dpop.interop.\(resource)"
        )
        let nonceStore = DPoPNonceStore()
        let browser = OAuthProviderFixtureBrowser()
        let sessionID = OAuthSessionID(rawValue: "interop-\(resource)")
        let coordinator = makeCoordinator(
            transport: transport,
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody,
            nonceStore: nonceStore
        )

        let signedIn = try await coordinator.signIn(
            identifier: fixture.identifier,
            sessionID: sessionID
        )

        XCTAssertEqual(signedIn.subject, fixture.did)
        XCTAssertEqual(signedIn.pdsURL, fixture.pdsURL)
        XCTAssertEqual(signedIn.accessToken, "\(fixture.name)-access-1")
        let storedSignedIn = try await sessionStore.load(id: sessionID)
        let signedInState = await coordinator.state
        XCTAssertEqual(storedSignedIn, signedIn)
        XCTAssertEqual(signedInState, .authenticated(signedIn))

        let browserRequest = try XCTUnwrap(browser.requests.first)
        XCTAssertEqual(browserRequest.expectedIssuer, fixture.metadata.issuer)
        let authorizationItems = URLComponents(
            url: browserRequest.authorizationURL,
            resolvingAgainstBaseURL: false
        )?.queryItems
        XCTAssertEqual(authorizationItems?.first { $0.name == "client_id" }?.value, clientID)
        XCTAssertEqual(
            authorizationItems?.first { $0.name == "request_uri" }?.value,
            "urn:ietf:params:oauth:request_uri:\(fixture.did)"
        )

        let restoredCoordinator = makeCoordinator(
            transport: transport,
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody,
            nonceStore: nonceStore
        )
        let restored = try await restoredCoordinator.restore(sessionID: sessionID)
        XCTAssertEqual(restored, signedIn)

        let refreshed = try await restoredCoordinator.refresh(sessionID: sessionID)
        XCTAssertEqual(refreshed.accessToken, "\(fixture.name)-access-2")
        XCTAssertEqual(refreshed.refreshToken, "\(fixture.name)-refresh-2")
        let storedRefreshed = try await sessionStore.load(id: sessionID)
        let refreshedState = await restoredCoordinator.state
        XCTAssertEqual(storedRefreshed, refreshed)
        XCTAssertEqual(refreshedState, .authenticated(refreshed))

        try await restoredCoordinator.signOut(sessionID: sessionID)
        let removedSession = try await sessionStore.load(id: sessionID)
        let removedKey = try await keyCustody.load(sessionID: sessionID)
        let signedOutState = await restoredCoordinator.state
        XCTAssertNil(removedSession)
        XCTAssertNil(removedKey)
        XCTAssertEqual(signedOutState, .signedOut)

        try assertProtocolRequests(
            await transport.recordedRequests(),
            fixture: fixture
        )
    }

    private func makeCoordinator(
        transport: OAuthProviderFixtureTransport,
        browser: OAuthProviderFixtureBrowser,
        sessionStore: KeychainOAuthSessionStore,
        keyCustody: KeychainDPoPKeyCustody,
        nonceStore: DPoPNonceStore
    ) -> OAuthFlowCoordinator {
        OAuthFlowCoordinator(
            configuration: OAuthFlowConfiguration(
                clientID: clientID,
                redirectURI: redirectURI,
                scope: scope
            ),
            identityResolver: ATProtoIdentityResolver(transport: transport, directoryURL: nil),
            metadataDiscovery: AuthorizationServerMetadataClient(transport: transport),
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody,
            authorizationServerFactory: { key in
                OAuthAuthorizationServerClient(
                    transport: transport,
                    proofGenerator: DPoPProofGenerator(privateKey: key),
                    nonceStore: nonceStore
                )
            },
            makeState: { "fixture-state" },
            makeCodeVerifier: {
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
            },
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
    }

    private func assertProtocolRequests(
        _ requests: [URLRequest],
        fixture: OAuthProviderFixture
    ) throws {
        let discoveryURL = try AuthorizationServerMetadataClient.discoveryURL(
            for: fixture.metadata.issuer
        )
        var expectedURLs = [
            "https://\(fixture.handle)/.well-known/atproto-did",
            "https://plc.directory/\(fixture.did)",
            fixture.pdsURL.appending(path: ".well-known/oauth-protected-resource").absoluteString,
            discoveryURL.absoluteString,
        ]
        expectedURLs += Array(
            repeating: try XCTUnwrap(fixture.metadata.pushedAuthorizationRequestEndpoint)
                .absoluteString,
            count: fixture.challengePARNonce ? 2 : 1
        )
        expectedURLs += Array(
            repeating: fixture.metadata.tokenEndpoint.absoluteString,
            count: fixture.challengeTokenNonce ? 2 : 1
        )
        expectedURLs += [discoveryURL.absoluteString, fixture.metadata.tokenEndpoint.absoluteString]
        XCTAssertEqual(requests.compactMap { $0.url?.absoluteString }, expectedURLs)

        let parRequests = requests.filter { $0.url == fixture.metadata.pushedAuthorizationRequestEndpoint }
        let tokenRequests = requests.filter { $0.url == fixture.metadata.tokenEndpoint }
        XCTAssertEqual(parRequests.count, fixture.challengePARNonce ? 2 : 1)
        XCTAssertEqual(tokenRequests.count, fixture.challengeTokenNonce ? 3 : 2)

        let parFields = try formFields(try XCTUnwrap(parRequests.first))
        XCTAssertEqual(parFields["login_hint"], fixture.identifier)
        XCTAssertEqual(parFields["state"], "fixture-state")
        XCTAssertEqual(parFields["scope"], scope)
        let parHeader = try dpopHeader(from: try XCTUnwrap(parRequests.first))
        XCTAssertEqual(parFields["dpop_jkt"], parHeader.jwk.thumbprint)

        let allDPoPRequests = parRequests + tokenRequests
        let claims = try allDPoPRequests.map(dpopClaims(from:))
        XCTAssertEqual(Set(claims.map(\.jti)).count, claims.count)
        XCTAssertNil(claims.first?.nonce)
        if fixture.challengePARNonce {
            XCTAssertEqual(claims[1].nonce, "\(fixture.did)-par-challenge")
        }

        let codeRequests = tokenRequests.filter {
            (try? formFields($0)["grant_type"]) == "authorization_code"
        }
        let codeFields = try formFields(try XCTUnwrap(codeRequests.first))
        XCTAssertEqual(codeFields["code"], "fixture-authorization-code")
        XCTAssertEqual(
            codeFields["code_verifier"],
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
        )
        let refreshRequest = try XCTUnwrap(
            tokenRequests.first {
                (try? formFields($0)["grant_type"]) == "refresh_token"
            })
        XCTAssertEqual(
            try dpopClaims(from: try XCTUnwrap(codeRequests.first)).nonce,
            "\(fixture.did)-par-issued"
        )
        if fixture.challengeTokenNonce {
            XCTAssertEqual(
                try dpopClaims(from: codeRequests[1]).nonce,
                "\(fixture.did)-token-challenge"
            )
        }
        XCTAssertEqual(
            try dpopClaims(from: refreshRequest).nonce,
            "\(fixture.did)-token-issued"
        )
        XCTAssertEqual(try formFields(refreshRequest)["refresh_token"], "\(fixture.name)-refresh-1")
    }

    private func dpopHeader(from request: URLRequest) throws -> DPoPHeader {
        try jwtPart(from: request, index: 0, as: DPoPHeader.self)
    }

    private func dpopClaims(from request: URLRequest) throws -> DPoPClaims {
        try jwtPart(from: request, index: 1, as: DPoPClaims.self)
    }

    private func jwtPart<Value: Decodable>(
        from request: URLRequest,
        index: Int,
        as type: Value.Type
    ) throws -> Value {
        let jwt = try XCTUnwrap(request.value(forHTTPHeaderField: "DPoP"))
        let parts = jwt.split(separator: ".")
        XCTAssertEqual(parts.count, 3)
        return try JSONDecoder().decode(
            Value.self,
            from: try XCTUnwrap(Base64URL.decode(String(parts[index])))
        )
    }

    private func formFields(_ request: URLRequest) throws -> [String: String] {
        guard let body = request.httpBody, let encoded = String(data: body, encoding: .utf8) else {
            throw OAuthProviderFixtureError.invalidForm
        }
        return try encoded.split(separator: "&").reduce(into: [:]) { fields, pair in
            let components = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard components.count == 2,
                let name = String(components[0]).removingPercentEncoding,
                let value = String(components[1]).replacingOccurrences(of: "+", with: " ")
                    .removingPercentEncoding
            else { throw OAuthProviderFixtureError.invalidForm }
            fields[name] = value
        }
    }
}
