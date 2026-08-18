---
title: Generate alt text and scene graphs
description: Connect an image-analysis provider and review generated photo metadata.
---

# Generate alt text and scene graphs

Hypo can ask Gemini or Claude to draft alt text or identify visible objects and
relations. The provider receives a JPEG copy resized to no more than 1,400 pixels
on its longest side. The original image and API key are not sent to a Hypo server.

## Connect a provider

1. Open **Settings**, then select **Image analysis**.
2. Choose a provider and model, then enter an API key from that provider.
3. Select **Test connection**.
4. After the test succeeds, select **Save & connect**.

The key stays in this browser's local storage and is sent only to the selected
provider. The provider's own data-use and billing terms still apply. Hypo shows
the relevant note before you connect.

## Draft alt text

1. Open a gallery, then open a photo for editing.
2. Next to **Alt text**, select **Generate**.
3. Review and revise the returned text.
4. Save the photo. Generation alone does not write the draft to your PDS.

## Analyze a scene

1. Open the photo editor and select **Scene graph**.
2. Select **Analyze**.
3. Review the proposed Wikidata groundings, keeping a free-text type when none
   of the suggestions fits.
4. Correct or add regions, nodes, and relations in the scene editor.

Scene analysis writes a new scene graph to your PDS after the grounding review.
It replaces that photo's existing scene graph, so inspect an existing graph
before running the analysis again. A generated box is either absent or contains
four numeric coordinates; Hypo rejects malformed responses rather than saving a
partial region.

## Recover from a provider or deployment error

A provider may reject a request for safety, quota, authentication, or output
length reasons. Hypo reports that condition without saving a partial result.

If a deployment replaced an application file while the tab was open, Hypo
reloads the page once when there are no unsaved edits. When edits are pending,
it offers a reload action and asks before discarding them. Save the edits, then
reload and retry the analysis.
