# `GenerateDesignSystemSnapshots`

Render review evidence for Hypo's component gallery.

## Overview

The executable writes an SVG reference, an Apple-platform PNG, and a manifest entry for
each standard, darkroom, standard-text, and accessibility-text scene. Run it from the
repository root:

```sh
swift run --package-path apps/ios/Packages/DesignSystem \
  generate-design-system-snapshots --output /tmp/hypo-design-system-gallery
```

The output contains no account or user data.
