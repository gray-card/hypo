---
title: Import .frames files
description: Batch-import film exposure logs, connect them to rolls, and review inferred shoots.
---

# Import .frames files

A `.frames` file contains the exposure log for one roll. Hypo can import several files at once, connect each file to an existing roll, match recorded cameras and lenses, and propose shoot records from the sequence.

## Prepare the library

1. Add each physical roll under **Setup → Film**.
2. Add the camera and lenses used for the rolls. Include alternative model names when the names recorded by the source app differ from the catalog labels.
3. Open **Film** and select **Import .frames**.
4. Choose one or more `.frames` files.

Hypo proposes a roll and camera for each file. Check these assignments before importing. Camera and lens matching uses make, model, alternative names, and serial number when available.

## Review proposed shoots

For each file, choose how readily Hypo should create a boundary: **Fewer shoots**, **Balanced**, or **More shoots**. Leave **Use location to refine shoot boundaries** selected when the file contains coordinates and a move between places may distinguish two shoots.

Hypo models the positive waiting times between consecutive frames as two right-skewed regimes: shorter within-shoot gaps and longer between-shoot gaps. The implementation fits a two-component, common-shape gamma mixture by expectation maximization. This approach follows the use of [finite gamma mixtures for model-based clustering](https://doi.org/10.1007/s11634-019-00361-y). It combines temporal and spatial boundary evidence separately, an idea also used by [spatiotemporal clustering methods](https://doi.org/10.1016/j.datak.2006.01.013).

The number of shoots is not an input. Every supported boundary creates another proposed shoot, so one file may yield any number of shoots. The result is a proposal, not a fact. Rename each shoot, merge adjacent proposals, or split a proposal after any frame before saving.

## Control location publication

Location is used for inference inside the browser. Coordinates and altitude are not written to the PDS unless you select **Publish frame locations**. Hypo does not derive shoot names from the coordinates or placemark. The archive's own name is still used as the shoot-name prefix, so review it when a source name contains a place you do not want to publish.

This distinction is the **local inference boundary**: private coordinates may inform the grouping without becoming exposure metadata. The imported timestamp and IANA time-zone identifier are still written so Hypo can preserve when the frame was exposed and its local-time context.

## Import the records

Select the **Import** button, which shows the number of new frames. Hypo creates one exposure record for each new source frame, links it to the selected roll and reviewed shoot, and then updates the roll's frame count and status. A matched camera or lens is linked as an owned instance rather than copied as a model string.

Each exposure keeps the source frame identifier. Importing the same file again skips those exposures and does not create empty duplicate shoots. Files without stable frame identifiers can still be imported, but Hypo cannot detect a repeated import of those frames.
