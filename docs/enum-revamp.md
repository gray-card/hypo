# Enum revamp: coverage, one level of analysis, custom values

A review of every controlled vocabulary in the lexicons. Three goals: **full coverage**
of the concept, **one level of analysis** per enum (each option answers the same
question), and letting users enter **their own value** rather than settling for "other".

Note on the data model: in atproto, `knownValues` is an *open* list: a record may
carry any string, so widening a vocabulary or letting a user type a custom value is
non-breaking. The only work is (a) curating the suggested values and (b) a UI that
offers "Other…" → free text. Existing records with custom values round-trip.

## Level-of-analysis fixes (options that answered a different question)

- **filmProcess** contained `ra4`: RA-4 is a colour *paper/print* process, not a film
  development process. Removed from film process; it already lives in `printProcess`.
- **filmType** contained `motion-picture`: that's a use/format axis, not a
  tone×polarity. A motion-picture stock is really a colour-negative (ECN-2) or
  B&W-negative whose *process* is `ecn2`/`bw`. Removed; affected presets reclassified.
- **surface** (paper) mixed `fiber` (a paper *base*) with `glossy/matte/pearl` (a
  *finish*). Split into a new **base** field (fiber / resin-coated / baryta) and a
  finish-only **surface**.
- **cassetteType** contained `sheet-holder`: sheet film has no cassette. Removed;
  added the housings that actually exist (reloadable metal/plastic, 120 spool, bulk).
- **process** / **tankType** were duplicated across `developSession` and `devRecipe`
  with *different* value sets. Unified to one list each.

## Coverage additions (same level, more complete)

- **format**: was a mix of a few film formats, frame sizes, instant, cine and digital
  sensors. Rebuilt as one axis, "the physical format of the recorded frame," grouped:
  roll (135, half-frame, 120, 220, 127, 126, 110, 620, 828, 70mm, APS/IX240, 16mm
  still, Minox, disc), sheet (4x5, 5x7, 8x10, 9x12cm, 13x18cm, 6.5x9cm, 11x14,
  ultra-large), instant (Instax mini/square/wide, Polaroid i-Type/600/SX-70/Spectra,
  peel-apart, instant 8x10), cine (Super 8, Regular 8, 16mm, 35mm, 65mm), digital
  sensor (full-frame, APS-C, APS-H, medium format, Micro Four Thirds, 1-inch, Foveon).
- **filmType**: added `chromogenic-bw` (C-41-process B&W such as XP2 / BW400CN).
- **storage**: added `cool-dark`, `dry-cabinet`, `other` (was only room/fridge/freezer).
- **rollStatus**: added `developing` and `scanned` (the board now has those columns).
- **chemistryRole**: added `pre-soak`, `reversal-bath`, `wash-aid`, `hardener`,
  `final-rinse` (needed for C-41/E-6 and archival B&W chains).
- **printProcess**: added `kallitype`, `bromoil`, `albumen`, `wet-plate-collodion`,
  `dye-transfer`, `dye-destruction` (Cibachrome), `photogravure`, `lith`,
  `dye-sublimation`.
- **filterKind**: added `nd-variable`, `ir-pass`, `ir-cut`, `uv-pass`, `gradient-color`,
  `split-diopter`, `soft-focus`, `center-spot`, `mist`, `prism`, `night`, `didymium`.
- **exposureProgram**: added the remaining EXIF programs: `creative`, `action`,
  `portrait`, `landscape`.
- **meteringMode**: added `unknown`.
- **scannerKind**: added `smartphone`.

## Deliberate non-changes

- **cameraCategory** keeps `motion-picture`. Although "motion vs still" is technically a
  separate axis from "film vs digital", *motion-picture camera* is a well-understood
  top-level category and splitting it into a flag would churn the data for little gain.
- **Rule / scene / provenance enums** (`op`, `operator`, `mode`, `scope`, `source`,
  `confidence`, `regionKind`, `artifactKind`, `engine`, `scheme`) are internal and were
  found internally consistent; left as-is.

## Custom values

Both gear-form and process-form enum selectors gain an **"Other (type your own)…"**
option that reveals a text field; the typed value is written verbatim. Any record whose
stored value isn't in the suggested list is shown as a custom value and preserved on
save. This applies to every domain enum listed above (format, film type, process, form,
role, scanner kind, surface, base, storage, filter kind, print process, cassette type,
mount, camera category, metering mode, exposure program).
