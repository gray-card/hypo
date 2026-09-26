import CryptoKit
import Foundation

public struct DPoPOrigin: RawRepresentable, Hashable, Codable, Sendable {
    public var rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }

    public init(url: URL) throws {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else {
            throw ATProtoClientError.invalidURL
        }
        var value = "\(scheme)://\(host)"
        if let port = url.port { value += ":\(port)" }
        self.rawValue = value
    }
}

public struct DPoPNonceKey: Hashable, Codable, Sendable {
    public var origin: DPoPOrigin
    public var sessionID: OAuthSessionID

    public init(origin: DPoPOrigin, sessionID: OAuthSessionID) {
        self.origin = origin
        self.sessionID = sessionID
    }
}

public actor DPoPNonceStore {
    private var nonces: [DPoPNonceKey: String] = [:]

    public init() {}
    public func nonce(for key: DPoPNonceKey) -> String? { nonces[key] }
    public func set(_ nonce: String?, for key: DPoPNonceKey) { nonces[key] = nonce }
}

public struct DPoPJSONWebKey: Codable, Hashable, Sendable {
    public var kty: String
    public var crv: String
    public var x: String
    public var y: String
}

public struct DPoPHeader: Codable, Hashable, Sendable {
    public var typ: String
    public var alg: String
    public var jwk: DPoPJSONWebKey
}

public struct DPoPClaims: Codable, Hashable, Sendable {
    public var jti: String
    public var htm: String
    public var htu: String
    public var iat: Int64
    public var ath: String?
    public var nonce: String?
}

public struct DPoPProof: Hashable, Sendable {
    public var compactJWT: String
    public var header: DPoPHeader
    public var claims: DPoPClaims
    public var rawSignature: Data
}

/// Generates RFC 9449 DPoP proofs with ES256/P-256 and JOSE raw `(r || s)` signatures.
public struct DPoPProofGenerator: Sendable {
    private let privateKey: P256.Signing.PrivateKey
    private let now: @Sendable () -> Date
    private let makeJTI: @Sendable () -> String

    public init(
        privateKey: P256.Signing.PrivateKey = P256.Signing.PrivateKey(),
        now: @escaping @Sendable () -> Date = Date.init,
        makeJTI: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.privateKey = privateKey
        self.now = now
        self.makeJTI = makeJTI
    }

    public var publicJWK: DPoPJSONWebKey { get throws { try privateKey.publicKey.jwk } }

    public func proof(
        method: String,
        url: URL,
        accessToken: String? = nil,
        nonce: String? = nil
    ) throws -> DPoPProof {
        let header = DPoPHeader(typ: "dpop+jwt", alg: "ES256", jwk: try publicJWK)
        let claims = DPoPClaims(
            jti: makeJTI(),
            htm: method.uppercased(),
            htu: Self.normalizedHTU(url),
            iat: Int64(now().timeIntervalSince1970),
            ath: accessToken.map { Base64URL.encode(SHA256Digest.hash(Data($0.utf8))) },
            nonce: nonce
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let encodedHeader = Base64URL.encode(try encoder.encode(header))
        let encodedClaims = Base64URL.encode(try encoder.encode(claims))
        let signingInput = Data("\(encodedHeader).\(encodedClaims)".utf8)
        let signature = try privateKey.signature(for: signingInput).rawRepresentation
        return DPoPProof(
            compactJWT: "\(encodedHeader).\(encodedClaims).\(Base64URL.encode(signature))",
            header: header,
            claims: claims,
            rawSignature: signature
        )
    }

    /// RFC 9449 `htu`: scheme, authority, and path; query and fragment are excluded.
    public static func normalizedHTU(_ url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        return components?.url?.absoluteString ?? url.absoluteString
    }
}
