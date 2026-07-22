import { describe, it, expect } from "vitest";
import { buildSceneIndex, parseQuery, searchScenes, rankScenes } from "../src/sceneSearch.js";

// one photo whose scene graph is: dog (Q144) left-of tree (ungrounded),
// person (Q5) riding bicycle (Q11442).
const PHOTO = "at://did/social.grain.photo/pA";
const G = "at://did/scene.graph/g1";
const node = (rk, id, label) => ({ uri: `at://did/scene.node/${rk}`, value: { scene: G, type: { id, label } } });
const edge = (rk, from, to, id, label) => ({ uri: `at://did/scene.edge/${rk}`, value: { scene: G, type: { id, label }, from: `at://did/scene.node/${from}`, to: `at://did/scene.node/${to}` } });

const FIXTURE = {
  scenes: [{ uri: G, value: { subject: PHOTO } }],
  sceneNodes: [
    node("dog", "Q144", "dog"),
    node("tree", "tree", "tree"),          // ungrounded (plain text id)
    node("person", "Q5", "person"),
    node("bike", "Q11442", "bicycle"),
  ],
  sceneEdges: [
    edge("e1", "dog", "tree", "left-of", "left of"),
    edge("e2", "person", "bike", "riding", "riding"),
  ],
};

// stub Wikidata: query term -> entity, and node qid -> ancestor set (incl self).
const ENTITY = { animal: "Q729", dog: "Q144", person: "Q5", bicycle: "Q11442", cat: "Q146", vehicle: "Q42889" };
const resolveTerm = async (t) => (ENTITY[t.toLowerCase()] ? { qid: ENTITY[t.toLowerCase()], label: t } : null);
const ANC = {
  Q144: ["Q144", "Q729"],        // dog is-a animal
  Q5: ["Q5", "Q729"],            // person is-a animal (for the test)
  Q11442: ["Q11442", "Q42889"],  // bicycle is-a vehicle
};
const ancestorsOf = async (qids) => new Map(qids.map((q) => [q, new Set(ANC[q] || [q])]));
const deps = { resolveTerm, ancestorsOf };

describe("buildSceneIndex", () => {
  const idx = buildSceneIndex(FIXTURE);
  it("groups nodes and edges under the graph's subject photo", () => {
    const rec = idx.photos.get(PHOTO);
    expect(rec.nodes).toHaveLength(4);
    expect(rec.edges).toHaveLength(2);
    expect(rec.edges[0].fromNode.label).toBe("dog");    // endpoints resolved
    expect(rec.edges[0].concept).toBe("left-of");        // relation resolved to a concept
  });
  it("collects only grounded (QID) node ids for hierarchy expansion", () => {
    expect(idx.allNodeQids.sort()).toEqual(["Q11442", "Q144", "Q5"]); // "tree" excluded
  });
  it("records the relation surface forms present in the corpus", () => {
    expect(idx.relationForms.has("riding")).toBe(true);
    expect(idx.relationForms.has("left of")).toBe(true);
  });
});

describe("parseQuery", () => {
  const forms = buildSceneIndex(FIXTURE).relationForms;
  it("splits object terms on comma / 'and', but keeps multi-word objects whole", () => {
    expect(parseQuery("dog, tree", forms)).toEqual({ terms: ["dog", "tree"], triple: null });
    expect(parseQuery("dog and tree", forms)).toEqual({ terms: ["dog", "tree"], triple: null });
    expect(parseQuery("fire hydrant", forms)).toEqual({ terms: ["fire hydrant"], triple: null });
  });
  it("detects a spatial triple via the relation-concept lexicon", () => {
    expect(parseQuery("dog left of tree", forms).triple).toEqual({ subj: "dog", rel: "left of", obj: "tree" });
  });
  it("detects a non-spatial relation present in the corpus", () => {
    expect(parseQuery("person riding bicycle", forms).triple).toEqual({ subj: "person", rel: "riding", obj: "bicycle" });
  });
});

