---
title: Film-processing sequences and print exposure plans
description: Why reusable darkroom instructions are distinct from logged sessions and source-backed development recipes.
---

# Film-processing sequences and print exposure plans

Hypo uses two names for two different kinds of instructions. A **film-processing sequence** is an ordered set of baths and physical operations, with planned time, temperature, dilution, chemistry, and agitation. A **print exposure plan** is an ordered set of enlarger exposures, including base exposures, dodges, and burns. Neither is a completed session. A session records what happened and snapshots the plan selected at the time.

## Terminology and evidence

ILFORD's [film-processing chart](https://www.ilfordphoto.com/wp/wp-content/uploads/2017/03/Film-processing-chart-.pdf) separates development time and agitation from stop, fixation, and washing. Its [processing manual](https://www.ilfordphoto.com/amfile/file/download/file/455/product/592/) identifies time, temperature, agitation, replenishment, stop, and fixer as process variables. Thus a manufacturer-backed `devRecipe` remains a recommendation for a film/developer combination, while a user-owned `developmentPlan` assembles a complete local sequence. The `developSession.steps` array records actual temperatures, durations, and timestamps; the plan does not claim those observations.

For prints, ILFORD calls the whole-sheet exposure the **base exposure**, and calls withholding light from a local area **dodging** and giving it extra light **burning** ([darkroom guide](https://www.ilfordphoto.com/beginners-guide-darkrooms/)). Its [split-grade guide](https://www.ilfordphoto.com/split-grade-printing/) describes two or more base exposures at different contrast grades, with dodging possible during either. A [darkroom timer manual](https://www.darkroomautomation.com/support/mfs-manual.pdf) treats dodges as timed intervals inside a base exposure, burns as additional exposures, and test strips as separate trials. The plan therefore stores an ordered sequence of base and burn steps; each dodge names a preceding base step and a start offset inside it. Durations are stored in milliseconds and shown in seconds. A plan may also record contrast grade, color-head filtration, test strips, physical masking instructions, and named semantic targets.

## Image selections and scene meaning

The image editor stores selections in image-relative coordinates rather than screen pixels. Brush paths, polygons, ellipses, and linear gradients can be combined as additions, subtractions, or intersections, with per-selection strength and feathering. This vocabulary follows [darktable's drawn masks and mask manager](https://darktable-org.github.io/dtdocs/en/darkroom/masking-and-blending/masks/drawn/) and [Lightroom Classic's masking tools](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html). A selected image is a _reference for planning_, not a claim that a digital mask can be projected through an enlarger. Physical card placement, motion, and edge softness remain instructions for the printer.

An exposure step can name a region (for instance, “sky”) or link an `app.graycard.scene.node`. A matching `app.graycard.scene.region` polygon or bounding box can be imported into the plan. Hypo copies its geometry into the exposure step and retains the source-region URI; later scene-graph edits cannot silently alter an established print plan. This distinguishes **semantic identity** (“the sky”) from **mask geometry** (the area to burn on this reference image).

## Record boundaries and compatibility

- `app.graycard.process.developmentPlan` and `app.graycard.print.exposurePlan` are reusable plans.
- `app.graycard.process.developSession` and `app.graycard.process.printSession` keep the chosen plan URI plus a snapshot of the instructions used. Actual observations remain on the session.
- Existing development sessions and print sessions remain valid without a plan. The old free-text `dodgeBurn` field is historical notes, not a machine-readable substitute: a migration cannot infer geometry, timing, or grade from arbitrary prose. New plans do not write to that field.
- A workflow may default to a plan; a batch rule may assign one to eligible process records and snapshots its current content when applied. Data Quality flags missing snapshots and invalid plans.

The canvas is a **planning overlay**, not a calibrated preview of paper response. It does not simulate photographic exposure, reciprocity, filtration curves, or the precise shadow of a moving dodging card. The saved times and geometry are instructions to carry into the darkroom, and the completed session records what the printer actually did.
