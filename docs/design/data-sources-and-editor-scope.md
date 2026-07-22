# Hypo: data sources and editor scope

> Status: **proposed / planning** (2026-07-04). The backbone design decision for Hypo's metadata
> editors: **derive, don't re-enter.** Every `app.graycard.*` field has an upstream source of truth;
> an editor's job is to review / reconcile / publish that data and prompt only for what is genuinely
> novel. This doc maps each record to its source and thereby fixes Hypo's real authoring surface.
> (Legacy dir name `grain-editor/` = the app **Hypo**.)

## 1. Framing

- **The `app.graycard.*` lexicons are canonical for Gray Card**: the shared metadata model of the
  whole system, not a foreign export schema. Data has one home: the canonical record in the user's
  ATProto repo.
- **Gray Card (desktop)** is the *source of truth* for the heavy, automatically-captured provenance:
  capture metadata, the Roll→Frame→Scan shot-log, the digitize pipeline, the edit graph, the scene
  graph. It emits records as a **bundle** (`docs/bundle-format.md`).
- **Hypo** (web, no backend) is billed as **(a) a lightweight *gear-metadata* builder** and **(b) a
  more powerful *grain-gallery* editor**, integrated with the canonical lexicons. It reads the bundle,
  diffs it against the PDS, and writes with `putRecord` + `swapRecord`.
- **grain / EXIF** (`social.grain.photo`, `.exif`, `.gallery`) is the public photo layer the
  `app.graycard.*` records enrich and reference by AT-URI.

