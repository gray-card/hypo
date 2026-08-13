---
title: Licensing boundaries
description: The separate licenses for code, original catalog data, Lensfun data, and linked third-party works.
---

# Licensing boundaries

Hypo has a **four-part license boundary**. The applicable terms follow the artifact, not the repository directory alone.

| Material                                                      | Terms                          |
| ------------------------------------------------------------- | ------------------------------ |
| Application and data-processing code                          | MIT                            |
| Original curated data and database compilations under `data/` | CC BY-SA 4.0                   |
| Vendored Lensfun database and its direct adaptations          | CC BY-SA 3.0                   |
| Linked manufacturer documents, pages, and images              | Their respective owners' terms |

The MIT license permits use and modification of the software, subject to its notice. It does not relicense catalog data merely because code reads that data.

The CC BY-SA 4.0 data license covers Hypo's original curated datasets and database compilations. Redistribution of a substantial portion should credit “Hypo contributors,” link to the repository and license, indicate changes, and retain source information.

Lensfun is kept as a separate vendored work with its own notice and CC BY-SA 3.0 text. Generated camera and lens data derived from that snapshot retain Lensfun attribution and same-license treatment. No license upgrade is asserted for the vendored XML.

Manufacturer datasheets and product images are links, not repository copies. A URL in a catalog record does not transfer copyright or grant a redistribution license. Images should use manufacturer-hosted originals under the catalog policy; user-uploaded assets require the uploader to have permission.

Wikidata identifiers are drawn from CC0 data. Wikimedia Commons images, when linked, retain their per-file licenses.

For contributions, add facts and structured source locations rather than copying protected prose, diagrams, product photography, or entire documents. See `data/LICENSE.md`, `data/lensfun-db/NOTICE.md`, `src/data/CATALOG_ATTRIBUTION.md`, and the repository `LICENSE` for the controlling texts.
