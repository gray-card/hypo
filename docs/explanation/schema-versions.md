---
title: Schema version handling
description: How Hypo validates the current lexicon suite and migrates supported legacy records.
---

# Schema version handling

Hypo treats the complete `lexicons/` directory as one Panproto schema package. This is the **suite snapshot**: one content-addressed view of every record, object definition, reference, and constraint used by the application.

The package boundary matters because the lexicons refer to shared definitions across namespaces. A change to `app.graycard.defs#measure`, for instance, may affect catalog, process, and meter records. The `panproto.toml` manifest therefore declares the entire directory as one `atproto` package.

## Checked-in schema data

The repository pins `@panproto/core` and `panproto-cli` at 0.70.1. The `.panproto/` sidecar stores the current schema objects and conformance records. Production builds copy that sidecar to `/.panproto/`, where the read-only `StaticPanprotoStore` can resolve refs and retrieve object bytes without an application server.

`npm run check:panproto` verifies the current package by:

1. loading all 59 lexicon documents through the root manifest;
2. checking ATProto theory diagnostics;
3. staging the two records under `fixtures/records`;
4. exercising manifest-backed compatibility and diff loading; and
5. parsing the bundle through the TypeScript SDK.

The sidecar tags this first stable snapshot as `lexicons-v1`. No earlier published suite exists, so the 1.0 check establishes the baseline rather than exercising a transition from a previous release. Pull-request compatibility checks become active once the corresponding `v1.0.0` Git tag is reachable from `main`.

## Browser record boundary

The browser identifies the current application view as `lexicons-v1`. The generated ATProto validator is the fast path for current records. Panproto's WASM runtime loads only if that validator rejects an `app.graycard.*` record and another registered version or transition must be considered.

The current runtime registers only `lexicons-v1`; its general transition and complement-custody machinery is present, but there is no multi-version transition chain. A record that does not match the current validator is rejected as an unknown schema version.

## Developer-to-chemistry migration

Hypo runs one repository migration before its first current-schema store read. It detects the removed `app.graycard.catalog.developerType` and `app.graycard.instance.developer` collections and replaces those records with `catalog.chemistryType` and `instance.chemistry` records.

Panproto compiles the value transforms that add the `film-developer` role, change the record type, and rename `defaultDeveloper` to `defaultChemistry`. Hypo also rewrites AT-URI references in development recipes, film rolls, development sessions, and workflow templates.

The PDS receives the replacement records, dependent-record updates, and legacy deletions in one `com.atproto.repo.applyWrites` request guarded by the current repository commit CID. A failed write leaves the legacy records in place. A successful write removes them in the same commit that creates their replacements.

The migration stops before writing if an instance points to a missing developer type, a target rkey already exists, the source and target fields conflict, or the operation would exceed the 200-write atomic request limit.
