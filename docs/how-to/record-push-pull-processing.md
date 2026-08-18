---
title: Record push and pull processing
description: Keep exposure index, published recommendations, derived values, and observed processing distinct.
---

# Record push and pull processing

The **plan/observation split** prevents a push or pull label from being treated as evidence about the processing that occurred.

1. On the film roll, record the exposure index actually used in `shotAtIso`.
2. In the timer, select a development recipe for that exact film, developer, dilution, method, and exposure index when one exists.
3. Preserve the developer stage's `recipe`, `sourceDocument`, and `sourceSpec`, and the session's `pushPull` value.
4. Use an interpolated time only when the source data brackets the target temperature and the recipe explicitly permits interpolation.
5. If no exact or permitted derived value exists, enter a manual time and label its provenance as manual. Do not present it as published.
6. After processing, record the observed duration and temperature separately from the selected values.

Hypo's recipe resolver never extrapolates beyond published temperature rows. An exact source row is marked as published, and an allowed interior interpolation is marked as `recipe-interpolation`. The optional general black-and-white calculator is marked as `general-estimate`. A manually chosen time remains manual even if it resembles a value found elsewhere.

On the developer stage, `publishedTimeSeconds` means that the selected source supports that time and `actualTimeSeconds` records how long the bath ran. Session-level `pushPull` describes the intended deviation from box-speed processing; it does not establish that a particular time is authoritative.

When the source recommends a range or qualifies the result, retain that limitation in the provenance note. The record should permit later reconstruction of the decision and the process, including cases where the result differed from the plan.
