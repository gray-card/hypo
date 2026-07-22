import { describe, it, expect, beforeEach } from "vitest";
import { initLibrary, countTypeRefs, resolveTypeForSave } from "../src/ui/library.js";
import { NS } from "../src/graycard.js";
import { mockAgent } from "./setup.js";

const did = "did:plc:test";

// build a minimal ctx.store with the given catalog types and instances, then
// wire it into the library module via initLibrary.
function seed(agent, { lensTypes = [], lenses = [] }) {
  const byUri = new Map();
  for (const t of lensTypes) byUri.set(t.uri, { layer: "catalog", kind: "lensType", item: t });
  for (const l of lenses) byUri.set(l.uri, { layer: "instance", kind: "lens", item: l });
  const store = {
    catalog: { lensType: lensTypes },
    instance: { lens: lenses },
    byUri,
  };
  initLibrary({ agent, did, store });
}

const lensType = (rk, model) => ({
  uri: `at://${did}/app.graycard.catalog.lensType/${rk}`, cid: `c${rk}`, rkey: rk,
  value: { make: "Nikon", model },
});
const lens = (rk, typeUri) => ({
  uri: `at://${did}/app.graycard.instance.lens/${rk}`, cid: `c${rk}`, rkey: rk,
  value: { type: typeUri },
});

describe("resolveTypeForSave — never orphans a catalog type on rename", () => {
  it("renames the type in place when the instance solely owns it", async () => {
    const agent = mockAgent();
    const t = lensType("A", "Nikkor 50mm f/1.4 pre-AI");
    const l = lens("L1", t.uri);
    seed(agent, { lensTypes: [t], lenses: [l] });

    const uri = await resolveTypeForSave("lensType", { make: "Nikon", model: "Nikon Nikkor 50mm f/1.4 pre-AI" }, null, "lens", l);

    expect(agent.created).toHaveLength(0);                 // no duplicate type created
    expect(agent.put).toHaveLength(1);                     // old type updated in place
    expect(agent.put[0].rkey).toBe("A");
    expect(agent.put[0].record.model).toBe("Nikon Nikkor 50mm f/1.4 pre-AI");
    expect(uri).toBe(t.uri);                               // same URI kept
  });

  it("dedups onto an existing type and deletes the now-orphaned old one", async () => {
    const agent = mockAgent();
    const a = lensType("A", "Nikkor 50mm f/1.4 AI");
    const b = lensType("B", "Nikkor 24mm f/2.8 AI");
    const l = lens("L1", a.uri);
    seed(agent, { lensTypes: [a, b], lenses: [l] });

    const uri = await resolveTypeForSave("lensType", { make: "Nikon", model: "Nikkor 24mm f/2.8 AI" }, null, "lens", l);

    expect(uri).toBe(b.uri);                               // pointed at existing match
    expect(agent.created).toHaveLength(0);
    expect(agent.deleted).toHaveLength(1);                 // orphaned old type removed
    expect(agent.deleted[0].rkey).toBe("A");
  });

  it("creates a new type (not mutating the old) when the old type is shared", async () => {
    const agent = mockAgent();
    const a = lensType("A", "Nikkor 50mm f/1.4 AI");
    const l1 = lens("L1", a.uri);
    const l2 = lens("L2", a.uri);                          // second lens shares type A
    seed(agent, { lensTypes: [a], lenses: [l1, l2] });

    const uri = await resolveTypeForSave("lensType", { make: "Nikon", model: "Nikkor 105mm f/2.5 AI" }, null, "lens", l1);

    expect(agent.deleted).toHaveLength(0);                 // shared type left intact
    expect(agent.created).toHaveLength(1);                 // brand-new type for L1
    expect(agent.created[0].record.model).toBe("Nikkor 105mm f/2.5 AI");
    expect(uri).toBe(`at://${did}/app.graycard.catalog.lensType/rk1`);
  });

  it("dedups on a fresh add without touching anything else", async () => {
    const agent = mockAgent();
    const a = lensType("A", "Nikkor 50mm f/1.4 AI");
    seed(agent, { lensTypes: [a], lenses: [] });

    const uri = await resolveTypeForSave("lensType", { make: "Nikon", model: "Nikkor 50mm f/1.4 AI" }, null, "lens", null);

    expect(uri).toBe(a.uri);
    expect(agent.created).toHaveLength(0);
    expect(agent.deleted).toHaveLength(0);
    expect(agent.put).toHaveLength(0);
  });

  it("countTypeRefs excludes the instance being edited", () => {
    const agent = mockAgent();
    const a = lensType("A", "X");
    seed(agent, { lensTypes: [a], lenses: [lens("L1", a.uri), lens("L2", a.uri)] });
    expect(countTypeRefs("lensType", a.uri, `at://${did}/app.graycard.instance.lens/L1`)).toBe(1);
    expect(countTypeRefs("lensType", a.uri, null)).toBe(2);
  });
});
