import Foundation
import Testing

@testable import ATProtoClient

@Suite("AT Protocol identity resolution")
struct IdentityResolutionTests {
    @Test("A handle is verified through its DID document before OAuth discovery")
    func resolvesVerifiedHandle() async throws {
        let transport = IdentityResolutionTransport(responses: [
            "https://alice.example/.well-known/atproto-did": .text("did:plc:alice"),
            "https://plc.directory/did:plc:alice": .json(
                """
                {
                  "id": "did:plc:alice",
                  "alsoKnownAs": ["at://alice.example"],
                  "service": [{
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://pds.example"
                  }]
                }
                """
            ),
            "https://pds.example/.well-known/oauth-protected-resource": .json(
                #"{"authorization_servers":["https://auth.example"]}"#
            ),
        ])
        let resolver = ATProtoIdentityResolver(transport: transport, directoryURL: nil)

        let identity = try await resolver.resolveIdentity(identifier: "@Alice.Example")

        #expect(identity.did == "did:plc:alice")
        #expect(identity.handle == "alice.example")
        #expect(identity.pdsURL.absoluteString == "https://pds.example")
        #expect(identity.authorizationIssuer.absoluteString == "https://auth.example")
    }

    @Test("An unconfirmed handle is rejected")
    func rejectsUnconfirmedHandle() async throws {
        let transport = IdentityResolutionTransport(responses: [
            "https://alice.example/.well-known/atproto-did": .text("did:plc:alice"),
            "https://plc.directory/did:plc:alice": .json(
                """
                {"id":"did:plc:alice","alsoKnownAs":["at://other.example"],"service":[]}
                """
            ),
        ])
        let resolver = ATProtoIdentityResolver(transport: transport, directoryURL: nil)

        await #expect(throws: ATProtoIdentityResolutionError.self) {
            try await resolver.resolveAuthorizationIssuer(identifier: "alice.example")
        }
    }

    @Test("did:web paths resolve to their method-specific document")
    func resolvesDIDWebPath() async throws {
        let transport = IdentityResolutionTransport(responses: [
            "https://example.com/users/alice/did.json": .json(
                """
                {
                  "id": "did:web:example.com:users:alice",
                  "service": [{
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://pds.example"
                  }]
                }
                """
            ),
            "https://pds.example/.well-known/oauth-protected-resource": .json(
                #"{"authorization_servers":["https://auth.example"]}"#
            ),
        ])
        let resolver = ATProtoIdentityResolver(transport: transport, directoryURL: nil)

        let issuer = try await resolver.resolveAuthorizationIssuer(
            identifier: "did:web:example.com:users:alice"
        )

        #expect(issuer.host == "auth.example")
    }
}

private actor IdentityResolutionTransport: HTTPTransport {
    enum Response: Sendable {
        case text(String)
        case json(String)

        var data: Data {
            switch self {
            case .text(let value), .json(let value): Data(value.utf8)
            }
        }
    }

    let responses: [String: Response]

    init(responses: [String: Response]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, let response = responses[url.absoluteString] else {
            throw URLError(.resourceUnavailable)
        }
        let http = try #require(
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)
        )
        return (response.data, http)
    }
}
