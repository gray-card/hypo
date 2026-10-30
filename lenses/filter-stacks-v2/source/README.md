# app.graycard lexicons

The `app.graycard.*` namespace is the metadata model shared by **Hypo** and **Gray Card**.
It defines provenance, workflow, and scene-graph records used with Grain
(`social.grain.photo`, `social.grain.photo.exif`). Records live in the user's own repo
and reference Grain records by AT-URI. Hypo writes metadata from the browser. Gray Card
is a separate photo editor that reads and writes the same model.

All lexicons validate with `@atproto/lexicon` (structural checks plus record-level ref
resolution).

## Type / instance / event / artifact

- **catalog.\***: shareable, forkable **types** (camera model, film stock, photographic
  chemistry, lab, scan profile, paper, scanner). Catalog records carry
  `links` (`app.graycard.defs#catalogLinks`): `sameAs` / `forkedFrom` AT-URIs and
  `externalIds` for external ontologies (Wikidata, camera-wiki, Getty AAT, and so on).
- **instance.\***: owned **individuals** that point at a type (two Nikon F2 bodies, one
  HC-110 bottle, one loaded roll).
- **process.\***: one-off **sessions** (develop, digitize, edit, render/export, print,
  maintenance). Capture is represented by `session.capture`, not a duplicate process
  record. `process.developSession` keeps batch facts on the session and records
  each bath or physical operation in ordered `steps[]`.
- **artifact** (`app.graycard.artifact`): a first-class node in a workflow (RAW, negative
  strip, glass plate, print, video clip), with `parents` lineage and `producedBy`.
- **session.capture**: a shoot that links many photos.

## Workflow

- **workflow.template**: a reusable process type (forkable via `links`).
- **workflow.run**: one execution of a template (a trace).
- **workflow.stage**: one step (discriminated union).

Stage variants: capture, develop, digitize, digital, print, edit, output, **other**.
The `digitalStage` discriminator is retained for record compatibility, but it means a
render/export stage and links to `process.renderSession`; editing belongs in `editStage`.
`otherStage` is an open escape hatch (`kind` + `params`) for steps outside the closed
set (coating, toning, mounting). Stages accept `inputs[]` for multi-input steps (a print
from a negative plus a mask).

**outputStage** publishes to a `publishTarget` (`service` + `ref`). `social.grain` is one
target, not hard-coded into the taxonomy.

## Scene graphs

A typed graph where node and edge _types_ are data, not fixed in a lexicon, so external
ontologies (Visual Genome, WordNet, a research schema) can be expressed. Aligns with
Gray Card's internal panproto scene tier.

- **scene.ontology**: declares `nodeTypes` / `edgeTypes` with `sameAs` links;
  `schemaVersion` pins the panproto theory for migration.
- **scene.region**: a grounded region on a photo (bbox, polygon, mask, point, depth plane).
- **scene.node** / **scene.edge**: typed vertices and relations with open `attrs`.
- **scene.graph**: container binding nodes and edges to a subject (a grain photo or an
  artifact).

## Reproducible edits

- **edit.recipe**: engine-native, versioned edit graph (module DAG / history stack).
  `process.editSession` records the editing event. `process.renderSession` records a
  render/export event, while `artifact.parents` and `artifact.producedBy` carry the
  resulting file's lineage. There is no separate derivative record.

## Shared conventions (`app.graycard.defs`)

- **measure**: self-describing scaled quantity `{value, unit, scale}`
  (real = value / scale). Used for graycard-native quantities (temperature, dpi, stops,
  EV). `scaledInteger` (×1e6) is for values projected into grain EXIF.
- **temporalRef**: optional `{frame, timeStartMs, timeEndMs, fps}` on regions, stages,
  and graphs so the same records can ground video without a schema fork.
- **provenance** / **fieldProvenance**: record- and field-level source and confidence.
- **productDocument** / **specSource**: edition-aware manufacturer documents and the
  exact catalog fields, pages, or tables they support. Camera, lens, film, and
  chemistry records can expose these citations alongside their
  structured technical specifications.

Film/developer processing recommendations belong in `catalog.devRecipe`, where
the exact film, developer, EI, dilution, method, temperature/time points, and
source location can vary together. Each `process.developSession` stage carries
its roles and linked chemistry instances, recipe or source, optional dates,
agitation, volume, disposition, and planned and observed time and temperature.
Combined baths use multiple roles; multi-part baths may link multiple chemistry
instances.

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
