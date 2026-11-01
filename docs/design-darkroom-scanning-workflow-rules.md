# Darkroom, scanning, workflows, and rules

The older proposal in this file named `process.scan`, `scanFrame`, and `process.development` records that were never adopted. It has been replaced by the implemented record model:

- [`app.graycard.process.developSession`](reference/lexicons/app.graycard.process.developSession.md) logs observed development steps and links rolls, chemistry and recipes.
- [`app.graycard.process.digitizeSession`](reference/lexicons/app.graycard.process.digitizeSession.md) logs digitization, links rolls and photos, and can retain a modular setup snapshot.
- [`app.graycard.process.printSession`](reference/lexicons/app.graycard.process.printSession.md) logs printing equipment and materials, including enlargers and enlarging lenses.
- [`app.graycard.process.developmentPlan`](reference/lexicons/app.graycard.process.developmentPlan.md) stores reusable ordered film-processing instructions; [`app.graycard.print.exposurePlan`](reference/lexicons/app.graycard.print.exposurePlan.md) stores base, dodge, and burn exposure instructions with image-relative selections. Sessions snapshot the plan used.
- [`app.graycard.workflow.template`](reference/lexicons/app.graycard.workflow.template.md), runs and stages express the process plan. Completed development, digitization and print stages should link the process session that records the work.
- [`app.graycard.rule.batch`](reference/lexicons/app.graycard.rule.batch.md) supports preview-first edits. Gallery edits and process/workflow-record edits have separate, explicitly bounded action sets.

See [the development-session model](explanation/development-session-model.md), [processing plans](explanation/processing-plans.md), [workflow records](explanation/workflow-records.md), and [modular camera-scanning setups](explanation/camera-scanning-setups.md) for current design and usage. The [workflow how-to](how-to/create-and-run-a-workflow.md), [darkroom planning how-to](how-to/plan-darkroom-processing.md), and [batch-rule how-to](how-to/write-batch-rules.md) describe the interface.
