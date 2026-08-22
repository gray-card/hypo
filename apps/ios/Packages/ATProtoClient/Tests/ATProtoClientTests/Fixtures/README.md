# OAuth provider fixtures

These fixtures exercise two AT Protocol OAuth deployment shapes without contacting a live service:

- `bluesky-hosted.json` models a PDS that is also its own authorization server. It requires a DPoP nonce retry on PAR.
- `federated-entryway.json` models a PDS that delegates authorization to an entryway. It omits the optional `require_request_uri_registration` field and requires a DPoP nonce retry at the token endpoint.

The metadata follows the AT Protocol authorization-server profile, but the accounts and domains are test values. `OAuthProviderInteroperabilityTests` composes the production identity resolver, metadata client, authorization-server client, callback validator, session store, and DPoP key custody against these files. The test then restores, refreshes, and removes each session.

Keep this gate offline and deterministic. A live-provider conformance test belongs in a separate opt-in suite because network availability, accounts, and provider deployment state must not control the package test result.
