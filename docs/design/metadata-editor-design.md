# Hypo: metadata editor design

> Status: **proposed / planning** (2026-07-04). Companion to `data-sources-and-editor-scope.md`: that
> doc fixes *what* each editor may collect (Derive / Reconcile / Author); this one designs *how*. The
> field model, the reconciliation engine, and the diff/write flow. Synthesized from two research
> passes (schema-driven metadata editors; gear entity-reconciliation). Sources are cited inline.

## 0. One sentence

Every Hypo form **opens already filled**: from the bundle, the file's EXIF, the lens/film databases,
and other records, with each field wearing a **provenance chip**; the user *reviews and confirms* a
mostly-derived record and actively types only the small **residue** no source could supply, while gear
is **reconciled** (linked to an authority) rather than retyped.

## 1. The universal field model: derive by default

On load, Hypo runs a **derivation pass** before rendering: pull each field from its highest-precedence
source, then render the form with fields pre-filled. This inverts the usual "empty form" default. The
NN/g **EAS** framework's "Eliminate + Automate" (don't ask what you can derive) made the resting state.
[nngroup.com/articles/eas-framework-simplify-forms]

Every field carries one of **three visual tiers** (from Horvitz's mixed-initiative confidence-scoping:
act autonomously only in proportion to confidence, keep a cheap safety net):
[erichorvitz.com/chi99horvitz.pdf]

- **Derived-confident**: quiet, pre-accepted, collapsible. (e.g. capture time from EXIF.)
- **Derived-uncertain**: surfaced with a glanceable badge + a one-click **Confirm**. (e.g. a lens
  matched by fuzzy name.)
- **Author**: the only tier that actively demands input; the residue.

**Gap-only prompting** is the operational rule: the prompted set = `required − derivable`. Everything
derivable is shown-and-confirmable, never blank-and-asked. NN/g's caution is load-bearing here: users
*stop re-checking* prefilled values, so **confidence display + trivially-easy override are not polish,
they are what keep derived data trustworthy**. [nngroup.com/articles/eas-framework-simplify-forms]

## 2. Field-level provenance

**Model**: adopt a PROV-style stamp per field: the value `wasDerivedFrom` a source,
`wasAttributedTo` an engine/human, with a confidence. [w3.org/TR/prov-o] PROV supports attribute-level
granularity, which is exactly Hypo's need. The lexicons already carry `app.graycard.defs#provenance`
and `#fieldProvenance`: Hypo renders and writes those; **no schema change needed** for the core model.

**UI**: a compact **source + confidence chip** next to the field (source ∈ {EXIF, bundle, lens-DB,
film-DB, edit-graph, authority, manual}), styled by tier (§1), with confirm/override. Visual precedent:
OpenRefine renders a confident match as a **solid link** and an uncertain one as a **lighter link with
a score**: copy that weight-by-confidence idiom. [openrefine.org/docs/manual/reconciling]

**Per-field source precedence (MWG-style, no single universal winner).** The Metadata Working Group's
image-metadata guidelines establish that reconciliation is **property-specific**, not one global rule.
[MWG guidance; exiftool.org/TagNames/MWG] Hypo needs its own table; a starting cut:

| Field | Precedence (first wins) |
|---|---|
| capture time | EXIF · bundle `photo.capture` · manual |
| camera / lens (which body/glass) | bundle shot-log · EXIF make/model/lens · lens-DB match · manual |
| exposure / aperture / ISO | EXIF · bundle capture · manual |
| film stock / roll state | bundle shot-log (Roll model) · manual |
| digitize settings | bundle `digitizeSession` · scan-file metadata · manual |
| edit parameters | edit-graph (`edit.recipe`) **only**: never hand-typed |
| gear *type* identity | reconciled authority ID · shared network type · manual |

State this table in-repo; it removes ambiguity from the diff and defines which chip a field shows.

## 3. Schema-driven forms from the lexicon

An ATProto **Lexicon is JSON-Schema-shaped**, and `@atproto/lex-cli` already codegens types from it
 -  so the *same* lexicon can drive the form. [atproto.com/guides/lexicon] But a schema says *what*, not
*how to render*: every mature generator (RJSF's `uiSchema`, JSON Forms' UI schema, SHACL-UI's
`dash:editor`) adds a **presentation layer**. Hypo keeps a **UI-hint map keyed to lexicon paths**
(widget, order, group, disclosure). [react-jsonschema-form; datashapes.org/forms.html; w3.org/TR/shacl12-ui]

Concrete rules to adopt:
- **Widget by type**, DASH-style: string→text, long string→textarea, datetime→picker, `measure`→a
  value+unit control, an `at-uri` ref→the reconciler/record-picker (§4), a blob→image upload.
  [datashapes.org/forms.html]
