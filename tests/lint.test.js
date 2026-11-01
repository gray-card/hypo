import { describe, it, expect } from "vitest";
import { computeLintFindings } from "../src/lint.js";

const NOW = Date.parse("2026-07-07T00:00:00Z");

function store() {
  return {
    instance: {
      filmRoll: [
        { uri: "r1", value: { exposuresTotal: 36, exposuresUsed: 38, status: "exposed" } }, // overshot + awaiting
        { uri: "r2", value: { status: "developed" } },
      ],
      exposure: [
        { uri: "e1", value: { photo: "at://did/social.grain.photo/p1" } },
        { uri: "e2", value: {} }, // unlinked
      ],
      chemistry: [
        { uri: "c1", value: { expiresAt: "2026-01-01T00:00:00Z", volumeMl: 1000, volumeRemainingMl: 500 } }, // expired
        { uri: "c2", value: { volumeMl: 1000, volumeRemainingMl: 0 } }, // spent
      ],
    },
    photoCaptureByPhoto: new Map([
      ["p1", { value: { camera: "cam", lens: "lens" } }],
      ["p2", { value: { camera: "cam" } }], // no lens
      ["p3", { value: {} }], // no camera, no lens
    ]),
  };
}

describe("computeLintFindings", () => {
  const f = computeLintFindings(store(), NOW);
  const by = (id) => f.find((x) => x.id === id);

  it("flags rolls over their frame count", () => expect(by("roll-overshot").count).toBe(1));
  it("flags rolls awaiting development", () => expect(by("roll-awaiting-dev").count).toBe(1));
  it("flags unlinked exposures", () => expect(by("exposure-unlinked").count).toBe(1));
  it("flags expired chemistry", () => expect(by("chem-expired").count).toBe(1));
  it("flags spent chemistry", () => expect(by("chem-spent").count).toBe(1));
  it("counts photos missing camera / lens", () => {
    expect(by("cap-no-camera").count).toBe(1);
    expect(by("cap-no-lens").count).toBe(2);
  });

  it("returns nothing for a clean store", () => {
    const clean = { instance: { filmRoll: [], exposure: [], chemistry: [] }, photoCaptureByPhoto: new Map() };
    expect(computeLintFindings(clean, NOW)).toEqual([]);
  });

  it("finds broken setup links, missing snapshots, and completed unlogged stages", () => {
    const broken = {
      instance: {
        filmRoll: [],
        exposure: [],
        chemistry: [],
        scanSetup: [
          {
            uri: "setup",
            value: {
              components: [
                {
                  id: "camera",
                  role: "capture-camera",
                  ref: "at://did:example:one/app.graycard.instance.camera/missing",
                },
              ],
              connections: [{ from: "camera", to: "removed", relation: "mounted-on" }],
            },
          },
        ],
      },
      byUri: new Map(),
      digitizeSessions: [{ uri: "scan", value: { scanSetup: "setup" } }],
      workflowStages: [
        { uri: "stage", value: { $type: "app.graycard.workflow.stage#digitizeStage", status: "completed" } },
      ],
      photoCaptureByPhoto: new Map(),
    };
    const findings = computeLintFindings(broken, NOW);
    expect(findings.find((item) => item.id === "scan-setup-broken-link")?.subjects).toEqual(["setup"]);
    expect(findings.find((item) => item.id === "scan-session-no-snapshot")?.subjects).toEqual(["scan"]);
    expect(findings.find((item) => item.id === "workflow-completed-without-log")?.subjects).toEqual(["stage"]);
  });

  it("finds invalid reusable plans and process sessions missing plan snapshots", () => {
    const exposurePlan = {
      uri: "at://did:plc:test/app.graycard.print.exposurePlan/one",
      value: { name: "Broken", exposures: [{ id: "burn", action: "burn", durationMs: 1000 }] },
    };
    const developmentPlan = {
      uri: "at://did:plc:test/app.graycard.process.developmentPlan/one",
      value: { name: "Empty", process: "bw", steps: [] },
    };
    const printSession = { uri: "print", value: { exposurePlan: exposurePlan.uri } };
    const developSession = { uri: "develop", value: { developmentPlan: developmentPlan.uri } };
    const records = [exposurePlan, developmentPlan, printSession, developSession];
    const findings = computeLintFindings(
      {
        instance: { filmRoll: [], exposure: [], chemistry: [] },
        byUri: new Map(records.map((record) => [record.uri, { item: record }])),
        recordsByCollection: {
          "app.graycard.print.exposurePlan": [exposurePlan],
          "app.graycard.process.developmentPlan": [developmentPlan],
        },
        printSessions: [printSession],
        developSessions: [developSession],
        photoCaptureByPhoto: new Map(),
      },
      NOW,
    );
    expect(findings.find((item) => item.id === "process-plan-invalid")?.subjects).toEqual([
      exposurePlan.uri,
      developmentPlan.uri,
    ]);
    expect(findings.find((item) => item.id === "process-plan-no-snapshot")?.subjects).toEqual(["develop", "print"]);
  });

  it("finds missing semantic scene links and development chemistry in reusable plans", () => {
    const exposurePlan = {
      uri: "at://did:plc:test/app.graycard.print.exposurePlan/one",
      value: {
        name: "Face dodge",
        exposures: [
          { id: "base", action: "base", durationMs: 10000 },
          {
            id: "dodge",
            action: "dodge",
            baseId: "base",
            durationMs: 2000,
            targetNode: "at://did:plc:test/app.graycard.scene.node/missing",
            selections: [
              {
                kind: "polygon",
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 0, y: 100 },
                ],
              },
            ],
          },
        ],
      },
    };
    const developmentPlan = {
      uri: "at://did:plc:test/app.graycard.process.developmentPlan/one",
      value: {
        name: "Black and white",
        process: "bw",
        steps: [
          {
            roles: [{ id: "developer", label: "Developer" }],
            chemistries: ["at://did:plc:test/app.graycard.instance.chemistry/missing"],
          },
        ],
      },
    };
    const findings = computeLintFindings(
      {
        instance: { filmRoll: [], exposure: [], chemistry: [] },
        byUri: new Map(),
        recordsByCollection: {
          "app.graycard.print.exposurePlan": [exposurePlan],
          "app.graycard.process.developmentPlan": [developmentPlan],
        },
        photoCaptureByPhoto: new Map(),
      },
      NOW,
    );
    expect(findings.find((item) => item.id === "process-plan-broken-link")?.subjects).toEqual([
      exposurePlan.uri,
      developmentPlan.uri,
    ]);
  });
});