describe("searchScenes (Wikidata class-hierarchy expansion)", () => {
  const idx = buildSceneIndex(FIXTURE);
  it("matches a broad concept against a specific grounded node (animal -> dog)", async () => {
    expect(await searchScenes(idx, "animal", deps)).toEqual([PHOTO]);
  });
  it("matches an exact grounded concept", async () => {
    expect(await searchScenes(idx, "dog", deps)).toEqual([PHOTO]);
  });
  it("falls back to label text for ungrounded nodes / unresolved terms", async () => {
    expect(await searchScenes(idx, "tree", deps)).toEqual([PHOTO]);
  });
  it("returns nothing when neither hierarchy nor label matches", async () => {
    expect(await searchScenes(idx, "cat", deps)).toEqual([]);
  });
  it("AND-s multiple object terms", async () => {
    expect(await searchScenes(idx, "animal, vehicle", deps)).toEqual([PHOTO]); // dog + bicycle
    expect(await searchScenes(idx, "animal, cat", deps)).toEqual([]);          // cat absent
  });
  it("matches a spatial triple and its converse", async () => {
    expect(await searchScenes(idx, "dog left of tree", deps)).toEqual([PHOTO]);
    expect(await searchScenes(idx, "tree right of dog", deps)).toEqual([PHOTO]); // inverse of left-of
  });
  it("respects triple direction (no matching edge -> no hit)", async () => {
    expect(await searchScenes(idx, "tree left of dog", deps)).toEqual([]);
  });
  it("matches a non-spatial relation by its raw label", async () => {
    expect(await searchScenes(idx, "person riding bicycle", deps)).toEqual([PHOTO]);
  });
  it("expands the subject/object of a triple too (animal riding vehicle)", async () => {
    expect(await searchScenes(idx, "animal riding vehicle", deps)).toEqual([PHOTO]);
  });
});

describe("searchScenes — regressions caught in adversarial review", () => {
  // dog (Q144) --adjacent-to--> tree; scarf (Q28109459) present as a distractor.
  const SG = "at://did/scene.graph/gS", SP = "at://did/social.grain.photo/pS";
  const sn = (rk, id, label) => ({ uri: `at://did/scene.node/${rk}`, value: { scene: SG, type: { id, label } } });
  const F = {
    scenes: [{ uri: SG, value: { subject: SP } }],
    sceneNodes: [sn("d", "Q144", "dog"), sn("t", "Q10884", "tree"), sn("s", "Q28109459", "scarf")],
    sceneEdges: [{ uri: "at://did/scene.edge/e", value: { scene: SG, type: { id: "adjacent-to", label: "next to" }, from: "at://did/scene.node/d", to: "at://did/scene.node/t" } }],
  };
  const idx = buildSceneIndex(F);
  const ent = { dog: "Q144", tree: "Q10884", car: "Q1420" };
  const dep = {
    resolveTerm: async (x) => (ent[x.toLowerCase()] ? { qid: ent[x.toLowerCase()], label: x } : null),
    ancestorsOf: async (qids) => new Map(qids.map((q) => [q, new Set([q])])),   // no hierarchy
  };

  it("matches a symmetric relation regardless of query argument order", async () => {
    expect(await searchScenes(idx, "dog next to tree", dep)).toEqual([SP]);
    expect(await searchScenes(idx, "tree next to dog", dep)).toEqual([SP]); // reversed order was missed
  });

  it("does not match two unrelated grounded entities via a label substring (car ≠ scarf)", async () => {
    expect(await searchScenes(idx, "car", dep)).toEqual([]);  // "scarf" contains "car" but is a different entity
  });
});

import { parseQueryToIR, validateIR } from "../src/sceneSearch.js";

