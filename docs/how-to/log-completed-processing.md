---
title: Log completed development and scanning
description: Link chemistry and scanners to a film roll without starting a live timer or scan logger.
---

# Log completed development and scanning

A **completed processing session** records work after it has occurred. Use this path when you need to associate chemistry or a scanner with a roll without running Hypo's live development timer or scan logger.

## Record development

1. Add the working chemistry under **Setup → Darkroom** if it is not already in your setup.
2. Open **Setup → Film**, then open the roll.
3. Under **Processing history**, select **Log development**.
4. Select the roll or rolls. The roll you opened is selected by default.
5. Record the process, tank or processor, push or pull, development location, and optional session start and finish.
6. Build the ordered process under **Ordered process stages**. **Use sequence** supplies a starting sequence for black-and-white, monobath, C-41, E-6, ECN-2, or black-and-white reversal processing. Add, remove, and reorder stages to match the process you used.
7. For every chemical bath, select its role or roles and link the tracked chemistry. A monobath may have both `film-developer` and `fixer`; a blix may have both `bleach` and `fixer`. Select additional chemistry when one bath combines multiple tracked parts.
8. Record the actual duration and temperature. Expand **Dates, targets, agitation, and bath details** to add planned values, optional stage start and finish, dilution, working volume, disposition, agitation method, initial agitation, interval, cycle duration, inversions, continuous agitation, and notes.
9. Select **Log development**.

Hypo creates an `app.graycard.process.developSession` and updates each selected roll's development status, lifecycle dates, and primary developer. Every linked chemistry instance receives one session use, the number of processed rolls, and its latest-use date. A chemistry linked more than once within the same session is counted once.

Stage dates are optional. When supplied, they must follow the stage order, fall within the session interval, and place each finish after its start. Planned and observed values are separate: `temperatureSetpoint` and `publishedTimeSeconds` record the plan, while `actualTemperature` and `actualTimeSeconds` record what occurred.

## Record scanning

1. Add the scanner under **Setup → Scanning** if it is not already in your setup.
2. Open the roll and select **Log scan** under **Processing history**.
3. Choose the scanner and method. Add the scan date, software, resolution, file format, and notes as needed.
4. Select **Log scan**.

Hypo creates an `app.graycard.process.digitizeSession`, links it to the roll and scanner, and updates the roll's scanned status and lifecycle date.

## Review processing history

The roll's **Processing history** lists its development and scan sessions. Development entries show the primary chemistry, duration, agitation schedule, and ordered stages; scan entries show the scanner, method, and resolution. Select a development entry to edit its rolls, chemistry, timing, agitation, or stages. Hypo updates the same session record and reconciles the derived roll fields and chemistry usage totals. Select a scan entry to inspect its complete record.

Hypo keeps these associations on session records because one roll may be developed once but scanned more than once. A session history preserves each scan rather than replacing one scanner field on the roll.

Lifecycle chronology is checked before either form writes its session. For instance, a scan date cannot precede an existing development date. Stage chronology, agitation intervals, temperatures, and durations are also checked before a development record is saved.
