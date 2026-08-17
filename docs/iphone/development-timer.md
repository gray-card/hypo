---
title: Run a development timer
description: Follow a staged recipe and retain planned and observed processing values.
---

# Run a development timer

Open **Timer** and select a recipe. Recipes may come from the bundled catalog, your own `app.graycard.catalog.devRecipe` records, or the built-in black-and-white fallback. The source badge identifies which recipe supplied the plan.

Review the chemistry stages, temperature, duration, and agitation instructions before starting. The recipe keeps combined baths, such as monobath and blix, as one stage with multiple chemical roles. Black-and-white, C-41, and E-6 recipes retain the other baths required by their process instead of reducing the session to the developer alone.

A catalog development recipe publishes a duration for its primary developer step. It may identify later baths without publishing their times. Hypo labels those baths **Manual** and does not make up countdowns for them. Follow the chemistry manufacturer's instructions, optionally record the duration, temperature, and agitation you observed, then mark each manual stage complete. An explicitly optional stage, such as an optional stabilizer, can be skipped.

During a timed stage, Hypo derives remaining time from wall-clock deadlines. Pausing, leaving the app, or relaunching does not turn delayed screen updates into extra processing time.

The **Film rolls** panel can link no rolls, one roll, or several rolls to the development session. Hypo never selects a roll on your behalf. Once the timer starts, its roll links stay fixed so a restored or retried completion describes the same session.

You can pause, resume, skip a timed stage, or add time. Record observed duration, temperature, and agitation when useful. These values remain separate from the recipe's selected duration, temperature, and agitation instructions.

## Completion record

Hypo writes the session after the final required manual stage is complete and every optional manual stage is either complete or skipped. It prepares one `app.graycard.process.developSession` containing:

- the selected recipe and its provenance;
- ordered bath roles with selected and observed duration, temperature, and agitation, leaving unpublished values absent; and
- linked rolls with session start and finish times.

Completion is keyed to the timer run, so reopening or retrying the same completed run does not create a second development session. A linked roll can advance to developed-at-home through the same semantic update boundary used by the logger.

Darkroom mode reduces non-red light in the timer interface. It cannot control light emitted by system sheets, notifications, or other apps, so it is not a substitute for normal safelight practice.
