import { describe, it, expect, vi, afterEach } from "vitest";
import { distinctTerms, applyGroundings, confidentChoices, lookupGroundings, autoGroundAnalysis } from "../src/grounding.js";

const A = (nodeTypes, edges = []) => ({
  altText: "x",
  nodes: nodeTypes.map((id, i) => ({ key: `o${i + 1}`, type: { id, label: id } })),
  edges: edges.map(([from, to, id]) => ({ from, to, type: { id, label: id } })),
});

describe("distinctTerms", () => {
  it("collects distinct free-text types and skips already-grounded QIDs", () => {
    const a = A(["log", "log", "fire", "Q3196"], [["o1", "o2", "inside"], ["o2", "o1", "wd:Q1"]]);
    const { nodes, edges } = distinctTerms(a);
    expect(nodes.sort()).toEqual(["fire", "log"]);   // "log" once; Q3196 skipped
    expect(edges).toEqual(["inside"]);               // wd:Q1 skipped
  });
});

describe("applyGroundings", () => {
  it("replaces chosen terms and leaves the rest as text", () => {
    const a = A(["log", "fire"], [["o1", "o2", "inside"]]);
    const out = applyGroundings(a, new Map([["log", { id: "Q3196", label: "log" }]]), new Map());
    expect(out.nodes[0].type).toEqual({ id: "Q3196", label: "log" }); // grounded
    expect(out.nodes[1].type).toEqual({ id: "fire", label: "fire" }); // untouched
    expect(out.edges[0].type).toEqual({ id: "inside", label: "inside" });
    expect(a.nodes[0].type.id).toBe("log");   // original not mutated
  });
});

describe("Wikidata lookup + auto-grounding", () => {
  afterEach(() => vi.unstubAllGlobals());

  // stub the wbsearchentities endpoint, keyed by the `search` query param
  const stubWikidata = (byQuery) => vi.stubGlobal("fetch", vi.fn(async (url) => {
    const q = new URL(url).searchParams.get("search");
    return { ok: true, json: async () => ({ search: byQuery[q] || [] }) };
  }));

  it("suggests only a UNIQUE exact-label match", async () => {
    stubWikidata({
      log: [{ id: "Q3196", label: "log", description: "wood" }, { id: "Q11197", label: "log", description: "logarithm" }],
      fire: [{ id: "Q3196", label: "fire", description: "combustion" }],
    });
    const look = await lookupGroundings(["log", "fire"]);
    expect(look.get("log").suggested).toBeNull();          // two exact "log" matches -> ambiguous
    expect(look.get("fire").suggested).toMatchObject({ id: "Q3196" }); // unique exact -> confident
    expect(confidentChoices(look).has("fire")).toBe(true);
    expect(confidentChoices(look).has("log")).toBe(false);
  });

  it("autoGroundAnalysis applies only confident matches", async () => {
    stubWikidata({
      fire: [{ id: "Q3196", label: "fire", description: "combustion" }],
      log: [{ id: "Q3196", label: "log" }, { id: "Q11197", label: "log" }],   // ambiguous
      inside: [{ id: "Q9", label: "interior" }],                              // no exact match
    });
    const out = await autoGroundAnalysis(A(["fire", "log"], [["o1", "o2", "inside"]]));
    expect(out.nodes.find((n) => n.key === "o1").type).toEqual({ id: "Q3196", label: "fire" }); // grounded
    expect(out.nodes.find((n) => n.key === "o2").type).toEqual({ id: "log", label: "log" });    // left as text
    expect(out.edges[0].type).toEqual({ id: "inside", label: "inside" });                        // left as text
  });
});
