# Changelog

Notable changes to Hypo are recorded here.

## [1.0.1] - 2026-08-13

### Fixed

- Prevent automatic onboarding and the Guided setup button from opening two
  setup wizards when they are triggered at nearly the same time.

## [1.0.0] - 2026-08-13

### Added

- Structured workflow templates, runs, stages, typed inputs and outputs,
  branching, joins, and repeatable stage occurrences.
- Meter records, calibration, exposure calculations, shoots, and a mobile shot
  logger.
- Optional dated milestones for film and chemistry lifecycles, with chronology
  validation across ordered statuses.
- A Following activity feed assembled from Bluesky and Grain, separate from
  public-setup discovery.
- Offline record caching, an outbox for supported writes, and conflict recovery.
- Generated lexicon types and validators, a browser schema runtime, Panproto
  conformance fixtures, and versioned documentation at `/docs`.

### Changed

- Replaced separate developer records with photographic chemistry records whose
  `roles` array supports developers, stop baths, fixers, bleach, blix, monobaths,
  and other multi-role chemistry.
- Split the application into typed workspace packages for the domain model,
  lexicons, catalog, PDS access, schema runtime, storage, synchronization, and UI.
- Added alternative camera and lens names and use them when matching EXIF values.
- Made workflows first-class throughout setup, library, following, process, and
  mobile interfaces.
- Limited Discover to published setups; Following now names its Bluesky and
  Grain sources and explains local reindexing.
- Reworked profile filters, navigation, dialogs, buttons, and record forms for
  consistent desktop and mobile behavior.
- Consolidated derivative output under `app.graycard.artifact`, capture under
  `app.graycard.session.capture`, and digital rendering under the narrower
  `app.graycard.process.renderSession` schema.

### Fixed

- Resize and re-encode replacement images before Grain upload so oversized
  originals do not bypass the display-image path.
- Restore modal scrolling after a password-manager panel closes.
- Show every owned camera or lens model once a duplicate-copy filter is needed.
- Include film names and useful record links in Following activity entries, and
  use source-specific chip colors.
- Preserve authenticated offline sessions when a lazy onboarding chunk cannot
  load.

### Migration

- Legacy developer types and instances are transformed into chemistry records.
  Dependent references are rewritten, and the old records are deleted only in
  the same successful atomic PDS write that creates their replacements.
- This is the first stable schema baseline. Later breaking lexicon changes must
  provide reviewed Panproto transitions and conformance data.

## [0.2.0] - 2026-07-23

### Added

- Manufacturer-sourced technical specifications and document provenance for
  cameras, lenses, film stocks, developers, and processing chemistry.
- Film-specific development recipes with structured times, temperatures,
  agitation, push/pull guidance, process details, and source locations.
- Expandable technical details in the catalog, development timer, and process
  forms.
- Practice-specific guided setup for digital, home-processed film, lab-processed
  film, instant photography, hybrid scanning, and darkroom printing.
- A separate CC BY-SA 4.0 license for original catalog data and database
  compilations, while application and data-processing code remain MIT licensed.

### Changed

- Development records distinguish published recipe values from observed time
  and temperature.
- Guided setup now creates film reserves, captures useful workflow defaults,
  checks format and mount compatibility, persists progress, and supports
  recovery without duplicating workflows.

### Fixed

- Prevented internal atproto metadata from appearing as user-facing technical
  specifications.
- Treated `135` and `35mm` as equivalent still-film formats during onboarding
  compatibility checks.
- Removed stray conditional values from the guided-setup interface.

[0.2.0]: https://github.com/gray-card/hypo/compare/v0.1.0...v0.2.0
[1.0.0]: https://github.com/gray-card/hypo/compare/v0.2.0...v1.0.0
[1.0.1]: https://github.com/gray-card/hypo/compare/v1.0.0...v1.0.1
