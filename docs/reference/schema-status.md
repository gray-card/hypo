---
title: State of the schemas
description: Current stable and experimental app.graycard NSIDs supported by Hypo and their enforced checks.
---

# State of the schemas

**Repository snapshot:** 2026-08-13

The current suite contains 59 NSIDs: 55 record collections and four definition-only namespaces. This page separates two questions that were previously conflated: **schema maturity** and **client authoring support**.

“Stable” here means supported by current Hypo code, not frozen across releases. “Experimental” means that a record's shape may still change before it joins the compatibility baseline. An experimental record may have an authoring path, and a stable record may be read-only in a particular client. Neither label currently activates an automated compatibility rule.

## Stable NSIDs

The stable side contains 53 NSIDs.

| Group                                                         | Count | Current evidence                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app.graycard.catalog.*`](./lexicons/index.md#catalog-types) |    15 | Fourteen record types are derived into the production OAuth write set. `catalog.devRecipe` is the exception: the timer consumes it from static catalog shards rather than writing it to a user's repo.                                                                                    |
| [`app.graycard.instance.*`](./lexicons/index.md#instances)    |    16 | Every generated instance kind is included in the production OAuth write set. Library, shot, darkroom, and meter interfaces read or write these records.                                                                                                                                   |
| Shared definition NSIDs                                       |     4 | [`app.graycard.defs`](./lexicons/app.graycard.defs.md), [`meter.defs`](./lexicons/app.graycard.meter.defs.md), [`scene.defs`](./lexicons/app.graycard.scene.defs.md), and [`workflow.defs`](./lexicons/app.graycard.workflow.defs.md) supply referenced shapes used by supported records. |
| Application records                                           |    18 | These collections have current read/write paths or are direct parts of those paths; the exact list follows.                                                                                                                                                                               |

The 18 application-record NSIDs are:

- [`app.graycard.process.developSession`](./lexicons/app.graycard.process.developSession.md), [`process.digitizeSession`](./lexicons/app.graycard.process.digitizeSession.md), and [`process.maintenanceSession`](./lexicons/app.graycard.process.maintenanceSession.md);
- [`app.graycard.session.capture`](./lexicons/app.graycard.session.capture.md);
- [`app.graycard.meter.reading`](./lexicons/app.graycard.meter.reading.md) and [`meter.calibration`](./lexicons/app.graycard.meter.calibration.md);
- [`app.graycard.workflow.template`](./lexicons/app.graycard.workflow.template.md), [`workflow.run`](./lexicons/app.graycard.workflow.run.md), and [`workflow.stage`](./lexicons/app.graycard.workflow.stage.md);
- [`app.graycard.photo.capture`](./lexicons/app.graycard.photo.capture.md) and [`photo.workflow`](./lexicons/app.graycard.photo.workflow.md);
- [`app.graycard.gallery.defaults`](./lexicons/app.graycard.gallery.defaults.md) and [`rule.batch`](./lexicons/app.graycard.rule.batch.md);
- [`app.graycard.scene.graph`](./lexicons/app.graycard.scene.graph.md), [`scene.node`](./lexicons/app.graycard.scene.node.md), [`scene.edge`](./lexicons/app.graycard.scene.edge.md), and [`scene.region`](./lexicons/app.graycard.scene.region.md); and
- [`app.graycard.setup`](./lexicons/app.graycard.setup.md).

The production OAuth scope identifies what Hypo can write. It is an authoring-support boundary, not a maturity or versioning guarantee. See the [OAuth scope reference](./oauth-scopes.md) for the exact grant policy.

## Experimental NSIDs

Six record NSIDs are experimental:

| NSID                                                                                     | Why its schema remains experimental                                                                                                          | Current authoring support                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`app.graycard.artifact`](./lexicons/app.graycard.artifact.md)                           | Workflow stages currently embed lightweight artifact references; the standalone provenance-node contract has not yet been exercised broadly. | Hypo does not create standalone records. The shared record is designed for Gray Card and other workflow clients. |
| [`app.graycard.edit.recipe`](./lexicons/app.graycard.edit.recipe.md)                     | The opaque engine graph and recipe-version contract need evidence from a production editing engine.                                          | Hypo does not create recipes. Gray Card owns the editing-engine authoring path.                                  |
| [`app.graycard.process.editSession`](./lexicons/app.graycard.process.editSession.md)     | The basic event shape works, but its relationship to engine history and recipes may need refinement.                                         | Hypo can create a basic record from a workflow stage; Gray Card can provide richer editor provenance.            |
| [`app.graycard.process.printSession`](./lexicons/app.graycard.process.printSession.md)   | The record covers several print families, so its process-specific fields need more production use.                                           | Hypo can create a record from a workflow stage.                                                                  |
| [`app.graycard.process.renderSession`](./lexicons/app.graycard.process.renderSession.md) | The new, narrow render/export contract needs production use with artifact lineage and Gray Card output.                                      | Hypo can create a basic record from a workflow stage; Gray Card can provide renderer-specific provenance.        |
| [`app.graycard.scene.ontology`](./lexicons/app.graycard.scene.ontology.md)               | The vocabulary contract has not yet been exercised across independently authored scene graphs.                                               | Hypo does not publish ontology records. They are intended for shared vocabulary exchange.                        |

Experimental records pass the same source-shape, generated-code, and documentation checks as stable records. The label concerns application support and expected change, not whether the JSON parses or references resolve.

## What is enforced today

The current release checks enforce four properties:

1. `npm run check:lexicons` regenerates the TypeScript schema table, namespace map, and record types, then fails when the checked-in outputs differ.
2. `npm run check:lexicon-docs` does the same for generated NSID pages, the sidebar, and the summary. Unit tests also check source IDs, resolved references, generated page coverage, deterministic output, and definition anchors.
3. Type checking, unit tests, end-to-end tests, lint, formatting, application builds, and documentation builds run in CI.
4. `@hypo/pds` validates `app.graycard.*` creates and puts against the generated record validator by default. Callers explicitly disable that validator for external Grain collections whose schemas are not owned here.

These checks establish freshness and current-program conformance. They do not compare a proposed schema with the previous release, prohibit a breaking change to a stable NSID, prove a migration round trip, or enforce the stable/experimental labels. Until a compatibility gate is operational, those judgments remain part of human review.

## Panproto checks

The repository pins `@panproto/core` and `panproto-cli` at 0.70.1. CI runs `npm run check:panproto`, which loads the root manifest as an ATProto bundle, checks theory diagnostics, stages two record fixtures, exercises directory compatibility, and validates the parsed bundle with the TypeScript SDK.

The checked-in sidecar records the 59-document suite under protocol `atproto`, tracks both files in `fixtures/records`, and tags this first stable snapshot as `lexicons-v1`. Pull-request compatibility checks become active after the corresponding `v1.0.0` Git release tag is present on `main`. [How schema versions work](../explanation/schema-versions.md) describes that boundary.
