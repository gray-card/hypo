# `SettingsFeature`

Manage account access, meter calibration, private capture policy, and local diagnostics.

## Overview

SettingsFeature presents authentication and device-level controls without owning their production implementations. Calibration management combines observations into a hardware-specific profile and can publish the corresponding [`meter.calibration`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.meter.calibration) record. Diagnostics and private meter context remain opt-in and independently deletable.

## Topics

### Account and support

- `SettingsFeatureModel`
- `SettingsAuthenticationClient`
- `SettingsDiagnosticsOperation`

### Calibration

- `SettingsCalibrationSample`
- `SettingsCalibrationState`
- `SettingsCalibrationManaging`
- `DefaultSettingsCalibrationManager`
