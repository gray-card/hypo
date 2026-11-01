---
title: Create and run a workflow
description: Define steps and artifact flow, start a run, and record each available stage.
---

# Create and run a workflow

Workflow templates are reusable process graphs. A run expands one template into stage records for a particular roll, shoot, photo, or other subject.

## Create a template

1. Open **Setup**, then **Workflows**.
2. Select **+ Template**.
3. Enter a name and choose the photographic medium.
4. Add steps in their working order. Hypo provides capture, develop, digitize, edit, render/export, print, output, and custom step types. The stored discriminator for render/export remains `digitalStage` so existing workflow records continue to validate.
5. Open **Configure** on a step to set its label, description, optional status, occurrence limits, process-session scope, and default resources.
6. Select **Save** after adding at least one step.

Use the typed resource controls in **Configure** for common operations. A development step can default a [film-processing sequence](./plan-darkroom-processing.md), recipe, chemistry and lab. A digitization step can default a [modular scanning setup](../explanation/camera-scanning-setups.md), camera, lens, scanner and scan profile. A print step can default a [print exposure plan](./plan-darkroom-processing.md), printer or enlarger, enlarging lens, paper, light source, filters and recipe. The advanced parameters remain available for stage-specific values that do not yet have a shared control.

A step's occurrence limits control how many stage records a run creates. An optional step has a minimum of zero and may be skipped while the run is active. Repeated steps retain separate stable IDs, so two development baths can carry different defaults.

## Configure artifact flow

The template editor supplies an input and output port for each built-in step. Open **Advanced flow and parameters** on a step to add or replace ports. Enter one port per line in this form:

```text
port-id: artifact-kind, another-artifact-kind
```

Under **Artifact flow, branches, and joins**, connect a source output to a destination input. The two ports must accept at least one common artifact kind. One output may connect to several steps to form a branch, and several outputs may connect to one step to form a join.

Hypo rejects self-connections, missing ports, incompatible artifact kinds, duplicate IDs, invalid occurrence limits, and cycles. A template must form a directed acyclic graph.

## Start a run

A workflow can be started while loading or editing a film roll, creating or editing a shoot, or applying workflow steps in a gallery. Select a template and, when prompted, choose the number of occurrences for steps whose limits permit repetition.

Starting the workflow creates:

- one `app.graycard.workflow.stage` record for each selected occurrence;
- one `app.graycard.workflow.run` that identifies the subject, template revision, stage order, and graph edges; and
- an `app.graycard.photo.workflow` link when the run belongs to a photo.

Root stages become ready immediately. Other stages remain planned until all incoming stages are completed or skipped.

## Record progress

Open **Setup → Workflows** and find the run under **Active workflows**. Hypo shows a **Log** action for every stage whose inputs are ready.

- **Log** or **Continue** opens the logger for that stage type.
- **Skip** completes an optional stage without a process-session record.
- **Cancel** marks every unfinished stage and the run as cancelled.

Completing a stage stores its process-session link when that stage represents a separate event, records its outputs, and then makes newly available branches ready. Capture stages link directly to `app.graycard.session.capture`; they do not create a redundant process-side capture record. Edit, render/export, print, development, and digitization stages can each link to their corresponding `app.graycard.process.*` event. A join becomes available only after every incoming stage succeeds. The run becomes complete when every stage is completed or skipped.

You can also log development or digitization from a roll rather than opening the workflow board first. Hypo fills the logger from that roll's next actionable stage when one exists, then links the saved session to the stage and advances the run. If a batch combines rolls with different stage defaults, Hypo leaves the conflicting defaults blank for review instead of choosing one roll's plan for every roll. Data Quality flags a completed development, digitization or print stage that lacks a process-session link.

The roll board shows each roll's active workflow, next available stages, and completed-stage count.
