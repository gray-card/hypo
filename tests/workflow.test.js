import { describe, it, expect } from "vitest";
import {
  STAGE_LABELS,
  STAGE_VARIANTS,
  defaultStagePayload,
  describeStage,
  stepsFromTemplate,
  getRunForPhoto,
} from "../src/workflow.js";
import {
  normalizeWorkflowTemplate,
  templateFromSteps,
  plannedStagesFromTemplate,
  validateWorkflowTopology,
  assertWorkflowTopology,
  WorkflowTopologyValidationError,
} from "@hypo/domain";

describe("describeStage", () => {
  it("maps a stage record $type to its human label", () => {
    const type = STAGE_VARIANTS.capture;
    expect(describeStage({ value: { $type: type } })).toBe(STAGE_LABELS.capture);
  });
});

describe("defaultStagePayload", () => {
  it("produces a typed payload with an input", () => {
    const p = defaultStagePayload("capture", null);
    expect(p.$type).toBe(STAGE_VARIANTS.capture);
    expect(p.input).toBeTruthy();
  });
  it("adds a grain target for output stages", () => {
    const p = defaultStagePayload("output", "at://photo");
    expect(p.target).toEqual({ service: "social.grain", ref: "at://photo" });
  });
  it("marks 'other' stages as custom", () => {
    expect(defaultStagePayload("other", null).kind).toBe("custom");
  });
  it("persists custom stage kinds through the other-stage escape hatch", () => {
    expect(defaultStagePayload("selenium-tone", null)).toEqual({
      $type: STAGE_VARIANTS.other,
      kind: "selenium-tone",
      input: { kind: "other" },
      output: { kind: "other" },
    });
  });
});

describe("stepsFromTemplate", () => {
  it("expands stageKinds and marks configured steps", () => {
    const steps = stepsFromTemplate({
      value: {
        stageKinds: ["capture", "develop"],
        stageDefaults: [{ kind: "develop", fields: { tankType: "tank" } }],
      },
    });
    expect(steps.map((s) => s.kind)).toEqual(["capture", "develop"]);
    expect(steps[0].configured).toBe(false);
    expect(steps[1].configured).toBe(true);
    expect(steps[1].processFields).toEqual({ tankType: "tank" });
  });

  it("preserves identified duplicate step kinds and their separate typed defaults", () => {
    const steps = stepsFromTemplate({
      value: {
        medium: "film",
        steps: [
          {
            id: "develop-negative",
            kind: "develop",
            processDefaults: { chemistry: "at://did/app.graycard.instance.chemistry/dev" },
          },
          {
            id: "develop-reversal",
            kind: "develop",
            processDefaults: { chemistry: "at://did/app.graycard.instance.chemistry/reversal" },
            stageDefaults: { notes: "Second developer" },
          },
        ],
      },
    });
    expect(steps.map((step) => step.id)).toEqual(["develop-negative", "develop-reversal"]);
    expect(steps.map((step) => step.processFields.chemistry)).toEqual([
      "at://did/app.graycard.instance.chemistry/dev",
      "at://did/app.graycard.instance.chemistry/reversal",
    ]);
    expect(steps[1].stageFields).toEqual({ notes: "Second developer" });
  });

  it("assigns deterministic IDs and distinct defaults to repeated legacy kinds", () => {
    const steps = stepsFromTemplate({
      value: {
        stageKinds: ["develop", "develop"],
        stageDefaults: [
          { kind: "develop", fields: { chemistry: "at://first" } },
          { kind: "develop", fields: { chemistry: "at://second" } },
        ],
      },
    });
    expect(steps.map((step) => step.id)).toEqual(["develop-1", "develop-2"]);
    expect(steps.map((step) => step.processFields.chemistry)).toEqual(["at://first", "at://second"]);
  });
});

