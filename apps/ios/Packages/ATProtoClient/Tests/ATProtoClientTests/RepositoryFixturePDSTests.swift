import Foundation
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif
import XCTest
@testable import ATProtoClient

private actor FixturePDSTransport: HTTPTransport {
    private struct StoredRecord: Sendable {
        var uri: String
        var cid: String
        var value: JSONValue
    }

    private var records: [String: StoredRecord] = [:]
    private var revision = 0

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard request.value(forHTTPHeaderField: "Authorization") == "DPoP fixture-token",
            request.value(forHTTPHeaderField: "DPoP") == "fixture-proof"
        else {
            return response(
                request,
                status: 401,
                object: ["error": "AuthenticationRequired"]
            )
        }

        switch request.url?.lastPathComponent {
        case "com.atproto.repo.createRecord":
            return create(request)
        case "com.atproto.repo.getRecord":
            return get(request)
        case "com.atproto.repo.listRecords":
            return list(request)
        case "com.atproto.repo.putRecord":
            return put(request)
        case "com.atproto.repo.deleteRecord":
            return delete(request)
        default:
            return response(request, status: 404, object: ["error": "UnknownMethod"])
        }
    }

    private func create(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        guard let body = body(request),
            let repo = body["repo"] as? String,
            let collection = body["collection"] as? String,
            let rkey = body["rkey"] as? String,
            let value = jsonValue(body["record"])
        else {
            return response(request, status: 400, object: ["error": "InvalidRequest"])
        }
        let key = recordKey(repo: repo, collection: collection, rkey: rkey)
        guard records[key] == nil else {
            return response(request, status: 400, object: ["error": "RecordAlreadyExists"])
        }
        revision += 1
        let cid = "cid-\(revision)"
        let uri = "at://\(repo)/\(collection)/\(rkey)"
        records[key] = StoredRecord(uri: uri, cid: cid, value: value)
        return response(
            request,
            status: 200,
            object: writeReceipt(uri: uri, cid: cid)
        )
    }

    private func get(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        guard let query = query(request),
            let repo = query["repo"],
            let collection = query["collection"],
            let rkey = query["rkey"],
            let record = records[recordKey(repo: repo, collection: collection, rkey: rkey)]
        else {
            return response(request, status: 400, object: ["error": "RecordNotFound"])
        }
        return response(request, status: 200, object: recordObject(record))
    }

    private func list(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        guard let query = query(request),
            let repo = query["repo"],
            let collection = query["collection"]
        else {
            return response(request, status: 400, object: ["error": "InvalidRequest"])
        }
        let prefix = recordKey(repo: repo, collection: collection, rkey: "")
        let objects =
            records
            .filter { $0.key.hasPrefix(prefix) }
            .sorted { $0.key < $1.key }
            .map { recordObject($0.value) }
        return response(request, status: 200, object: ["records": objects])
    }

    private func put(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        guard let body = body(request),
            let repo = body["repo"] as? String,
            let collection = body["collection"] as? String,
            let rkey = body["rkey"] as? String,
            let value = jsonValue(body["record"])
        else {
            return response(request, status: 400, object: ["error": "InvalidRequest"])
        }
        let key = recordKey(repo: repo, collection: collection, rkey: rkey)
        if !matchesCAS(body["swapRecord"], currentCID: records[key]?.cid) {
            return invalidSwap(request)
        }
        revision += 1
        let cid = "cid-\(revision)"
        let uri = "at://\(repo)/\(collection)/\(rkey)"
        records[key] = StoredRecord(uri: uri, cid: cid, value: value)
        return response(
            request,
            status: 200,
            object: writeReceipt(uri: uri, cid: cid)
        )
    }

    private func delete(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        guard let body = body(request),
            let repo = body["repo"] as? String,
            let collection = body["collection"] as? String,
            let rkey = body["rkey"] as? String
        else {
            return response(request, status: 400, object: ["error": "InvalidRequest"])
        }
        let key = recordKey(repo: repo, collection: collection, rkey: rkey)
        if !matchesCAS(body["swapRecord"], currentCID: records[key]?.cid) {
            return invalidSwap(request)
        }
        records[key] = nil
        revision += 1
        return response(
            request,
            status: 200,
            object: ["commit": ["cid": "commit-\(revision)", "rev": "\(revision)"]]
        )
    }

    private func matchesCAS(_ encoded: Any?, currentCID: String?) -> Bool {
        switch encoded {
        case nil:
            true
        case is NSNull:
            currentCID == nil
        case let cid as String:
            currentCID == cid
        default:
            false
        }
    }

    private func invalidSwap(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        response(
            request,
            status: 400,
            object: ["error": "InvalidSwap", "message": "fixture CID did not match"]
        )
    }

    private func writeReceipt(uri: String, cid: String) -> [String: Any] {
        [
            "uri": uri,
            "cid": cid,
            "commit": ["cid": "commit-\(revision)", "rev": "\(revision)"],
            "validationStatus": "valid",
        ]
    }

    private func recordObject(_ record: StoredRecord) -> [String: Any] {
        ["uri": record.uri, "cid": record.cid, "value": foundationObject(record.value)]
    }

    private func recordKey(repo: String, collection: String, rkey: String) -> String {
        "\(repo)/\(collection)/\(rkey)"
    }

    private func body(_ request: URLRequest) -> [String: Any]? {
        guard let data = request.httpBody else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func query(_ request: URLRequest) -> [String: String]? {
        guard let url = request.url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        return Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )
    }

    private func jsonValue(_ object: Any?) -> JSONValue? {
        guard let object,
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func foundationObject(_ value: JSONValue) -> Any {
        let data = try! JSONEncoder().encode(value)
        return try! JSONSerialization.jsonObject(with: data)
    }

    private func response(
        _ request: URLRequest,
        status: Int,
        object: [String: Any]
    ) -> (Data, HTTPURLResponse) {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (data, response)
    }
}

