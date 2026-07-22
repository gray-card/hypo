import { describe, it, expect } from "vitest";
import { splitRollFromStockpile, NS } from "../src/graycard.js";
import { mockAgent } from "./setup.js";

const did = "did:plc:test";
const stockpile = () => ({
  uri: "at://did:plc:test/app.graycard.instance.filmStockpile/rkS",
  cid: "cidS", rkey: "rkS",
  value: { stock: "at://did:plc:test/app.graycard.catalog.filmStock/rkF", quantity: 5, format: "35mm", createdAt: "2026-01-01T00:00:00Z" },
});

const fullStockpile = () => ({
  uri: "at://did:plc:test/app.graycard.instance.filmStockpile/rkS",
  cid: "cidS", rkey: "rkS",
  value: {
    stock: "at://did:plc:test/app.graycard.catalog.filmStock/rkF",
    quantity: 3, format: "120", storage: "freezer",
    emulsionBatch: "AB-2231", expiresAt: "2027-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00Z",
  },
});

describe("splitRollFromStockpile", () => {
  it("creates a loaded roll and decrements the reserve", async () => {
    const agent = mockAgent();
    const sp = stockpile();
    const rollUri = await splitRollFromStockpile(agent, did, sp, { camera: "at://cam", label: "Roll 12" });

    const created = agent.created.find((c) => c.collection === NS.instance.filmRoll);
    expect(created.record).toMatchObject({
      stock: sp.value.stock, stockpile: sp.uri, status: "loaded",
      camera: "at://cam", label: "Roll 12", format: "35mm",
    });
    expect(created.record.loadedAt).toBeTruthy();
    expect(rollUri).toContain(NS.instance.filmRoll);

    // the stockpile is updated in place (putRecord), quantity 5 -> 4
    const put = agent.put.find((p) => p.collection === NS.instance.filmStockpile);
    expect(put.rkey).toBe("rkS");
    expect(put.record.quantity).toBe(4);
    expect(put.record.createdAt).toBe("2026-01-01T00:00:00Z"); // preserved
  });

  it("marks the roll 'loaded' when split without a camera and never goes below zero", async () => {
    const agent = mockAgent();
    const sp = stockpile();
    sp.value.quantity = 0;
    await splitRollFromStockpile(agent, did, sp, {});
    const created = agent.created.find((c) => c.collection === NS.instance.filmRoll);
    expect(created.record.status).toBe("loaded");      // no "stored" limbo; splitting loads it
    expect(created.record.loadedAt).toBeTruthy();
    expect(created.record.camera).toBeUndefined();     // camera optional
    const put = agent.put.find((p) => p.collection === NS.instance.filmStockpile);
    expect(put.record.quantity).toBe(0); // clamped, not negative
  });

  it("carries batch, expiry and storage from the reserve onto the roll", async () => {
    const agent = mockAgent();
    const sp = fullStockpile();
    await splitRollFromStockpile(agent, did, sp, { camera: "at://cam" });
    const created = agent.created.find((c) => c.collection === NS.instance.filmRoll);
    expect(created.record).toMatchObject({
      format: "120",
      storage: "freezer",
      emulsionBatch: "AB-2231",
      expiresAt: "2027-08-01T00:00:00.000Z",
      status: "loaded",
    });
  });
});
