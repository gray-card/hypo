import CryptoKit
import Foundation

public struct OAuthFlowConfiguration: Hashable, Sendable {
    public var clientID: String
    public var redirectURI: URL
    /// The exact, space-delimited scope request produced by the application.
    public var scope: String

    public init(clientID: String, redirectURI: URL, scope: String) {
        self.clientID = clientID
        self.redirectURI = redirectURI
        self.scope = scope
    }
}

public enum OAuthFlowStage: String, Hashable, Sendable {
    case restoring
    case resolvingIdentity
    case discoveringAuthorizationServer
    case preparingAuthorization
    case awaitingAuthorization
    case exchangingCode
    case savingSession
    case refreshing
    case signingOut
}

public enum OAuthFlowState: Hashable, Sendable {
    case idle
    case restoring(OAuthSessionID)
    case resolving(identifier: String, sessionID: OAuthSessionID)
    case discovering(identity: ATProtoResolvedIdentity)
    case preparingAuthorization(identity: ATProtoResolvedIdentity)
    case awaitingAuthorization(BrowserAuthorizationRequest)
    case exchangingCode(identity: ATProtoResolvedIdentity)
    case savingSession(OAuthSession)
    case authenticated(OAuthSession)
    case refreshing(OAuthSessionID)
    case signingOut(OAuthSessionID)
    case signedOut
    case failed(OAuthFlowStage)
}

public enum OAuthFlowCoordinatorError: Error, Equatable, Sendable {
    case operationInProgress
    case operationSuperseded
    case invalidClientID
    case emptyScope
    case missingATProtoScope
    case invalidPushedAuthorizationExpiration(Int)
    case sessionNotFound(OAuthSessionID)
    case sessionIdentifierMismatch(expected: OAuthSessionID, actual: OAuthSessionID)
    case missingRefreshToken(OAuthSessionID)
    case missingStoredScope(OAuthSessionID)
    case missingDPoPKey(OAuthSessionID)
    case missingPDS(OAuthSessionID)
    case subjectMismatch(expected: String, actual: String)
    case scopeEscalation(requested: [String], granted: [String])
}

