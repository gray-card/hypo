import CryptoKit
import XCTest
@testable import ATProtoClient

private actor ScriptedHTTPTransport: HTTPTransport {
    struct Response: Sendable {
        var status: Int
        var headers: [String: String]
        var data: Data
    }

    private var responses: [Response]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [Response]) { self.responses = responses }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let response = responses.removeFirst()
        return (
            response.data,
            HTTPURLResponse(
                url: request.url!,
                statusCode: response.status,
                httpVersion: "HTTP/1.1",
                headerFields: response.headers
            )!
        )
    }

    func calls() -> [URLRequest] { requests }
}

private actor RecordingSigner: AuthenticatedRequestSigning {
    private(set) var nonces: [String?] = []

    func sign(_ request: URLRequest, session: OAuthSession, nonce: String?) async throws -> URLRequest {
        nonces.append(nonce)
        var signed = request
        signed.setValue(nonce ?? "none", forHTTPHeaderField: "X-Test-Nonce")
        return signed
    }

    func observedNonces() -> [String?] { nonces }
}

final class ATProtoClientTests: XCTestCase {
    private let session = OAuthSession(
        id: OAuthSessionID(rawValue: "session-1"),
        issuer: URL(string: "https://issuer.example")!,
        subject: "did:plc:test",
        accessToken: "access-token"
    )

    private func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    func testBase64URLAndPKCEGoldenVector() throws {
        XCTAssertEqual(Base64URL.encode(Data([0xfb, 0xff, 0x00])), "-_8A")
        XCTAssertEqual(Base64URL.decode("-_8A"), Data([0xfb, 0xff, 0x00]))
        XCTAssertEqual(
            PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
        XCTAssertGreaterThanOrEqual(try PKCE.verifier().count, 43)
    }

    func testDPoPProofClaimsJWKRawSignatureAndVerification() throws {
        let key = try P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 1, count: 32))
        let generator = DPoPProofGenerator(
            privateKey: key,
            now: { Date(timeIntervalSince1970: 1_700_000_000) },
            makeJTI: { "fixed-jti" }
        )
        let url = URL(string: "https://PDS.EXAMPLE:8443/xrpc/com.atproto.repo.getRecord?repo=x#fragment")!
        let proof = try generator.proof(
            method: "get",
            url: url,
            accessToken: "access-token",
            nonce: "nonce-1"
        )

        XCTAssertEqual(proof.header.typ, "dpop+jwt")
        XCTAssertEqual(proof.header.alg, "ES256")
        XCTAssertEqual(proof.header.jwk.kty, "EC")
        XCTAssertEqual(proof.header.jwk.crv, "P-256")
        XCTAssertEqual(
            Base64URL.decode(proof.header.jwk.x),
            Data(hex: "6ff03b949241ce1dadd43519e6960e0a85b41a69a05c328103aa2bce1594ca16")
        )
        XCTAssertEqual(
            Base64URL.decode(proof.header.jwk.y),
            Data(hex: "3c4f753a55bf01dc53f6c0b0c7eee78b40c6ff7d25a96e2282b989cef71c144a")
        )
        XCTAssertEqual(proof.claims.jti, "fixed-jti")
        XCTAssertEqual(proof.claims.htm, "GET")
        XCTAssertEqual(proof.claims.htu, "https://PDS.EXAMPLE:8443/xrpc/com.atproto.repo.getRecord")
        XCTAssertEqual(proof.claims.iat, 1_700_000_000)
        XCTAssertEqual(proof.claims.nonce, "nonce-1")
        XCTAssertEqual(proof.claims.ath, "Pxa-1wifRlPl7yG_0oJNfzqq7MelmOfonFgOFgapzFI")
        XCTAssertEqual(proof.rawSignature.count, 64)

