// grounding.js — automatically link analysis terms (object types, relation
// types) to Wikidata, and disambiguate the uncertain ones with the user.
//
// An object/relation detector (Claude, Gemini) returns free-text types like
// "log" or "inside". We look each up on Wikidata: a unique exact-label match is
// treated as confident (auto-applied, grounding the term id to a QID), while
// anything ambiguous is surfaced for the user to confirm, pick, or keep as
// plain text. Grounding turns a bare string type into a shared, reusable
// ontology node keyed by a stable Wikidata id.

import { searchConcepts, refineConceptRanking } from "./data/wikidata.js";

const norm = (s) => String(s || "").trim().toLowerCase();
// already grounded if the id is a Wikidata QID (bare "Q123" or "wd:Q123")
const isGrounded = (id) => /^(wd:)?Q\d+$/i.test(String(id || ""));

// distinct free-text type ids used by nodes and by edges (grounded ones skipped)
export function distinctTerms(analysis) {
  const nodes = new Set(), edges = new Set();
  for (const n of analysis?.nodes || []) if (n.type?.id && !isGrounded(n.type.id)) nodes.add(n.type.id);
  for (const e of analysis?.edges || []) if (e.type?.id && !isGrounded(e.type.id)) edges.add(e.type.id);
  return { nodes: [...nodes], edges: [...edges] };
}

// look up Wikidata candidates for each term. Returns Map<text, {candidates, suggested}>.
// `suggested` is the UNIQUE exact-label match (confident); null when ambiguous or absent.
export async function lookupGroundings(terms) {
  const out = new Map();
  await Promise.all((terms || []).map(async (text) => {
    // rank a deeper list than we show: an object detector emits ordinary nouns
    // ("post", "bat", "trunk"), whose plain sense Wikidata often buries.
    const deep = await searchConcepts(text, 20).catch(() => []);
    const candidates = (await refineConceptRanking(deep, text)).slice(0, 6);
    const exact = candidates.filter((c) => norm(c.label) === norm(text));
    out.set(text, { candidates, suggested: exact.length === 1 ? exact[0] : null });
  }));
  return out;
}

// apply chosen groundings to a COPY of the analysis. nodeChoice/edgeChoice map a
// term id -> { id, label } (a Wikidata grounding); a missing entry keeps the
// term as free text.
export function applyGroundings(analysis, nodeChoice = new Map(), edgeChoice = new Map()) {
  const ground = (term, choice) => {
    const c = term?.id != null ? choice.get(term.id) : null;
    return c ? { id: c.id, label: c.label } : term;
  };
  return {
    ...analysis,
    nodes: (analysis?.nodes || []).map((n) => ({ ...n, type: ground(n.type, nodeChoice) })),
    edges: (analysis?.edges || []).map((e) => ({ ...e, type: ground(e.type, edgeChoice) })),
  };
}

// keep only the confident (unique exact) groundings from a lookup map.
export function confidentChoices(lookup) {
  const m = new Map();
  for (const [text, r] of lookup) if (r.suggested) m.set(text, r.suggested);
  return m;
}

// non-interactive: ground only the confident matches, silently (used for bulk).
export async function autoGroundAnalysis(analysis) {
  const { nodes, edges } = distinctTerms(analysis);
  const [nLook, eLook] = await Promise.all([lookupGroundings(nodes), lookupGroundings(edges)]);
  return applyGroundings(analysis, confidentChoices(nLook), confidentChoices(eLook));
}
