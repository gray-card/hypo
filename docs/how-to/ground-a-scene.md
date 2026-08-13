---
title: Ground objects and relations in a scene
description: Draw regions, choose stable concept identifiers, and save a typed scene graph.
---

# Ground objects and relations in a scene

Open a photo's scene editor. Scene grounding connects a visible region to a typed node, then relates nodes with typed edges.

1. Draw a box or polygon around one object. Imported scenes may also contain points, rotated regions, or masks, but the editor's authoring tools currently focus on boxes and polygons.
2. Enter a node type such as `camera`, `tree`, or `person`.
3. Prefer a Wikidata result when one sense matches the intended object. The saved type then carries the stable QID and its human label.
4. Keep the term as free text when the offered concepts are ambiguous or wrong.
5. Add another object, then create a relation between them, such as `inside`, `above`, or `behind`.
6. Check the edge direction. `A inside B` and `B contains A` are converse descriptions, not interchangeable argument orders.
7. Save the graph and reopen it to confirm the regions, nodes, and edges.

Hypo automatically applies only a unique exact-label grounding during non-interactive analysis. Ambiguous terms remain for user choice. Recent types and a spatial seed list appear before remote Wikidata results.

The persisted records separate concerns: `scene.region` carries geometry, `scene.node` carries the object type and optional region, `scene.edge` carries a relation between nodes, and `scene.graph` binds them to the photo. Coordinates are normalized to the image and stored as integers scaled by 1,000,000.

Grounding identifies a concept; it does not assert that every instance of the source type bears the same relation to every target type. The derived scene ontology treats observed source and target types as defeasible witnesses, not universal constraints.
