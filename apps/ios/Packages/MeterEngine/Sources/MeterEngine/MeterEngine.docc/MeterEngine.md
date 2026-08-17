# `MeterEngine`

Acquire camera samples and turn them into calibrated reflected, incident, and spot readings.

## Overview

MeterEngine separates the `MeterSensor` boundary from photometric calculations. The production sensor negotiates RAW or processed capture and records fallback provenance; `SimulatedMeterDevice` replays deterministic traces through the same protocols. Calibration profiles are keyed by device, camera module, and sensor path so a correction is not applied to incompatible hardware.

Published readings use the canonical [`app.graycard.meter.reading`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.meter.reading) record. Calibration records use [`app.graycard.meter.calibration`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.meter.calibration).

> Important: Software structure does not establish measurement accuracy. A release accuracy claim requires physical-device comparison against a reference meter over the documented range.

## Topics

### Measure

- `MeterService`
- `DefaultMeterEngine`
- `Reading`
- `MeterCapture`
- `MeterConfiguration`

### Camera boundary

- `MeterSensor`
- `MeterFrameCapturing`
- `SimulatedMeterDevice`
- `FrameCaptureNegotiator`
- `CapturedFrameProvenance`

### Calibrate

- `CalibrationIdentity`
- `CalibrationObservation`
- `CalibrationProfile`
- `CalibrationBuilder`
