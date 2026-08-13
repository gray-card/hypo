import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveGallery } from "../src/grain.js";
import { NS, loadStore, saveRecord, splitRollFromStockpile } from "../src/graycard.js";
import { flush, pending } from "../src/outbox.js";
import { mockAgent } from "./setup.js";

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(false);
});

afterEach(() => setOnline(true));

describe("all-feature offline writes", () => {
  it("queues gear creates and edits, then flushes them in order", async () => {
    const did = "did:plc:offline-gear";
    const agent = mockAgent();
    const created = await saveRecord(
      agent,
      did,
      NS.instance.camera,
      { type: "at://catalog/camera", nickname: "field body", createdAt: "2026-08-11T12:00:00Z" },
      null,
    );
    const existing = {
      uri: `at://${did}/${NS.instance.camera}/camera-a`,
      rkey: "camera-a",
      cid: "cid-old",
      value: { nickname: "old" },
    };
    await saveRecord(agent, did, NS.instance.camera, { nickname: "edited" }, existing);

    expect(created).toMatch(/^outbox:/);
    expect(agent.created).toHaveLength(0);
    expect(agent.put).toHaveLength(0);
    expect(pending(did, NS.instance.camera).map((operation) => operation.kind)).toEqual(["create", "put"]);
    const optimistic = await loadStore(agent, did);
    expect(optimistic.instance.camera.map((record) => record.value.nickname)).toEqual(["edited", "field body"]);

    setOnline(true);
    await flush(agent, did);
    expect(agent.created).toHaveLength(1);
    expect(agent.put).toHaveLength(1);
    expect(pending(did, NS.instance.camera)).toHaveLength(0);
  });

  it("queues both sides of a roll split without losing their order", async () => {
    const did = "did:plc:offline-roll";
    const agent = mockAgent();
    const stockpile = {
      uri: `at://${did}/${NS.instance.filmStockpile}/reserve-a`,
      rkey: "reserve-a",
      cid: "cid-reserve",
      value: { stock: "at://catalog/film", quantity: 3, createdAt: "2026-08-11T12:00:00Z" },
    };

    const rollUri = await splitRollFromStockpile(agent, did, stockpile, { label: "Roll 3" });
    expect(rollUri).toMatch(/^outbox:/);
    expect(pending(did).map((operation) => operation.collection)).toEqual([
      NS.instance.filmRoll,
      NS.instance.filmStockpile,
    ]);

    setOnline(true);
    await flush(agent, did);
    expect(agent.created[0].collection).toBe(NS.instance.filmRoll);
    expect(agent.put[0]).toMatchObject({ collection: NS.instance.filmStockpile, rkey: "reserve-a" });
  });

  it("queues gallery metadata edits and preserves the remote swap CID", async () => {
    const did = "did:plc:offline-gallery";
    const agent = mockAgent();
    const gallery = {
      uri: `at://${did}/social.grain.gallery/gallery-a`,
      rkey: "gallery-a",
      cid: "cid-gallery",
      value: { title: "Old title", createdAt: "2026-08-11T12:00:00Z" },
    };

    await saveGallery(agent, did, gallery, { title: "Offline title", description: "field notes" });
    expect(agent.put).toHaveLength(0);
    expect(pending(did, "social.grain.gallery")).toEqual([
      expect.objectContaining({ kind: "put", swapRecord: "cid-gallery" }),
    ]);

    setOnline(true);
    await flush(agent, did);
    expect(agent.put[0]).toMatchObject({
      collection: "social.grain.gallery",
      rkey: "gallery-a",
      record: expect.objectContaining({ title: "Offline title", description: "field notes" }),
    });
  });
});
