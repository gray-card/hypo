// the export/import bundle must round-trip idempotently: exporting the repo and
// importing it back is a no-op, and importing a bundle then exporting reproduces
// it. also guards that the export covers every app.graycard record lexicon.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exportBundle, diffBundle, writeBundle, graycardCollections } from "../src/import.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// a tiny in-memory PDS: create/put/get/list/delete over a Map, enough for the
// bundle pipeline to run without a network.
function memAgent(did = "did:plc:test") {
  const store = new Map(); // "collection|rkey" -> value
  let seq = 0;
  const uri = (c, rk) => `at://${did}/${c}/${rk}`;
  const cid = (c, rk) => `cid-${c}-${rk}`;
  return {
    store,
    com: { atproto: { repo: {
      createRecord: async ({ collection, record }) => {
        const rkey = `rk${++seq}`;
        store.set(`${collection}|${rkey}`, record);
        return { data: { uri: uri(collection, rkey), cid: cid(collection, rkey) } };
      },
      putRecord: async ({ collection, rkey, record }) => {
        store.set(`${collection}|${rkey}`, record);
        return { data: { uri: uri(collection, rkey), cid: cid(collection, rkey) } };
      },
      getRecord: async ({ collection, rkey }) => {
        const v = store.get(`${collection}|${rkey}`);
        if (v === undefined) throw new Error("not found");
        return { data: { value: v, cid: cid(collection, rkey) } };
      },
      listRecords: async ({ collection }) => {
        const records = [];
        for (const [k, value] of store) {
          const [c, rkey] = k.split("|");
          if (c === collection) records.push({ uri: uri(collection, rkey), value, cid: cid(collection, rkey) });
        }
        return { data: { records } };
      },
      deleteRecord: async ({ collection, rkey }) => { store.delete(`${collection}|${rkey}`); return {}; },
    } } },
  };
}

const DID = "did:plc:test";
const CAP = "app.graycard.photo.capture";
const SHOOT = "app.graycard.session.capture";
const ROLL = "app.graycard.instance.filmRoll";

function seed(agent) {
  agent.store.set(`${SHOOT}|s1`, { $type: SHOOT, label: "A shoot", createdAt: "2026-06-01T00:00:00Z", cameras: ["at://x/cam"] });
  agent.store.set(`${CAP}|c1`, { $type: CAP, photo: "at://x/p1", filmRoll: "at://x/r1", frameIndex: 12, createdAt: "2026-06-01T00:00:00Z" });
  agent.store.set(`${ROLL}|r1`, { $type: ROLL, stock: "at://x/stock", label: "Roll 1", createdAt: "2026-06-01T00:00:00Z" });
}

describe("bundle export covers every app.graycard record type", () => {
  it("graycardCollections() == the set of record lexicons on disk", () => {
    const dir = join(ROOT, "lexicons/app/graycard");
    const found = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".json")) {
          const j = JSON.parse(readFileSync(p, "utf8"));
          if (j.defs?.main?.type === "record") found.push(j.id);
        }
      }
    };
    walk(dir);
    const exported = new Set(graycardCollections());
    const missing = found.filter((id) => !exported.has(id));
    expect(missing, `record lexicons missing from the export: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("export -> import is idempotent (a no-op)", () => {
  it("importing a freshly exported bundle reports every record unchanged", async () => {
    const agent = memAgent();
    seed(agent);
    const bundle = await exportBundle(agent, DID);
    expect(bundle.records.length).toBe(3);
    const plan = await diffBundle(agent, DID, bundle.records);
    expect(plan.every((p) => p.status === "unchanged")).toBe(true);
  });

  it("full record values survive the export (all fields present)", async () => {
    const agent = memAgent();
    seed(agent);
    const bundle = await exportBundle(agent, DID);
    const cap = bundle.records.find((r) => r.collection === CAP);
    expect(cap.value).toMatchObject({ photo: "at://x/p1", filmRoll: "at://x/r1", frameIndex: 12 });
  });

  it("compare is key-order independent (no spurious 'update')", async () => {
    const agent = memAgent();
    agent.store.set(`${CAP}|c1`, { $type: CAP, photo: "at://x/p1", frameIndex: 3, createdAt: "t", location: { latitude: 1, longitude: 2 } });
    // same content, keys in a different order
    const reordered = [{ collection: CAP, rkey: "c1", value: { createdAt: "t", location: { longitude: 2, latitude: 1 }, frameIndex: 3, photo: "at://x/p1", $type: CAP } }];
    const plan = await diffBundle(agent, DID, reordered);
    expect(plan[0].status).toBe("unchanged");
  });
});

describe("import -> export is idempotent (round-trips into an empty repo)", () => {
  it("writes at the same rkeys, and re-exporting matches", async () => {
    const src = memAgent();
    seed(src);
    const bundle = await exportBundle(src, DID);

    const dest = memAgent();
    const plan = await diffBundle(dest, DID, bundle.records);
    expect(plan.every((p) => p.status === "create")).toBe(true);
    const results = await writeBundle(dest, DID, plan);
    expect(results.every((r) => r.result === "written")).toBe(true);

    // rkeys preserved (put at the bundle's rkey, not a fresh createRecord id)
    expect(dest.store.has(`${SHOOT}|s1`)).toBe(true);
    expect(dest.store.has(`${CAP}|c1`)).toBe(true);

    const bundle2 = await exportBundle(dest, DID);
    expect(bundle2.records).toEqual(bundle.records);
    // and importing again is a no-op
    const plan2 = await diffBundle(dest, DID, bundle2.records);
    expect(plan2.every((p) => p.status === "unchanged")).toBe(true);
  });
});
