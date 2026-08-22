import Foundation

public struct OAuthSessionID: RawRepresentable, Hashable, Codable, Sendable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
}

public struct OAuthSession: Hashable, Codable, Sendable {
    public var id: OAuthSessionID
    public var issuer: URL
    public var subject: String
    /// Personal Data Server verified during identity resolution.
    public var pdsURL: URL?
    public var accessToken: String
    public var refreshToken: String?
    /// Space-delimited scope granted by the authorization server.
    public var scope: String?
    public var expiresAt: Date?

    public init(
        id: OAuthSessionID,
        issuer: URL,
        subject: String,
        pdsURL: URL? = nil,
        accessToken: String,
        refreshToken: String? = nil,
        scope: String? = nil,
        expiresAt: Date? = nil
    ) {
        self.id = id
        self.issuer = issuer
        self.subject = subject
        self.pdsURL = pdsURL
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.scope = scope
        self.expiresAt = expiresAt
    }
}

/// Keychain-shaped session custody. A production implementation should use Security access
/// controls appropriate to the application; ATProtoClient does not silently persist tokens.
public protocol OAuthSessionStore: Sendable {
    func load(id: OAuthSessionID) async throws -> OAuthSession?
    func save(_ session: OAuthSession) async throws
    func remove(id: OAuthSessionID) async throws
}

/// Identity and authorization-server discovery boundary.
public protocol OAuthIdentityResolving: Sendable {
    func resolveAuthorizationIssuer(identifier: String) async throws -> URL
}

/// Identity-resolution boundary used when an OAuth token must be bound to an account DID.
public protocol ATProtoAccountIdentityResolving: Sendable {
    func resolveIdentity(identifier: String) async throws -> ATProtoResolvedIdentity
}

public struct BrowserAuthorizationRequest: Hashable, Sendable {
    public var authorizationURL: URL
    public var redirectURI: URL
    public var expectedState: String
    public var expectedIssuer: URL

    public init(
        authorizationURL: URL,
        redirectURI: URL,
        expectedState: String,
        expectedIssuer: URL
    ) {
        self.authorizationURL = authorizationURL
        self.redirectURI = redirectURI
        self.expectedState = expectedState
        self.expectedIssuer = expectedIssuer
    }

    public var callbackScheme: String? { redirectURI.scheme }
}

/// UI boundary for ASWebAuthenticationSession or an equivalent browser presenter.
@MainActor
public protocol OAuthBrowserPresenting: AnyObject, Sendable {
    func authorize(_ request: BrowserAuthorizationRequest) async throws -> URL
}

public struct OAuthAuthorizationCallback: Hashable, Sendable {
    public var code: String
    public var state: String
    public var issuer: URL

    public init(code: String, state: String, issuer: URL) {
        self.code = code
        self.state = state
        self.issuer = issuer
    }
}

public enum OAuthCallbackValidationError: Error, Equatable, Sendable {
    case redirectMismatch(expected: String, actual: String)
    case duplicateParameter(String)
    case missingState
    case stateMismatch
    case missingIssuer
    case issuerMismatch(expected: String, actual: String)
    case authorizationError(code: String, description: String?)
    case missingAuthorizationCode
}

public enum OAuthBrowserPresentationError: Error, Equatable, Sendable {
    case authorizationAlreadyInProgress
    case presentationFailed
    case missingCallback
    case cancelled
    case invalidCallbackURI
    case httpsCallbackRequiresIOS17_4
}

public enum OAuthCallbackValidator {
    public static func validate(
        _ callbackURL: URL,
        for request: BrowserAuthorizationRequest
    ) throws -> OAuthAuthorizationCallback {
        guard redirectComponents(of: callbackURL) == redirectComponents(of: request.redirectURI) else {
            throw OAuthCallbackValidationError.redirectMismatch(
                expected: request.redirectURI.absoluteString,
                actual: callbackURL.absoluteString
            )
        }
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
            throw ATProtoClientError.invalidURL
        }
        let parameters = try uniqueParameters(components.queryItems ?? [])
        guard let state = parameters["state"] else {
            throw OAuthCallbackValidationError.missingState
        }
        guard state == request.expectedState else {
            throw OAuthCallbackValidationError.stateMismatch
        }
        guard let issuerValue = parameters["iss"], let issuer = URL(string: issuerValue) else {
            throw OAuthCallbackValidationError.missingIssuer
        }
        guard issuer.absoluteString == request.expectedIssuer.absoluteString else {
            throw OAuthCallbackValidationError.issuerMismatch(
                expected: request.expectedIssuer.absoluteString,
                actual: issuer.absoluteString
            )
        }
        if let error = parameters["error"] {
            throw OAuthCallbackValidationError.authorizationError(
                code: error,
                description: parameters["error_description"]
            )
        }
        guard let code = parameters["code"], !code.isEmpty else {
            throw OAuthCallbackValidationError.missingAuthorizationCode
        }
        return OAuthAuthorizationCallback(code: code, state: state, issuer: issuer)
    }

    private static func redirectComponents(of url: URL) -> URLComponents? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.query = nil
        components.fragment = nil
        return components
    }

    private static func uniqueParameters(_ queryItems: [URLQueryItem]) throws -> [String: String] {
        var result: [String: String] = [:]
        for item in queryItems {
            guard result[item.name] == nil else {
                throw OAuthCallbackValidationError.duplicateParameter(item.name)
            }
            if let value = item.value { result[item.name] = value }
        }
        return result
    }
}
