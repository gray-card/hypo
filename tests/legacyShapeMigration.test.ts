import { describe, expect, it, vi } from "vitest";

import {
  migrateFilmRollValue,
  migrateFilmStockValue,
  migrateLegacyShapesWithClient,
  migrateWorkflowRunValue,
  migrateWorkflowStageValue,
  migrateWorkflowTemplateValue,
} from "../src/legacyShapeMigration.ts";

const REPO = "did:plc:test";

function record(collection: string, rkey: string, value: Record<string, unknown>) {
  return { uri: `at://${REPO}/${collection}/${rkey}`, cid: `bafy${rkey}`, value: { $type: collection, ...value } };
}

describe("canonical record-shape migrations", () => {
  it("moves legacy workflow template defaults into stable steps", () => {
    const migrated = migrateWorkflowTemplateValue({
      name: "Film",
      medium: "film",
      stageKinds: ["capture", "develop", "develop"],
      stageDefaults: [
        { kind: "capture", fields: { lens: "at://lens" } },
        { kind: "develop", fields: { method: "first" } },
        { kind: "develop", fields: { method: "second" } },
      ],
      defaultCamera: "at://camera",
      defaultChemistry: "at://chemistry",
    });
    expect(migrated).not.toHaveProperty("stageKinds");
    expect(migrated).not.toHaveProperty("stageDefaults");
    expect(migrated.steps).toEqual([
      { id: "capture-1", kind: "capture", processDefaults: { lens: "at://lens", camera: "at://camera" } },
      { id: "develop-1", kind: "develop", processDefaults: { method: "first", chemistry: "at://chemistry" } },
      { id: "develop-2", kind: "develop", processDefaults: { method: "second" } },
    ]);
  });

  it("wraps scalar catalog and publication fields without dropping explicit arrays", () => {
    expect(migrateFilmStockValue({ format: "120", formats: ["135"] })).toEqual({ formats: ["120", "135"] });
    expect(
      migrateWorkflowRunValue({
        photo: "at://photo",
        products: [{ kind: "physical-print", ref: "at://print" }],
      }),
    ).toEqual({
      products: [
        { kind: "physical-print", ref: "at://print" },
        { kind: "digital-raster", ref: "at://photo" },
      ],
    });
  });

  it("preserves a grouped roll count as one roll plus its remaining reserve", () => {
    const migrated = migrateFilmRollValue({
      stock: "at://stock",
      quantity: 4,
      format: "120",
      createdAt: "2026-10-30T12:00:00.000Z",
    });
    expect(migrated.roll).not.toHaveProperty("quantity");
    expect(migrated.stockpile).toMatchObject({ stock: "at://stock", quantity: 3, format: "120" });
  });

  it("renames capture and output aliases and fails closed on conflicts", () => {
    expect(
      migrateWorkflowStageValue({
        $type: "app.graycard.workflow#captureStage",
        session: "at://shoot",
      }),
    ).toMatchObject({ shoot: "at://shoot" });
    expect(
      migrateWorkflowStageValue({
        $type: "app.graycard.workflow#outputStage",
        photo: "at://photo",
      }),
    ).toMatchObject({ target: { service: "social.grain", ref: "at://photo" } });
    expect(() =>
      migrateWorkflowStageValue({
        $type: "app.graycard.workflow#captureStage",
        session: "at://one",
        shoot: "at://two",
      }),
    ).toThrow(/conflicting/);
  });

  it("rewrites every legacy collection with swap-protected atomic writes", async () => {
    const collections = {
      "app.graycard.catalog.filmStock": [
        record("app.graycard.catalog.filmStock", "tri-x", {
          name: "Tri-X",
          format: "120",
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      "app.graycard.instance.filmRoll": [
        record("app.graycard.instance.filmRoll", "reserve", {
          stock: `at://${REPO}/app.graycard.catalog.filmStock/tri-x`,
          quantity: 4,
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      "app.graycard.instance.filmStockpile": [],
      "app.graycard.workflow.template": [
        record("app.graycard.workflow.template", "template", {
          name: "Film",
          medium: "film",
          stageKinds: ["capture"],
          defaultCamera: `at://${REPO}/app.graycard.instance.camera/one`,
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      "app.graycard.workflow.run": [
        record("app.graycard.workflow.run", "run", {
          photo: `at://${REPO}/social.grain.photo/one`,
          medium: "digital",
          stages: [],
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      "app.graycard.workflow.stage": [
        record("app.graycard.workflow.stage", "stage", {
          $type: "app.graycard.workflow#captureStage",
          session: `at://${REPO}/app.graycard.session.capture/one`,
        }),
      ],
    };
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const client = {
      describe: vi.fn(async () => ({ collections: Object.keys(collections) })),
      listAll: vi.fn(async ({ collection }: { collection: keyof typeof collections }) => collections[collection]),
      getLatestCommit: vi.fn(async () => ({ cid: "bafycommit", rev: "1" })),
      applyWrites,
    };

    await expect(migrateLegacyShapesWithClient(client, REPO)).resolves.toMatchObject({
      migrated: true,
      filmStocks: 1,
      filmRolls: 1,
      workflowTemplates: 1,
      workflowRuns: 1,
      workflowStages: 1,
    });
    expect(applyWrites).toHaveBeenCalledOnce();
    const writes = applyWrites.mock.calls[0][0].writes;
    expect(writes).toHaveLength(6);
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $type: "com.atproto.repo.applyWrites#create",
          collection: "app.graycard.instance.filmStockpile",
          rkey: "reserve",
          value: expect.objectContaining({ quantity: 3 }),
        }),
        expect.objectContaining({
          collection: "app.graycard.instance.filmRoll",
          value: expect.not.objectContaining({ quantity: expect.anything() }),
        }),
      ]),
    );
    expect(applyWrites).toHaveBeenCalledWith(
      expect.objectContaining({ repo: REPO, swapCommit: "bafycommit", validate: false }),
    );
  });
});
