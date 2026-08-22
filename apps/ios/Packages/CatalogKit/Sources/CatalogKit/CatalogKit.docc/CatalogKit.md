# `CatalogKit`

Search the content-addressed photographic catalog bundled with Hypo.

## Overview

CatalogKit verifies and loads the staged catalog snapshot for offline camera, lens, film-stock, chemistry, and development-recipe lookup. Search results retain their catalog identity and provenance rather than flattening a catalog match into user-authored text.

Catalog items become records only at a feature write boundary. See the canonical [catalog Lexicons](https://hypo.graycard.app/docs/reference/lexicons/#catalog) for the network representation.

## Topics

### Load and query

- ``BundledCatalog``
- ``CatalogSnapshot``
- ``CatalogSearch``
- ``CatalogSearchResult``

### Content and provenance

- ``CatalogItem``
- ``CatalogManifest``
- ``CatalogSource``
- ``ProvenanceBadge``
