# `DesignSystemSnapshotSupport`

Create stable vector references for Hypo's component-gallery scenes.

## Overview

DesignSystemSnapshotSupport renders the same scene matrix used by
`HypoComponentGallery` as deterministic SVG. The renderer uses fixed
geometry and exported design tokens, allowing CI to detect changes without comparing
platform-dependent font rasterization.

## Topics

### Reference rendering

- `ComponentGalleryReferenceRenderer`
