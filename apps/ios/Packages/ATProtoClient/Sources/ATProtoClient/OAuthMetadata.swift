import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// RFC 8414 authorization-server metadata used by the AT Protocol OAuth profile.
public struct AuthorizationServerMetadata: Codable, Hashable, Sendable {
    public var issuer: URL
    public var authorizationEndpoint: URL
    public var tokenEndpoint: URL
    public var pushedAuthorizationRequestEndpoint: URL?
    public var responseTypesSupported: [String]
    public var grantTypesSupported: [String]
    public var tokenEndpointAuthMethodsSupported: [String]
    public var tokenEndpointAuthSigningAlgValuesSupported: [String]
    public var codeChallengeMethodsSupported: [String]
    public var scopesSupported: [String]
    public var dpopSigningAlgValuesSupported: [String]
    public var authorizationResponseIssuerParameterSupported: Bool?
    public var requirePushedAuthorizationRequests: Bool?
    public var requireRequestURIRegistration: Bool?
    public var clientIDMetadataDocumentSupported: Bool?

    public init(
        issuer: URL,
        authorizationEndpoint: URL,
        tokenEndpoint: URL,
        pushedAuthorizationRequestEndpoint: URL,
        responseTypesSupported: [String],
        grantTypesSupported: [String],
        tokenEndpointAuthMethodsSupported: [String],
        tokenEndpointAuthSigningAlgValuesSupported: [String],
        codeChallengeMethodsSupported: [String],
        scopesSupported: [String],
        dpopSigningAlgValuesSupported: [String],
        authorizationResponseIssuerParameterSupported: Bool,
        requirePushedAuthorizationRequests: Bool,
        requireRequestURIRegistration: Bool? = nil,
        clientIDMetadataDocumentSupported: Bool
    ) {
        self.issuer = issuer
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.pushedAuthorizationRequestEndpoint = pushedAuthorizationRequestEndpoint
        self.responseTypesSupported = responseTypesSupported
        self.grantTypesSupported = grantTypesSupported
        self.tokenEndpointAuthMethodsSupported = tokenEndpointAuthMethodsSupported
        self.tokenEndpointAuthSigningAlgValuesSupported =
            tokenEndpointAuthSigningAlgValuesSupported
        self.codeChallengeMethodsSupported = codeChallengeMethodsSupported
        self.scopesSupported = scopesSupported
        self.dpopSigningAlgValuesSupported = dpopSigningAlgValuesSupported
        self.authorizationResponseIssuerParameterSupported =
            authorizationResponseIssuerParameterSupported
        self.requirePushedAuthorizationRequests = requirePushedAuthorizationRequests
        self.requireRequestURIRegistration = requireRequestURIRegistration
        self.clientIDMetadataDocumentSupported = clientIDMetadataDocumentSupported
    }

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case pushedAuthorizationRequestEndpoint = "pushed_authorization_request_endpoint"
        case responseTypesSupported = "response_types_supported"
        case grantTypesSupported = "grant_types_supported"
        case tokenEndpointAuthMethodsSupported = "token_endpoint_auth_methods_supported"
        case tokenEndpointAuthSigningAlgValuesSupported =
            "token_endpoint_auth_signing_alg_values_supported"
        case codeChallengeMethodsSupported = "code_challenge_methods_supported"
        case scopesSupported = "scopes_supported"
        case dpopSigningAlgValuesSupported = "dpop_signing_alg_values_supported"
        case authorizationResponseIssuerParameterSupported =
            "authorization_response_iss_parameter_supported"
        case requirePushedAuthorizationRequests = "require_pushed_authorization_requests"
        case requireRequestURIRegistration = "require_request_uri_registration"
        case clientIDMetadataDocumentSupported = "client_id_metadata_document_supported"
    }
}

public enum OAuthMetadataValidationError: Error, Equatable, Sendable {
    case issuerMismatch(expected: String, actual: String)
    case invalidIssuer(String)
    case invalidEndpoint(String)
    case insecureEndpoint(String)
    case missingAuthorizationCodeResponseType
    case missingAuthorizationCodeGrant
    case missingRefreshTokenGrant
    case missingPublicClientAuthentication
    case missingConfidentialClientAuthentication
    case invalidTokenEndpointAuthenticationAlgorithm
    case missingES256TokenEndpointAuthentication
    case missingS256
    case missingATProtoScope
    case missingES256DPoP
    case missingAuthorizationResponseIssuerParameter
    case pushedAuthorizationRequestsNotRequired
    case missingPushedAuthorizationRequestEndpoint
    case requestURIRegistrationDisabled
    case clientIDMetadataDocumentUnsupported
    case invalidMetadataContentType
}

