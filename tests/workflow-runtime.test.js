import { describe, expect, it } from "vitest";
import {
  cancelWorkflowRun,
  completeWorkflowStageAndAdvance,
  findNextActionableStage,
  instantiateWorkflowTemplate,
  skipWorkflowStageAndAdvance,
} from "../src/workflow.js";
import { NS } from "../src/graycard.js";
import { mockAgent } from "./setup.js";

function recordsWritten(agent, collection) {
  return agent.created.flatMap((write, index) =>
    write.collection === collection
      ? [
          {
            uri: `at://did:plc:test/${collection}/rk${index + 1}`,
            cid: `cid${index + 1}`,
            rkey: `rk${index + 1}`,
            value: write.record,
          },
        ]
      : [],
  );
}

function branchedTemplate() {
  const port = (id, kind, max = 1) => ({ id, artifactKinds: [kind], cardinality: { min: 0, max } });
  return {
    uri: "at://did:plc:test/app.graycard.workflow.template/film",
    cid: "template-cid",
    value: {
      name: "Negative to scan and print",
      medium: "film",
      steps: [
        {
          id: "develop",
          kind: "develop",
          outputs: [port("negative", "film-negative", 2)],
          processDefaults: { chemistry: "at://did:plc:test/app.graycard.instance.chemistry/d76" },
        },
        { id: "scan", kind: "digitize", inputs: [port("negative", "film-negative")] },
        { id: "print", kind: "print", inputs: [port("negative", "film-negative")] },
      ],
      connections: [
        {
          id: "negative-to-scan",
          fromStep: "develop",
          fromPort: "negative",
          toStep: "scan",
          toPort: "negative",
          artifactKind: "film-negative",
        },
        {
          id: "negative-to-print",
          fromStep: "develop",
          fromPort: "negative",
          toStep: "print",
          toPort: "negative",
          artifactKind: "film-negative",
        },
      ],
      createdAt: "2026-08-13T10:00:00.000Z",
    },
  };
}

