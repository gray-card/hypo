import { describe, it, expect } from "vitest";
import { deriveVocabulary, RELATION_CONCEPTS, resolveRelation, relationConcept, SPATIAL_SEED } from "../src/ontology.js";

const N = (uri, typeId, label) => ({ uri, value: { type: { id: typeId, label: typeId }, label } });
const E = (from, to, typeId) => ({ value: { type: { id: typeId, label: typeId }, from, to } });

describe("deriveVocabulary (ontology vocabulary as a byproduct of instance authoring)", () => {
  it("collects the node-type and edge-type vocabulary, deduped, with no type-to-type edges", () => {
    const nodes = [
      N("at://n1", "log", "charred log"),
      N("at://n2", "log", "firewood logs"),
      N("at://n3", "firepit", "brick firepit"),
      N("at://n4", "fire", "campfire flames"),
    ];
    const edges = [E("at://n1", "at://n3", "inside"), E("at://n4", "at://n2", "burning")];
    const v = deriveVocabulary(nodes, edges);

    expect(v.nodeTypes.map((t) => t.id).sort()).toEqual(["fire", "firepit", "log"]); // "log" once
    expect(v.edgeTypes.map((t) => t.id).sort()).toEqual(["burning", "inside"]);
    expect(v).not.toHaveProperty("edges");        // type-to-type relation edges are punted
    expect(v).not.toHaveProperty("attestations");
  });

  it("records observed domain/codomain WITNESSES per relation type (non-exhaustive)", () => {
    const nodes = [N("at://a", "log"), N("at://b", "firepit"), N("at://c", "rock")];
    const edges = [E("at://a", "at://b", "inside"), E("at://c", "at://b", "inside")]; // log inside firepit; rock inside firepit
    const inside = deriveVocabulary(nodes, edges).edgeTypes.find((t) => t.id === "inside");
    expect(inside.domainIncludes.sort()).toEqual(["log", "rock"]); // two witnessed source types
    expect(inside.rangeIncludes).toEqual(["firepit"]);             // one witnessed target type (deduped)
  });

  it("enriches recognized edge types with relation algebra (which is NOT observable from instances)", () => {
    const v = deriveVocabulary([N("at://n1", "a"), N("at://n2", "b")], [E("at://n1", "at://n2", "part-of")]);
    expect(v.edgeTypes.find((t) => t.id === "part-of")).toMatchObject({ inverse: "has-part", transitive: true });
  });

  it("grafts a directional antonym (opposite) onto a path relation, and no converse", () => {
    const v = deriveVocabulary([N("at://n1", "a"), N("at://n2", "b")], [E("at://n1", "at://n2", "into")]);
    const into = v.edgeTypes.find((t) => t.id === "into");
    expect(into.opposite).toBe("out-from");
    expect(into.inverse).toBeUndefined();   // path relations have no lexicalized converse
  });

  it("keeps derived edge types lexicon-conformant: no lex/category/axis leaks onto them", () => {
    const v = deriveVocabulary([N("at://n1", "a"), N("at://n2", "b")], [E("at://n1", "at://n2", "below")]);
    const et = v.edgeTypes.find((t) => t.id === "below");
    const allowed = new Set(["id", "label", "inverse", "opposite", "symmetric", "transitive", "reflexive", "functional", "domainIncludes", "rangeIncludes"]);
    for (const k of Object.keys(et)) expect(allowed.has(k), `unexpected field "${k}" on derived edge type`).toBe(true);
    for (const gone of ["lex", "category", "axis", "contact", "arity"]) expect(et[gone], gone).toBeUndefined();
  });

  it("normalizes synonymous relation strings to one canonical concept edge type", () => {
    // "lower than" and "below" are the same concept; they must merge, not split.
    const nodes = [N("at://a", "lamp"), N("at://b", "table"), N("at://c", "shelf")];
    const edges = [E("at://a", "at://b", "lower than"), E("at://c", "at://b", "below")];
    const et = deriveVocabulary(nodes, edges).edgeTypes;
    expect(et).toHaveLength(1);
    expect(et[0]).toMatchObject({ id: "below", label: "below", inverse: "above", transitive: true });
    expect(et[0].domainIncludes.sort()).toEqual(["lamp", "shelf"]);
  });

  it("keeps an ambiguous relation string verbatim, unenriched", () => {
    // "under" spans below / underneath / under-path -> not uniquely resolvable
    const v = deriveVocabulary([N("at://a", "x"), N("at://b", "y")], [E("at://a", "at://b", "under")]);
    const under = v.edgeTypes.find((t) => t.id === "under");
    expect(under).toBeTruthy();
    expect(under.inverse).toBeUndefined();   // no algebra grafted onto an ambiguous string
  });

  it("keeps an edge type in the vocabulary even when its endpoints are untyped/unknown", () => {
    const v = deriveVocabulary([], [E("at://ghost1", "at://ghost2", "near")]);
    const near = v.edgeTypes.find((t) => t.id === "near");
    expect(near).toBeTruthy();
    expect(near.domainIncludes).toEqual([]);   // no witnesses, but the relation is in use
    expect(near.symmetric).toBe(true);
  });

  it("tolerates empty input", () => {
    expect(deriveVocabulary()).toEqual({ nodeTypes: [], edgeTypes: [] });
  });
});