- **Open `knownValues` enums** (the ATProto idiom - `cassetteType`, `inversionMethod`, `rollStatus`,
  the workflow stage kinds) render as a **combobox that suggests the known values but accepts free
  text**; never a hard-restricted dropdown. This respects the open-by-design semantics.
  [github.com/bluesky-social/atproto/discussions/3116]
- **Cardinality-driven affordances**: required from the lexicon `required[]`; a max-one field gets no
  "add" button; arrays (`steps[]`, scene nodes) get add/remove.
- **Progressive disclosure** for the deep records (sessions, scene graphs): show the common fields;
  reveal the rest behind a details toggle; nested ref records render as an expandable sub-card (DASH
  `sh:node` + DetailsViewer), edited **in place**, not via a modal round-trip. [nngroup progressive
  disclosure; datashapes.org/forms.html]
- **Pitfall to avoid (RJSF-documented):** do **not** regenerate the schema object mid-edit for
  union/discriminator switches. React treats it as a new form and inputs lose focus / reset. Keep the
  form model stable and swap only the affected sub-tree. [dev.to/surveyjs - react-json-schema-forms-in-practice]

The nearest existing system to study as a whole (schema-driven form, provenance, change tracking) is
**HERITRACE** (a SHACL-driven RDF curation tool). There is *no* mature general lexicon-driven record
editor to copy, so Hypo is adapting adjacent patterns, not cloning an ATProto exemplar. [arxiv.org/pdf/2605.01941]

## 4. The reconciliation engine (gear builder)

The gear catalog editor is a **reconciler**, not a form: the user types a camera/lens/film and Hypo
**links to an existing entity** instead of creating a duplicate. Adopt the **Reconciliation Service
API** as the *internal contract* and make each source an **adapter** behind it. [reconciliation-api.github.io/specs]

