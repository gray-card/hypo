---
title: Development sessions and process stages
description: Why Hypo records film development as ordered baths and operations rather than one developer summary.
---

# Development sessions and process stages

A film-development record has two levels. The session identifies the rolls, process family, tank or processor, push or pull, overall dates, lab, notes, and provenance. Its ordered `steps` describe the baths and physical operations that occurred.

This separation matters because there is no universal developer–stop–fix sequence. Kodak's black-and-white guidance separates development, stop or rinse, fixation, washing, wash aid, wetting agent, and drying. Kodak's E-6 and ECN-2 specifications add process-specific baths and operations, while Fujifilm's CN-16 process uses its own sequence of developer, bleach, fixer, rinse, and stabilizer stages. The record therefore follows the process used instead of forcing every process into one summary.

## One stage

A stage may record:

- `kind`, the physical operation, such as a chemical bath, wash, rinse, rem-jet removal, re-exposure, drain, or dry;
- `roles[]`, every chemical function performed in that stage;
- `chemistries[]`, the tracked chemistry instances used, with the primary chemistry first when that distinction matters;
- `recipe`, `sourceDocument`, `sourceSpec`, and `dilution`;
- planned and actual duration and temperature;
- optional `startedAt` and `finishedAt` timestamps;
- `agitationMethod` and a structured `agitationScheme`;
- working volume, post-use disposition, and notes.

Roles are an array because one bath may perform several functions. A monobath can carry `film-developer` and `fixer`; a blix can carry `bleach` and `fixer`. Chemistry is also an array because a working bath may combine multiple tracked parts. These are different claims: roles say what the bath did, while chemistry links identify what was used.

Water operations use the `wash` role. A chemical washing aid uses `wash-aid`. This distinction prevents a water wash from being counted as a chemistry instance.

## Dates and observations

All per-stage dates are optional. When present, Hypo checks that (i) a stage does not finish before it starts, (ii) later stages are not dated before earlier stages, and (iii) stage dates fall within the session interval. The same check applies to a session start and finish.

Planned and observed values remain distinct. `temperatureSetpoint` and `publishedTimeSeconds` describe the selected plan. `actualTemperature` and `actualTimeSeconds` describe the recorded execution. This distinction permits a session to retain a manufacturer recommendation without replacing it with the observed result.

## Chemistry usage

Saving a home-development session updates every linked chemistry instance. `sessionsUsed` increases once, `rollsProcessed` increases by the number of rolls in the session, and `lastUsedAt` records the latest use. Duplicate links within one session are counted once. The selected rolls also receive their development dates, location, status, and the first linked developer-role chemistry as `developedWith`.

## Existing records

Hypo 1.2 migrates earlier `app.graycard.process.developSession` records before loading the store. Panproto compiles the reviewed summary-to-stage transformation. Application migration code then merges existing steps, converts shortcut stop, fixer, and blix fields into stages, removes redundant singular or summary fields, and updates the original record key with a repository commit guard. A failed write leaves the previous record unchanged.

## Process references

The model follows the distinctions in current manufacturer documentation:

- [Kodak black-and-white film processing](https://kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf)
- [Kodak E-6 kit manual](https://business.kodakmoments.com/sites/default/files/files/resources/ti2443.pdf)
- [Kodak motion-picture laboratory chemicals](https://www.kodak.com/content/products-brochures/Film/Using-KODAK-Kit-Chemicals-in-Motion-Picture-Film-Laboratories.pdf)
- [Fujifilm CN-16LQ processing manual](https://asset.fujifilm.com/www/sg/files/2020-08/e92ec01bf0eef9b159ffa4d37f88bd14/cn16lq_.pdf)
- [Ilford black-and-white film processing](https://www.ilfordphoto.com/wp/wp-content/uploads/2017/04/Processing-your-first-black-and-white-film.pdf)

Manufacturer instructions remain authoritative for safety, sequence, capacity, replenishment, time, temperature, and agitation. Hypo records a process; it does not prescribe one.
