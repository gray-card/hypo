# @hypo/web

## 1.11.0

### Minor Changes

- Separate chemistry roles into readable category chips in resource lists and status cards. Avoid duplicate role words in product labels and preserve category distinctions in selectors.
- Separate chemistry volume meters from roll-usage counts. Keep meter widths independent of labels, show both measurements when recorded, and label unknown values and reached or exceeded roll limits explicitly.
- Fix crowded photo toolbars, stretched checkbox spacing, uneven chemistry columns, and misaligned development filters and stage fields. Add screenshot audits and geometry checks across resource, roll, and session screens in both themes.
- Use shared page framing, headings, panel density, and disclosures across gallery, Library, and session screens. Align photo EXIF rows despite missing or wrapped captions, refresh coverage badges after saves, and respect both themes.
- Add a gallery contact sheet with a persistent photo inspector, compact gallery settings, selection-scoped batch controls, and shared gear overrides. Keep drafts when navigating photos and reveal invalid fields on save. Replace gallery autosaving and immediate reordering writes with explicit saving, retain pending changes after failures, and keep mobile save controls above navigation.

## 1.10.0

### Minor Changes

- 97f7555: Add reusable modular camera-scanning setups, film-processing sequences, and image-grounded print exposure plans with brush, polygon, ellipse, gradient, scene-region import, and timed dodge/burn steps. Snapshot the selected plan in development and print sessions, connect plans and scanning setups to workflow defaults and preview-first batch rules, and report broken process links and plans in Data Quality.

## 1.9.0

### Minor Changes

- 8a0a36d: Add sourced enlarger and enlarging-lens catalogues to Library, including Omega
  B-22 equipment, and use those catalogues exclusively for add-gear suggestions.

## 1.8.1

### Patch Changes

- 23aa7b3: Keep gallery uploads from using temporary record URIs, retry writes that race a concurrent outbox flush, and reopen IndexedDB connections that close before a record or schema-custody transaction starts. Never silently replace a failed browser database with a volatile queue. Report failed local queue writes instead of presenting them as saved, and give people clear next steps for common storage, sync, and conflict errors.
