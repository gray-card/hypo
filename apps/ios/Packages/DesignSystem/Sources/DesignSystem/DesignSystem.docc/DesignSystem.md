# `DesignSystem`

Build Hypo interfaces from its instrument-panel visual and interaction primitives.

## Overview

DesignSystem defines the shared color, type, spacing, exposure-control, haptic, and error-presentation vocabulary used by the iPhone app. Controls retain usable touch targets and accessibility descriptions across standard and darkroom appearances.

### Component gallery

`HypoComponentGallery` provides account-free reference scenes for the standard and
darkroom appearances at standard and accessibility text sizes. The snapshot executable
emits an exact SVG reference and a PNG rendered by the active Apple toolchain for each scene.

```sh
swift run --package-path apps/ios/Packages/DesignSystem \
  generate-design-system-snapshots --output /tmp/hypo-design-system-gallery
```

CI runs the same command and uploads the scene pairs with stable reference fingerprints.
The PNGs show the selected Xcode version's rendering. Exact checks use the vector references
so font-rasterization changes do not produce false failures.

## Topics

### Appearance and structure

- ``HypoTheme``
- ``HypoAppearance``
- ``InstrumentPanel``
- ``HypoPrimaryButtonStyle``
- ``HypoSecondaryButtonStyle``
- ``HypoComponentGallery``

### Exposure controls

- ``ApertureDial``
- ``ShutterSpeedDial``
- ``ISODial``
- ``EVCompensationDial``
- ``ExposureNeedle``

### Feedback

- ``HypoError``
- ``HypoErrorPresenter``
- ``HypoHapticCue``
