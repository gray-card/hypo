---
title: Measures and EXIF projection
description: Why app.graycard quantities carry units while Grain EXIF uses fixed-scale integers.
---

# Measures and EXIF projection

Hypo interoperates with two numeric conventions. Treating them as one would either discard units or change Grain's established record shape.

## Shared-model measures

`app.graycard.defs#measure` is a self-describing quantity:

```json
{ "value": 205, "unit": "celsius", "scale": 10 }
```

The real value is `value / scale`, so this object represents 20.5 °C. `scale` defaults to `1`. Units such as `celsius`, `dpi`, `stop`, `ev`, `mm`, `second`, and `ml` travel with the integer.

This is the native form for quantities whose interpretation depends on a physical unit. A consumer can reject or convert an unfamiliar unit rather than guessing.

## EXIF fixed-point values

`social.grain.photo.exif` stores numeric values as integers scaled by 1,000,000. Hypo follows that contract when editing Grain EXIF. Thus:

```text
f/2.8       → 2800000
ISO 400     → 400000000
35 mm       → 35000000
1/125 s     → 8000
```

The unit is implied by the EXIF field. `app.graycard.defs#scaledInteger` exists for fields in the shared model that intentionally project into this convention, such as catalog focal lengths and apertures.

## Projection, not equivalence

When owned gear is linked to a photo, `projectCaptureToExif` may fill Grain make, model, lens, focal length, maximum aperture, and film ISO. It converts catalog values into the target EXIF form and, by default, writes only empty fields.

This projection is lossy. An EXIF model string cannot identify which of two owned bodies made the frame, and a bare scaled integer does not state a general unit. The `app.graycard.photo.capture` record therefore remains the structured link to instances, while Grain EXIF remains the interoperable photo-metadata view.

Use `measure` for new `app.graycard.*` physical quantities. Use fixed-scale integers only where the lexicon declares that convention or where a value is being projected into Grain EXIF.
