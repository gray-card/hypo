import { describe, it, expect } from "vitest";
import { parseBundle, diffBundle, pruneCandidates } from "../src/import.js";

describe("parseBundle", () => {
  it("accepts an array or a {records} object", () => {
    expect(parseBundle('[{"collection":"c","value":{},"rkey":"r"}]').length).toBe(1);
    expect(parseBundle('{"records":[{"collection":"c","value":{}}]}').length).toBe(1);
  });
  it("rejects empty or malformed bundles", () => {
    expect(() => parseBundle("[]")).toThrow();
    expect(() => parseBundle('[{"value":{}}]')).toThrow(/collection/);
    expect(() => parseBundle('[{"collection":"c"}]')).toThrow(/value/);
  });
});

describe("diffBundle", () => {
  const agent = {
    com: { atproto: { repo: {
      getRecord: async ({ rkey }) => {
        if (rkey === "same") return { data: { value: { a: 1 }, cid: "c1" } };
        if (rkey === "diff") return { data: { value: { a: 2 }, cid: "c2" } };
        throw new Error("not found");
      },
    } } },
  };

  it("classifies unchanged / update / create", async () => {
    const plan = await diffBundle(agent, "did:plc:test", [
      { collection: "x", rkey: "same", value: { a: 1 } },
      { collection: "x", rkey: "diff", value: { a: 9 } },
      { collection: "x", rkey: "missing", value: { a: 0 } },
      { collection: "x", value: { a: 0 } },
    ]);
    expect(plan.map((p) => p.status)).toEqual(["unchanged", "update", "create", "create"]);
  });
});

describe("pruneCandidates", () => {
  const agent = {
    com: { atproto: { repo: {
      listRecords: async () => ({ data: { records: [
        { uri: "at://did:plc:test/x/keep", value: {}, cid: "c1" },
        { uri: "at://did:plc:test/x/gone", value: {}, cid: "c2" },
      ] } }),
    } } },
  };
  it("flags repo records not present in the bundle as deletes", async () => {
    const out = await pruneCandidates(agent, "did:plc:test", [{ collection: "x", rkey: "keep", value: {} }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ collection: "x", rkey: "gone", status: "delete" });
  });
});