describe("resolveRelation (surface form -> concept)", () => {
  it("resolves a canonical id, label, or lexical realization to the same concept", () => {
    expect(relationConcept("below")).toBe("below");            // id
    expect(relationConcept("beneath")).toBe("below");          // lex (unique: only below in this norm... see ambiguity test)
    expect(relationConcept("lower than")).toBe("below");       // multi-word lex
    expect(relationConcept("in front of")).toBe("in-front-of"); // label == id-with-spaces
    expect(relationConcept("ahead of")).toBe("in-front-of");   // synonym
  });

  it("returns candidates but no unique id for a genuinely ambiguous form", () => {
    const r = resolveRelation("under");
    expect(r.id).toBeNull();
    expect(r.candidates.sort()).toEqual(["below", "under-path", "underneath"]);
    // "over" spans the static vertical sense and the path sense
    expect(resolveRelation("over").candidates.sort()).toEqual(["above", "over-path"]);
  });

  it("honors the many-to-many map: one form realizes many concepts (cross-cutting)", () => {
    // the SAME preposition realizes DIFFERENT concepts
    expect(resolveRelation("by").candidates.sort()).toEqual(["near", "past-path"]);
    expect(resolveRelation("around").candidates.sort()).toEqual(["around-path", "surrounding"]);
    expect(resolveRelation("past").candidates.sort()).toEqual(["beyond", "past-path"]);
    expect(resolveRelation("out of").candidates.sort()).toEqual(["out-from", "outside"]);
    for (const w of ["by", "around", "past", "out of", "over", "under"]) {
      expect(resolveRelation(w).id, `${w} must not silently pick a winner`).toBeNull();
    }
  });

  it("honors the many-to-many map: one concept has many realizations (synonymy)", () => {
    // the SAME concept is realized by DIFFERENT prepositions
    for (const form of ["below", "beneath", "lower than", "down below"]) {
      expect(resolveRelation(form).candidates, form).toContain("below");
    }
    expect(relationConcept("beneath")).toBe("below"); // unique here (contact sense dropped from below)
    expect(relationConcept("lower than")).toBe("below");
  });

  it("is unrecognized (empty) for a non-spatial string", () => {
    expect(resolveRelation("burning")).toEqual({ id: null, candidates: [] });
  });

  it("normalizes case, hyphens, and trailing punctuation", () => {
    expect(relationConcept("In-Front-Of")).toBe("in-front-of");
    expect(relationConcept("adjacent to.")).toBe("adjacent-to");
  });
});

describe("RELATION_CONCEPTS integrity", () => {
  it("every inverse is a defined concept, mutual, and a genuine converse (not an antonym)", () => {
    for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
      if (!c.inverse) continue;
      const inv = RELATION_CONCEPTS[c.inverse];
      expect(inv, `${id}.inverse=${c.inverse} undefined`).toBeTruthy();
      expect(inv.inverse, `${c.inverse}.inverse should be ${id}`).toBe(id);
      expect(c.opposite, `${id} must not carry both inverse and opposite`).toBeUndefined();
    }
  });

  it("every opposite is a defined concept and mutual, and never doubles as inverse", () => {
    for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
      if (!c.opposite) continue;
      const opp = RELATION_CONCEPTS[c.opposite];
      expect(opp, `${id}.opposite=${c.opposite} undefined`).toBeTruthy();
      expect(opp.opposite, `${c.opposite}.opposite should be ${id}`).toBe(id);
      expect(c.inverse, `${id} must not carry both inverse and opposite`).toBeUndefined();
    }
  });

  it("converse pairs agree on transitivity", () => {
    for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
      if (!c.inverse) continue;
      expect(!!c.transitive, `${id} vs ${c.inverse} transitivity`).toBe(!!RELATION_CONCEPTS[c.inverse].transitive);
    }
  });

  it("symmetric relations do not also declare a separate inverse", () => {
    for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
      if (c.symmetric && c.inverse) expect(c.inverse, `${id} symmetric+inverse`).toBe(id);
    }
  });

  it("every concept has a label and at least one lexical realization", () => {
    for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
      expect(c.label, `${id}.label`).toBeTruthy();
      expect(Array.isArray(c.lex) && c.lex.length > 0, `${id}.lex`).toBe(true);
    }
  });

  it("covers a broad concept inventory including complex realizations", () => {
    expect(Object.keys(RELATION_CONCEPTS).length).toBeGreaterThan(50);
    for (const id of ["in-front-of", "left-of", "on-top-of", "in-the-middle-of", "north-of", "surrounded-by", "part-of", "into"]) {
      expect(RELATION_CONCEPTS[id], id).toBeTruthy();
    }
  });

  it("SPATIAL_SEED entries are all real concepts with canonical labels", () => {
    for (const s of SPATIAL_SEED) {
      expect(RELATION_CONCEPTS[s.id], s.id).toBeTruthy();
      expect(s.label).toBe(RELATION_CONCEPTS[s.id].label);
    }
  });
});
