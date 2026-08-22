import CryptoKit
import Foundation
import Security

enum SHA256Digest {
    static func hash(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }
}

public enum ATProtoClientError: Error, Equatable, Sendable {
    case randomGenerationFailed(OSStatus)
    case malformedP256PublicKey
    case invalidJSONResponse
    case missingHTTPResponse
    case authenticationRetryLimitExceeded
    case missingDPoPNonce
    case invalidURL
}

extension P256.Signing.PublicKey {
    var jwk: DPoPJSONWebKey {
        get throws {
            let bytes = x963Representation
            guard bytes.count == 65, bytes.first == 4 else {
                throw ATProtoClientError.malformedP256PublicKey
            }
            return DPoPJSONWebKey(
                kty: "EC",
                crv: "P-256",
                x: Base64URL.encode(bytes.subdata(in: 1..<33)),
                y: Base64URL.encode(bytes.subdata(in: 33..<65))
            )
        }
    }
}
