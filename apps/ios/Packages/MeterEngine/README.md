# MeterEngine

`MeterEngine` is Hypo's camera-meter boundary. Its public contract is sensor discovery plus
`AsyncSequence<Reading>` and one-shot capture. The core translates camera AE, illuminance,
and spot samples into calibrated EV100 readings through `PhotometryKit`; feature code does
not import AVFoundation.

Implemented here:

- wide/ultra-wide/tele/front/external camera discovery and in-context authorization;
- AVFoundation AE metadata sampling for reflected-average measurements;
- linear-light N-sample and moving-window averaging;
- per-device, camera-module, and sensor-path calibration with optional response curves;
- drift scheduling and sunny-16/handheld/known-target calibration observations;
- RAW/processed photo-output negotiation with typed DNG/JPEG/HEIF payloads, recorded still-photo
  exposure, explicit fallback provenance, and uncharacterized-frame gating;
- Bayer-cell and RGB-plane conversion hooks, circular spot-patch integration,
  bounded Core Image decoding, exposure-anchored spot estimates, angular-resolution reporting,
  processed-frame linearization, flare-risk labeling, and nine-reading spot memory;
- incident-reading primitives with flat/dome constants and explicit approximate labeling;
- deterministic `SimulatedMeterDevice` traces for simulator, previews, and CI.

## Composition-root wiring

Add `MeterEngine` to the app target, then construct either:

```swift
let engine = DefaultMeterEngine(sensor: AVFoundationMeterSensor())
```

or a `SimulatedMeterDevice` for previews. The package depends only on `PhotometryKit`.

## Device-validation boundary

The AVFoundation adapter captures an encoded RAW DNG when the active output supports it and a
processed JPEG/HEIF otherwise. A DNG that Core Image cannot render causes a second, processed
capture and an explicit `rawFallback` flag. Core Image's DNG output is a rendered-RAW path: it
does not expose native Bayer cells, black levels, or a camera color matrix. The separate
`BayerPlane` hook remains available for a future metadata-aware decoder.

Spot estimates are anchored to the still photo's EXIF exposure and integrate a circular patch in
linearized luminance. The adapter records requested and achieved angles, clipped patches, and a
conservative flare-risk warning. Both rendered-RAW and processed paths remain `approximate` in
the current adapter, even when a calibration profile is present. Physical-device characterization
is required before removing that flag. Field-of-view values come from the active video format;
photo cropping, stabilization, front-camera mirroring, and preview-to-capture coordinate transforms
still require device-specific verification. Incident measurements from a camera likewise require
a characterized diffuser. Flash metering is out of v1 scope.

Before release, run the plan's step-wedge/reference-meter lane on physical devices. The M3
exit criterion is no more than one-third stop error from EV 5 through EV 15 after calibration;
the M4 criterion applies the same threshold to the middle seven stops of the telephoto spot
path, while recording its achieved rather than nominal angle.