**The principle.** A field is entered **once**, at the moment it is first *known* (the file's EXIF,
the shoot's shot-log, the develop bench, the edit session, an external authority), and then flows into
its canonical record. No editor re-collects a value another surface already owns. An editor that finds
itself with an empty form asking a user to retype what the file/log/DB already knows is a design bug.

## 2. The three editor roles

Every field an editor touches falls into exactly one role:

- **Derive**: the value already exists upstream (EXIF, shot-log, pipeline, edit graph, scene graph).
  The editor **shows it, stamps its provenance, and lets the user confirm/override**: it never asks
  for it blank.
- **Reconcile**: the value is an *entity* that likely exists in an external authority or another
  user's shared catalog (a camera model, a lens, a film stock). The editor **type-aheads and links**
  (pulls fields + stores the external ID / `sameAs`). It never re-types a known thing.
- **Author**: the value is genuinely novel to this user and exists in no upstream source (a body's
  serial number, a roll's hand-label, a develop bath time, a gallery's caption). This, and only this
  - is where the editor collects fresh input.

Hypo's craft is to make the Derive/Reconcile mass nearly invisible (pre-filled, one-click-confirm) so
the user's attention lands only on the small Author surface.

## 3. Source-of-truth map

For every canonical record, where its data comes from and the editor's role.

### Catalog types (shareable, forkable)

| Record | Authoritative source | Editor role |
|---|---|---|
| `catalog.cameraType` | EXIF make/model · **Wikidata / camera-wiki.org** · the Lensfun camera list · another user's shared type (`forkedFrom`) | **Reconcile**: type-ahead to an authority/shared type, pull make/model/mount/format + `externalIds`; **Author** only a truly-unlisted body |
| `catalog.lensType` | **Lensfun lens DB** (make/model/mount) · EXIF lens · Wikidata | **Reconcile**: the desktop's lens picker already resolves this; Hypo links to the same Lensfun/Wikidata identity |
| `catalog.filmStock` | **Gray Card's film-stock preset DB** (datasheet-derived) · Wikidata film emulsions · shared type | **Reconcile**: link to the stock; brand/name/iso/process pull from the preset/authority |
| `catalog.developerType` / `paperType` / `chemistryType` | manufacturer datasheets · **shared community catalogs** · Wikidata | **Reconcile** where a shared/authority type exists; **Author** a niche/DIY product |
| `catalog.scannerType` / `scanProfile` / `lab` | Wikidata / manufacturer · shared catalogs · the user's own lab | **Reconcile** the device; **Author** a personal scan profile or a local lab |

### Instance records (owned individuals)

| Record | Source of the *type* | Source of *instance* fields | Editor role |
|---|---|---|---|
| `instance.camera` | reconciled `cameraType` | serial, shutterCount, nickname, purchasedAt. **genuinely manual** (serial/count sometimes in EXIF maker-notes) | **Author** (light) over a **Reconciled** type |
| `instance.lens` | reconciled `lensType` (Lensfun) | serial, nickname; manual | **Author** (light) over Reconcile |
| `instance.filmRoll` | reconciled `filmStock` | **Gray Card's Roll model / shot-log** already captures label, rollNumber, loaded `camera`, exposuresUsed, loaded/finishedAt, status | **Derive** from the shot-log; **Author** only stray fields (emulsion batch) |
| `instance.developer`/`chemistry`/`scanner`/`enlarger`/`storageLocation`/`labAccount`/`intermediate` | reconciled type where one exists | the user's kit - light manual | **Author** (light) + Reconcile |

### Process sessions (events)

| Record | Authoritative source | Editor role |
|---|---|---|
| `process.captureSession` | **EXIF** (picture profile, film simulation, metering, exposure comp) for digital · the **shot-log** for film intended settings | **Derive** |
| `process.digitizeSession` | **Gray Card's import/digitize pipeline** + the scan's file metadata (resolution, bit depth, color profile, format) · the negadoctor `inversionMethod` | **Derive** |
| `process.editSession` → `edit.recipe` | **Gray Card's edit** (the actual session + engine/version) | **Derive** |
| `process.developSession` (steps[] baths, chem, temp/time) | the **develop bench**: a genuine capture point (the desktop does not develop film) | **Author** (a develop-log; templatable for C-41/E-6) |
| `process.printSession` / `digitalSession` / `maintenanceSession` | the respective process | **Author** (light) |

### Photo, artifact, scene, edit, rules, grain

| Record | Authoritative source | Editor role |
|---|---|---|
| `photo.capture` (photo→camera/lens/filmRoll/frameIndex) | **Gray Card's shot-log (Roll→Frame→Scan) + EXIF**; it *projects into* `photo.exif` via the `projectCaptureToExif` rule | **Derive** |
| `photo.derivative` | Gray Card's render/export lineage | **Derive** |
| `artifact` (RAW / negative / print, `parents` + `producedBy`) | **Gray Card's pipeline/workflow** knows the lineage | **Derive** |
| `scene.ontology`/`region`/`node`/`edge`/`graph` | **Gray Card's scene-graph (panproto SG tier)** analysis | **Derive**: Hypo offers *annotation/correction*, not authoring from scratch |
| `edit.recipe` (`graph` opaque, engine, paramsHash, preset) | **Gray Card's EditBlob / edit engine** | **Derive**: opaque `graph` travels; Hypo shows a read-only summary + preset name |
| `workflow.template` / `run` / `stage` | template = **Author** (a reusable process a user designs); run = **Derive** (a trace the desktop emits) | mixed |
| `rule.batch` (typed when/actions DSL) | **user-authored** in Hypo's rule builder | **Author**: a genuine Hypo surface |
| `social.grain.gallery` (title/description) · `photo` (alt) | **user curation** | **Author**: the "powerful gallery editor" surface |
| `social.grain.photo.exif` | **projected** from `photo.capture` + file EXIF (`scaledInteger` ×1e6 per `defs#measure`) | **Derive**: never hand-typed when a capture record exists |

## 4. What this leaves as Hypo's genuine authoring surface

Strip out everything marked Derive/Reconcile and the *actual* new-input surface is small and matches
Hypo's billing:

1. **Gear catalog + instance building** : **Reconcile-first**: link to
   Wikidata/camera-wiki/Lensfun/shared types; author only the truly-unlisted item and the
   instance-specific specifics (serial, nickname, shutter count, hand-label).
2. **Grain gallery/photo curation**: titles, descriptions, alt text, ordering (the "more powerful
   gallery editor").
3. **Develop logs** (`developSession` bath sequences): the one process the desktop can't observe;
   templatable so C-41/E-6 aren't retyped per roll.
4. **Batch rules** (`rule.batch`): the typed DSL author.
5. **Workflow templates**: designing a reusable process (distinct from a run, which is emitted).

Everything else (capture, digitize, edit recipes, scene graphs, photo/gear links, EXIF,
filmRoll state) **arrives already filled** from the file, the shot-log, the pipeline, and
the edit engine. Hypo *reviews and publishes* it; it does not re-collect it.

## 5. Desktop ↔ Hypo division of labor

- **Desktop emits** (via the bundle): capture/digitize/edit sessions, `photo.capture`, `edit.recipe`,
  `artifact` lineage, `scene.*`, filmRoll state from the shot-log, and the `instance.*`/`catalog.*` it
  resolved during editing (the lens it matched in Lensfun, the film stock preset it used).
- **Hypo owns**: the Reconcile UX against external authorities + shared catalogs; light gear authoring;
  develop logs; gallery curation; batch rules; and the **review/diff/write** of everything in the
  bundle (new/changed/unchanged/conflict, `swapRecord`).
- **The seam is the bundle** (`bundle-format.md`): stable `rkey`s → idempotent re-import; AT-URI cross
  refs. Hypo never needs to re-derive what the desktop put in the bundle.

## 6. Deferred to the editor-design doc (+ the live research)

Left for `metadata-editor-design.md` (pending the metadata-editor + gear-reconciliation research):
schema/lexicon-driven form generation from the lexicons; the field-level **provenance chip** UI
(auto/manual/external/confidence) and confirm-override interaction; the **reconciliation** flow
(type-ahead → candidate → confirm → pull → store external ID) and its data sources; progressive
disclosure for the deep session/scene schemas; gap-only prompting; the develop-log templating; and the
gallery editor's power features. This spine fixes *what* each editor may collect; that doc designs
*how*.