describe("parseQueryToIR (shared query IR from the heuristic)", () => {
  const forms = buildSceneIndex(FIXTURE).relationForms;
  const objs = buildSceneIndex(FIXTURE).objectForms;

  it("splits AND (comma/and) and OR", () => {
    expect(parseQueryToIR("dog and tree")).toMatchObject({ match: "all", clauses: [{ kind: "object", concept: "dog" }, { kind: "object", concept: "tree" }] });
    expect(parseQueryToIR("dog or cat")).toMatchObject({ match: "any", clauses: [{ concept: "dog" }, { concept: "cat" }] });
  });
  it("keeps a multi-word object whole, but splits known labels via objectForms", () => {
    expect(parseQueryToIR("fire hydrant").clauses).toEqual([{ kind: "object", concept: "fire hydrant" }]);   // no objectForms -> whole
    expect(parseQueryToIR("dog tree", { objectForms: objs }).clauses).toEqual([{ kind: "object", concept: "dog" }, { kind: "object", concept: "tree" }]);
  });
  it("strips leading determiners/articles", () => {
    expect(parseQueryToIR("a red car").clauses).toEqual([{ kind: "object", concept: "red car" }]);
  });
  it("marks leading negation and leading counts", () => {
    expect(parseQueryToIR("no people").clauses).toEqual([{ kind: "object", concept: "people", negate: true }]);
    expect(parseQueryToIR("two dogs").clauses).toEqual([{ kind: "object", concept: "dogs", minCount: 2 }]);
  });
  it("detects relations with wildcard subject or object", () => {
    expect(parseQueryToIR("near a tree", { relationForms: forms }).clauses).toEqual([{ kind: "relation", subject: null, relation: "near", object: "tree" }]);
    expect(parseQueryToIR("dog on top of", { relationForms: forms }).clauses).toEqual([{ kind: "relation", subject: "dog", relation: "on top of", object: null }]);
  });
});

describe("validateIR (repair external/LLM output)", () => {
  it("strips a leaked QID and drops empty clauses", () => {
    expect(validateIR({ match: "all", clauses: [{ kind: "object", concept: "Q144" }] })).toBeNull();
    expect(validateIR({ clauses: [{ kind: "object", concept: "dog" }] })).toEqual({ match: "all", clauses: [{ kind: "object", concept: "dog" }] });
  });
  it("forbids negate + minCount together (negate wins)", () => {
    expect(validateIR({ match: "all", clauses: [{ kind: "object", concept: "dog", negate: true, minCount: 3 }] }))
      .toEqual({ match: "all", clauses: [{ kind: "object", concept: "dog", negate: true }] });
  });
  it("drops a relation clause with no arguments", () => {
    expect(validateIR({ match: "all", clauses: [{ kind: "relation", relation: "near" }] })).toBeNull();
  });
});

describe("searchScenes with the richer IR", () => {
  const idx = buildSceneIndex(FIXTURE);
  it("splits a spaced multi-word query into AND object clauses (dog tree)", async () => {
    expect(await searchScenes(idx, "dog tree", deps)).toEqual([PHOTO]);   // was one dead term before
  });
  it("OR matches either concept", async () => {
    expect(await searchScenes(idx, "cat or animal", deps)).toEqual([PHOTO]);   // animal(dog) present
    expect(await searchScenes(idx, "cat or unicorn", deps)).toEqual([]);
  });
  it("negation is negation-as-failure over the annotation, gated on a non-empty graph", async () => {
    expect(await searchScenes(idx, "no cat", deps)).toEqual([PHOTO]);   // photo is not tagged with a cat
    expect(await searchScenes(idx, "no dog", deps)).toEqual([]);        // photo IS tagged with a dog
  });
  it("minCount is a lower bound (one dog does not satisfy 'two dog')", async () => {
    expect(await searchScenes(idx, "two dog", deps)).toEqual([]);
  });
  it("accepts a pre-parsed IR from an llmParse stub, falling back on junk", async () => {
    const good = async () => ({ match: "all", clauses: [{ kind: "object", concept: "animal" }] });
    const junk = async () => ({ not: "an ir" });
    expect(await searchScenes(idx, "whatever", { ...deps, llmParse: good })).toEqual([PHOTO]);
    expect(await searchScenes(idx, "dog", { ...deps, llmParse: junk })).toEqual([PHOTO]);   // junk -> heuristic("dog")
  });
});

