# `TimerEngine`

Run development schedules against wall-clock time.

## Overview

TimerEngine represents ordered development stages, agitation schedules, temperature compensation, persisted runs, and resume behavior. Recipe compensation resolves exact published points and, only when a recipe permits it, defaults to logarithmic interpolation between adjacent points. Requests outside the published range fail rather than extrapolate. A separate general black-and-white estimator implements Ilford's 18–27 °C chart relationship, rounds to 15 seconds, and reports short-time and large-change warnings without presenting the result as recipe data. A running timer derives its position from dates rather than decrementing a counter, so suspension and relaunch do not discard elapsed time.

## Topics

### Plans and runs

- ``TimerPlan``
- ``TimerStage``
- ``DevelopmentTimerRun``
- ``DevelopmentTimerEngine``
- ``TimerSnapshot``

### Darkroom calculations

- ``AgitationSchedule``
- ``AgitationScheduler``
- ``TemperatureCompensator``
- ``GeneralBlackAndWhiteTemperatureEstimator``
- ``GeneralBlackAndWhiteTemperatureEstimate``
