---
title: Time a C-41 development session
description: Use the development timer while preserving the selected and observed process values.
---

# Time a C-41 development session

Follow the instructions for your exact chemistry kit first. Hypo can time and record the process, but its generic C-41 chain is not a substitute for the manufacturer's temperatures, capacities, replenishment rules, or safety directions.

1. Open **Timer** and select the C-41 process.
2. Choose the roll or rolls and the development recipe when an exact supported recipe is available.
3. Check the temperature setpoint and developer time against the current kit documentation.
4. Start the developer step only after the bath has reached the intended setpoint.
5. Use the step cue to drain or advance, recording the actual temperature and duration when they differ.
6. Continue through the remaining baths in the kit's order. Some processes use separate bleach and fixer baths; others use a combined blix. Washing and final-rinse requirements also vary.
7. Save the completed session and review the resulting `app.graycard.process.developSession`.

The built-in following-step defaults are 390 seconds for blix, 300 seconds for wash, and 60 seconds for stabilizer. They are editable run aids, not manufacturer claims. Nudge or skip them as the process requires.

Each saved stage separates the published time, planned time and basis, temperature setpoint, actual temperature, and actual time. Keep the values that differ. The general black-and-white temperature estimator is not available for C-41; use the kit's instructions.

The timer continues from an absolute step deadline when the page is backgrounded or refreshed. Audio, vibration, and wake lock are best effort, so keep an independent clock available for process-critical work.
