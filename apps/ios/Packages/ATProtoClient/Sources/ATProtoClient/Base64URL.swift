import Foundation
import Security

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var value =
            string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        return Data(base64Encoded: value)
    }
}

public enum PKCE {
    /// RFC 7636 S256 code challenge.
    public static func challenge(for verifier: String) -> String {
        Base64URL.encode(SHA256Digest.hash(Data(verifier.utf8)))
    }

    /// Generates an RFC 7636 verifier from cryptographically random bytes.
    public static func verifier(byteCount: Int = 32) throws -> String {
        precondition(byteCount >= 32)
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw ATProtoClientError.randomGenerationFailed(status) }
        return Base64URL.encode(Data(bytes))
    }
}