describe("query parser fixes (adversarial review of the parsers)", () => {
  const idx = buildSceneIndex(FIXTURE);
  const objs = idx.objectForms;

  it("mixed AND/OR keeps precedence: (dog AND cat) OR bird", async () => {
    const ir = parseQueryToIR("dog and cat or bird");
    expect(ir.match).toBe("any");
    expect(ir.clauses[0]).toEqual({ kind: "group", match: "all", clauses: [{ kind: "object", concept: "dog" }, { kind: "object", concept: "cat" }] });
    expect(ir.clauses[1]).toEqual({ kind: "object", concept: "bird" });
    // fixture photo has a dog but no cat and no bird -> both disjuncts false -> no match
    expect(await searchScenes(idx, "dog and cat or bird", deps)).toEqual([]);
    // but "dog and animal or bird" -> (dog AND animal) holds -> matches
    expect(await searchScenes(idx, "dog and animal or bird", deps)).toEqual([PHOTO]);
  });

  it("leading-hyphen negation works for single and multi-term queries", () => {
    expect(parseQueryToIR("-cat").clauses).toEqual([{ kind: "object", concept: "cat", negate: true }]);
    expect(parseQueryToIR("dog -cat").clauses).toEqual([{ kind: "object", concept: "dog" }, { kind: "object", concept: "cat", negate: true }]);
    // interior hyphens in compounds are untouched
    expect(parseQueryToIR("t-shirt").clauses).toEqual([{ kind: "object", concept: "t shirt" }]);
  });

  it("segmentObjects recovers a known object after an unknown token", () => {
    expect(parseQueryToIR("dog brown tree", { objectForms: objs }).clauses)
      .toEqual([{ kind: "object", concept: "dog" }, { kind: "object", concept: "brown" }, { kind: "object", concept: "tree" }]);
  });

  it("does not emit a relation clause with both arguments null", () => {
    const forms = idx.relationForms;
    // "on the" -> relation with determiner-only args -> must NOT be a both-null relation
    const ir = parseQueryToIR("on the", { relationForms: forms });
    expect(ir.clauses.every((c) => c.kind !== "relation" || c.subject || c.object)).toBe(true);
  });
});

import { buildTextIndex, bm25Search } from "../src/sceneSearch.js";

describe("BM25 text search over title/description/alt", () => {
  const docs = [
    { uri: "p1", text: "A dog on the beach at sunset" },
    { uri: "p2", text: "Sunset over the harbor" },
    { uri: "p3", text: "A fire hydrant on a street corner" },
  ];
  const ti = buildTextIndex(docs);

  it("ranks the more specific match higher (rare term beats common)", () => {
    const s = bm25Search(ti, ["dog"]);
    expect([...s.keys()]).toEqual(["p1"]);
    const sun = bm25Search(ti, ["sunset"]);
    expect(new Set(sun.keys())).toEqual(new Set(["p1", "p2"]));   // both mention sunset
  });
  it("returns nothing for a term absent from the corpus", () => {
    expect(bm25Search(ti, ["helicopter"]).size).toBe(0);
  });

  it("searchScenes merges scene-graph hits above text-only hits", async () => {
    // FIXTURE photo has a scene graph (dog/tree/…). Add a text-only doc for a
    // different photo that only mentions 'dog' in its caption.
    const idx = buildSceneIndex(FIXTURE);
    const textIndex = buildTextIndex([
      { uri: PHOTO, text: "" },                                   // the analyzed photo, no caption
      { uri: "at://did/social.grain.photo/pTxt", text: "a happy dog running" },
    ]);
    const hits = await searchScenes(idx, "dog", { ...deps, textIndex });
    expect(hits[0]).toBe(PHOTO);                                  // scene-graph hit ranked first
    expect(hits).toContain("at://did/social.grain.photo/pTxt");   // text-only hit still surfaced
  });
});

import { scoreIR, rankScenes } from "../src/sceneSearch.js";
import { buildIdfLookup } from "../src/data/captionIdf.js";