describe("workflow template conversion", () => {
  it("normalizes a legacy linear template into ports and compatible edges", () => {
    const normalized = normalizeWorkflowTemplate({
      value: { medium: "film", stageKinds: ["capture", "develop", "digitize", "edit", "output"] },
    });
    expect(normalized.source).toBe("legacy");
    expect(normalized.steps.map((step) => step.id)).toEqual([
      "capture-1",
      "develop-1",
      "digitize-1",
      "edit-1",
      "output-1",
    ]);
    expect(normalized.connections).toHaveLength(4);
    expect(normalized.connections[1]).toMatchObject({
      fromStep: "develop-1",
      toStep: "digitize-1",
      artifactKind: "film-negative",
    });
  });

  it("serializes rich steps together with a legacy mirror", () => {
    const payload = templateFromSteps("Reversal", "film", [
      { kind: "develop", processFields: { chemistry: "at://chem/first" }, stageFields: {}, configured: true },
      { kind: "develop", processFields: { chemistry: "at://chem/second" }, stageFields: {}, configured: true },
    ]);
    expect(payload.steps.map((step) => step.id)).toEqual(["develop-1", "develop-2"]);
    expect(payload.steps[1].processDefaults).toEqual({ chemistry: "at://chem/second" });
    expect(payload.stageKinds).toEqual(["develop", "develop"]);
    expect(payload.stageDefaults).toHaveLength(2);
  });

  it("plans session-less stages with stable template identity and lifecycle state", () => {
    const [stage] = plannedStagesFromTemplate(
      {
        value: {
          steps: [{ id: "scan-master", kind: "digitize", processDefaults: { scanner: "at://scanner" } }],
        },
      },
      { plannedAt: "2026-08-13T12:00:00.000Z" },
    );
    expect(stage).toMatchObject({
      templateStepId: "scan-master",
      occurrence: 1,
      processDefaults: { scanner: "at://scanner" },
      value: {
        templateStepId: "scan-master",
        occurrence: 1,
        status: "planned",
        processDefaults: { scanner: "at://scanner" },
        inputBindings: [{ port: "input", artifact: { kind: "film-negative" } }],
        outputBindings: [{ port: "output", artifact: { kind: "digital-raster" } }],
        outputs: [{ kind: "digital-raster" }],
        plannedAt: "2026-08-13T12:00:00.000Z",
      },
    });
    expect(stage.value.session).toBeUndefined();
  });

  it("retains every named input and output port in planned artifact bindings", () => {
    const [stage] = plannedStagesFromTemplate({
      value: {
        steps: [
          {
            id: "composite-print",
            kind: "print",
            inputs: [
              { id: "negative", artifactKinds: ["film-negative"] },
              { id: "mask", artifactKinds: ["film-negative", "other"] },
            ],
            outputs: [
              { id: "work-print", artifactKinds: ["physical-print"] },
              { id: "final-print", artifactKinds: ["physical-print"] },
            ],
          },
        ],
      },
    });

    expect(stage.value.input).toEqual({ kind: "film-negative" });
    expect(stage.value.output).toEqual({ kind: "physical-print" });
    expect(stage.value.inputBindings).toEqual([
      { port: "negative", artifact: { kind: "film-negative" } },
      { port: "mask", artifact: { kind: "film-negative" } },
    ]);
    expect(stage.value.outputBindings).toEqual([
      { port: "work-print", artifact: { kind: "physical-print" } },
      { port: "final-print", artifact: { kind: "physical-print" } },
    ]);
    expect(stage.value.outputs).toEqual([{ kind: "physical-print" }, { kind: "physical-print" }]);
  });
});

