---
title: Schema version handling
description: How Hypo validates the current lexicon suite and migrates supported legacy records.
---

# Schema version handling

Hypo treats the complete `lexicons/` directory as one Panproto schema package. This is the **suite snapshot**: one content-addressed view of every record, object definition, reference, and constraint used by the application.

The package boundary matters because the lexicons refer to shared definitions across namespaces. A change to `app.graycard.defs#measure`, for instance, may affect catalog, process, and meter records. The `panproto.toml` manifest therefore declares the entire directory as one `atproto` package.

## Application and schema versions

Hypo and its lexicon suite use separate version lines. Hypo follows product SemVer: patches fix behavior, minors add backward-usable features and transparent lossless repository migrations, and majors mark an upgrade that requires user or operator action, cannot migrate supported data automatically, drops compatibility with a supported client, changes an authentication or deployment contract incompatibly, or breaks a published package API.

The shared schema uses `lexicons-vN` tags. A Panproto-breaking schema transition increments that number even when the corresponding Hypo upgrade remains a minor release because the application performs the migration automatically. Thus Hypo 1.2.0 carries the `lexicons-v2` development-session transition.

## Checked-in schema data

The repository pins `@panproto/core` and `panproto-cli` at 0.70.1. The `.panproto/` sidecar stores the current schema objects and conformance records. Production builds copy that sidecar to `/.panproto/`, where the read-only `StaticPanprotoStore` can resolve refs and retrieve object bytes without an application server.

`npm run check:panproto` verifies the current package by:

1. loading all 59 lexicon documents through the root manifest;
2. checking ATProto theory diagnostics;
3. staging the two records under `fixtures/records`;
4. exercising manifest-backed compatibility and diff loading; and
5. parsing the bundle through the TypeScript SDK.

The sidecar tags the 1.0 baseline as `lexicons-v1` and the ordered development-stage suite as `lexicons-v2`. Pull-request compatibility checks compare proposed changes with the latest released Git baseline reachable from `main`.

## Browser record boundary

The browser identifies the current application view as `lexicons-v1`. The generated ATProto validator is the fast path for current records. Panproto's WASM runtime loads only if that validator rejects an `app.graycard.*` record and another registered version or transition must be considered.

The current runtime registers only `lexicons-v1`; its general transition and complement-custody machinery is present, but there is no multi-version transition chain. A record that does not match the current validator is rejected as an unknown schema version.

## Repository migrations

Hypo runs supported repository migrations before its first current-schema store read. These migrations use swap-protected PDS writes, so the old data remains intact if a write fails.

### Developer to chemistry

Hypo detects the removed `app.graycard.catalog.developerType` and `app.graycard.instance.developer` collections and replaces those records with `catalog.chemistryType` and `instance.chemistry` records.

Panproto compiles the value transforms that add the `film-developer` role, change the record type, and rename `defaultDeveloper` to `defaultChemistry`. Hypo also rewrites AT-URI references in development recipes, film rolls, development sessions, and workflow templates.

The PDS receives the replacement records, dependent-record updates, and legacy deletions in one `com.atproto.repo.applyWrites` request guarded by the current repository commit CID. A failed write leaves the legacy records in place. A successful write removes them in the same commit that creates their replacements.

The migration stops before writing if an instance points to a missing developer type, a target rkey already exists, the source and target fields conflict, or the operation would exceed the 200-write atomic request limit.

### Development summaries to ordered stages

Hypo detects `app.graycard.process.developSession` records that carry session-wide recipe, chemistry, time, temperature, or agitation fields, shortcut stop/fixer/blix fields, or the superseded singular fields inside an existing stage. Panproto compiles the reviewed summary-to-stage value transform. The application merges that result with any existing stages and converts shortcut baths into their ordered equivalents.

The migration updates each record at the same collection and record key with `com.atproto.repo.applyWrites#update`. It removes the superseded fields only in the replacement value and guards each write batch with the current repository commit CID. The migration is idempotent: records already using only `steps[]` are skipped.

The source suite, lens document, projection schema, and migration fixtures are checked in under `lenses/develop-session-v2/`. The pull-request gate independently classifies the transition as breaking, compiles the reviewed lens, runs the fixtures through the application rewrite, and validates every result against the target lexicons.