private struct FixtureRequestSigner: AuthenticatedRequestSigning {
    func sign(
        _ request: URLRequest,
        session: OAuthSession,
        nonce _: String?
    ) async throws -> URLRequest {
        var signed = request
        signed.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
        signed.setValue("fixture-proof", forHTTPHeaderField: "DPoP")
        return signed
    }
}

final class RepositoryFixturePDSTests: XCTestCase {
    func testRepositoryLifecycleAndCASAgainstFixturePDS() async throws {
        let transport = DPoPAuthenticatedTransport(
            transport: FixturePDSTransport(),
            signer: FixtureRequestSigner()
        )
        let client = RepositoryClient(
            serviceURL: URL(string: "https://fixture-pds.invalid")!,
            transport: transport
        )
        let session = OAuthSession(
            id: OAuthSessionID(rawValue: "fixture-session"),
            issuer: URL(string: "https://fixture-auth.invalid")!,
            subject: "did:plc:fixture",
            accessToken: "fixture-token"
        )
        let collection = "app.graycard.instance.filmRoll"
        let firstValue: JSONValue = .object([
            "$type": .string(collection),
            "title": .string("First roll"),
        ])

        let created = try await client.createRecord(
            CreateRecordRequest(
                repo: session.subject,
                collection: collection,
                rkey: "roll-one",
                record: firstValue
            ),
            session: session
        )
        XCTAssertEqual(
            created.uri,
            "at://did:plc:fixture/app.graycard.instance.filmRoll/roll-one"
        )
        XCTAssertEqual(created.validationStatus, "valid")

        let fetched = try await client.getRecord(
            GetRecordRequest(
                repo: session.subject,
                collection: collection,
                rkey: "roll-one"
            ),
            session: session
        )
        XCTAssertEqual(fetched.cid, created.cid)
        XCTAssertEqual(fetched.value, firstValue)

        let page = try await client.listRecords(
            ListRecordsRequest(repo: session.subject, collection: collection),
            session: session
        )
        XCTAssertEqual(page.records, [fetched])

        do {
            _ = try await client.putRecord(
                PutRecordRequest(
                    repo: session.subject,
                    collection: collection,
                    rkey: "roll-one",
                    record: firstValue,
                    swapRecord: .noRecord
                ),
                session: session
            )
            XCTFail("Expected no-record CAS to reject an existing fixture record")
        } catch let conflict as InvalidSwapConflict {
            XCTAssertEqual(conflict.operation, "com.atproto.repo.putRecord")
            XCTAssertEqual(conflict.message, "fixture CID did not match")
        }

        let updatedValue: JSONValue = .object([
            "$type": .string(collection),
            "title": .string("First roll, developed"),
        ])
        let updated = try await client.putRecord(
            PutRecordRequest(
                repo: session.subject,
                collection: collection,
                rkey: "roll-one",
                record: updatedValue,
                swapRecord: .cid(created.cid)
            ),
            session: session
        )
        XCTAssertNotEqual(updated.cid, created.cid)

        do {
            _ = try await client.deleteRecord(
                DeleteRecordRequest(
                    repo: session.subject,
                    collection: collection,
                    rkey: "roll-one",
                    swapRecord: .cid(created.cid)
                ),
                session: session
            )
            XCTFail("Expected stale delete CAS to fail")
        } catch let conflict as InvalidSwapConflict {
            XCTAssertEqual(conflict.operation, "com.atproto.repo.deleteRecord")
        }

        _ = try await client.deleteRecord(
            DeleteRecordRequest(
                repo: session.subject,
                collection: collection,
                rkey: "roll-one",
                swapRecord: .cid(updated.cid)
            ),
            session: session
        )

        do {
            _ = try await client.getRecord(
                GetRecordRequest(
                    repo: session.subject,
                    collection: collection,
                    rkey: "roll-one"
                ),
                session: session
            )
            XCTFail("Expected the deleted fixture record to be absent")
        } catch let error as ATProtoHTTPError {
            XCTAssertEqual(error.statusCode, 400)
            XCTAssertEqual(error.error, "RecordNotFound")
        }
    }
}
