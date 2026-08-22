---
title: Use the meter
description: Measure reflected or incident light and keep the measurement path with the reading.
---

# Use the meter

Open **Meter**, choose **Reflected**, **Spot**, or **Incident**, and select **Measure**. A reading reports EV at ISO 100, the camera module, its accuracy tier, and any measurement warnings.

The **sensor path** describes how the phone produced the reading. An auto-exposure metadata reading is not labeled as a characterized RAW spot reading. A reflected reading without a matching calibration is marked **Unknown**; a phone-only incident estimate is marked **Approximate**. These labels are part of the saved reading rather than display-only warnings.

## What a meter record can hold

The `app.graycard.meter.reading` Lexicon has 42 top-level field groups. It can describe reflected, spot, incident, cine, flash, filter-compensated, reciprocity-corrected, averaged, and Zone System readings. It can also carry color temperature, tint, preview and exposure links, notes, provenance, and a precise public location.

The Hypo iPhone app writes a strict public projection of that larger model. It includes the photographic measurement and the facts needed to interpret it: geometry and light kind; meter and calibration references; sensor path and camera module; EV, illuminance or luminance, and calibration constant; requested and achieved spot geometry; ISO, aperture, and shutter solution; reading role and average membership; accuracy flags; timestamps; and provenance. It publishes the iPhone hardware-model identifier and camera name or module through the reading provenance or referenced phone-meter record, but not the phone's precise location, attitude, motion, magnetic-field values, or AVFoundation camera unique ID.

This gives one reading two possible data paths:

- **Public photographic projection → your AT Protocol PDS**
- **Private sensor context → encrypted storage on this iPhone ↔ your private iCloud database**

The private branch is optional and does not change the public projection.

## Keep private measurement context

Open **Private context** in the meter's configuration panel to choose what Hypo keeps outside the public record.

**Keep private device context** records the device model, operating-system and app versions, device orientation, camera identifier and field of view, lens position, attitude and quaternion, gravity, acceleration, rotation rate, and magnetic-field reading for the primary saved capture. It is off by default. When a saved result is an average, its constituent public readings do not each receive a separate private context.

**Include precise location** is a separate opt-in. It adds coordinates, altitude, accuracy, speed, course, floor, location-source flags, and heading to the encrypted private context. It never adds them to the public meter reading. Private collection runs after the public record is accepted, so location or iCloud delays do not hold the meter's save confirmation open.

**Sync encrypted context with iCloud** stores AES-GCM ciphertext in your private CloudKit database. The data key is stored as a synchronizable Keychain item. Another device using the same Apple Account can read the context after iCloud Keychain is enabled and the key has synchronized. You can also prepare a JSON export or delete stored context from this panel. See [Privacy and operating limits](./privacy-and-limits.md) before exporting private data.

## Hold and compare readings

Select **Hold** to keep the current value. The meter keeps up to nine readings so you can compare separate shadow, midtone, and highlight observations. Held readings remain on the device after relaunch.

Select **Use** beside a held reading to send the bank to Logger with that reading marked preferred, or remove readings that do not belong to the current scene. The main **Use in Logger** button sends the bank with the current live reading marked preferred.

## Spot readings

Spot mode captures a bounded camera frame after auto-exposure settles. Hypo requests RAW when the selected camera supports it and records a processed-frame fallback when it does not. The reading reports both the requested and achieved angle, along with clipping, saturation, flare-risk, and fallback warnings. This path remains **Approximate** until its camera module has been characterized on a physical device.

After the first spot reading, **Spot analysis** compares the current spot with held
spots. It reports the average EV, each reading's difference from that average, each
reading's difference from a selected reference, and the darkest-to-brightest range.
The average is computed in linear light rather than by taking an arithmetic mean of
EV numbers.

Select any spot as the reference, then choose Zone 0 through Zone X on the ruler.
Hypo shows where the other spots fall relative to that placement and the camera EV
for the selected placement. A result outside the ruler is reported as above Zone X
or below Zone 0 rather than clamped. **Use spot bank in Logger** sends every spot in
the analysis with the reference reading marked preferred. The analysis does not
rewrite the independent public meter records.

## Calibration

Calibration profiles record the device model and are matched by camera module and sensor path. A one-point comparison against a reference meter can correct a constant offset. It does not characterize flare, response across the full EV range, or a physical incident-light diffuser.

Use meter results as photographic exposure guidance. Device-dependent accuracy limits are also described under [Privacy and operating limits](./privacy-and-limits.md).
