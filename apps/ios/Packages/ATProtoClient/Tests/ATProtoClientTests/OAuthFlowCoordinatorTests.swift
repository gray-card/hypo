import Foundation
import XCTest

@testable import ATProtoClient

private enum CoordinatorBrowserError: Error, Equatable {
    case cancelled
}

private struct CoordinatorIdentityResolver: ATProtoAccountIdentityResolving {
    var identity: ATProtoResolvedIdentity

    func resolveIdentity(identifier: String) async throws -> ATProtoResolvedIdentity {
        identity
    }
}

private struct CoordinatorMetadataDiscovery: AuthorizationServerDiscovering {
    var metadata: AuthorizationServerMetadata

    func discover(issuer: URL) async throws -> AuthorizationServerMetadata {
        XCTAssertEqual(issuer, metadata.issuer)
        return metadata
    }
}

private final class CoordinatorBrowser: OAuthBrowserPresenting, @unchecked Sendable {
    typealias Action = @MainActor @Sendable (BrowserAuthorizationRequest) throws -> URL
    private let action: Action

    init(action: @escaping Action) { self.action = action }

    @MainActor
    func authorize(_ request: BrowserAuthorizationRequest) async throws -> URL {
        try action(request)
    }
}

private actor CoordinatorAuthorizationServer: OAuthAuthorizationServerNetworking {
    var issuedTokens: OAuthTokenResponse
    var refreshedTokens: OAuthTokenResponse
    private(set) var pushedRequests: [PushedAuthorizationRequest] = []
    private(set) var tokenRequests: [AuthorizationCodeTokenRequest] = []
    private(set) var refreshRequests: [RefreshTokenRequest] = []

    init(issuedTokens: OAuthTokenResponse, refreshedTokens: OAuthTokenResponse? = nil) {
        self.issuedTokens = issuedTokens
        self.refreshedTokens = refreshedTokens ?? issuedTokens
    }

    func pushAuthorization(
        metadata: AuthorizationServerMetadata,
        request: PushedAuthorizationRequest,
        sessionID: OAuthSessionID
    ) -> PushedAuthorizationResponse {
        pushedRequests.append(request)
        return PushedAuthorizationResponse(
            requestURI: "urn:ietf:params:oauth:request_uri:test", expiresIn: 90)
    }

    func exchangeAuthorizationCode(
        metadata: AuthorizationServerMetadata,
        request: AuthorizationCodeTokenRequest,
        sessionID: OAuthSessionID
    ) -> OAuthTokenResponse {
        tokenRequests.append(request)
        return issuedTokens
    }

    func refreshToken(
        metadata: AuthorizationServerMetadata,
        request: RefreshTokenRequest,
        sessionID: OAuthSessionID
    ) -> OAuthTokenResponse {
        refreshRequests.append(request)
        return refreshedTokens
    }

    func recordedPushedRequests() -> [PushedAuthorizationRequest] { pushedRequests }
    func recordedTokenRequests() -> [AuthorizationCodeTokenRequest] { tokenRequests }
    func recordedRefreshRequests() -> [RefreshTokenRequest] { refreshRequests }
}

