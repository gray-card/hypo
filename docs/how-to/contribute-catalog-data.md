---
title: Contribute catalog data
description: Add a sourced JSONL row, rebuild generated catalog artifacts, and check attribution.
---

# Contribute catalog data

Edit the human-maintained JSON Lines under `data/`, not generated catalog files.

1. Choose the matching directory: `curated-cameras/`, `curated-lenses/`, `curated-film-stocks/`, `curated-dev-times/`, or the relevant datasheet source.
2. Add one complete JSON object on one line. Match the manufacturer and model spelling used by the catalog so deduplication and enrichment can find the row.
3. Cite an exact primary source when adding specifications. Prefer a manufacturer technical sheet, then an official manual, catalog, support page, or product page for that exact model.
4. Add `verifiedFields` only for fields supported by the cited edition. Use `sourcePage`, `sourceTable`, `sourceMethod`, and `sourceNote` to locate the evidence.
5. Run the build and tests:

```bash
npm run build:catalog
npm test
```

6. Inspect the resulting source attribution and ensure the record was neither dropped nor incorrectly deduplicated.

Do not use retailer pages, reviews, fan databases, generic manual mirrors, or a document for a merely similar product as specification evidence. Link manufacturer documents and images at their publisher; do not copy them into the repository.

Original curated data and database compilations are CC BY-SA 4.0. Vendored Lensfun XML remains CC BY-SA 3.0. Linked documents and images retain their owners' terms. A contribution should include the source, retain record-level links, and avoid copied prose, diagrams, photography, or whole datasheets.

The [catalog data reference](../reference/catalog-data-format.md) specifies the generated manifest and shard envelope. The [licensing explanation](../explanation/licensing.md) gives the repository's license boundary.