/// Runs one native AT Protocol OAuth operation at a time and serializes rotating refresh tokens.
public actor OAuthFlowCoordinator {
    public typealias SecureValueGenerator = @Sendable () throws -> String
    public typealias AuthorizationServerFactory =
        @Sendable (P256.Signing.PrivateKey) throws -> any OAuthAuthorizationServerNetworking

    private let configuration: OAuthFlowConfiguration
    private let identityResolver: any ATProtoAccountIdentityResolving
    private let metadataDiscovery: any AuthorizationServerDiscovering
    private let browser: any OAuthBrowserPresenting
    private let sessionStore: any OAuthSessionStore
    private let keyCustody: any DPoPKeyCustody
    private let makeAuthorizationServer: AuthorizationServerFactory
    private let makeState: SecureValueGenerator
    private let makeCodeVerifier: SecureValueGenerator
    private let now: @Sendable () -> Date

    private var operationID = UUID()
    public private(set) var state: OAuthFlowState = .idle

    public init(
        configuration: OAuthFlowConfiguration,
        identityResolver: any ATProtoAccountIdentityResolving = ATProtoIdentityResolver(),
        metadataDiscovery: any AuthorizationServerDiscovering = AuthorizationServerMetadataClient(),
        browser: any OAuthBrowserPresenting,
        sessionStore: any OAuthSessionStore,
        keyCustody: any DPoPKeyCustody,
        authorizationServerFactory: @escaping AuthorizationServerFactory,
        makeState: @escaping SecureValueGenerator = { try PKCE.verifier() },
        makeCodeVerifier: @escaping SecureValueGenerator = { try PKCE.verifier() },
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.identityResolver = identityResolver
        self.metadataDiscovery = metadataDiscovery
        self.browser = browser
        self.sessionStore = sessionStore
        self.keyCustody = keyCustody
        self.makeAuthorizationServer = authorizationServerFactory
        self.makeState = makeState
        self.makeCodeVerifier = makeCodeVerifier
        self.now = now
    }

    public init(
        configuration: OAuthFlowConfiguration,
        identityResolver: any ATProtoAccountIdentityResolving = ATProtoIdentityResolver(),
        metadataDiscovery: any AuthorizationServerDiscovering = AuthorizationServerMetadataClient(),
        browser: any OAuthBrowserPresenting,
        sessionStore: any OAuthSessionStore,
        keyCustody: any DPoPKeyCustody,
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        nonceStore: DPoPNonceStore = DPoPNonceStore()
    ) {
        self.init(
            configuration: configuration,
            identityResolver: identityResolver,
            metadataDiscovery: metadataDiscovery,
            browser: browser,
            sessionStore: sessionStore,
            keyCustody: keyCustody,
            authorizationServerFactory: { key in
                OAuthAuthorizationServerClient(
                    transport: transport,
                    proofGenerator: DPoPProofGenerator(privateKey: key),
                    nonceStore: nonceStore
                )
            }
        )
    }

    @discardableResult
    public func signIn(
        identifier: String,
        sessionID: OAuthSessionID = OAuthSessionID(rawValue: UUID().uuidString.lowercased())
    ) async throws -> OAuthSession {
        try requireNoOperation()
        let loginHint = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestedScopes = try validatedScope(configuration.scope)
        guard !configuration.clientID.isEmpty else { throw OAuthFlowCoordinatorError.invalidClientID }

        let thisOperation = UUID()
        operationID = thisOperation
        var stage = OAuthFlowStage.resolvingIdentity
        state = .resolving(identifier: identifier, sessionID: sessionID)
        var createdKey = false

        do {
            let identity = try await identityResolver.resolveIdentity(identifier: identifier)
            try requireCurrent(thisOperation)

            stage = .discoveringAuthorizationServer
            state = .discovering(identity: identity)
            let discoveredMetadata = try await metadataDiscovery.discover(
                issuer: identity.authorizationIssuer
            )
            let metadata = try AuthorizationServerMetadataValidator.validate(
                discoveredMetadata,
                expectedIssuer: identity.authorizationIssuer
            )
            try requireCurrent(thisOperation)

            stage = .preparingAuthorization
            state = .preparingAuthorization(identity: identity)
            let privateKey = try await keyCustody.loadOrCreate(sessionID: sessionID)
            createdKey = true
            let authorizationServer = try makeAuthorizationServer(privateKey)
            let stateToken = try makeState()
            let verifier = try makeCodeVerifier()
            let pushed = try await authorizationServer.pushAuthorization(
                metadata: metadata,
                request: PushedAuthorizationRequest(
                    clientID: configuration.clientID,
                    redirectURI: configuration.redirectURI,
                    scope: configuration.scope,
                    state: stateToken,
                    codeChallenge: PKCE.challenge(for: verifier),
                    loginHint: loginHint,
                    dpopJKT: try DPoPProofGenerator(privateKey: privateKey).publicJWK.thumbprint
                ),
                sessionID: sessionID
            )
            guard pushed.expiresIn > 0 else {
                throw OAuthFlowCoordinatorError.invalidPushedAuthorizationExpiration(
                    pushed.expiresIn
                )
            }
            try requireCurrent(thisOperation)

            let browserRequest = BrowserAuthorizationRequest(
                authorizationURL: try OAuthRequestBuilder.authorizationURL(
                    endpoint: metadata.authorizationEndpoint,
                    clientID: configuration.clientID,
                    requestURI: pushed.requestURI
                ),
                redirectURI: configuration.redirectURI,
                expectedState: stateToken,
                expectedIssuer: identity.authorizationIssuer
            )
            stage = .awaitingAuthorization
            state = .awaitingAuthorization(browserRequest)
            let callbackURL = try await browser.authorize(browserRequest)
            try requireCurrent(thisOperation)
            let callback = try OAuthCallbackValidator.validate(callbackURL, for: browserRequest)

            stage = .exchangingCode
            state = .exchangingCode(identity: identity)
            let tokens = try await authorizationServer.exchangeAuthorizationCode(
                metadata: metadata,
                request: AuthorizationCodeTokenRequest(
                    clientID: configuration.clientID,
                    code: callback.code,
                    redirectURI: configuration.redirectURI,
                    codeVerifier: verifier
                ),
                sessionID: sessionID
            )
            try requireCurrent(thisOperation)
            var session = try tokens.makeSession(
                id: sessionID,
                issuer: metadata.issuer,
                now: now()
            )
            session.pdsURL = identity.pdsURL
            guard session.subject == identity.did else {
                throw OAuthFlowCoordinatorError.subjectMismatch(
                    expected: identity.did,
                    actual: session.subject
                )
            }
            try requireNoScopeEscalation(requested: requestedScopes, granted: session.scope)

            stage = .savingSession
            state = .savingSession(session)
            try await sessionStore.save(session)
            try requireCurrent(thisOperation)
            state = .authenticated(session)
            return session
        } catch {
            if createdKey {
                try? await keyCustody.remove(sessionID: sessionID)
            }
            try? await sessionStore.remove(id: sessionID)
            if operationID == thisOperation { state = .failed(stage) }
            throw error
        }
    }

    @discardableResult
    public func restore(sessionID: OAuthSessionID) async throws -> OAuthSession? {
        try requireNoOperation()
        let thisOperation = UUID()
        operationID = thisOperation
        state = .restoring(sessionID)
        do {
            guard let session = try await sessionStore.load(id: sessionID) else {
                try requireCurrent(thisOperation)
                state = .idle
                return nil
            }
            guard session.id == sessionID else {
                throw OAuthFlowCoordinatorError.sessionIdentifierMismatch(
                    expected: sessionID,
                    actual: session.id
                )
            }
            guard session.pdsURL != nil else {
                throw OAuthFlowCoordinatorError.missingPDS(sessionID)
            }
            _ = try validatedScope(session.scope ?? "")
            guard try await keyCustody.load(sessionID: sessionID) != nil else {
                throw OAuthFlowCoordinatorError.missingDPoPKey(sessionID)
            }
            try requireCurrent(thisOperation)
            state = .authenticated(session)
            return session
        } catch {
            if operationID == thisOperation { state = .failed(.restoring) }
            throw error
        }
    }

    @discardableResult
    public func refresh(sessionID: OAuthSessionID) async throws -> OAuthSession {
        try requireNoOperation()
        let thisOperation = UUID()
        operationID = thisOperation
        state = .refreshing(sessionID)

        do {
            guard let session = try await sessionStore.load(id: sessionID) else {
                throw OAuthFlowCoordinatorError.sessionNotFound(sessionID)
            }
            guard let refreshToken = session.refreshToken else {
                throw OAuthFlowCoordinatorError.missingRefreshToken(sessionID)
            }
            guard let existingScope = session.scope else {
                throw OAuthFlowCoordinatorError.missingStoredScope(sessionID)
            }
            let requestedScopes = try validatedScope(existingScope)
            guard let privateKey = try await keyCustody.load(sessionID: sessionID) else {
                throw OAuthFlowCoordinatorError.missingDPoPKey(sessionID)
            }
            let discoveredMetadata = try await metadataDiscovery.discover(issuer: session.issuer)
            let metadata = try AuthorizationServerMetadataValidator.validate(
                discoveredMetadata,
                expectedIssuer: session.issuer
            )
            let authorizationServer = try makeAuthorizationServer(privateKey)
            let tokens = try await authorizationServer.refreshToken(
                metadata: metadata,
                request: RefreshTokenRequest(
                    clientID: configuration.clientID,
                    refreshToken: refreshToken,
                    scope: existingScope
                ),
                sessionID: sessionID
            )
            try requireCurrent(thisOperation)
            let refreshed = try tokens.applying(to: session, now: now())
            try requireNoScopeEscalation(requested: requestedScopes, granted: refreshed.scope)
            try await sessionStore.save(refreshed)
            try requireCurrent(thisOperation)
            state = .authenticated(refreshed)
            return refreshed
        } catch {
            if operationID == thisOperation { state = .failed(.refreshing) }
            throw error
        }
    }

    public func signOut(sessionID: OAuthSessionID) async throws {
        try requireNoOperation()
        let thisOperation = UUID()
        operationID = thisOperation
        state = .signingOut(sessionID)
        do {
            try await sessionStore.remove(id: sessionID)
            try await keyCustody.remove(sessionID: sessionID)
            try requireCurrent(thisOperation)
            state = .signedOut
        } catch {
            if operationID == thisOperation { state = .failed(.signingOut) }
            throw error
        }
    }

    private func requireNoOperation() throws {
        switch state {
        case .restoring, .resolving, .discovering, .preparingAuthorization, .awaitingAuthorization,
            .exchangingCode, .savingSession, .refreshing, .signingOut:
            throw OAuthFlowCoordinatorError.operationInProgress
        case .idle, .authenticated, .signedOut, .failed:
            break
        }
    }

    private func requireCurrent(_ id: UUID) throws {
        guard operationID == id else { throw OAuthFlowCoordinatorError.operationSuperseded }
    }

    private func validatedScope(_ scope: String) throws -> Set<String> {
        let components = scope.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !components.isEmpty else { throw OAuthFlowCoordinatorError.emptyScope }
        guard components.contains("atproto") else {
            throw OAuthFlowCoordinatorError.missingATProtoScope
        }
        return Set(components)
    }

    private func requireNoScopeEscalation(requested: Set<String>, granted: String?) throws {
        let granted = try validatedScope(granted ?? "")
        guard granted.isSubset(of: requested) else {
            throw OAuthFlowCoordinatorError.scopeEscalation(
                requested: requested.sorted(),
                granted: granted.sorted()
            )
        }
    }
}
