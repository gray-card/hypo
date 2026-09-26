import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionHTTPTransport: HTTPTransport, Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw ATProtoClientError.missingHTTPResponse
        }
        return (data, response)
    }
}

/// Produces resource requests with the current access token and DPoP proof. OAuth token refresh
/// is kept behind the separate authorization-server networking boundary.
public protocol AuthenticatedRequestSigning: Sendable {
    func sign(_ request: URLRequest, session: OAuthSession, nonce: String?) async throws -> URLRequest
}

public struct DPoPRequestSigner: AuthenticatedRequestSigning, Sendable {
    public var proofGenerator: DPoPProofGenerator

    public init(proofGenerator: DPoPProofGenerator) {
        self.proofGenerator = proofGenerator
    }

    public func sign(_ request: URLRequest, session: OAuthSession, nonce: String?) async throws -> URLRequest
    {
        guard let url = request.url else { throw ATProtoClientError.invalidURL }
        let proof = try proofGenerator.proof(
            method: request.httpMethod ?? "GET",
            url: url,
            accessToken: session.accessToken,
            nonce: nonce
        )
        var signed = request
        signed.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
        signed.setValue(proof.compactJWT, forHTTPHeaderField: "DPoP")
        return signed
    }
}

/// Authenticated HTTP transport with one bounded DPoP nonce retry.
public actor DPoPAuthenticatedTransport {
    private let transport: any HTTPTransport
    private let signer: any AuthenticatedRequestSigning
    private let nonceStore: DPoPNonceStore
    private let maximumNonceRetries: Int

    public init(
        transport: any HTTPTransport,
        signer: any AuthenticatedRequestSigning,
        nonceStore: DPoPNonceStore = DPoPNonceStore(),
        maximumNonceRetries: Int = 1
    ) {
        precondition(maximumNonceRetries >= 0)
        self.transport = transport
        self.signer = signer
        self.nonceStore = nonceStore
        self.maximumNonceRetries = maximumNonceRetries
    }

    public func data(for request: URLRequest, session: OAuthSession) async throws -> (Data, HTTPURLResponse) {
        guard let requestURL = request.url else { throw ATProtoClientError.invalidURL }
        let key = DPoPNonceKey(origin: try DPoPOrigin(url: requestURL), sessionID: session.id)
        var retryCount = 0
        while true {
            let nonce = await nonceStore.nonce(for: key)
            let signed = try await signer.sign(request, session: session, nonce: nonce)
            let result = try await transport.data(for: signed)
            if let responseNonce = result.1.value(forHTTPHeaderField: "DPoP-Nonce") {
                await nonceStore.set(responseNonce, for: key)
            }
            guard Self.requiresNonceRetry(data: result.0, response: result.1) else { return result }
            guard retryCount < maximumNonceRetries else {
                throw ATProtoClientError.authenticationRetryLimitExceeded
            }
            guard result.1.value(forHTTPHeaderField: "DPoP-Nonce") != nil else {
                throw ATProtoClientError.missingDPoPNonce
            }
            retryCount += 1
        }
    }

    private static func requiresNonceRetry(data: Data, response: HTTPURLResponse) -> Bool {
        guard response.statusCode == 400 || response.statusCode == 401 else { return false }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return object["error"] as? String == "use_dpop_nonce"
    }
}
