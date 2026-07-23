# Hypo catalog data

This directory contains the human-editable sources for Hypo's camera, lens, film,
and darkroom catalogs, plus a vendored snapshot of the Lensfun correction
database. The build pipeline turns these sources into the generated catalog files
under `src/data/`.

## Directory layout

| Path | Contents |
| --- | --- |
| `curated-cameras/` | Camera bodies not supplied by Lensfun |
| `curated-lenses/` | Lenses not supplied by Lensfun |
| `curated-film-stocks/` | Film specifications compiled from primary sources |
| `curated-dev-times/` | Development recipes transcribed from manufacturer technical sheets |
| `datasheets/` | Manufacturer links that enrich records originating outside the curated files |
| `lensfun-db/` | Vendored Lensfun source XML and its own license notice |

The curated files use JSON Lines: one complete JSON object per line. Edit these
files rather than the generated JSON under `src/data/`, then run:

```bash
npm run build:catalog
```

Rows under `datasheets/` may do more than attach a URL. Camera and lens
enrichment rows use the catalog's exact manufacturer and model strings, may add
schema-native technical fields, and may include:

- `document`, for edition metadata such as publisher, document number, revision,
  language, and publication date;
- `verifiedFields`, an array of catalog property names checked against that
  exact document;
- `sourcePage`, `sourceTable`, `sourceMethod`, and `sourceNote`, for the exact
  location and transcription method without leaking build-only metadata into
  the generated record.

The build converts this metadata to `documents` and field-level `specSources`
on the generated catalog record. A field must not appear in `verifiedFields`
unless the cited document supports the value for the exact product or revision.

## Datasheets and source quality

Datasheet fields contain links; manufacturer documents are not copied into this
repository. Prefer sources in this order:

1. an exact technical datasheet hosted by the manufacturer;
2. an official manufacturer manual, catalog, support page, or product page that
   covers the exact model;
3. no link until an appropriate primary source is available.

Do not substitute retailer pages, review sites, fan-maintained databases, generic
manual mirrors, or a document for a merely similar product. A manufacturer catalog
may cover several records when it names those models explicitly. Verify that a URL
resolves and describes the record before adding it. Preserve the original source
URL and note any relevant model-family or archival limitation.

## Licenses

The licenses are intentionally split by artifact:

| Material | License |
| --- | --- |
| Original curated data and database compilations in this directory | [CC BY-SA 4.0](LICENSE.md) |
| Vendored Lensfun database | [CC BY-SA 3.0](lensfun-db/NOTICE.md) |
| Hypo application and data-processing code | [MIT](../LICENSE) |
| Linked manufacturer datasheets, pages, and images | Copyright remains with their respective owners |

The data license covers **data only**. It does not change the MIT license on the
code. Conversely, the repository's MIT license does not relicense the data or the
third-party works to which the catalog links.

The Lensfun snapshot is kept as a separate work with its original attribution and
license. Creative Commons permits contributions to adaptations of BY-SA 3.0
material to use a later BY-SA version, but no such upgrade is asserted for the
vendored XML itself.

## Attribution and changes

When redistributing a substantial portion of the curated data, credit “Hypo
contributors,” link to this repository and the applicable license, and indicate
whether you changed the data. Retain record-level source URLs and the Lensfun
attribution files. Contributions should include the primary source used and should
not copy protected prose, diagrams, photographs, or whole datasheets into the
dataset.
