import { describe, expect, it } from "vitest";
import { NS, SCHEMAS, validateRecord } from "@hypo/lexicon";
import { STAGE_VARIANTS, defaultStagePayload } from "@hypo/domain";

const createdAt = "2026-08-13T12:00:00.000Z";

describe("rich workflow lexicons", () => {
  it("validates stable repeated steps, typed defaults, ports, and graph connections", () => {
    const result = validateRecord(NS.workflow.template, {
      name: "E-6 reversal with a second developer",
      medium: "film",
      steps: [
        {
          id: "first-developer",
          kind: "develop",
          sessionScope: "per-batch",
          inputs: [{ id: "film", artifactKinds: ["film-roll-latent"], cardinality: { min: 1 } }],
          outputs: [{ id: "negative", artifactKinds: ["film-negative"] }],
          processDefaults: {
            chemistry: "at://did:plc:test/app.graycard.instance.chemistry/first",
            method: "reversal first developer",
          },
        },
        {
          id: "second-developer",
          kind: "develop",
          optional: true,
          cardinality: { min: 0, max: 1 },
          inputs: [{ id: "negative", artifactKinds: ["film-negative"] }],
          outputs: [{ id: "slide", artifactKinds: ["film-slide"] }],
          processDefaults: {
            chemistry: "at://did:plc:test/app.graycard.instance.chemistry/second",
          },
          stageDefaults: { notes: "Run after reversal exposure" },
        },
      ],
      connections: [
        {
          id: "developer-flow",
          fromStep: "first-developer",
          fromPort: "negative",
          toStep: "second-developer",
          toPort: "negative",
          artifactKind: "film-negative",
        },
      ],
      stageKinds: ["develop", "develop"],
      createdAt,
    });
    expect(result).toMatchObject({ success: true });
  });

  it("validates runs with general subjects, products, lifecycle, and template identity", () => {
    const result = validateRecord(NS.workflow.run, {
      medium: "film",
      template: "at://did:plc:test/app.graycard.workflow.template/template",
      templateRevision: "bafy-template-cid",
      templateName: "Film to darkroom print",
      status: "in-progress",
      subjects: [
        {
          kind: "film-roll-latent",
          ref: "at://did:plc:test/app.graycard.instance.filmRoll/roll",
        },
      ],
      products: [{ kind: "physical-print", label: "11 × 14 fiber print" }],
      stages: [
        {
          stage: "at://did:plc:test/app.graycard.workflow.stage/develop",
          position: 0,
          templateStepId: "develop-film",
          occurrence: 1,
        },
      ],
      branches: [
        {
          fromStage: "at://did:plc:test/app.graycard.workflow.stage/develop",
          toStage: "at://did:plc:test/app.graycard.workflow.stage/print",
          label: "print branch",
          templateConnectionId: "negative-to-print",
          fromPort: "negative",
          toPort: "negative",
          artifactKind: "film-negative",
        },
      ],
      plannedAt: createdAt,
      startedAt: createdAt,
      createdAt,
    });
    expect(result).toMatchObject({ success: true });
  });

  it("allows a planned stage without a process session", () => {
    const result = validateRecord(NS.workflow.stage, {
      $type: STAGE_VARIANTS.develop,
      templateStepId: "develop-film",
      occurrence: 1,
      status: "planned",
      processDefaults: {
        chemistry: "at://did:plc:test/app.graycard.instance.chemistry/developer",
        method: "small tank",
      },
      input: { kind: "film-roll-latent" },
      output: { kind: "film-negative" },
      outputs: [{ kind: "film-negative" }, { kind: "contact-sheet" }],
      inputBindings: [{ port: "roll", artifact: { kind: "film-roll-latent" } }],
      outputBindings: [
        { port: "negative", artifact: { kind: "film-negative" } },
        { port: "contact-sheet", artifact: { kind: "contact-sheet" } },
      ],
      plannedAt: createdAt,
    });
    expect(result).toMatchObject({ success: true });
  });

  it("exposes bindings and compatibility outputs on every stage variant", () => {
    const defs = SCHEMAS[NS.workflow.stage].defs;
    for (const name of [
      "captureStage",
      "developStage",
      "digitizeStage",
      "digitalStage",
      "printStage",
      "editStage",
      "outputStage",
      "otherStage",
    ]) {
      expect(defs[name].properties.inputBindings.ref ?? defs[name].properties.inputBindings.items.ref).toBe(
        "app.graycard.workflow.defs#artifactBinding",
      );
      expect(defs[name].properties.outputBindings.items.ref).toBe("app.graycard.workflow.defs#artifactBinding");
      expect(defs[name].properties.outputs.items.ref).toBe("app.graycard.workflow.defs#artifactRef");
    }
  });

  it("uses the canonical shoot and render-session records without changing stable stage discriminators", () => {
    const defs = SCHEMAS[NS.workflow.stage].defs;
    expect(defs.captureStage.properties.shoot.description).toContain("app.graycard.session.capture");
    expect(defs.captureStage.properties.session.description).toContain("Deprecated alias of shoot");
    expect(defs.digitalStage.description).toContain("render or export stage");
    expect(defs.digitalStage.properties.session.description).toContain("app.graycard.process.renderSession");
    expect(STAGE_VARIANTS.digital).toBe("app.graycard.workflow#digitalStage");
  });

  it("validates custom stage kinds through the other-stage union member", () => {
    const result = validateRecord(NS.workflow.stage, {
      ...defaultStagePayload("selenium-tone"),
      status: "planned",
      processDefaults: { chemistry: "at://did:plc:test/app.graycard.instance.chemistry/toner" },
      plannedAt: createdAt,
    });
    expect(result).toMatchObject({ success: true });
  });
});
