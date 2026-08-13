# Hypo: data sources and editor scope

> Status: **proposed / planning** (2026-07-04). The main design decision for Hypo's metadata
> editors is **derive, don't re-enter**. Every `app.graycard.*` field has an upstream authority;
> an editor reviews, reconciles, or publishes that data and prompts only for values that no source supplies.
> This document maps each record to its source and defines the fields that Hypo authors.
> (Legacy dir name `grain-editor/` = the app **Hypo**.)

## 1. Framing

- **The `app.graycard.*` lexicons are canonical for Gray Card**: the shared metadata model of the
  whole system, not a foreign export schema. Data has one home: the canonical record in the user's
  ATProto repo.
- **Gray Card (desktop)** is the authority for automatically captured provenance:
  capture metadata, the Roll→Frame→Scan shot-log, the digitize pipeline, the edit graph, the scene
  graph. It emits records as a **bundle** (`docs/bundle-format.md`).
- **Hypo** (web, no backend) provides **(a) a _gear-metadata_ builder** and **(b) a
  _grain-gallery_ editor** based on the canonical lexicons. It reads the bundle,
  diffs it against the PDS, and writes with `putRecord` + `swapRecord`.
- **grain / EXIF** (`social.grain.photo`, `.exif`, `.gallery`) is the public photo layer the
  `app.graycard.*` records enrich and reference by AT-URI.

