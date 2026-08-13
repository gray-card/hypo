---
title: Types, instances, events, and artifacts
description: The four data roles that keep products, owned objects, occurrences, and workflow outputs distinct.
---

# Types, instances, events, and artifacts

Hypo uses a **four-role model** to avoid collapsing a product description, a physical object, something that happened, and something produced.

## Type

`app.graycard.catalog.*` records describe reusable kinds: a camera model, film stock, developer, scanner, or lab. A type may be shared or forked across repositories and aligned with another catalog or ontology through `sameAs`, `forkedFrom`, and external identifiers.

A Nikon F2 model is a type. It may carry mount, shutter, document, and field-source information, but it has no serial number and was not loaded with a particular roll.

## Instance

`app.graycard.instance.*` records identify owned or otherwise individuated things. Two bodies of the same model are two instances that point to one type. Serial number, nickname, acquisition, condition, storage, and current state belong here.

Film makes the separation especially visible. A film stock is a type; a stockpile is a counted reserve; a film roll is one physical roll with loading, frame, and status history.

## Event

Process, session, exposure, and meter records describe occurrences. A development session records what happened to specified rolls at a time. An exposure records one shutter event and may link to a capture session, roll, frame, camera, lens, and meter reading.

Events may refer to both types and instances, but they should not mutate a timeless type into a diary. The event carries its selected settings, observations, provenance, and timestamps.

## Artifact

`app.graycard.artifact` reifies a concrete workflow input or output: a RAW file, negative strip, scan, mask, print, or video clip. `parents` expresses lineage and `producedBy` points to the producing stage or process.

Artifacts make a workflow a provenance graph. A stage may take several inputs and produce a new object; the process and its output remain separate records.

## The diagnostic

When choosing a namespace, ask four questions:

1. Could many people refer to the same product specification? Use a type.
2. Can two copies have different histories? Use an instance.
3. Did it occur at a time? Use an event or session.
4. Can it flow into a later stage as an input? Use an artifact.

Some records combine links across these roles, but the roles remain distinct. This separation supports reuse without erasing individual history.
