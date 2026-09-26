# ADR 0002: Generate iOS record types from the monorepo lexicons

- Status: accepted
- Date: 2026-08-13

## Decision

The root [`lexicons/`](../../../../lexicons/) directory is the only schema source for both Hypo web and Hypo iOS. The iOS generator writes deterministic, checked-in Swift models and a runtime schema index into `Packages/HypoLexicon`. CI reruns the generator in check mode and fails when the checked-in output differs.

The generated layer includes:

- `Codable`, `Hashable`, and `Sendable` models for every definition and record;
- typed `ATURI` and `ATProtoDate` properties where the lexicon declares those formats;
- open string wrappers for `knownValues`, so new network values remain decodable;
- every record NSID and reproducibility metadata;
- a generated runtime schema index used for structural and value validation; and
- a source manifest containing the SHA-256 hash of every input lexicon.

The repository also retains a `JSONValue` boundary for unknown data and union members that cannot be represented safely as one static Swift type. This prevents the generated layer from turning open AT Protocol data into closed Swift enums.

## Why there is no vendored subtree here

The original iOS backlog assumed a separate iOS repository and thus specified a pinned `lexicons-v1` git subtree. Hypo iOS now lives in the same repository as Hypo web. Vendoring the root schemas into a second directory would create two local sources and permit them to drift within one commit.

The monorepo commit is the pin: application code, schema changes, generated Swift, migrations, fixtures, and CI gates can change atomically. `LexiconSourceManifest.json` records the exact inputs compiled into the client. If the iOS application moves to a separate repository, the subtree pin from the backlog should be reinstated.

## Regeneration and checks

Run:

```sh
node apps/ios/Scripts/generate-hypo-lexicon-swift.mjs
node apps/ios/Scripts/generate-hypo-lexicon-swift.mjs --check
swift test --package-path apps/ios/Packages/HypoLexicon
```

The conformance tests read `fixtures/records/camera.json` and `fixtures/records/setup.json` directly from the repository. Package fixtures cover `catalog.devRecipe`, `process.developSession`, `meter.reading`, `meter.calibration`, and `instance.filmRoll` until those records join the shared root corpus.

Panproto lift/get/put oracle comparison is a separate I13.4 gate. The generator does not call or imitate Panproto APIs.