describe("workflow topology validation", () => {
  const port = (id, artifactKinds, max = 1) => ({ id, artifactKinds, cardinality: { min: 0, max } });

  it("accepts branching DAGs with compatible artifact ports", () => {
    const template = {
      value: {
        steps: [
          { id: "develop", kind: "develop", outputs: [port("negative", ["film-negative"], 2)] },
          { id: "scan", kind: "digitize", inputs: [port("negative", ["film-negative"])] },
          { id: "print", kind: "print", inputs: [port("negative", ["film-negative"])] },
        ],
        connections: [
          {
            id: "scan-flow",
            fromStep: "develop",
            fromPort: "negative",
            toStep: "scan",
            toPort: "negative",
            artifactKind: "film-negative",
          },
          {
            id: "print-flow",
            fromStep: "develop",
            fromPort: "negative",
            toStep: "print",
            toPort: "negative",
            artifactKind: "film-negative",
          },
        ],
      },
    };
    expect(validateWorkflowTopology(template)).toEqual([]);
    expect(() => assertWorkflowTopology(template)).not.toThrow();
  });

  it("reports duplicate identities, broken endpoints, incompatible kinds, cycles, and bad cardinality", () => {
    const template = {
      value: {
        steps: [
          {
            id: "same",
            kind: "capture",
            optional: true,
            cardinality: { min: 1, max: 0 },
            inputs: [port("duplicate", ["scene"]), port("duplicate", ["scene"])],
            outputs: [port("out", ["digital-raw"])],
          },
          {
            id: "same",
            kind: "edit",
            inputs: [port("in", ["film-negative"])],
            outputs: [port("out", ["digital-raster"])],
          },
          {
            id: "final",
            kind: "output",
            inputs: [port("in", ["digital-raster"])],
            outputs: [port("out", ["digital-raw"])],
          },
        ],
        connections: [
          { id: "edge", fromStep: "same", fromPort: "out", toStep: "final", toPort: "missing" },
          {
            id: "edge",
            fromStep: "final",
            fromPort: "out",
            toStep: "same",
            toPort: "in",
            artifactKind: "digital-raw",
          },
          { id: "unknown", fromStep: "missing", fromPort: "out", toStep: "final", toPort: "in" },
        ],
      },
    };
    const issues = validateWorkflowTopology(template);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate-step-id",
        "duplicate-port-id",
        "duplicate-connection-id",
        "unknown-step",
        "unknown-port",
        "incompatible-artifact-kind",
        "invalid-cardinality",
        "cycle",
      ]),
    );
    expect(() => assertWorkflowTopology(template)).toThrow(WorkflowTopologyValidationError);
  });

  it("enforces port connection maxima", () => {
    const template = {
      value: {
        steps: [
          { id: "source", kind: "develop", outputs: [port("out", ["film-negative"], 1)] },
          { id: "a", kind: "print", inputs: [port("in", ["film-negative"])] },
          { id: "b", kind: "digitize", inputs: [port("in", ["film-negative"])] },
        ],
        connections: [
          { id: "a", fromStep: "source", fromPort: "out", toStep: "a", toPort: "in" },
          { id: "b", fromStep: "source", fromPort: "out", toStep: "b", toPort: "in" },
        ],
      },
    };
    expect(validateWorkflowTopology(template)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "connection-cardinality" })]),
    );
  });
});

describe("getRunForPhoto", () => {
  it("returns null when a photo has no workflow", () => {
    const store = { photoWorkflowByPhoto: new Map(), workflowRuns: [], workflowStages: [] };
    expect(getRunForPhoto(store, "at://p")).toBe(null);
  });
  it("resolves and orders stages by position", () => {
    const store = {
      photoWorkflowByPhoto: new Map([["at://p", { value: { run: "at://run" } }]]),
      workflowRuns: [
        {
          uri: "at://run",
          value: {
            stages: [
              { stage: "at://s2", position: 1 },
              { stage: "at://s1", position: 0 },
            ],
          },
        },
      ],
      workflowStages: [
        { uri: "at://s1", value: { $type: STAGE_VARIANTS.capture } },
        { uri: "at://s2", value: { $type: STAGE_VARIANTS.develop } },
      ],
    };
    const r = getRunForPhoto(store, "at://p");
    expect(r.stages.map((s) => s.uri)).toEqual(["at://s1", "at://s2"]);
  });
});
