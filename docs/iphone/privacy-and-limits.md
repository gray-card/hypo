---
title: Privacy and operating limits
description: What Hypo stores, which permissions it requests, and where device behavior matters.
---

# Privacy and operating limits

Hypo has no analytics SDK and does not send usage telemetry to a Hypo application server. It does, however, send data off the phone when you publish a record to your AT Protocol PDS or enable private iCloud sync. Those two destinations have different privacy boundaries.

## Public records and private context

A saved meter reading has two independent branches:

1. **Public photographic projection → AT Protocol PDS.** Hypo writes the exposure value, measurement geometry, meter and calibration references, sensor path, camera module, relevant exposure settings, spot geometry, accuracy flags, timestamps, and provenance. The public projection includes the iPhone hardware-model identifier and camera name or module through the reading provenance and referenced phone-meter record. It does not include location, motion, attitude, or the AVFoundation camera unique ID.
2. **Private sensor context → encrypted on-device storage ↔ private iCloud.** If you enable **Keep private device context**, Hypo separately records device and camera identifiers, orientation, camera details, attitude, gravity, acceleration, rotation, and magnetic-field values for the primary saved capture. An averaged capture does not create separate private contexts for each constituent public reading. Hypo encrypts the private sensor payload with AES-GCM; the envelope metadata described below remains outside the ciphertext but is cryptographically authenticated with it. The private context is never encoded into `app.graycard.meter.reading`.

The public meter Lexicon can represent a precise geographic location. That capability is useful to clients that deliberately publish location, but the Hypo iPhone writer uses a stricter allowlist and leaves the public `location` field empty.

Private context is off by default. **Include precise location** is a second opt-in and remains unavailable until private context is enabled. When selected, the private record may include coordinates, altitude, horizontal and vertical accuracy, speed, course, floor, source flags, and heading. Location remains on the private branch.

The local file uses complete file protection. Its sensor payloads are AES-GCM encrypted, while the envelope version, context ID, capture and modification times, deletion state, and key fingerprint remain visible for merging. AES-GCM associated data authenticates those fields, and Hypo verifies the decrypted ID and capture time against the envelope. Existing local version-one payloads remain readable and are rewritten in the authenticated version-two format after they are opened. A deletion performed while a key is unavailable first writes an unsigned marker so deletion cannot be blocked; Hypo replaces that marker with an authenticated one after the key becomes available during sync. If you enable **Sync encrypted context with iCloud**, CloudKit receives independently encrypted payloads together with the same merge metadata. Hypo stores the 256-bit cloud data key as a synchronizable Keychain item. Another device can open the payload after it is signed in to the same Apple Account, iCloud Keychain is enabled, and the key has synchronized. The private record retains a one-way reference to the corresponding public meter-record URI; the public record does not point back to the private context.

You can prepare a plaintext JSON export from **Meter → Private context**. Sharing that file places its contents under the receiving app's or person's custody. **Delete all private capture data** replaces local sensor payloads with deletion markers before it accesses the encryption key or contacts CloudKit. Thus local deletion remains available for a missing key or an unreadable local store. If iCloud is temporarily unavailable, Hypo retains local markers for retry. A deletion marker always wins over a live record with the same immutable capture ID, including when device clocks disagree. When private iCloud sync is enabled, Hypo checks the Apple Account around cloud operations and uploads the markers so other devices remove their copies. Turning sync off does not delete CloudKit records already present.

Pending PDS writes, cached records, and calibration data remain on the device until synchronization needs them. OAuth tokens, device DPoP keys, and the private-context encryption key use iOS Keychain custody.

## Permissions

The app requests camera access when you use the meter. Denying that permission leaves the logger, timer, local library, and sync status available. Hypo does not claim access before the corresponding feature needs it.

Private meter motion capture and private precise-location capture apply only to the controls described above. For a meter reading, Hypo requests location permission when you have separately enabled precise location and save the reading, not merely because you opened the meter. The private request allows up to 30 seconds for a first-run permission decision and a location fix, but it cannot delay confirmation of the public save. The Logger has its own shoot-scoped location control.

## Privacy disclosures

“Data not collected” is not an accurate blanket description of Hypo. User-published PDS records and optional private CloudKit synchronization transmit data off the device, even though Hypo has no analytics service and does not track users. The app privacy manifest declares user ID, other user content, precise location, device ID, and other private sensor data for app functionality. These categories are linked to the user and not used for tracking. App Store privacy answers must also account for the photographic records a user chooses to publish to their PDS.

The manifest also records the required reasons for app-local and app-group preferences. Hypo accesses system boot time only to reconstruct the wall-clock time of a Core Motion sample; it does not use that value for tracking or device fingerprinting.

## Meter limits

Phone camera modules differ in field of view, exposure pipeline, flare behavior, and RAW availability. A saved reading includes the camera module, sensor path, available geometry, accuracy tier, and warnings. Hypo fails closed when a requested measurement path is unavailable.

A one-point calibration corrects a constant offset near the comparison point. It does not establish accuracy across every light level or device path. Incident readings also depend on the receptor geometry; a bare phone sensor is not equivalent to a calibrated hemispherical diffuser.

## Timing limits

The development timer follows persisted wall-clock deadlines, which lets it recover after background suspension or relaunch. A manual system-clock change can still move a wall-clock deadline. Haptics are attention cues rather than timing authorities.

For a processing step where a missed cue would ruin material, keep an independent timer.
