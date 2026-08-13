---
title: Why the timer follows wall-clock deadlines
description: The absolute-deadline design that keeps development timing correct across throttling and refresh.
---

# Why the timer follows wall-clock deadlines

A browser interval is not a clock. Background tabs may receive fewer callbacks, a busy main thread may delay rendering, and a page can be refreshed. Counting callback ticks would therefore make a development step run long.

Hypo uses an **absolute-deadline timer**. Starting or resuming a step computes:

```text
endsAt = Date.now() + remainingSeconds × 1000
```

The display updates roughly every 250 ms, but each update derives the remaining duration from `endsAt - Date.now()`. A callback that arrives late changes only how often the display was painted; it does not shift the deadline.

Timer state is mirrored under `hypo:devtimer:<did>` in local storage. On reload, Hypo reconstructs the active step from the saved wall-clock deadline. If the deadline passed while the page was absent, the restored state can advance rather than granting the missing time back.

Wake Lock, sound, and vibration improve attention when the platform permits them. They are cues, not timing authorities. The wall clock remains authoritative even when a phone suppresses a notification or releases its wake lock.

This design has a limit: a system-clock adjustment can move `Date.now()`. A monotonic clock such as `performance.now()` resists adjustments but does not provide a durable timestamp that survives reload. Hypo favors reload and background recovery, which matter for the current browser workflow. For critical processing, the user should still keep an independent timer and record the actual duration.

The saved development session distinguishes the planned deadline from observation. Thus recovery behavior supports timing, while `actualTimeSeconds` remains the record of what the photographer judges to have occurred.
