# `TimerFeature`

Select, run, restore, and record a film-development process.

## Overview

TimerFeature projects catalog, personal, and workflow-derived recipes into TimerEngine plans. Before timing starts, a recipe may expose a temperature control when it publishes multiple temperature/time points and explicitly permits interpolation. The control uses logarithmic time interpolation only between those points; it never extrapolates. Standard black-and-white recipes also offer an explicit general estimate based on Ilford's 18–27 °C chart. The interface identifies that estimate as approximate, retains its published reference, and warns below five minutes or after a change of at least 4 °C.

The completion record keeps source, plan, and observation separate. Exact rows retain `publishedTimeSeconds`; every timed plan retains `plannedTimeSeconds` and `timeBasis`; observations use `actualTimeSeconds`. General estimates never become published recipe values.

The feature records automatic timed stages and manual baths, preserves the run across suspension, and writes a [`process.developSession`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.process.developSession) record when the process completes. When a roll is attached, the same completion advances its optional development milestone.

## Topics

### Recipes and stages

- `DevelopmentRecipeSelection`
- `DevelopmentRecipeStage`
- `DevelopmentRecipeProviding`
- `DevelopmentRecipeProvenance`
- `TemperatureCompensator`
- `GeneralBlackAndWhiteTemperatureEstimator`

### Run and persist

- `TimerFeatureModel`
- `TimerFeatureSessionState`
- `TimerFeatureSessionStoring`
- `DevelopmentSessionWriting`
- `DevelopmentSessionRecordBuilder`