public enum AuthorizationServerMetadataValidator {
    /// Validates the interoperability requirements used by AT Protocol OAuth clients.
    public static func validate(
        _ metadata: AuthorizationServerMetadata,
        expectedIssuer: URL
    ) throws -> AuthorizationServerMetadata {
        guard isValidIssuer(metadata.issuer) else {
            throw OAuthMetadataValidationError.invalidIssuer(metadata.issuer.absoluteString)
        }
        guard metadata.issuer.absoluteString == expectedIssuer.absoluteString else {
            throw OAuthMetadataValidationError.issuerMismatch(
                expected: expectedIssuer.absoluteString,
                actual: metadata.issuer.absoluteString
            )
        }
        let endpoints = [
            metadata.authorizationEndpoint,
            metadata.tokenEndpoint,
            metadata.pushedAuthorizationRequestEndpoint,
        ].compactMap { $0 }
        for endpoint in endpoints {
            guard let components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
                components.host != nil,
                components.user == nil,
                components.password == nil,
                components.fragment == nil
            else {
                throw OAuthMetadataValidationError.invalidEndpoint(endpoint.absoluteString)
            }
            guard components.scheme?.lowercased() == "https" else {
                throw OAuthMetadataValidationError.insecureEndpoint(endpoint.absoluteString)
            }
        }
        guard metadata.responseTypesSupported.contains("code") else {
            throw OAuthMetadataValidationError.missingAuthorizationCodeResponseType
        }
        guard metadata.grantTypesSupported.contains("authorization_code") else {
            throw OAuthMetadataValidationError.missingAuthorizationCodeGrant
        }
        guard metadata.grantTypesSupported.contains("refresh_token") else {
            throw OAuthMetadataValidationError.missingRefreshTokenGrant
        }
        guard metadata.tokenEndpointAuthMethodsSupported.contains("none") else {
            throw OAuthMetadataValidationError.missingPublicClientAuthentication
        }
        guard metadata.tokenEndpointAuthMethodsSupported.contains("private_key_jwt") else {
            throw OAuthMetadataValidationError.missingConfidentialClientAuthentication
        }
        guard !metadata.tokenEndpointAuthSigningAlgValuesSupported.contains("none") else {
            throw OAuthMetadataValidationError.invalidTokenEndpointAuthenticationAlgorithm
        }
        guard metadata.tokenEndpointAuthSigningAlgValuesSupported.contains("ES256") else {
            throw OAuthMetadataValidationError.missingES256TokenEndpointAuthentication
        }
        guard metadata.codeChallengeMethodsSupported.contains("S256") else {
            throw OAuthMetadataValidationError.missingS256
        }
        guard metadata.scopesSupported.contains("atproto") else {
            throw OAuthMetadataValidationError.missingATProtoScope
        }
        guard metadata.dpopSigningAlgValuesSupported.contains("ES256") else {
            throw OAuthMetadataValidationError.missingES256DPoP
        }
        guard metadata.authorizationResponseIssuerParameterSupported == true else {
            throw OAuthMetadataValidationError.missingAuthorizationResponseIssuerParameter
        }
        guard metadata.requirePushedAuthorizationRequests == true else {
            throw OAuthMetadataValidationError.pushedAuthorizationRequestsNotRequired
        }
        guard metadata.pushedAuthorizationRequestEndpoint != nil else {
            throw OAuthMetadataValidationError.missingPushedAuthorizationRequestEndpoint
        }
        guard metadata.requireRequestURIRegistration != false else {
            throw OAuthMetadataValidationError.requestURIRegistrationDisabled
        }
        guard metadata.clientIDMetadataDocumentSupported == true else {
            throw OAuthMetadataValidationError.clientIDMetadataDocumentUnsupported
        }
        return metadata
    }

    fileprivate static func isValidIssuer(_ issuer: URL) -> Bool {
        guard let components = URLComponents(url: issuer, resolvingAgainstBaseURL: false) else {
            return false
        }
        return components.scheme?.lowercased() == "https"
            && components.host != nil
            && components.user == nil
            && components.password == nil
            && (components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/")
            && components.query == nil
            && components.fragment == nil
            && !(components.port == 443)
    }
}

public protocol AuthorizationServerDiscovering: Sendable {
    func discover(issuer: URL) async throws -> AuthorizationServerMetadata
}

public struct AuthorizationServerMetadataClient: AuthorizationServerDiscovering, Sendable {
    private let transport: any HTTPTransport
    private let decoder = JSONDecoder()

    public init(transport: any HTTPTransport = URLSessionHTTPTransport()) {
        self.transport = transport
    }

    public func discover(issuer: URL) async throws -> AuthorizationServerMetadata {
        let url = try Self.discoveryURL(for: issuer)
        let (data, response) = try await transport.data(for: URLRequest(url: url))
        guard response.url == url else {
            throw OAuthMetadataValidationError.invalidEndpoint(
                response.url?.absoluteString ?? "missing response URL"
            )
        }
        guard response.statusCode == 200 else {
            throw ATProtoHTTPError(statusCode: response.statusCode)
        }
        guard response.mimeType?.lowercased() == "application/json" else {
            throw OAuthMetadataValidationError.invalidMetadataContentType
        }
        let metadata = try decoder.decode(AuthorizationServerMetadata.self, from: data)
        return try AuthorizationServerMetadataValidator.validate(metadata, expectedIssuer: issuer)
    }

    /// AT Protocol authorization-server issuers are origins, so the well-known path is fixed.
    public static func discoveryURL(for issuer: URL) throws -> URL {
        guard AuthorizationServerMetadataValidator.isValidIssuer(issuer),
            var components = URLComponents(url: issuer, resolvingAgainstBaseURL: false)
        else { throw OAuthMetadataValidationError.invalidIssuer(issuer.absoluteString) }
        components.percentEncodedPath = "/.well-known/oauth-authorization-server"
        guard let url = components.url else { throw ATProtoClientError.invalidURL }
        return url
    }
}
