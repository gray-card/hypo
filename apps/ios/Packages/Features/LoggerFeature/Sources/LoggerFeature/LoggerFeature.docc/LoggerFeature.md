# `LoggerFeature`

Log film exposures and optional roll lifecycle dates while working in the field.

## Overview

LoggerFeature maintains a draft for the selected active roll, validates exposure values, queues an [`instance.exposure`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.instance.exposure) record, and advances the next frame. It can associate a frame with meter readings and a shoot. Location is requested only after a person enables it for that shoot.

The roll lifecycle writer merges optional milestone dates into [`instance.filmRoll`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.instance.filmRoll). Chronology validation rejects a dated earlier milestone that follows a dated later milestone.

## Topics

### Log a frame

- `LoggerFeatureModel`
- `ActiveRoll`
- `ExposureDraft`
- `ExposureWriting`
- `DiscardingExposureWriter`

### Track a roll

- `FilmRollLifecycleAction`
- `FilmRollLifecycleWriting`
- `QueuedFilmRollLifecycleWriter`
- `FrameDetailStoring`
