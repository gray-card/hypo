# `TimerEngine`

Run development schedules against wall-clock time.

## Overview

TimerEngine represents ordered development stages, agitation schedules, temperature compensation, persisted runs, and resume behavior. A running timer derives its position from dates rather than decrementing a counter, so suspension and relaunch do not discard elapsed time.

## Topics

### Plans and runs

- `TimerPlan`
- `TimerStage`
- `DevelopmentTimerRun`
- `DevelopmentTimerEngine`
- `TimerSnapshot`

### Darkroom calculations

- `AgitationSchedule`
- `AgitationScheduler`
- `TemperatureCompensator`