**The loop** (search → candidates → confirm → pull → store-ID), one interface:
1. **Suggest / typeahead**: as the user types, query adapters in order: **(a) the network catalog**
   (other users' shared `catalog.*` types), **(b) Wikidata** (`wbsearchentities`), **(c) Getty AAT**,
   **(d) Lensfun** (for bodies/lenses). Narrow by known properties (reconcile "50mm" *as a lens*,
   manufacturer=Nikon) to raise precision. [reconciliation-api spec §reconcile; mediawiki wbsearchentities]
2. **Candidate cards**: ranked, each with score + thumbnail + a **preview card** and **its source +
   license label**, grouped by source. [openrefine reconciling]
3. **Confirm** → **data-extension** (`/extend`) pulls the selected display fields, and Hypo **stores
   the external ID** (namespaced: `wikidata:Q…`, `getty-aat:…`, `lensfun:…`, `camera-wiki:<slug>`) in
   the record's `externalIds`. Prefer **ID-based linking over name matching**: Wikidata's own rule:
   a unique external ID scores 100, fuzzy names fall back below. [wikidata.reconci.link]
4. **Create is the fallback**: a "+ Create '<input>'" option appears only at the end of the candidate
   list; on save, re-run a duplicate check against the network + authorities and offer *"Did you mean
   <X>? Link instead"* before committing. [drupal inline_entity_form search-before-create]

**External sources + licensing discipline** (record the source + license of every pulled field):

| Source | Use | License |
|---|---|---|
| **Wikidata** | primary reconcile + field + stock image (P18) for cameras/lenses/some films | **CC0**: pull freely |
| **Getty AAT** | reconcile *type/material* vocab (processes, apparatus, chemistry) | **ODC-By**: attribute |
| **Lensfun** | structured lens/camera identity + mount graph (the desktop already resolves this) | **CC BY-SA 3.0**: attribute; share-alike on re-published derived types |
| **camera-wiki.org** | `sameAs` link + attribution for analog gear Wikidata lacks | **GFDL**: link only, don't scrape fields |
| **film datasheets / Filmtypes / EMULSIVE / spektrafilm** | datasheet URL + `sameAs` | manufacturer PDFs **copyrighted**: link, don't embed |

**Embed only CC0/openly-licensed images**; link (never embed) GFDL/copyrighted material; surface
attribution in the UI where CC-BY / ODC-By / GFDL sources contributed. The lexicons already have the
slot: `catalog.*` records carry `links.externalIds`.

## 5. Type → instance inheritance

The type/instance split the lexicons already model (an `instance.camera` points at a `catalog.cameraType`
by AT-URI) is the PIM **product-type template + attribute inheritance** pattern.
[commercetools product-types; atropim overrides]

- The instance stores a **strongRef to its type (AT-URI + CID)** and **displays the type's fields
  read-through**; it does not restate them.
- Any instance field may **override** its inherited value, stored as a **delta** only (serial, shutter
  count, nickname, condition, purchase, and for a loaded roll: EI shot, frame count, expiry, batch).
  These are the *only* fields the instance form authors.
- Because the type ref is **CID-pinned**, the instance can detect "type updated since link" and offer
  to **re-pin**: provenance stays honest. This matches ATProto's strongRef (AT-URI + CID) semantics.
  [atproto.com/specs/at-uri-scheme]

## 6. Forkable community catalogs

Catalog `types` are shareable and forkable across repos. Get the link semantics right. This is a
contract decision on `app.graycard.defs#catalogLinks`:

- **`sameAs`**: use **`owl:sameAs`** *only* for genuine identity (two repos' records that are literally
  the same camera type); overuse is a known anti-pattern. For links to an *external authority* use
  **`skos:exactMatch`** (transitive, high-confidence) or **`skos:closeMatch`** (similar-enough).
  [w3.org/TR/skos-reference; arxiv.org/pdf/1907.10528 the sameAs problem]
- **Carry provenance on every link, not a bare pointer**: SSSOM-style `{predicate, confidence,
  source, method(human|auto)}`. This is a small, worthwhile **lexicon addition** to `catalogLinks`
  (today it has `sameAs`/`forkedFrom`/`externalIds` but no per-link confidence/predicate). [mapping-commons.github.io/sssom]
- **`forkedFrom`** = a **strongRef (AT-URI + CID)** to the source type, pinning the exact version forked.
- **Dedup = merge-and-redirect, never delete**: the MusicBrainz/iNaturalist model: a merge picks a
  target whose fields win, and old references **redirect** rather than 404. [musicbrainz.org/doc/Merge;
  inaturalist taxon changes] Consider **curated "canonical" type tiers** (iNaturalist Taxon Frameworks)
  so a trusted community type outranks ad-hoc forks in typeahead.

## 7. The diff / write review

Hypo already diffs the bundle against the PDS into **new / changed / unchanged / conflict**; ground it
in **three-way merge** (bundle / common-ancestor / current-PDS) with status-colored review.
[git 3-way merge; vscode merge editor; gitkraken]

- **Default action = "Accept all non-conflicting"** (create + clean updates in one click); **quarantine
  only true conflicts** for per-item human decision. [openrefine bulk match]
- **Write with `swapRecord`** carrying the expected CID (ATProto's compare-and-swap). On CAS failure,
  **re-fetch, re-diff against the now-current PDS state, and re-present the conflict**: never a silent
  retry-clobber. [docs.bsky.app put-record]
- Show old→new **inline**, keyboard-navigable.
- **History**: the PDS keeps only the current version. If edit history / PROV chains must survive
  server-side, materialize versions as copy-on-write records with back-references, and design around
  its limits (race conditions, no cross-record transactions). Otherwise treat the desktop's bundle +
  `edit.recipe` history as the durable trail. [verdverm record-editing-with-history]

## 8. Templates & inheritance (fatigue control)

The universal move across Photo Mechanic (Stationery Pad), Lightroom (presets/Sync), Tropy/Omeka/
CollectiveAccess (templates): **set shared values once at the parent (roll / session) and inherit down
to frames, override the exceptions.** [camerabits stationery pad; helpx lightroom metadata; tropy] For
Hypo this rides the record graph: a roll or capture session holds shared values; per-frame `photo.capture`
records inherit and override: the same delta-only pattern as §5. This directly serves the Roll Baseline
consistency goal in the desktop's film QoL plan.

## 9. What this asks of the lexicons

Mostly the lexicons already support the design:
- **Provenance**: `defs#provenance` / `#fieldProvenance` already exist → the field-chip model (§2)
  needs no change.
- **External links**: `catalogLinks.externalIds` + `forkedFrom` already exist → reconciliation (§4)
  and forking (§6) have their slots.
- **Type/instance**: instance→type AT-URI refs already model inheritance (§5).
- **Measure / temporalRef**: self-describing quantities + the 🎬 video hook already exist.

Two **small additive proposals** (surface as decisions before building):
1. **Per-link provenance on `catalogLinks`**: an SSSOM-style `{predicate (owl:sameAs | skos:exactMatch
   | skos:closeMatch), confidence, source, method}` on each `sameAs` entry, so a linked identity carries
   its trust (§6). Additive; today's bare `sameAs` becomes a degenerate case.
2. **A source enum for `fieldProvenance`** aligned to the precedence table (§2): {exif, bundle, lensDb,
   filmDb, editGraph, authority, manual}, so the chip's source is a known value, not free text.

Neither blocks the editor; both make it precise.

## 10. Open questions / next

- The **UI-hint map** format (a per-lexicon-path config) - author it alongside the lexicons or in Hypo?
- The **network catalog** discovery: how Hypo finds *other users'* shared `catalog.*` types for
  typeahead (an app-view/index vs. follow-graph crawl): an ATProto-infra question.
- The **develop-log** templating (C-41/E-6 bath sequences) - the one genuine deep-authoring surface;
  design its template library.
- The **gallery editor** power features (the second billed value prop) - deserve their own short doc.
- Wiring the desktop **exporter** to emit the bundle with stable rkeys + resolved reconciliation IDs so
  Hypo inherits the links rather than re-reconciling.
