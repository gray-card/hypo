# `ATProtoClient`

Authenticate a Hypo client and perform repository XRPC operations without leaking transport concerns into features.

## Overview

ATProtoClient implements native OAuth with PKCE and DPoP, identity and authorization-server discovery, Keychain custody, and the `com.atproto.repo` record operations used by Hypo. Repository updates expose CID compare-and-swap guards so callers can detect a stale local value instead of overwriting a concurrent edit.

The package transports JSON records. Their field contracts remain canonical in the [Hypo Lexicon reference](https://hypo.graycard.app/docs/reference/lexicons/).

## Topics

### Authentication

- `OAuthFlowCoordinator`
- `OAuthSession`
- `KeychainOAuthSessionStore`
- `DPoPProofGenerator`

### Repository records

- `RepositoryClient`
- `RepositoryRecord`
- `RecordCAS`
- `InvalidSwapConflict`
