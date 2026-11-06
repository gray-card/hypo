# @hypo/domain

## 1.6.1

### Patch Changes

- 81d3b7a: Count shared gallery gear and film backs in gallery coverage badges using the same inheritance rules as the photo inspector. Preserve photo-specific overrides, including explicitly empty filter stacks.

## 1.6.0

### Minor Changes

- 97f7555: Add reusable modular camera-scanning setups, film-processing sequences, and image-grounded print exposure plans with brush, polygon, ellipse, gradient, scene-region import, and timed dodge/burn steps. Snapshot the selected plan in development and print sessions, connect plans and scanning setups to workflow defaults and preview-first batch rules, and report broken process links and plans in Data Quality.

### Patch Changes

- Updated dependencies [97f7555]
  - @hypo/lexicon@1.7.0
