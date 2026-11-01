import { describe, expect, it, vi } from "vitest";
import { applyProcessBatch, previewProcessBatch } from "../src/processBatch.js";

const scan = (uri, value) => ({ uri, value });
const rigUri = "at://did:example:one/app.graycard.instance.scanSetup/rig";
const devPlanUri = "at://did:example:one/app.graycard.process.developmentPlan/one";
const printPlanUri = "at://did:example:one/app.graycard.print.exposurePlan/one";
const store = {
  byUri: new Map([
    [
      rigUri,
      {
        item: scan(rigUri, {
          name: "120 rig",
          components: [{ id: "camera", role: "capture-camera", label: "Mirrorless" }],
        }),
      },
    ],
    [
      devPlanUri,
      {
        item: scan(devPlanUri, {
          name: "D-76 sequence",
          process: "bw",
          steps: [{ roles: [], publishedTimeSeconds: 600 }],
        }),
      },
    ],
    [
      printPlanUri,
      {
        item: scan(printPlanUri, {
          name: "Straight print",
          exposures: [{ id: "base", action: "base", durationMs: 10000 }],
        }),
      },
    ],
  ]),
  recordsByCollection: {
    "app.graycard.process.digitizeSession": [
      scan("at://did:example:one/app.graycard.process.digitizeSession/a", {
        method: "mirrorless-copy-stand",
        notes: "",
        createdAt: "2026-01-01T00:00:00Z",
      }),
      scan("at://did:example:one/app.graycard.process.digitizeSession/b", {
        method: "lab-scan",
        notes: "Lab",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ],
    "app.graycard.workflow.stage": [
      scan("at://did:example:one/app.graycard.workflow.stage/a", { status: "ready", processDefaults: {} }),
      scan("at://did:example:one/app.graycard.workflow.stage/b", { status: "completed", processDefaults: {} }),
    ],
  },
};

describe("process batch rules", () => {
  it("previews a conditional scan-setup assignment without mutating records", () => {
    const rule = {
      scope: "digitize-session",
      when: { field: "record.method", op: "eq", value: "mirrorless-copy-stand" },
      actions: [{ op: "setField", field: "scanSetup", value: rigUri, mode: "fill" }],
    };
    const result = previewProcessBatch(store, rule);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].next.scanSetup).toContain("scanSetup/rig");
    expect(result.matched[0].next.setupSnapshot.name).toBe("120 rig");
    expect(store.recordsByCollection["app.graycard.process.digitizeSession"][0].value.scanSetup).toBeUndefined();
  });

  it("only edits planned or ready workflow defaults", () => {
    const result = previewProcessBatch(store, {
      scope: "workflow-stage",
      when: { field: "record.status", op: "notEmpty" },
      actions: [
        {
          op: "setField",
          field: "processDefaults.scanSetup",
          value: "at://did:example:one/app.graycard.instance.scanSetup/rig",
        },
      ],
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].next.processDefaults.scanSetup).toContain("scanSetup/rig");
  });

  it("keeps development and print session snapshots in step with assigned plans", () => {
    const planned = {
      ...store,
      recordsByCollection: {
        ...store.recordsByCollection,
        "app.graycard.process.developSession": [scan("dev", { createdAt: "2026-01-01T00:00:00Z" })],
        "app.graycard.process.printSession": [scan("print", { createdAt: "2026-01-01T00:00:00Z" })],
      },
    };
    const development = previewProcessBatch(planned, {
      scope: "develop-session",
      when: null,
      actions: [{ op: "setField", field: "developmentPlan", value: devPlanUri }],
    }).matched[0].next;
    const print = previewProcessBatch(planned, {
      scope: "print-session",
      when: null,
      actions: [{ op: "setField", field: "exposurePlan", value: printPlanUri }],
    }).matched[0].next;
    expect(development.developmentPlanSnapshot.steps[0].publishedTimeSeconds).toBe(600);
    expect(print.exposurePlanSnapshot.exposures[0].durationMs).toBe(10000);
    const cleared = previewProcessBatch(
      {
        ...planned,
        recordsByCollection: {
          ...planned.recordsByCollection,
          "app.graycard.process.printSession": [scan("print", print)],
        },
      },
      { scope: "print-session", when: null, actions: [{ op: "clearField", field: "exposurePlan" }] },
    ).matched[0].next;
    expect(cleared.exposurePlan).toBeUndefined();
    expect(cleared.exposurePlanSnapshot).toBeUndefined();
  });

  it("clears a scanning setup snapshot when its link is removed", () => {
    const source = scan("scan", { scanSetup: rigUri, setupSnapshot: { name: "120 rig", components: [] } });
    const result = previewProcessBatch(
      {
        ...store,
        recordsByCollection: { ...store.recordsByCollection, "app.graycard.process.digitizeSession": [source] },
      },
      { scope: "digitize-session", when: null, actions: [{ op: "clearField", field: "scanSetup" }] },
    );
    expect(result.matched[0].next.scanSetup).toBeUndefined();
    expect(result.matched[0].next.setupSnapshot).toBeUndefined();
  });

  it("rejects unsupported mutations instead of silently ignoring them", () => {
    expect(() =>
      previewProcessBatch(store, {
        scope: "digitize-session",
        when: null,
        actions: [{ op: "setField", field: "createdAt", value: "bad" }],
      }),
    ).toThrow(/cannot be changed/);
    expect(() =>
      previewProcessBatch(store, { scope: "digitize-session", when: null, actions: [{ op: "applyWorkflowTemplate" }] }),
    ).toThrow(/not a supported action/);
  });

  it("applies only the previewed changes with a fresh updatedAt", async () => {
    const save = vi.fn(async () => "saved");
    const result = await applyProcessBatch(
      store,
      {
        scope: "digitize-session",
        when: { field: "record.method", op: "eq", value: "lab-scan" },
        actions: [{ op: "clearField", field: "notes" }],
      },
      save,
    );
    expect(result.matched).toHaveLength(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1].notes).toBeUndefined();
  });
});
