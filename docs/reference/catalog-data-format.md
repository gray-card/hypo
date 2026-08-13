---
title: Catalog data format
description: Source, manifest, shard, integrity, and cache formats for the Hypo catalog.
---

# Catalog data format

Hypo separates the **authoring format** from the **delivery format**. Contributors edit JSON Lines under `data/`; the build emits a small mutable manifest and immutable, content-addressed shards under `public/catalog/`.

## Authoring format

Each file in a curated directory contains one complete JSON object per line. Field shapes follow the corresponding `app.graycard.catalog.*` lexicon. A camera row may look like this:

```json
{ "make": "Example Camera Co.", "model": "Model 1", "mount": "example-mount", "category": "slr" }
```

Source rows may also carry build metadata such as `document`, `verifiedFields`, `sourcePage`, `sourceTable`, `sourceMethod`, and `sourceNote`. The catalog build converts this material to schema-native `documents` and `specSources`. It does not copy manufacturer documents into the repository.

The current human-maintained source groups are cameras, lenses, film stocks, development times, and datasheet enrichment. Run `npm run build:catalog` after editing a source. Do not edit the generated JSON in `src/data/` or `public/catalog/` by hand.

## Manifest

`/catalog/manifest.json` is the catalog's mutable pointer. Its TypeScript shape is `CatalogManifest`:

```json
{
  "schemaVersion": 1,
  "hashAlgorithm": "sha256",
  "catalogHash": "<sha256>",
  "shards": {
    "cameras": {
      "path": "<catalogHash>/cameras.json",
      "sha256": "<sha256>",
      "bytes": 1234,
      "itemCount": 42
    }
  }
}
```

`catalogHash` identifies the complete manifest identity. Each descriptor supplies the relative path, digest, UTF-8 byte count, and item count required to verify one shard.

## Shards

Each shard has this envelope:

```json
{
  "schemaVersion": 1,
  "domain": "cameras",
  "sources": [
    {
      "file": "data/curated-cameras/example.jsonl",
      "collection": "app.graycard.catalog.cameraType",
      "itemCount": 42,
      "metadata": {}
    }
  ],
  "items": []
}
```

The current named domains are `cameras`, `lenses`, `dev-times`, `film-stocks`, and `darkroom-products`. The client accepts future string domains, but it rejects a shard whose `schemaVersion`, `domain`, item count, byte count, or SHA-256 digest does not agree with the manifest.

## Fetch and cache behavior

`CatalogClient` fetches the manifest from the network first because the pointer may change. If that request fails, a previously verified cached manifest may be used. Shards are addressed and cached by digest; a corrupt cache entry is discarded before a network recovery is attempted.

The default browser cache uses the Cache API under `hypo-catalog-shards-v1` when available. Without that API, reads still work but are not persisted; consumers may inject `MemoryCatalogCache`, `IndexedDbCatalogCache`, or another `CatalogCache` implementation. Concurrent requests for the same manifest or shard share one promise.

The package entry point exports `CatalogClient`, the manifest and shard types, cache adapters, search types, and catalog-specific errors. See the [generated package reference](./generated-package.md) for the adjacent lexicon runtime.
