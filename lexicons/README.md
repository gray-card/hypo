# app.graycard lexicons

Provenance, workflow, and scene-graph schemas for **graycard** (`app.graycard.*`),
used with grain (`social.grain.photo`, `social.grain.photo.exif`). Records live in the
user's own repo and reference grain records by AT-URI. Grain's data model is treated as
frozen. Gray Card is the source of truth: it can emit these records in a dump-to-ATProto
pass. **Hypo** writes them to the PDS from the browser.

All lexicons validate with `@atproto/lexicon` (structural checks plus record-level ref
resolution).

## Type / instance / event / artifact

- **catalog.\***: shareable, forkable **types** (camera model, film stock, developer,
  lab, scan profile, paper, chemistry, scanner). Catalog records carry
  `links` (`app.graycard.defs#catalogLinks`): `sameAs` / `forkedFrom` AT-URIs and
  `externalIds` for external ontologies (Wikidata, camera-wiki, Getty AAT, and so on).
- **instance.\***: owned **individuals** that point at a type (two Nikon F2 bodies, one
  HC-110 bottle, one loaded roll).
- **process.\***: one-off **sessions** (develop, digitize, capture, edit, print, digital,
  maintenance). `process.developSession` has an ordered `steps[]` bath sequence for
  multi-step chemistry (C-41, E-6) and reusable measures.
- **artifact** (`app.graycard.artifact`): a first-class node in a workflow (RAW, negative
  strip, glass plate, print, video clip), with `parents` lineage and `producedBy`.
- **session.capture**: a shoot that links many photos.

## Workflow

- **workflow.template**: a reusable process type (forkable via `links`).
- **workflow.run**: one execution of a template (a trace).
- **workflow.stage**: one step (discriminated union).

Stage variants: capture, develop, digitize, digital, print, edit, output, **other**.
`otherStage` is an open escape hatch (`kind` + `params`) for steps outside the closed
set (coating, toning, mounting). Stages accept `inputs[]` for multi-input steps (a print
from a negative plus a mask).

**outputStage** publishes to a `publishTarget` (`service` + `ref`). `social.grain` is one
target, not hard-coded into the taxonomy.

## Scene graphs

A typed graph where node and edge *types* are data, not fixed in a lexicon, so external
ontologies (Visual Genome, WordNet, a research schema) can be expressed. Aligns with
Gray Card's internal panproto scene tier.

- **scene.ontology**: declares `nodeTypes` / `edgeTypes` with `sameAs` links;
  `schemaVersion` pins the panproto theory for migration.
- **scene.region**: a grounded region on a photo (bbox, polygon, mask, point, depth plane).
- **scene.node** / **scene.edge**: typed vertices and relations with open `attrs`.
- **scene.graph**: container binding nodes and edges to a subject (a grain photo or an
  artifact).

## Reproducible edits

- **edit.recipe**: engine-native, versioned edit graph (module DAG / history stack) that
  renders a derivative. `process.editSession` points at it via `recipe`.

## Shared conventions (`app.graycard.defs`)

- **measure**: self-describing scaled quantity `{value, unit, scale}`
  (real = value / scale). Used for graycard-native quantities (temperature, dpi, stops,
  EV). `scaledInteger` (×1e6) is for values projected into grain EXIF.
- **temporalRef**: optional `{frame, timeStartMs, timeEndMs, fps}` on regions, stages,
  and graphs so the same records can ground video without a schema fork.
- **provenance** / **fieldProvenance**: record- and field-level source and confidence.

## rule.batch

`when` is a `#comparison` (`{field, op, value, pattern, flags}`) or a recursive
`#booleanGroup` (`and` / `or` / `not`). `actions` are typed `#action` ops (`setAlt`,
`setExif`, `projectCaptureToExif`, `associateCamera`, …). Clients interpret a saved rule
the same way because the DSL is typed.

## setup (cross-network discovery)

`app.graycard.setup` is a small, public opt-in record that lists a user's setup in
network-wide Discover. Its `registry` field links to a frozen web-URL anchor
(`HYPO_REGISTRY` in `src/registry.js`). A shared backlink index (Constellation) indexes
that link in real time, so Hypo can enumerate every published setup across the network by
asking "who links to the anchor?", then read each setup straight from its author's PDS. No
Hypo backend, no indexer round-trip: publishing is discoverable the moment the write
commits, and deleting the record removes it from Discover.

See `lexicons/app/graycard/` for NSID definitions.