describe("graded scoring + fusion + banding", () => {
  const recDog = { photo: "p", nodes: [{ qid: "Q144", label: "dog", typeId: "Q144" }], edges: [] };
  const anc = new Map([["Q144", new Set(["Q144", "Q729"])]]);   // dog is-a animal (flat set)
  const r = (m) => new Map(Object.entries(m).map(([k, v]) => [k, { qid: v, text: k }]));

  it("scoreIR grades exact 1.0 > hierarchy member 0.7 > no-match 0", () => {
    expect(scoreIR(recDog, { match: "all", clauses: [{ kind: "object", concept: "dog" }] }, r({ dog: "Q144" }), anc)).toBe(1);
    expect(scoreIR(recDog, { match: "all", clauses: [{ kind: "object", concept: "animal" }] }, r({ animal: "Q729" }), anc)).toBeCloseTo(0.7, 5);
    expect(scoreIR(recDog, { match: "all", clauses: [{ kind: "object", concept: "cat" }] }, r({ cat: "Q146" }), anc)).toBe(0);
  });
  it("2-of-2 outranks 1-of-2 via the mean aggregation", () => {
    const two = scoreIR(recDog, { match: "all", clauses: [{ kind: "object", concept: "animal" }, { kind: "object", concept: "dog" }] }, r({ animal: "Q729", dog: "Q144" }), anc);
    const one = scoreIR(recDog, { match: "all", clauses: [{ kind: "object", concept: "animal" }, { kind: "object", concept: "cat" }] }, r({ animal: "Q729", cat: "Q146" }), anc);
    expect(two).toBeGreaterThan(one);
  });

  it("rankScenes returns scored, banded results with match ranked above near", async () => {
    const idx = buildSceneIndex(FIXTURE);
    const scored = await rankScenes(idx, "animal, cat", deps);   // dog matches (animal), cat absent -> partial
    expect(scored.every((x) => x.uri && "score" in x && "band" in x)).toBe(true);
    expect(scored.find((x) => x.uri === PHOTO)?.band).toBe("near");   // 1-of-2 -> near, not match
  });

  it("negation gate drops a photo even when a positive text term would surface it", async () => {
    const idx = buildSceneIndex(FIXTURE);
    const ti = buildTextIndex([{ uri: PHOTO, text: "a dog on a beach" }]);
    expect(await searchScenes(idx, "no dog", { ...deps, textIndex: ti })).toEqual([]);       // PHOTO has a dog -> excluded
    expect(await searchScenes(idx, "no cat", { ...deps, textIndex: ti })).toEqual([PHOTO]);  // no cat -> match
  });

  it("bm25Search honors an injected corpus IDF", () => {
    const ti = buildTextIndex([{ uri: "a", text: "dog cat" }, { uri: "b", text: "dog" }]);
    const flat = bm25Search(ti, ["dog"], { idf: () => 1 });
    expect(flat.size).toBe(2);   // both docs contain "dog"
  });

  it("LLM rerank enters the fusion when provided", async () => {
    const idx = buildSceneIndex(FIXTURE);
    const seen = [];
    const llmRerank = async (q, uris) => { seen.push(...uris); return new Map(uris.map((u) => [u, 1])); };
    const hits = await searchScenes(idx, "animal", { ...deps, llmRerank });
    expect(hits).toEqual([PHOTO]);
    expect(seen).toContain(PHOTO);   // the reranker was consulted
  });
});

describe("caption IDF lookup", () => {
  it("returns null for an empty/placeholder table (-> per-profile fallback)", () => {
    expect(buildIdfLookup({ N: 0, df: {} })).toBeNull();
    expect(buildIdfLookup(null)).toBeNull();
  });
  it("gives OOV terms a bounded high IDF from dfFloor", () => {
    const idf = buildIdfLookup({ N: 1000, dfFloor: 5, df: { dog: 200 } });
    expect(Number.isFinite(idf("dog"))).toBe(true);
    expect(idf("helicopter")).toBeGreaterThan(idf("dog"));   // rarer OOV term weighted higher
    expect(Number.isFinite(idf("helicopter"))).toBe(true);
  });
});