**The principle.** A field is entered **once**, at the moment it is first _known_ (the file's EXIF,
the shoot's shot-log, the develop bench, the edit session, an external authority), and then flows into
its canonical record. No editor re-collects a value another surface already owns. An editor that finds
itself with an empty form asking a user to retype what the file/log/DB already knows is a design bug.

## 2. The three editor roles

Every field an editor touches falls into exactly one role:

- **Derive**: the value already exists upstream (EXIF, shot-log, pipeline, edit graph, scene graph).
  The editor **shows it, stamps its provenance, and lets the user confirm/override**: it never asks
  for it blank.
- **Reconcile**: the value is an _entity_ that likely exists in an external authority or another
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

| Record                                        | Authoritative source                                                                                                   | Editor role                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog.cameraType`                          | EXIF make/model · **Wikidata / camera-wiki.org** · the Lensfun camera list · another user's shared type (`forkedFrom`) | **Reconcile**: type-ahead to an authority/shared type, pull make/model/mount/format + `externalIds`; **Author** only a truly-unlisted body |
| `catalog.lensType`                            | **Lensfun lens DB** (make/model/mount) · EXIF lens · Wikidata                                                          | **Reconcile**: the desktop's lens picker already resolves this; Hypo links to the same Lensfun/Wikidata identity                           |
| `catalog.filmStock`                           | **Gray Card's film-stock preset DB** (datasheet-derived) · Wikidata film emulsions · shared type                       | **Reconcile**: link to the stock; brand/name/iso/process pull from the preset/authority                                                    |
| `catalog.chemistryType` / `paperType`         | manufacturer datasheets · **shared community catalogs** · Wikidata                                                     | **Reconcile** where a shared/authority type exists; **Author** a niche/DIY product                                                         |
| `catalog.scannerType` / `scanProfile` / `lab` | Wikidata / manufacturer · shared catalogs · the user's own lab                                                         | **Reconcile** the device; **Author** a personal scan profile or a local lab                                                                |

### Instance records (owned individuals)

| Record                                                                                  | Source of the _type_             | Source of _instance_ fields                                                                                                         | Editor role                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `instance.camera`                                                                       | reconciled `cameraType`          | serial, shutterCount, nickname, purchasedAt. **genuinely manual** (serial/count sometimes in EXIF maker-notes)                      | **Author** (light) over a **Reconciled** type                               |
| `instance.lens`                                                                         | reconciled `lensType` (Lensfun)  | serial, nickname; manual                                                                                                            | **Author** (light) over Reconcile                                           |
| `instance.filmRoll`                                                                     | reconciled `filmStock`           | **Gray Card's Roll model / shot-log** already captures label, rollNumber, loaded `camera`, exposuresUsed, loaded/finishedAt, status | **Derive** from the shot-log; **Author** only stray fields (emulsion batch) |
| `instance.chemistry`/`scanner`/`enlarger`/`storageLocation`/`labAccount`/`intermediate` | reconciled type where one exists | the user's kit - light manual                                                                                                       | **Author** (light) + Reconcile                                              |

### Process sessions (events)

| Record                                                          | Authoritative source                                                                                                                                  | Editor role                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `session.capture`                                               | **EXIF** and the **shot-log** for the gear, rolls, locations, and exposures gathered into a shoot                                                     | **Derive**                                           |
| `process.digitizeSession`                                       | **Gray Card's import/digitize pipeline** + the scan's file metadata (resolution, bit depth, color profile, format) · the negadoctor `inversionMethod` | **Derive**                                           |
| `process.editSession` → `edit.recipe`                           | **Gray Card's edit** (the actual session + engine/version)                                                                                            | **Derive**                                           |
| `process.developSession` (steps[] baths, chem, temp/time)       | the **develop bench**: a genuine capture point (the desktop does not develop film)                                                                    | **Author** (a develop-log; templatable for C-41/E-6) |
| `process.printSession` / `renderSession` / `maintenanceSession` | the respective print, render/export, or maintenance event                                                                                             | **Author** (light)                                   |

### Photographic-chemistry model

Photographic chemistry uses one catalog record type because the durable product facts are shared across
roles: form, dilution and mixing instructions, capacity, shelf life, temperature range, safety documents,
and disposal guidance. Manufacturer literature likewise presents developers, stop baths, fixers, washing
aids, and drying aids under one chemistry matrix. Role-specific processing facts remain on recipes and
session bath steps instead of producing nearly duplicate product lexicons.

`catalog.chemistryType.roles` is a required array of atomic bath functions. Thus a conventional black-and-
white film developer has `["film-developer"]`; a monobath has `["film-developer", "fixer"]`; and a blix has
`["bleach", "fixer"]`. `monobath` and `blix` may still appear in product names or process terminology, but
they are not roles. This distinction follows the actual behavior of a monobath, whose fixing action occurs
during development, rather than treating the trade term as a new chemical class.

Packaging and process topology are separate dimensions:

- `productKind` distinguishes a single chemical, a multi-part chemical, and a process kit.
- `kitBathSequence[]` describes the ordered baths in a kit; each bath also has `roles[]`, so one kit step can
  be a combined bleach/fix bath.
- `instance.chemistry` represents an owned concentrate, working solution, or separately tracked kit bath.
  `componentName` identifies the component, while each instance keeps its own optional mixed, replenished,
  exhausted, and discarded dates.

This model is based on the role groupings in the [Kodak black-and-white chemical
matrix](https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/chemistry/E103CF_0.pdf), the
film/paper and monobath descriptions in [ILFORD's Kentmere chemistry
instructions](https://www.ilfordphoto.com/kentmere-photo-chemicals-instructions/), and CineStill's description
of [Df96 as one solution that fixes during
development](https://help.cinestillfilm.com/hc/en-us/articles/360028875192-What-is-a-Monobath).

### Photo, artifact, scene, edit, rules, grain

| Record                                                        | Authoritative source                                                                                                   | Editor role                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `photo.capture` (photo→camera/lens/filmRoll/frameIndex)       | **Gray Card's shot-log (Roll→Frame→Scan) + EXIF**; it _projects into_ `photo.exif` via the `projectCaptureToExif` rule | **Derive**                                                                       |
| `artifact` (RAW / negative / print, `parents` + `producedBy`) | **Gray Card's pipeline/workflow** knows the lineage                                                                    | **Derive**                                                                       |
| `scene.ontology`/`region`/`node`/`edge`/`graph`               | **Gray Card's scene-graph (panproto SG tier)** analysis                                                                | **Derive**: Hypo offers _annotation/correction_, not authoring from scratch      |
| `edit.recipe` (`graph` opaque, engine, paramsHash, preset)    | **Gray Card's EditBlob / edit engine**                                                                                 | **Derive**: opaque `graph` travels; Hypo shows a read-only summary + preset name |
| `workflow.template` / `run` / `stage`                         | template = **Author** (a reusable process a user designs); run = **Derive** (a trace the desktop emits)                | mixed                                                                            |
| `rule.batch` (typed when/actions DSL)                         | **user-authored** in Hypo's rule builder                                                                               | **Author**: a genuine Hypo surface                                               |
| `social.grain.gallery` (title/description) · `photo` (alt)    | **user curation**                                                                                                      | **Author**: gallery and photo metadata                                           |
| `social.grain.photo.exif`                                     | **projected** from `photo.capture` + file EXIF (`scaledInteger` ×1e6 per `defs#measure`)                               | **Derive**: never hand-typed when a capture record exists                        |

## 4. What this leaves as Hypo's genuine authoring surface

Strip out everything marked Derive/Reconcile and the _actual_ new-input surface is small and matches
Hypo's billing:

1. **Gear catalog + instance building** : **Reconcile-first**: link to
   Wikidata/camera-wiki/Lensfun/shared types; author only the truly-unlisted item and the
   instance-specific specifics (serial, nickname, shutter count, hand-label).
2. **Grain gallery/photo curation**: titles, descriptions, alt text, and ordering.
3. **Develop logs** (`developSession` bath sequences): the one process the desktop can't observe;
   templatable so C-41/E-6 aren't retyped per roll.
4. **Batch rules** (`rule.batch`): the typed DSL author.
5. **Workflow templates**: designing a reusable process (distinct from a run, which is emitted).

Everything else (capture, digitize, edit recipes, scene graphs, photo/gear links, EXIF,
filmRoll state) **arrives already filled** from the file, the shot-log, the pipeline, and
the edit engine. Hypo _reviews and publishes_ it; it does not re-collect it.

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
gallery editor's power features. This spine fixes _what_ each editor may collect; that doc designs
_how_.