@MainActor
final class OAuthFlowCoordinatorTests: XCTestCase, @unchecked Sendable {
    private let sessionID = OAuthSessionID(rawValue: "coordinator-session")
    private let scope = "atproto repo:app.graycard.instance.exposure repo:app.graycard.roll"
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func identity() -> ATProtoResolvedIdentity {
        ATProtoResolvedIdentity(
            did: "did:plc:alice",
            handle: "alice.example",
            pdsURL: URL(string: "https://pds.example")!,
            authorizationIssuer: URL(string: "https://auth.example")!
        )
    }

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
            scopesSupported: ["atproto"],
            dpopSigningAlgValuesSupported: ["ES256"],
            authorizationResponseIssuerParameterSupported: true,
            requirePushedAuthorizationRequests: true,
            clientIDMetadataDocumentSupported: true
        )
    }

    private func issuedTokens(subject: String = "did:plc:alice") -> OAuthTokenResponse {
        OAuthTokenResponse(
            accessToken: "access-1",
            tokenType: "DPoP",
            expiresIn: 300,
            refreshToken: "refresh-1",
            scope: scope,
            subject: subject
        )
    }

    private func callback(for request: BrowserAuthorizationRequest, state: String? = nil) -> URL {
        var components = URLComponents(url: request.redirectURI, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "code", value: "authorization-code"),
            URLQueryItem(name: "state", value: state ?? request.expectedState),
            URLQueryItem(name: "iss", value: request.expectedIssuer.absoluteString),
        ]
        return components.url!
    }

    private func makeCoordinator(
        browser: CoordinatorBrowser,
        server: CoordinatorAuthorizationServer,
        keychain: InMemoryKeychainDataStore = InMemoryKeychainDataStore()
    ) -> (
        OAuthFlowCoordinator,
        KeychainOAuthSessionStore,
        KeychainDPoPKeyCustody,
        InMemoryKeychainDataStore
    ) {
        let sessionStore = KeychainOAuthSessionStore(
            keychain: keychain,
            service: "app.hypo.oauth.tests"
        )
        let keyCustody = KeychainDPoPKeyCustody(
            keychain: keychain,
            service: "app.hypo.dpop.tests"
        )
        let fixedNow = now
        let coordinator = OAuthFlowCoordinator(
            configuration: OAuthFlowConfiguration(
                clientID: "https://hypo.graycard.app/oauth-client.json",
                redirectURI: URL(string: "app.graycard.hypo:/oauth/callback")!,
                scope: scope
            ),
            identityResolver: CoordinatorIdentityResolver(identity: identity()),
            metadataDiscovery: CoordinatorMetadataDiscovery(metadata: metadata()),
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody,
            authorizationServerFactory: { _ in server },
            makeState: { "deterministic-state" },
            makeCodeVerifier: { "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~" },
            now: { fixedNow }
        )
        return (coordinator, sessionStore, keyCustody, keychain)
    }

    func testSuccessfulFlowPreservesGranularScopeAndStoresSessionAndKey() async throws {
        let server = CoordinatorAuthorizationServer(issuedTokens: issuedTokens())
        let browser = CoordinatorBrowser { request in self.callback(for: request) }
        let (coordinator, sessionStore, _, keychain) = makeCoordinator(
            browser: browser,
            server: server
        )

        let session = try await coordinator.signIn(
            identifier: "@alice.example",
            sessionID: sessionID
        )

        XCTAssertEqual(session.subject, identity().did)
        XCTAssertEqual(session.pdsURL, identity().pdsURL)
        XCTAssertEqual(session.scope, scope)
        XCTAssertEqual(session.expiresAt, now.addingTimeInterval(300))
        let storedSession = try await sessionStore.load(id: sessionID)
        XCTAssertEqual(storedSession, session)
        let pushed = await server.recordedPushedRequests()
        XCTAssertEqual(pushed.first?.scope, scope)
        XCTAssertEqual(pushed.first?.loginHint, "@alice.example")
        XCTAssertEqual(pushed.first?.state, "deterministic-state")
        XCTAssertEqual(
            pushed.first?.codeChallenge,
            PKCE.challenge(for: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        )
        let keyItem = await keychain.item(
            for: KeychainItemKey(
                service: "app.hypo.dpop.tests",
                account: "dpop-p256:coordinator-session"
            )
        )
        XCTAssertNotNil(keyItem)
        let finalState = await coordinator.state
        XCTAssertEqual(finalState, .authenticated(session))
    }

    func testRestoreRequiresAndPublishesCompleteCustody() async throws {
        let keychain = InMemoryKeychainDataStore()
        let server = CoordinatorAuthorizationServer(issuedTokens: issuedTokens())
        let browser = CoordinatorBrowser { request in self.callback(for: request) }
        let (signInCoordinator, _, _, _) = makeCoordinator(
            browser: browser,
            server: server,
            keychain: keychain
        )
        let signedIn = try await signInCoordinator.signIn(
            identifier: "alice.example",
            sessionID: sessionID
        )
        let (restoringCoordinator, _, _, _) = makeCoordinator(
            browser: browser,
            server: server,
            keychain: keychain
        )

        let restored = try await restoringCoordinator.restore(sessionID: sessionID)

        XCTAssertEqual(restored, signedIn)
        let finalState = await restoringCoordinator.state
        XCTAssertEqual(finalState, .authenticated(signedIn))
    }

    func testBrowserCancellationIsPreservedAndCleansCustody() async throws {
        let server = CoordinatorAuthorizationServer(issuedTokens: issuedTokens())
        let browser = CoordinatorBrowser { _ in throw CoordinatorBrowserError.cancelled }
        let (coordinator, sessionStore, keyCustody, _) = makeCoordinator(
            browser: browser,
            server: server
        )

        do {
            _ = try await coordinator.signIn(identifier: "alice.example", sessionID: sessionID)
            XCTFail("Expected browser cancellation")
        } catch {
            XCTAssertEqual(error as? CoordinatorBrowserError, .cancelled)
        }
        let storedSession = try await sessionStore.load(id: sessionID)
        let storedKey = try await keyCustody.load(sessionID: sessionID)
        let finalState = await coordinator.state
        XCTAssertNil(storedSession)
        XCTAssertNil(storedKey)
        XCTAssertEqual(finalState, .failed(.awaitingAuthorization))
    }

    func testBadCallbackIsRejectedBeforeTokenExchange() async throws {
        let server = CoordinatorAuthorizationServer(issuedTokens: issuedTokens())
        let browser = CoordinatorBrowser { request in
            self.callback(for: request, state: "attacker-state")
        }
        let (coordinator, _, _, _) = makeCoordinator(browser: browser, server: server)

        do {
            _ = try await coordinator.signIn(identifier: "alice.example", sessionID: sessionID)
            XCTFail("Expected callback rejection")
        } catch {
            XCTAssertEqual(error as? OAuthCallbackValidationError, .stateMismatch)
        }
        let tokenRequests = await server.recordedTokenRequests()
        let finalState = await coordinator.state
        XCTAssertTrue(tokenRequests.isEmpty)
        XCTAssertEqual(finalState, .failed(.awaitingAuthorization))
    }

    func testTokenSubjectMustMatchResolvedIdentity() async throws {
        let server = CoordinatorAuthorizationServer(
            issuedTokens: issuedTokens(subject: "did:plc:mallory")
        )
        let browser = CoordinatorBrowser { request in self.callback(for: request) }
        let (coordinator, sessionStore, keyCustody, _) = makeCoordinator(
            browser: browser,
            server: server
        )

        do {
            _ = try await coordinator.signIn(identifier: "alice.example", sessionID: sessionID)
            XCTFail("Expected account binding rejection")
        } catch {
            XCTAssertEqual(
                error as? OAuthFlowCoordinatorError,
                .subjectMismatch(expected: "did:plc:alice", actual: "did:plc:mallory")
            )
        }
        let storedSession = try await sessionStore.load(id: sessionID)
        let storedKey = try await keyCustody.load(sessionID: sessionID)
        XCTAssertNil(storedSession)
        XCTAssertNil(storedKey)
    }

    func testRefreshRotatesTokensAndSignOutClearsSessionAndKey() async throws {
        let refreshedTokens = OAuthTokenResponse(
            accessToken: "access-2",
            tokenType: "DPoP",
            expiresIn: 600,
            refreshToken: "refresh-2",
            scope: scope,
            subject: "did:plc:alice"
        )
        let server = CoordinatorAuthorizationServer(
            issuedTokens: issuedTokens(),
            refreshedTokens: refreshedTokens
        )
        let browser = CoordinatorBrowser { request in self.callback(for: request) }
        let (coordinator, sessionStore, keyCustody, _) = makeCoordinator(
            browser: browser,
            server: server
        )
        _ = try await coordinator.signIn(identifier: "alice.example", sessionID: sessionID)

        let refreshed = try await coordinator.refresh(sessionID: sessionID)

        XCTAssertEqual(refreshed.accessToken, "access-2")
        XCTAssertEqual(refreshed.refreshToken, "refresh-2")
        XCTAssertEqual(refreshed.expiresAt, now.addingTimeInterval(600))
        let refreshRequests = await server.recordedRefreshRequests()
        XCTAssertEqual(refreshRequests.first?.scope, scope)
        XCTAssertEqual(refreshRequests.first?.refreshToken, "refresh-1")
        let storedRefresh = try await sessionStore.load(id: sessionID)
        XCTAssertEqual(storedRefresh, refreshed)

        try await coordinator.signOut(sessionID: sessionID)
        let storedSession = try await sessionStore.load(id: sessionID)
        let storedKey = try await keyCustody.load(sessionID: sessionID)
        let finalState = await coordinator.state
        XCTAssertNil(storedSession)
        XCTAssertNil(storedKey)
        XCTAssertEqual(finalState, .signedOut)
    }
}
