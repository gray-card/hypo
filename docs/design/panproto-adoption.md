---
title: Panproto adoption decision
description: The pinned version, sidecar boundary, and activation criteria for schema migration.
---

# Panproto adoption decision

**Status:** accepted; `lexicons-v1` is the first stable schema snapshot

**Decision date:** 2026-08-12

Hypo adopts Panproto `0.70.1` as the versioning and migration engine for the shared `app.graycard.*` lexicon suite. The repository pins both `@panproto/core` and the CI-installed `panproto-cli` exactly at `0.70.1`. Its `panproto.toml` declares one manifest-backed ATProto package, and the checked-in `.panproto/` sidecar records that package plus two conformance records.

The suite is one package rather than one package per JSON file. This lets compatibility analysis account for shared definitions and cross-file references.

The **Panproto integration gate** runs `npm run check:panproto`. It creates a temporary repository and runs four direct regression checks:

1. Adding the repository root loads all 59 Lexicon documents as one ATProto bundle and returns successful equation diagnostics.
2. Adding `fixtures/records` places both JSON records in `staged_data`.
3. `schema compat` and `schema diff` load the manifest-backed directory; compatibility is full and the snapshots are identical.
4. The TypeScript SDK parses the same bundle and validates it against the WASM registry's ATProto definition, including the `format`, `knownValues`, and `ref` constraint sorts.

The browser migration boundary lives in `@hypo/schema-runtime`. Current-version records remain on the generated-validator fast path; a record that fails that validator triggers a dynamic `import()` of Panproto. The runtime stores each complement durably in IndexedDB and restores it before a swap-protected write. The published 0.70.1 WASM file is 8,733,245 bytes raw and about 2.10 MB gzipped, so it does not enter the startup path.

The production artifact also publishes the sidecar's immutable objects and refs under `/.panproto/`. `StaticPanprotoStore` resolves those refs and fetches object bytes over HTTPS. Fetched bytes do not become executable migrations by themselves: a client must still ship or register a reviewed transition before the schema runtime may apply it.

The checked-in sidecar tags the first stable snapshot as `lexicons-v1`. Pull-request checks classify later schema changes against the released line and require reviewed migrations for acknowledged breaks. The development-session transition keeps its exact source suite, lens, projection schema, and fixtures under `lenses/develop-session-v2/`; Hypo applies that transition as a repository rewrite before normal store reads. See [How schema versions work](../explanation/schema-versions.md) for the user-facing model and [Make a breaking lexicon change](../how-to/make-breaking-lexicon-change.md) for the release procedure.