describe("negation over-exclusion fix (edge-less / empty graphs)", () => {
  // a photo with a cat node but NO edges (the common case: objects extracted,
  // relations rarely are), plus a caption mentioning the cat.
  const F = { scenes: [{ uri: "g", value: { subject: "pc" } }], sceneNodes: [{ uri: "n", value: { scene: "g", type: { id: "Q146", label: "cat" } } }], sceneEdges: [] };
  const idx = buildSceneIndex(F);
  const ti = buildTextIndex([{ uri: "pc", text: "a cat by the window" }]);
  const ent = { cat: "Q146", table: "Q14748", dog: "Q144" };
  const d = { resolveTerm: async (t) => (ent[t.toLowerCase()] ? { qid: ent[t.toLowerCase()] } : null), ancestorsOf: async (qs) => new Map(qs.map((q) => [q, new Set([q])])) };

  it("a negated RELATION does not hard-drop an edge-less photo (it isn't witnessed)", async () => {
    // "on a table" has no edge to witness it -> not a violator. Pre-fix the photo
    // was excluded from EVERY band; now it survives (open-world: it can't confirm
    // the negative, so it lands in "near" rather than being nuked).
    const scored = await rankScenes(idx, "cat, not on a table", { ...d, textIndex: ti });
    expect(scored.map((r) => r.uri)).toContain("pc");
  });
  it("a truly-witnessed negation still excludes", async () => {
    // the photo HAS a cat, so "not cat" is violated -> excluded
    expect(await searchScenes(idx, "not cat", { ...d, textIndex: ti })).toEqual([]);
  });
});

describe("searchScenes — multi-sense query disambiguation", () => {
  // Photo node grounded to the TREE-TRUNK sense (Q193472); its part-of ancestors
  // include tree (Q10884). The query term "tree" is ambiguous.
  const PH = "at://photo/trunk";
  const idx = buildSceneIndex({
    scenes: [{ uri: "g", value: { subject: PH } }],
    sceneNodes: [{ uri: "n", value: { scene: "g", type: { id: "Q193472", label: "trunk" } } }],
    sceneEdges: [],
  });
  const anc = async (qids) => new Map(qids.map((q) => [q, new Set(q === "Q193472" ? ["Q193472", "Q10884"] : [q])]));
  const WRONG = "Q272683";   // "tree" (data structure) — unrelated to the node
  const RIGHT = "Q10884";    // "tree" (plant) — reachable via part-of

  it("matches via a non-top candidate sense (fixes a wrong top-1 grounding)", async () => {
    const multi = { resolveTerm: async () => ({ qids: [WRONG, RIGHT], label: "tree" }), ancestorsOf: anc };
    expect(await searchScenes(idx, "tree", multi)).toEqual([PH]);
  });
  it("misses when only the wrong top-1 sense is used (baseline it improves on)", async () => {
    const top1 = { resolveTerm: async () => ({ qid: WRONG, label: "tree" }), ancestorsOf: anc };
    expect(await searchScenes(idx, "tree", top1)).toEqual([]);
  });
});

describe("rankScenes — progressive render + deferred LLM rerank", () => {
  const idx = buildSceneIndex({
    scenes: [{ uri: "g1", value: { subject: "p1" } }, { uri: "g2", value: { subject: "p2" } }],
    sceneNodes: [
      { uri: "n1", value: { scene: "g1", type: { id: "Q144", label: "dog" } } },
      { uri: "n2", value: { scene: "g2", type: { id: "Q144", label: "dog" } } },
    ],
    sceneEdges: [],
  });
  const dep = {
    resolveTerm: async () => ({ qids: ["Q144"], label: "dog" }),
    ancestorsOf: async (qs) => new Map(qs.map((q) => [q, new Set([q])])),
  };

  it("paints the fast result via onPartial BEFORE the LLM reranker runs", async () => {
    let llmStarted = false, partial = null;
    const llmRerank = async () => { llmStarted = true; return new Map([["p2", 1]]); };
    const onPartial = (r) => { partial = r; expect(llmStarted).toBe(false); };   // fast result precedes the LLM
    const final = await rankScenes(idx, "dog", { ...dep, llmRerank, onPartial });
    expect(Array.isArray(partial) && partial.length > 0).toBe(true);
    expect(llmStarted).toBe(true);
    expect(final.find((r) => r.uri === "p2")?.signals.llm).toBeGreaterThan(0);   // final reflects the LLM signal
  });

  it("returns the fast result directly and never calls onPartial when no reranker is given", async () => {
    let called = false;
    const r = await rankScenes(idx, "dog", { ...dep, onPartial: () => { called = true; } });
    expect(r.length).toBeGreaterThan(0);
    expect(called).toBe(false);
  });
});
