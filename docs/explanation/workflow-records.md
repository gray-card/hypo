---
title: Workflow templates, runs, and stages
description: How Hypo represents reusable process graphs and their execution records.
---

# Workflow templates, runs, and stages

Hypo separates a reusable process definition from one execution of that process. This is the **template/run split**: a template records possible steps and dependencies, while a run records the stages created for one subject.

## Templates

`app.graycard.workflow.template` records the medium, ordered steps, explicit connections, and default resources. Each step has a stable ID and a kind such as `capture`, `develop`, `digitize`, `digital`, `print`, `edit`, `output`, or `other`.

A template step may define:

- occurrence limits and whether the step is optional;
- a process-session scope, such as one session per stage, subject, batch, or run;
- typed process defaults for cameras, lenses, rolls, chemistry, scanners, printers, paper, recipes, and related resources;
- stage defaults, notes, and stage-specific parameters; and
- named input and output ports with accepted artifact kinds.

Connections join an output port to an input port. They form a directed acyclic graph, which permits linear processes, parallel branches, joins, repeated operations, and multi-input stages.

## Runs

`app.graycard.workflow.run` is one instantiated template. It records its subjects and products, a reference to the template, the template revision used at launch, ordered stage links, graph edges, timestamps, and run status.

The template name is copied into the run for display. Editing or deleting the template does not change the stages already created for an existing run.

Run subjects and products use `artifactRef`. An artifact reference names a kind and may point to an `app.graycard.artifact` record, a film roll, a photo, or another AT-URI. This permits a run to begin with a latent roll, for instance, and end with a negative, digital raster, print, or publication.

## Stages

Each `app.graycard.workflow.stage` record is a typed occurrence. Its fields include template-step identity, occurrence number, input and output bindings, process defaults, process-session reference, status, and lifecycle timestamps.

Hypo creates root stages as `ready` and other stages as `planned`. The runtime exposes a planned stage only when every incoming predecessor is `completed` or `skipped`. Completing a stage may attach a process-session AT-URI and one or more output artifacts. The runtime then updates downstream stages and the enclosing run.

Stage status is one of `planned`, `ready`, `in-progress`, `blocked`, `completed`, `failed`, `skipped`, or `cancelled`. Run status omits `skipped` because skipping applies to an individual optional stage.

## Photo links

`app.graycard.photo.workflow` connects a Grain photo to a workflow run. The gallery editor uses this link to display workflow progress alongside the photo without embedding the run in the Grain record.

The [workflow how-to](../how-to/create-and-run-a-workflow.md) describes the corresponding interface. The generated references specify every [template](../reference/lexicons/app.graycard.workflow.template.md), [run](../reference/lexicons/app.graycard.workflow.run.md), [stage](../reference/lexicons/app.graycard.workflow.stage.md), and [shared workflow definition](../reference/lexicons/app.graycard.workflow.defs.md).
