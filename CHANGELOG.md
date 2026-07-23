# Changelog

Notable changes to Hypo are recorded here.

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
