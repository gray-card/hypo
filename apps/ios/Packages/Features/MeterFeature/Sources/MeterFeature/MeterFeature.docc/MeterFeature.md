# `MeterFeature`

Present live readings, exposure controls, spot analysis, and reading capture.

## Overview

MeterFeature projects MeterEngine samples into a field interface and writes a deliberately limited public [`meter.reading`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.meter.reading) record. Optional private context is a separate encrypted envelope: device attitude, sensor motion, camera details, and precise location are not added to the public record by default.

Private context can stay on one phone or roam as encrypted payloads through the person's private CloudKit database. The public record remains an allowlisted projection and can be shared independently.

Reflected spot readings can be held in a nine-reading bank. `MeterSpotAnalysis`
reports the linear-light average, EV differences, darkest-to-brightest range, and
Zone placements without changing the stored readings. The selected reference spot
and the rest of its bank can then be passed to Logger.

## Topics

### Meter interface

- `MeterFeatureModel`
- `MeterFeatureView`
- `MeterSpotAnalysis`
- `MeterReadingLogStoring`
- `MeterReadingSemanticWriting`

### Private capture context

- `PrivateMeterCaptureContext`
- `PrivateMeterCaptureSettings`
- `PrivateMeterCaptureContextCollecting`
- `PrivateMeterCaptureContextStoring`
- `EncryptedPrivateMeterCaptureContextStore`
