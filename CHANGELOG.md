# Changelog

Notable changes to Hypo are recorded here.

## [1.3.3] - 2026-08-18

### Changed

- Use Gemini's current schema-constrained response format for image analysis,
  query parsing, and semantic reranking, with current Flash model choices and
  without deprecated sampling parameters.

### Fixed

- Reject blocked, truncated, and otherwise incomplete Gemini responses before
  they can be parsed or saved, and require every returned bounding box to
  contain four numeric coordinates when it is present.
- Recover from lazy application chunks replaced during a deployment without
  resolving the failed import to `undefined`. Hypo reloads a stale application
  shell once when no edits are pending and offers a guarded reload otherwise.

## [1.3.2] - 2026-08-18

### Fixed

- Restore gallery thumbnails loaded from the local record cache by converting
  structured-cloned blob references back to canonical AT Protocol blob JSON.
- Validate every Grain gallery, item, photo, and EXIF create or update before
  it reaches the PDS, including durable outbox operations created by an older
  session.
- Reject non-image, oversized, malformed, or incomplete Grain photo records
  and keep browser-created uploads within Grain's 1 MB image limit.

## [1.3.1] - 2026-08-18

### Fixed

- Preserve canonical Grain photo blob references when creating or replacing an
  image and when editing photo metadata, preventing the source blob from
  becoming unreferenced and eligible for PDS garbage collection.
- Normalize queued blob references before every PDS write and reject malformed
  CID links instead of publishing a corrupt photo record.

### Recovery

- No metadata migration is required. Images whose source blobs were already
  garbage-collected cannot be restored automatically and must be re-uploaded
  from the original files.

## [1.3.0] - 2026-08-16

### Added

- Import one or more `.frames` files, map them to existing rolls, and match
  cameras and lenses through catalog names, alternative names, and serial
  numbers.
- Infer an unrestricted number of shoot proposals from frame timestamps and
  optional location changes, with sensitivity controls and review actions to
  rename, merge, or split the result before writing records.
- Filter, search, sort, summarize, and page the film-roll and shoot libraries.

### Changed

- Replace the overlapping roll **Open** and **Edit** actions with one **Manage**
  action for roll identity, lifecycle, processing history, and frames.
- Name shoot actions **Add frames** and **Edit details** to distinguish logging
  exposures from changing the capture session.
- Open development history entries in the complete process editor, including
  records entered through the earlier interface.

### Fixed

- Keep both frame-logging actions inside the mobile viewport after **Same
  frame** becomes available.
- Reconcile roll development fields and chemistry usage totals when an existing
  development session changes its rolls, chemistry, dates, or stages.
- Skip source frames already imported without creating empty duplicate shoots.
- Keep `.frames` coordinates and altitude off the PDS unless the user explicitly
  selects location publication; location may still refine shoot boundaries in
  the browser.

### Migration

- This release adds only optional exposure and development-session fields, so
  it requires no new record rewrite. `.frames` imports identify their source in
  each exposure's provenance note.
  Existing legacy development records continue through the Panproto 0.70.1
  summary-to-stage migration before editing.

## [1.2.0] - 2026-08-16

### Added

- Add an ordered development-stage editor for completed sessions, with process
  presets for black-and-white, monobath, C-41, E-6, ECN-2, and
  black-and-white reversal processing.
- Record every bath or physical operation with multiple chemical roles,
  multiple tracked chemistry instances, planned and observed time and
  temperature, optional timestamps, agitation method and schedule, working
  volume, post-use disposition, source, recipe, and notes.
- Track the last use of chemistry and update roll and session usage counts for
  every chemistry instance linked to a completed or timed development.

### Changed

- Model a development session as batch-level facts plus ordered stages instead
  of duplicating developer summaries and stop, fixer, or blix shortcuts on the
  session.
- Show stage sequences in roll processing history and recent darkroom activity.

### Fixed

- Update the selected rolls and all linked chemistry after completed
  development is logged, including development lifecycle dates and the roll's
  primary developer.
- Reject session or stage timestamps that reverse the recorded process order.
- Present photo labs as service providers with an optional account, without
  equipment-only copy, photo, datasheet, or technical-specification fields.
- Let a film roll reference the lab account that developed it directly from
  the roll form, in addition to completed lab-development logging.

### Migration

- Rewrite existing `app.graycard.process.developSession` records in place with
  Panproto 0.70.1. The migration moves legacy summary fields and shortcut baths
  into ordered stages and removes the superseded fields after a successful,
  swap-protected repository write.

## [1.1.1] - 2026-08-16

### Changed

- Cache Following activity on the device, show the saved feed immediately, and
  merge updates without rebuilding unchanged feed entries.
- Refresh known publishers before accounts that have not published Hypo or Grain
  records, ranked by record count and recency.

### Fixed

- Load scene records and image blobs through their public PDS when authenticated
  reads fail, with a final fallback to records already hydrated on the device.
- Allow tagged release gates to call the reusable CI workflow while keeping
  Pages assembly and deployment restricted to direct `main` CI runs.

## [1.1.0] - 2026-08-16

### Added

- Added completed development and scan forms that associate rolls with chemistry
  and scanners without starting a live timer or logging run.
- Added a processing history to each roll, with inspectable development and scan
  sessions.
- Added structured controls for development duration, temperature, agitation
  method, initial agitation, recurring cycles, inversions, and continuous
  agitation.

### Changed

- Preselect the current roll when development or scanning is logged from its
  detail view.
- Show chemistry, duration, and agitation for development sessions, and scanner,
  method, and resolution for scan sessions.

### Fixed

- Validate roll lifecycle chronology and agitation intervals before completed
  processing records are written.

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
[1.1.0]: https://github.com/gray-card/hypo/compare/v1.0.1...v1.1.0
[1.1.1]: https://github.com/gray-card/hypo/compare/v1.1.0...v1.1.1
[1.2.0]: https://github.com/gray-card/hypo/compare/v1.1.1...v1.2.0
[1.3.0]: https://github.com/gray-card/hypo/compare/v1.2.0...v1.3.0
[1.3.1]: https://github.com/gray-card/hypo/compare/v1.3.0...v1.3.1
[1.3.2]: https://github.com/gray-card/hypo/compare/v1.3.1...v1.3.2
