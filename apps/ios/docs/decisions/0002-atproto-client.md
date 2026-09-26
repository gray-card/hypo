# ADR 0002: use a narrow first-party AT Protocol client

**Status:** accepted for the iOS foundation

## Decision

Hypo for iOS will implement the small AT Protocol surface it needs using
Foundation, AuthenticationServices, CryptoKit, and Security. SyncKit depends on
a repository-gateway protocol rather than on OAuth, URLSession, or a particular
AT Protocol SDK.

The first surface is identity resolution, OAuth authorization code with PKCE and
DPoP, session refresh, and the `getRecord`, `listRecords`, `createRecord`,
`putRecord`, and `deleteRecord` XRPC methods. Blob upload will use the same
authorized transport when the media pipeline needs it.

## Why not ATProtoKit

ATProtoKit is active and builds under Swift 6, but its current public boundary
does not supply the security and wire behavior this app needs:

1. Its repository requests use bearer authorization and leave OAuth to a custom
   session. AT Protocol OAuth requires DPoP proofs on PAR, token, refresh, and
   resource requests, including nonce handling and per-request proof claims.
2. Its keychain layer stores legacy session values but does not own a DPoP P-256
   key or bind that key to an OAuth session.
3. Its identity resolver does not establish the bidirectional handle and DID
   relationship required before an account is trusted.
4. Its generic unknown-record encoder does not preserve an arbitrary Graycard
   record as a nested JSON object. Adopting it would thus duplicate the models
   generated from Hypo's lexicons.
5. Its write API cannot represent all three `putRecord.swapRecord` states:
   omitted, explicit null, and a matching CID.

Replacing those parts would replace the portion of the dependency Hypo would
actually use. The smaller first-party boundary keeps Panproto-generated records
as the only model surface and makes CAS conflicts an explicit SyncKit input.

## Security boundary

The OAuth session actor will serialize refreshes because refresh tokens rotate.
The DPoP signer will generate a unique `jti` for every proof, keep nonces per
origin, include `ath` on protected-resource calls, and store the private key in
the Keychain or Secure Enclave with a simulator fallback. Access tokens remain
in memory. Redirect state, issuer, subject DID, PDS, authorization server, and
the returned `atproto` scope must all match before a session becomes usable.

Identity and metadata fetches reject insecure or credential-bearing URLs,
unexpected URL components, oversized bodies, and private or link-local targets
outside explicit local-development mode. Redirects and nonce retries are
bounded.

## Required gates

- deterministic PKCE, JWK, JWS, `htu`, `ath`, nonce, and unique-`jti` vectors;
- mocked PAR, callback, token, refresh, and nonce-challenge state machines;
- malicious and valid DID/handle/metadata fixtures;
- exact JSON snapshots for all repository methods and CAS states;
- fixture-PDS conflict and relaunch tests through SyncKit;
- simulator Keychain tests and real-device Secure Enclave validation;
- OAuth interoperability against a current reference provider and a second PDS
  before TestFlight.

## Sources

- [AT Protocol OAuth](https://atproto.com/specs/oauth)
- [AT Protocol permissions](https://atproto.com/specs/permission)
- [AT Protocol DID rules](https://atproto.com/specs/did)
- [AT Protocol handle rules](https://atproto.com/specs/handle)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449.html)
