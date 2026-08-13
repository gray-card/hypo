---
title: Lexicon conventions
description: NSIDs, records, refs, known values, and rules for the shared metadata model.
---

# Lexicon conventions

The `app.graycard.*` namespace is the shared metadata model used by Hypo and Gray Card. It covers provenance, photographic workflows, owned gear, catalog types, meter readings, and scene graphs. We call its interpretation rules the **lexicon contract** (LC). The contract lets independently implemented clients read an unfamiliar record without duplicating application-specific assumptions. These pages document Hypo's support for the model; Gray Card's photo-editing behavior has separate documentation.

## NSIDs and definitions

Each JSON file declares one NSID and one or more definitions. A `main` definition with `type: "record"` defines a repository collection; other definitions are reusable shapes or open string sets.

Record NSIDs tend to follow the level of the object they identify:

| Prefix                    | Object                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `app.graycard.catalog.*`  | Shareable types, such as a camera model or film stock             |
| `app.graycard.instance.*` | Owned individuals, such as one camera body or roll                |
| `app.graycard.process.*`  | One-time events, such as developing, digitizing, or rendering     |
| `app.graycard.session.*`  | Activity containers, such as a shoot with several exposures       |
| `app.graycard.workflow.*` | Reusable workflows, runs, stages, and shared workflow definitions |
| `app.graycard.scene.*`    | Scene-graph ontologies, nodes, edges, regions, and graphs         |

## Refs

A local ref such as `#measure` resolves within the current NSID. A cross-schema ref such as `app.graycard.defs#provenance` resolves against another lexicon file. The generator checks all declared refs before it writes documentation; an unresolved target stops the run.

The generated NSID pages link every ref to its target definition. Field tables also expand one level of referenced object fields so that the immediate shape remains visible.

## Required and optional fields

An object lists required field names separately from its properties. A property that is present still has to match its declared type, format, and bounds. Record validators report issues as paths such as `$.createdAt` or `$.steps[0].durationSeconds`.

## Known values are open

`knownValues` supply editor completion and interoperable spellings, but they are not closed enums. Clients should preserve an unfamiliar string. This open-value rule allows a newer client to write a value that an older client can retain without understanding it.

## Links between records

Fields with `format: "at-uri"` point to an AT Protocol record. The description names the expected collection when the relationship is narrower than an arbitrary AT-URI. Catalog records also use `app.graycard.defs#catalogLinks` for equivalence, forks, and external identifiers.

## Fixed-point quantities

AT Protocol lexicons do not define floating-point numbers. The shared model uses either (i) `app.graycard.defs#measure`, which carries an integer value, unit, and scale, or (ii) a fixed integer scaled by 1,000,000 when projecting into an external schema that already uses that convention.
