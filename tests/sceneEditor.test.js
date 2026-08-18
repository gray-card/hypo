import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordStore } from "@hypo/store";
import * as facade from "../src/ui/sceneEditor.js";
import * as implementation from "../src/ui/sceneEditor.ts";

const mocks = vi.hoisted(() => ({
  blobUrl: vi.fn(async () => null),
  deleteRecord: vi.fn(async () => undefined),
  listRecords: vi.fn(),
  resolvePds: vi.fn(async () => "https://pds.test"),
  saveRecord: vi.fn(async (_agent, _did, collection) => `at://did:plc:test/${collection}/saved`),
}));

vi.mock("../src/graycard.js", () => ({
  NS: {
    scene: {
      edge: "app.graycard.scene.edge",
      graph: "app.graycard.scene.graph",
      node: "app.graycard.scene.node",
      region: "app.graycard.scene.region",
    },
  },
  deleteRecord: mocks.deleteRecord,
  saveRecord: mocks.saveRecord,
}));

vi.mock("../src/grain.js", async (importOriginal) => ({
  ...(await importOriginal()),
  blobUrl: mocks.blobUrl,
  listRecords: mocks.listRecords,
}));

vi.mock("../src/profile.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolvePds: mocks.resolvePds,
}));

vi.mock("../src/data/wikidata.js", () => ({
  refineConceptRanking: vi.fn(async (items) => items),
  searchConcepts: vi.fn(async () => []),
}));

vi.mock("../src/ontology.js", () => ({
  SPATIAL_SEED: [{ id: "left-of", label: "left of" }],
}));

const PHOTO = "at://did:plc:test/social.grain.photo/photo";
const BLOB_CID = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";
const GRAPH = "at://did:plc:test/app.graycard.scene.graph/graph";
const REGION = "at://did:plc:test/app.graycard.scene.region/region";
const DOG = "at://did:plc:test/app.graycard.scene.node/dog";
const TREE = "at://did:plc:test/app.graycard.scene.node/tree";

const records = {
  "app.graycard.scene.graph": [{ uri: GRAPH, cid: "graph-cid", value: { subject: PHOTO } }],
  "app.graycard.scene.region": [
    {
      uri: REGION,
      cid: "region-cid",
      value: {
        photo: PHOTO,
        kind: "bbox",
        bbox: { x: 100_000, y: 200_000, w: 300_000, h: 400_000 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ],
  "app.graycard.scene.node": [
    {
      uri: DOG,
      cid: "dog-cid",
      value: { scene: GRAPH, region: REGION, type: { id: "Q144", label: "dog" }, label: "Fido" },
    },
    {
      uri: TREE,
      cid: "tree-cid",
      value: { scene: GRAPH, type: { id: "Q10884", label: "tree" }, label: "oak" },
    },
  ],
  "app.graycard.scene.edge": [
    {
      uri: "at://did:plc:test/app.graycard.scene.edge/edge",
      cid: "edge-cid",
      value: { scene: GRAPH, from: DOG, to: TREE, type: { id: "left-of", label: "left of" } },
    },
  ],
};

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.listRecords.mockImplementation(async (_agent, _did, collection) => records[collection] || []);
  mocks.resolvePds.mockResolvedValue("https://pds.test");
});

describe("scene editor TypeScript compatibility facade", () => {
  it("re-exports the strict implementation through the established JS path", () => {
    expect(facade.openSceneEditor).toBe(implementation.openSceneEditor);
  });

  it("loads, edits, and persists graph records without changing their identities", async () => {
    const signals = createRecordStore({ repo: "did:plc:test" });
    for (const [collection, values] of Object.entries(records)) signals.replaceRemote(collection, values);
    await facade.openSceneEditor({ agent: {}, did: "did:plc:test" }, { uri: PHOTO, idx: 2, value: {} }, { signals });

    const modal = document.querySelector(".scene-modal");
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain("dog · Fido");
    expect(modal.textContent).toContain("Fido → left of → oak");
    expect(document.querySelector('svg rect[x="0.1"][y="0.2"]')).not.toBeNull();

    document.querySelector('input[placeholder^="relation"]').dispatchEvent(new FocusEvent("focus"));
    expect([...document.querySelectorAll(".term-section")].map((section) => section.textContent)).toContain("Spatial");

    const dogRow = [...document.querySelectorAll(".scene-tag-row")].find((row) => row.textContent.includes("Fido"));
    dogRow.querySelector("button:nth-of-type(2)").click();
    const label = document.querySelector('input[placeholder^="label"]');
    label.value = "Rex";
    document.querySelector(".scene-pending button").click();
    expect(modal.textContent).toContain("dog · Rex");

    [...modal.querySelectorAll("button")].find((button) => button.textContent === "Save to PDS").click();
    await vi.waitFor(() => {
      expect(mocks.saveRecord).toHaveBeenCalledWith(
        {},
        "did:plc:test",
        "app.graycard.scene.node",
        expect.objectContaining({ label: "Rex", region: REGION }),
        { uri: DOG, rkey: "dog", cid: "dog-cid" },
      );
    });
  });

  it("loads the scene image directly from the public PDS instead of requiring an authenticated blob read", async () => {
    const signals = createRecordStore({ repo: "did:plc:test" });
    mocks.blobUrl.mockRejectedValue(new Error("authenticated blob read failed"));

    await facade.openSceneEditor(
      { agent: {}, did: "did:plc:test" },
      {
        uri: PHOTO,
        idx: 0,
        value: {
          photo: { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 3 },
        },
      },
      { signals },
    );

    const image = document.querySelector(".scene-img-wrap img");
    expect(image).not.toBeNull();
    expect(image.src).toBe(`https://pds.test/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Atest&cid=${BLOB_CID}`);
    expect(mocks.blobUrl).not.toHaveBeenCalled();
    expect(document.querySelector(".scene-stage")?.textContent).not.toContain("image failed to load");
  });

  it("uses the hydrated local scene records when authenticated and public collection reads fail", async () => {
    const signals = createRecordStore({ repo: "did:plc:test" });
    for (const [collection, values] of Object.entries(records)) signals.replaceRemote(collection, values);
    mocks.listRecords.mockRejectedValue(new Error("authenticated collection read failed"));
    mocks.resolvePds.mockRejectedValue(new Error("DID resolution failed"));

    await facade.openSceneEditor({ agent: {}, did: "did:plc:test" }, { uri: PHOTO, idx: 1, value: {} }, { signals });

    const modal = document.querySelector(".scene-modal");
    expect(modal?.textContent).toContain("dog · Fido");
    expect(modal?.textContent).toContain("Fido → left of → oak");
    expect(modal?.textContent).not.toContain("Load failed");
  });
});
