---
title: Log a frame
description: Record an exposure against the active physical film roll.
---

# Log a frame

Open **Log** to see the active roll, its film stock, exposure index, camera, lens, and next frame number. Enter the aperture and shutter speed you used, then select **Log frame**.

Notes, shoot association, exposure-index override, and meter readings are optional. Hypo omits an exposure-index override unless you enable it, which keeps the roll's EI authoritative for ordinary frames.

For a multiple exposure, enable **Multiple exposure** before logging. Hypo keeps the physical frame number fixed and advances the exposure index within that frame. Disable it before moving to the next physical frame.

## Add lifecycle dates

A film-roll milestone may have a date, but no milestone date is required. Available actions include:

- loaded, first exposure, finished, and unloaded;
- sent to a lab, development started, developed at home, and received from a lab; and
- scanned and archived.

Hypo checks the full milestone order before saving. Thus a loaded date cannot be later than an existing unloaded date, even when the milestones between them have no dates. Invalid dates stay in the editor until you correct or cancel them; they are not queued for sync.

## Work without a connection

A logged frame is written to the local queue first. The frame number can advance while the phone is offline because the write intent is already durable. See [Offline sync](./offline-sync.md) for reconnect, retry, and conflict behavior.
