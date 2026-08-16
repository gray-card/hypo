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
4. Select the roll or rolls and the primary developer. The roll you opened is selected by default.
5. Record the process, dilution, development location, completion date, duration, and temperature as needed.
6. Choose the agitation method. You may also record initial agitation, the interval between cycles, the duration of each cycle, inversions per cycle, continuous agitation, and a short description.
7. Select **Log development**.

Hypo creates an `app.graycard.process.developSession`, links the selected rolls and chemistry, and updates each roll's development status and lifecycle date. The session stores both a readable agitation summary and the structured schedule.

## Record scanning

1. Add the scanner under **Setup → Scanning** if it is not already in your setup.
2. Open the roll and select **Log scan** under **Processing history**.
3. Choose the scanner and method. Add the scan date, software, resolution, file format, and notes as needed.
4. Select **Log scan**.

Hypo creates an `app.graycard.process.digitizeSession`, links it to the roll and scanner, and updates the roll's scanned status and lifecycle date.

## Review processing history

The roll's **Processing history** lists its development and scan sessions. Development entries show the chemistry, duration, and agitation schedule; scan entries show the scanner, method, and resolution. Select an entry to inspect the complete session record.

Hypo keeps these associations on session records because one roll may be developed once but scanned more than once. A session history preserves each scan rather than replacing one scanner field on the roll.

Lifecycle chronology is checked before either form writes its session. For instance, a scan date cannot precede an existing development date. Agitation intervals and development duration are also checked before the record is saved.