describe("workflow runtime", () => {
  it("instantiates a session-less branched run with durable topology and a roll subject", async () => {
    const agent = mockAgent();
    const roll = "at://did:plc:test/app.graycard.instance.filmRoll/roll";
    const template = branchedTemplate();
    const result = await instantiateWorkflowTemplate(agent, "did:plc:test", {
      template,
      subjects: [{ kind: "film-roll-latent", ref: roll, label: "Roll 12" }],
      processDefaults: { filmRoll: roll },
      plannedAt: "2026-08-13T12:00:00.000Z",
    });

    expect(result.stageUris).toHaveLength(3);
    expect(agent.created.filter((write) => write.collection.startsWith("app.graycard.process."))).toEqual([]);
    const stages = recordsWritten(agent, NS.workflow.stage);
    expect(stages.map((stage) => stage.value.status)).toEqual(["ready", "planned", "planned"]);
    expect(stages[0].value.$type).toBe("app.graycard.workflow#developStage");
    expect(stages[0].value.processDefaults).toMatchObject({
      filmRoll: roll,
      chemistry: "at://did:plc:test/app.graycard.instance.chemistry/d76",
    });
    const [run] = recordsWritten(agent, NS.workflow.run);
    expect(run.value).toMatchObject({
      template: template.uri,
      templateRevision: template.cid,
      templateName: template.value.name,
      status: "ready",
      subjects: [{ kind: "film-roll-latent", ref: roll, label: "Roll 12" }],
    });
    expect(run.value.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateConnectionId: "negative-to-scan",
          fromPort: "negative",
          toPort: "negative",
          artifactKind: "film-negative",
        }),
        expect.objectContaining({ templateConnectionId: "negative-to-print" }),
      ]),
    );
  });

  it("completes a real session and unlocks both downstream branches", async () => {
    const agent = mockAgent();
    const roll = "at://did:plc:test/app.graycard.instance.filmRoll/roll";
    await instantiateWorkflowTemplate(agent, "did:plc:test", {
      template: branchedTemplate(),
      subjects: [{ kind: "film-roll-latent", ref: roll }],
      processDefaults: { filmRoll: roll },
    });
    const store = {
      workflowStages: recordsWritten(agent, NS.workflow.stage),
      workflowRuns: recordsWritten(agent, NS.workflow.run),
    };
    const next = findNextActionableStage(store, roll, { kind: "develop" });
    expect(next?.stage.value.templateStepId).toBe("develop");
    const completion = await completeWorkflowStageAndAdvance(agent, "did:plc:test", {
      store,
      ...next,
      sessionUri: "at://did:plc:test/app.graycard.process.developSession/session",
      completedAt: "2026-08-13T13:00:00.000Z",
      products: [{ kind: "film-negative", ref: "at://did:plc:test/app.graycard.artifact/negative" }],
    });

    expect(completion.runStatus).toBe("in-progress");
    const stageUpdates = agent.put.filter((write) => write.collection === NS.workflow.stage);
    expect(stageUpdates[0].record).toMatchObject({
      $type: "app.graycard.workflow#developStage",
      status: "completed",
      session: "at://did:plc:test/app.graycard.process.developSession/session",
    });
    expect(stageUpdates.slice(1).map((write) => write.record.status)).toEqual(["ready", "ready"]);
    expect(agent.put.find((write) => write.collection === NS.workflow.run)?.record.status).toBe("in-progress");
  });

  it("honors optional and repeatable occurrence counts", async () => {
    const agent = mockAgent();
    const template = {
      value: {
        name: "Variable outputs",
        medium: "digital",
        steps: [
          { id: "capture", kind: "capture", cardinality: { min: 1, max: 1 } },
          { id: "edit", kind: "edit", cardinality: { min: 1, max: 3 } },
          { id: "print", kind: "print", optional: true, cardinality: { min: 0, max: 1 } },
        ],
        createdAt: "2026-08-13T10:00:00.000Z",
      },
    };
    const result = await instantiateWorkflowTemplate(agent, "did:plc:test", {
      template,
      subjects: [{ kind: "scene", ref: "at://did:plc:test/app.graycard.session.capture/shoot" }],
      occurrences: { edit: 3, print: 0 },
    });
    expect(result.stageUris).toHaveLength(4);
    const stages = recordsWritten(agent, NS.workflow.stage);
    expect(
      stages.filter((stage) => stage.value.templateStepId === "edit").map((stage) => stage.value.occurrence),
    ).toEqual([1, 2, 3]);
    expect(stages.some((stage) => stage.value.templateStepId === "print")).toBe(false);
  });

  it("lets an optional action be skipped and lets an active run be cancelled", async () => {
    const agent = mockAgent();
    await instantiateWorkflowTemplate(agent, "did:plc:test", {
      template: {
        value: {
          name: "Optional print",
          medium: "film",
          steps: [{ id: "print", kind: "print", optional: true, cardinality: { min: 0, max: 1 } }],
          connections: [],
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      },
      subjects: [{ kind: "film-negative", ref: "at://did:plc:test/app.graycard.artifact/negative" }],
      occurrences: { print: 1 },
    });
    const store = {
      workflowStages: recordsWritten(agent, NS.workflow.stage),
      workflowRuns: recordsWritten(agent, NS.workflow.run),
    };
    const next = findNextActionableStage(store, store.workflowRuns[0]);
    expect(next?.stage.value).toMatchObject({ optional: true, status: "ready" });
    const skipped = await skipWorkflowStageAndAdvance(agent, "did:plc:test", { store, ...next });
    expect(skipped.runStatus).toBe("completed");
    expect(agent.put.find((write) => write.collection === NS.workflow.stage)?.record.status).toBe("skipped");

    const cancelAgent = mockAgent();
    await instantiateWorkflowTemplate(cancelAgent, "did:plc:test", {
      template: branchedTemplate(),
      subjects: [{ kind: "film-roll-latent", ref: "at://did:plc:test/app.graycard.instance.filmRoll/two" }],
    });
    const cancelStore = {
      workflowStages: recordsWritten(cancelAgent, NS.workflow.stage),
      workflowRuns: recordsWritten(cancelAgent, NS.workflow.run),
    };
    await cancelWorkflowRun(cancelAgent, "did:plc:test", {
      store: cancelStore,
      run: cancelStore.workflowRuns[0],
      cancelledAt: "2026-08-13T14:00:00.000Z",
    });
    expect(cancelAgent.put.filter((write) => write.collection === NS.workflow.stage)).toHaveLength(3);
    expect(cancelAgent.put.find((write) => write.collection === NS.workflow.run)?.record.status).toBe("cancelled");
  });
});
