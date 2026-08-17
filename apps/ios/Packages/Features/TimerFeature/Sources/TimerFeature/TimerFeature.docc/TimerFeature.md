# `TimerFeature`

Select, run, restore, and record a film-development process.

## Overview

TimerFeature projects catalog, personal, and workflow-derived recipes into TimerEngine plans. It records automatic timed stages and manual baths, preserves the run across suspension, and writes a [`process.developSession`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.process.developSession) record when the process completes. When a roll is attached, the same completion advances its optional development milestone.

## Topics

### Recipes and stages

- `DevelopmentRecipeSelection`
- `DevelopmentRecipeStage`
- `DevelopmentRecipeProviding`
- `DevelopmentRecipeProvenance`

### Run and persist

- `TimerFeatureModel`
- `TimerFeatureSessionState`
- `TimerFeatureSessionStoring`
- `DevelopmentSessionWriting`
- `DevelopmentSessionRecordBuilder`
