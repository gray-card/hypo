---
title: Reference
description: Stable concepts and generated API surfaces for Hypo developers.
hide_title: true
---

# Reference

The reference covers the stable application contracts:

- [State of the schemas](./schema-status.md) distinguishes application-stable and experimental NSIDs, then states which release checks are operational.
- [Hypo bundle format](../bundle-format.md) specifies Hypo's import and export envelope.
- [Catalog data format](./catalog-data-format.md) specifies source rows, manifests, shards, integrity checks, and caching.
- [OAuth scopes](./oauth-scopes.md) lists the write-grant policy and production metadata contract.
- [Application routes](./routes.md) names every browser path and its static-hosting requirement.
- [Accessibility audit record](./accessibility-audit.md) states the automated coverage and the current manual VoiceOver waiver.
- [Local storage schema](./storage-schema.md) describes IndexedDB stores and queued operations.
- [Fixture PDS API](./fixture-pds-api.md) documents the deterministic XRPC subset used in tests.
- [Lexicon conventions](./lexicon-conventions.md) names the rules shared by all schemas.
- [Generated TypeScript package](./generated-package.md) documents runtime constants, the schema table, and validators.
- [Lexicon NSIDs](./lexicons/index.md) provides one generated page per source lexicon, including resolved refs, fields, constraints, and known values.

The lexicon JSON is the authoritative schema source. Both the TypeScript runtime and the NSID pages are derived artifacts.
