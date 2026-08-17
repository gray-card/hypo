---
title: Hypo for iPhone
description: Use Hypo as a meter, field logger, development timer, and companion library.
---

# Hypo for iPhone

Hypo for iPhone is a field and darkroom client for the same metadata records used by Hypo on the web. It has five main tabs:

- **Meter** gives photographic exposure guidance and records the measurement path used for each reading.
- **Log** records frames against a physical roll, including multiple exposures and optional lifecycle dates.
- **Timer** runs staged development recipes and records the selected and observed processing values.
- **Library** provides read-mostly access to rolls and gear alongside the bundled film, chemistry, camera, lens, and development-time catalog.
- **Settings** manages account access, calibration profiles, and sync details.

These records live in your AT Protocol repository. The app also keeps a local cache and durable write queue so logging and timing do not depend on a continuous connection.

Hypo does not edit image pixels. Gray Card is the separate photo editor built around the same metadata model.

Start with [Log a frame](./log-a-frame.md) for field use or [Run a development timer](./development-timer.md) in the darkroom. [Offline sync](./offline-sync.md) explains what the pending and needs-attention states mean.
