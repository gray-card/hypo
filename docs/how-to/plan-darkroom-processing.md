---
title: Plan film development and print exposures
description: Save reusable bath sequences and draw timed dodge and burn instructions against a reference photo.
---

# Plan film development and print exposures

## Film-processing sequence

1. Open **Sessions → Development → New sequence**.
2. Name the sequence and choose the film process and tank or processor.
3. Add or reorder stages. For each bath, set its chemistry, dilution, planned duration, temperature, and agitation. Save the sequence.
4. Choose **Log past work → Log completed development**. Select the saved sequence, then enter the rolls and actual observations. The log keeps a snapshot of the sequence even if you later revise it.

A manufacturer `devRecipe` supplies source-backed developer recommendations. A sequence can use that recipe in one stage and add the stop, fix, wash, and other stages around it.

## Print exposure plan

1. Open **Sessions → Print → New plan**, name it, and choose a photo from your library as a reference image.
2. Add one or more **base exposures**. Set each duration and contrast grade. Two base steps at different grades represent split-grade printing.
3. Add a **dodge** to hold light back during a named base exposure. Set its start offset and duration so it fits inside that base exposure.
4. Add a **burn** for an additional exposure after the preceding steps. You can give it a different grade or color-head filtration.
5. Select a dodge or burn and draw its region with **Brush**, **Polygon**, **Ellipse**, or **Gradient**. Finish a polygon with Enter or a double-click. Drag polygon points to refine them; adjust brush size, feather, strength, and how each selection combines with the others. **Undo last selection** or remove a selection if needed.
6. Optionally name the region, link a scene subject, or import a polygon/bounding-box region already grounded in the scene graph. Record test strips and physical masking notes, then save.
7. Choose **Log past work → Log print**, select the plan, and record the paper, enlarger, lens, source, and actual session time. The print log stores a snapshot of the plan.

The colored overlay is a guide to where to hold back or add light, not a calibrated preview of the final paper print. See [the design and source notes](../explanation/processing-plans.md) for the record model and terminology.