        let segments = proof.compactJWT.split(separator: ".")
        XCTAssertEqual(segments.count, 3)
        let signingInput = Data("\(segments[0]).\(segments[1])".utf8)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: proof.rawSignature)
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: signingInput))

        let decodedHeader = try JSONDecoder().decode(
            DPoPHeader.self,
            from: XCTUnwrap(Base64URL.decode(String(segments[0])))
        )
        let decodedClaims = try JSONDecoder().decode(
            DPoPClaims.self,
            from: XCTUnwrap(Base64URL.decode(String(segments[1])))
        )
        XCTAssertEqual(decodedHeader, proof.header)
        XCTAssertEqual(decodedClaims, proof.claims)
        XCTAssertEqual(Base64URL.decode(String(segments[2])), proof.rawSignature)
    }

    func testNonceStoreSeparatesOriginsAndSessions() async throws {
        let store = DPoPNonceStore()
        let originA = try DPoPOrigin(url: URL(string: "https://pds.example/a")!)
        let originB = try DPoPOrigin(url: URL(string: "https://other.example/a")!)
        let sessionA = OAuthSessionID(rawValue: "a")
        let sessionB = OAuthSessionID(rawValue: "b")
        await store.set("one", for: DPoPNonceKey(origin: originA, sessionID: sessionA))
        await store.set("two", for: DPoPNonceKey(origin: originA, sessionID: sessionB))
        await store.set("three", for: DPoPNonceKey(origin: originB, sessionID: sessionA))
        let first = await store.nonce(for: DPoPNonceKey(origin: originA, sessionID: sessionA))
        let second = await store.nonce(for: DPoPNonceKey(origin: originA, sessionID: sessionB))
        let third = await store.nonce(for: DPoPNonceKey(origin: originB, sessionID: sessionA))
        XCTAssertEqual(first, "one")
        XCTAssertEqual(second, "two")
        XCTAssertEqual(third, "three")
    }

    func testPutCASThreeStatesAndJSONRecordSnapshots() throws {
        let record: JSONValue = .object([
            "$type": .string("app.example.record"),
            "count": .number(2),
            "nested": .object(["enabled": .bool(true)]),
        ])
        let absent = try jsonObject(
            PutRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                record: record,
                swapRecord: .absent
            ))
        XCTAssertNil(absent["swapRecord"])
        XCTAssertTrue(absent["record"] is [String: Any])
        XCTAssertFalse(absent["record"] is String)

        let noRecord = try jsonObject(
            PutRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                record: record,
                swapRecord: .noRecord
            ))
        XCTAssertTrue(noRecord["swapRecord"] is NSNull)

        let cid = try jsonObject(
            PutRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                record: record,
                validate: false,
                swapRecord: .cid("bafycid"),
                swapCommit: .cid("bafycommit")
            ))
        XCTAssertEqual(cid["swapRecord"] as? String, "bafycid")
        XCTAssertEqual(cid["swapCommit"] as? String, "bafycommit")
        XCTAssertEqual(cid["validate"] as? Bool, false)
        let encodedRecord = try XCTUnwrap(cid["record"] as? [String: Any])
        XCTAssertEqual(encodedRecord["$type"] as? String, "app.example.record")
        XCTAssertEqual(encodedRecord["count"] as? Double, 2)
    }

    func testCreateAndDeleteRepositorySnapshots() throws {
        let create = try jsonObject(
            CreateRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                record: .object(["name": .string("Record")]),
                swapCommit: .noRecord
            ))
        XCTAssertEqual(create["rkey"] as? String, "one")
        XCTAssertTrue(create["swapCommit"] is NSNull)
        XCTAssertEqual((create["record"] as? [String: Any])?["name"] as? String, "Record")

        let delete = try jsonObject(
            DeleteRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                swapRecord: .cid("cid-one")
            ))
        XCTAssertEqual(delete["swapRecord"] as? String, "cid-one")
        XCTAssertNil(delete["swapCommit"])
    }

    func testDPoPNonceRetryIsBoundedAndReusesReturnedNonce() async throws {
        let challenge = Data("{\"error\":\"use_dpop_nonce\"}".utf8)
        let raw = ScriptedHTTPTransport([
            .init(status: 401, headers: ["DPoP-Nonce": "nonce-a"], data: challenge),
            .init(status: 200, headers: [:], data: Data("{}".utf8)),
        ])
        let signer = RecordingSigner()
        let transport = DPoPAuthenticatedTransport(
            transport: raw,
            signer: signer,
            maximumNonceRetries: 1
        )
        let request = URLRequest(url: URL(string: "https://pds.example/xrpc/test")!)
        let result = try await transport.data(for: request, session: session)
        XCTAssertEqual(result.1.statusCode, 200)
        let nonces = await signer.observedNonces()
        XCTAssertEqual(nonces.count, 2)
        XCTAssertNil(nonces[0])
        XCTAssertEqual(nonces[1], "nonce-a")
        let calls = await raw.calls()
        XCTAssertEqual(calls.count, 2)
    }

    func testDPoPNonceRetryStopsAfterOneRetry() async throws {
        let challenge = Data("{\"error\":\"use_dpop_nonce\"}".utf8)
        let raw = ScriptedHTTPTransport([
            .init(status: 401, headers: ["DPoP-Nonce": "nonce-a"], data: challenge),
            .init(status: 401, headers: ["DPoP-Nonce": "nonce-b"], data: challenge),
        ])
        let transport = DPoPAuthenticatedTransport(
            transport: raw,
            signer: RecordingSigner(),
            maximumNonceRetries: 1
        )
        do {
            _ = try await transport.data(
                for: URLRequest(url: URL(string: "https://pds.example/xrpc/test")!),
                session: session
            )
            XCTFail("Expected bounded retry failure")
        } catch let error as ATProtoClientError {
            XCTAssertEqual(error, .authenticationRetryLimitExceeded)
        }
        let calls = await raw.calls()
        XCTAssertEqual(calls.count, 2)
    }

    func testRepositoryClientMapsInvalidSwapAndBuildsQuery() async throws {
        let raw = ScriptedHTTPTransport([
            .init(
                status: 400,
                headers: [:],
                data: Data("{\"error\":\"InvalidSwap\",\"message\":\"stale CID\"}".utf8)
            ),
            .init(
                status: 200,
                headers: [:],
                data: Data(
                    "{\"uri\":\"at://did:plc:test/app.example.record/one\",\"cid\":\"cid\",\"value\":{\"name\":\"one\"}}"
                        .utf8)
            ),
        ])
        let auth = DPoPAuthenticatedTransport(transport: raw, signer: RecordingSigner())
        let client = RepositoryClient(serviceURL: URL(string: "https://pds.example")!, transport: auth)
        do {
            _ = try await client.putRecord(
                PutRecordRequest(
                    repo: "did:plc:test",
                    collection: "app.example.record",
                    rkey: "one",
                    record: .object(["name": .string("local")]),
                    swapRecord: .cid("stale")
                ),
                session: session
            )
            XCTFail("Expected InvalidSwap")
        } catch let conflict as InvalidSwapConflict {
            XCTAssertEqual(conflict.operation, "com.atproto.repo.putRecord")
            XCTAssertEqual(conflict.message, "stale CID")
        }

        let record = try await client.getRecord(
            GetRecordRequest(
                repo: "did:plc:test",
                collection: "app.example.record",
                rkey: "one",
                cid: "cid"
            ),
            session: session
        )
        XCTAssertEqual(record.cid, "cid")
        let calls = await raw.calls()
        let request = try XCTUnwrap(calls.last)
        let components = try XCTUnwrap(
            URLComponents(url: XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
        let query = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })
        XCTAssertEqual(query["repo"], "did:plc:test")
        XCTAssertEqual(query["collection"], "app.example.record")
        XCTAssertEqual(query["rkey"], "one")
        XCTAssertEqual(query["cid"], "cid")
    }
}

private extension Data {
    init(hex: String) {
        precondition(hex.utf8.count.isMultiple(of: 2))
        let bytes = Array(hex.utf8)
        self.init(
            stride(from: 0, to: bytes.count, by: 2).map { index in
                func nibble(_ byte: UInt8) -> UInt8 {
                    switch byte {
                    case 48...57: byte - 48
                    case 65...70: byte - 55
                    case 97...102: byte - 87
                    default: preconditionFailure("Invalid hex digit")
                    }
                }
                return nibble(bytes[index]) << 4 | nibble(bytes[index + 1])
            })
    }
}
