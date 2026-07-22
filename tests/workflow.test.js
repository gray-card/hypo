import { describe, it, expect } from "vitest";
import {
  STAGE_LABELS, STAGE_VARIANTS, defaultStagePayload, describeStage, stepsFromTemplate, getRunForPhoto,
} from "../src/workflow.js";

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
});

describe("stepsFromTemplate", () => {
  it("expands stageKinds and marks configured steps", () => {
    const steps = stepsFromTemplate({ value: {
      stageKinds: ["capture", "develop"],
      stageDefaults: [{ kind: "develop", fields: { tankType: "tank" } }],
    } });
    expect(steps.map((s) => s.kind)).toEqual(["capture", "develop"]);
    expect(steps[0].configured).toBe(false);
    expect(steps[1].configured).toBe(true);
    expect(steps[1].processFields).toEqual({ tankType: "tank" });
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
      workflowRuns: [{ uri: "at://run", value: { stages: [
        { stage: "at://s2", position: 1 }, { stage: "at://s1", position: 0 },
      ] } }],
      workflowStages: [
        { uri: "at://s1", value: { $type: STAGE_VARIANTS.capture } },
        { uri: "at://s2", value: { $type: STAGE_VARIANTS.develop } },
      ],
    };
    const r = getRunForPhoto(store, "at://p");
    expect(r.stages.map((s) => s.uri)).toEqual(["at://s1", "at://s2"]);
  });
});
