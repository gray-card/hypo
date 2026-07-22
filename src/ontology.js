// ontology.js — the ontology as a byproduct of instance authoring.
//
// There is no ontology editor. The ontology (app.graycard.scene.ontology) is a
// VOCABULARY: the typed-multigraph SCHEMA of node types and relation (edge)
// types in use, derived from the instance scene graphs. It deliberately does NOT
// hold type-to-type relation EDGES.
//
// Why no type-to-type edges. An instance edge (a specific log inside a specific
// firepit) is an existentially-quantified token; the instances ARE its Skolem
// witnesses. Redrawing it as a type-level edge "log --inside--> firepit" would
// silently grant it universal/generic force it never had -- "quantifier
// promotion" (Woods 1975, "What's in a Link?"), the exact reason the KL-ONE /
// KRYPTON tradition splits a terminological T-Box from an assertional A-Box
// (Brachman, Fikes & Levesque 1983). No number of witnesses closes that gap
// under an open world. What instance relations DO tell us, defeasibly, is that a
// relation has been WITNESSED with a given source/target type: soft selectional-
// preference witnesses (domainIncludes / rangeIncludes) on the relation type.

// ---------------------------------------------------------------------------
// Relation CONCEPTS, not prepositions.
//
// A spatial/directional relation is a concept; English lexicalizes it many ways.
// So the algebra is keyed on the concept and each concept carries a `lex` set of
// surface forms (any part of speech, simplex or complex) that express it. This
// dissolves two confusions:
//
//   (1) Synonymy. "beneath", "underneath", "on the underside of" are not three
//       inverses of "on top of" -- they are one converse CONCEPT with several
//       realizations. The converse of a relation is unique, so `inverse` is a
//       single concept id; the synonyms live in that concept's `lex`.
//   (2) Converse vs. antonym. `inverse` is the CONVERSE (swap the arguments):
//       A part-of B  <->  B has-part A;  A above B  <->  B below A. A directional
//       ANTONYM keeps the arguments and reverses the path/orientation: into /
//       out-of, up / down. Those get `opposite`, never `inverse`. Region-relative
//       terms (at-the-top-of / at-the-bottom-of) are two subregions of the SAME
//       ground, so they are neither each other's converse nor antonym -- no link.
//
// The concept<->form map is many-to-many, and BOTH directions matter: one
// concept has many realizations (below <- below, beneath, lower than, ...) AND
// one surface form realizes many concepts (over -> {above, over-path}; under ->
// {below, underneath, under-path}; by -> {near, past-path}; around ->
// {surrounding, around-path}). So `lex` sets overlap freely across concepts and
// LEX_INDEX maps a form to a SET of ids; a cross-cutting form resolves to
// candidates with no unique id, never to a silently-chosen one. The one
// deliberate exception is bare "in"/"on": in a still-image scene the static
// containment/support sense dominates and the motion senses have dedicated forms
// (into/onto), so those bare forms default rather than fan out.
//
// This concept-level treatment follows the linguistic-ontology-of-space tradition
// (GUM-Space, Bateman, Hois, Ross & Tenbrink 2010; cf. Talmy 2000 vol. 1; Landau
// & Jackendoff 1993; Herskovits 1986), where a small set of spatial relations
// backs a large set of linguistic realizations.
export const RELATION_CONCEPTS = {
  // ===== Topological containment =====
  "inside": { label: "inside", category: "topological-containment", lex: ["inside", "in", "within", "inside of", "contained in", "enclosed in", "throughout"], inverse: "contains", transitive: true },
  "contains": { label: "contains", category: "topological-containment", lex: ["contains", "containing", "contain", "encloses", "enclosing", "holds", "holding"], inverse: "inside", transitive: true },
  "outside": { label: "outside", category: "topological-containment", lex: ["outside", "outside of", "out of", "without", "exterior to"] },
  "at": { label: "at", category: "topological-containment", lex: ["at", "at the location of", "aboard", "on board"] },

  // ===== Support / contact =====
  "on-top-of": { label: "on top of", category: "support-contact", axis: "vertical", contact: true, lex: ["on top of", "atop", "on", "upon", "on the top of", "resting on", "sitting on"], inverse: "underneath" },
  "underneath": { label: "underneath", category: "support-contact", axis: "vertical", contact: true, lex: ["underneath", "under", "on the bottom of", "on the underside of"], inverse: "on-top-of" },
  "against": { label: "against", category: "support-contact", contact: true, lex: ["against", "up against", "leaning against", "leaning on", "propped against"] },
  "touching": { label: "touching", category: "support-contact", contact: true, lex: ["touching", "in contact with", "contiguous with", "contiguous to", "abutting", "flush with", "bordering on", "adjoining"], symmetric: true },

  // ===== Vertical axis (projective, no contact required) =====
  "above": { label: "above", category: "vertical-axis", axis: "vertical", contact: false, lex: ["above", "over", "higher than", "overhead of", "up above"], inverse: "below", transitive: true },
  "below": { label: "below", category: "vertical-axis", axis: "vertical", contact: false, lex: ["below", "beneath", "lower than", "under", "down below"], inverse: "above", transitive: true },

  // ===== Frontal axis (projective) =====
  "in-front-of": { label: "in front of", category: "frontal-axis", axis: "frontal", lex: ["in front of", "ahead of", "before", "in the front of", "fore of", "front of"], inverse: "behind", transitive: true },
  "behind": { label: "behind", category: "frontal-axis", axis: "frontal", lex: ["behind", "in back of", "to the rear of", "aft of", "after"], inverse: "in-front-of", transitive: true },

  // ===== Lateral axis (projective) =====
  "left-of": { label: "left of", category: "lateral-axis", axis: "lateral", lex: ["left of", "to the left of", "on the left of", "to the left"], inverse: "right-of", transitive: true },
  "right-of": { label: "right of", category: "lateral-axis", axis: "lateral", lex: ["right of", "to the right of", "on the right of", "to the right"], inverse: "left-of", transitive: true },

  // ===== Frame-absolute (cardinal + intercardinal) =====
  "north-of": { label: "north of", category: "frame-absolute", lex: ["north of", "to the north of", "northward of"], inverse: "south-of", transitive: true },
  "south-of": { label: "south of", category: "frame-absolute", lex: ["south of", "to the south of", "southward of"], inverse: "north-of", transitive: true },
  "east-of": { label: "east of", category: "frame-absolute", lex: ["east of", "to the east of", "eastward of"], inverse: "west-of", transitive: true },
  "west-of": { label: "west of", category: "frame-absolute", lex: ["west of", "to the west of", "westward of"], inverse: "east-of", transitive: true },
  "northeast-of": { label: "northeast of", category: "frame-absolute", lex: ["northeast of", "to the northeast of"], inverse: "southwest-of", transitive: true },
  "southwest-of": { label: "southwest of", category: "frame-absolute", lex: ["southwest of", "to the southwest of"], inverse: "northeast-of", transitive: true },
  "northwest-of": { label: "northwest of", category: "frame-absolute", lex: ["northwest of", "to the northwest of"], inverse: "southeast-of", transitive: true },
  "southeast-of": { label: "southeast of", category: "frame-absolute", lex: ["southeast of", "to the southeast of"], inverse: "northwest-of", transitive: true },

  // ===== Gradient (flow / slope / wind) =====
  "upstream-of": { label: "upstream of", category: "gradient", lex: ["upstream of", "up the river from"], inverse: "downstream-of", transitive: true },
  "downstream-of": { label: "downstream of", category: "gradient", lex: ["downstream of", "down the river from"], inverse: "upstream-of", transitive: true },
  "uphill-from": { label: "uphill from", category: "gradient", lex: ["uphill from", "up the slope from"], inverse: "downhill-from", transitive: true },
  "downhill-from": { label: "downhill from", category: "gradient", lex: ["downhill from", "down the slope from"], inverse: "uphill-from", transitive: true },
  "upwind-of": { label: "upwind of", category: "gradient", lex: ["upwind of"], inverse: "downwind-of", transitive: true },
  "downwind-of": { label: "downwind of", category: "gradient", lex: ["downwind of"], inverse: "upwind-of", transitive: true },

  // ===== Proximity / distance (symmetric) =====
  "near": { label: "near", category: "proximity", lex: ["near", "near to", "nearby", "close to", "close by", "close", "by", "hard by", "nigh", "proximate to", "in proximity to", "in the vicinity of", "in the region of", "a stone's throw from", "within reach of", "within sight of"], symmetric: true },
  "far-from": { label: "far from", category: "proximity", lex: ["far from", "far away from", "distant from", "remote from", "a long way from", "nowhere near", "well away from"], symmetric: true },

  // ===== Adjacency (immediate lateral neighbor; symmetric) =====
  "adjacent-to": { label: "adjacent to", category: "adjacency", lex: ["adjacent to", "next to", "beside", "alongside", "by the side of", "side by side with", "next door to", "cheek by jowl with"], symmetric: true },

  // ===== Proximity-negative (separation; NOT a converse of proximity) =====
  "clear-of": { label: "clear of", category: "proximity-negative", lex: ["clear of", "out of the way of", "well clear of"] },
  "out-of-sight-of": { label: "out of sight of", category: "proximity-negative", lex: ["out of sight of", "hidden from", "obscured from"] },
  "out-of-reach-of": { label: "out of reach of", category: "proximity-negative", lex: ["out of reach of", "beyond the reach of"] },

  // ===== Betweenness / collective ground (ternary; no converse) =====
  "between": { label: "between", category: "betweenness", arity: "ternary", lex: ["between", "in between", "betwixt", "halfway between", "midway between"] },
  "among": { label: "among", category: "betweenness", arity: "collective", lex: ["among", "amongst", "amid", "amidst", "in the midst of", "in the thick of"] },
  "flanking": { label: "flanking", category: "betweenness", arity: "collective", lex: ["flanking", "on either side of", "either side of", "on both sides of"] },

  // ===== Surrounding / spanning =====
  "surrounding": { label: "surrounding", category: "surrounding", lex: ["surrounding", "encircling", "ringing", "around", "round", "girdling"], inverse: "surrounded-by", transitive: true },
  "surrounded-by": { label: "surrounded by", category: "surrounding", lex: ["surrounded by", "encircled by", "ringed by", "hemmed in by"], inverse: "surrounding", transitive: true },
  "astride": { label: "astride", category: "surrounding", lex: ["astride", "straddling", "spanning"] },

  // ===== Orientation / alignment (symmetric) =====
  "parallel-to": { label: "parallel to", category: "orientation", lex: ["parallel to", "in line with", "aligned with", "collinear with"], symmetric: true, transitive: true },
  "perpendicular-to": { label: "perpendicular to", category: "orientation", lex: ["perpendicular to", "at right angles to", "athwart", "normal to"], symmetric: true },
  "level-with": { label: "level with", category: "orientation", lex: ["level with", "even with", "at the level of", "abreast of", "abeam of", "at the same height as"], symmetric: true, transitive: true },
  "facing": { label: "facing", category: "orientation", lex: ["facing", "oriented toward", "pointing at", "turned toward"] },

  // ===== Frame-relative (far/near side; opposition) =====
  "opposite": { label: "opposite", category: "frame-relative", lex: ["opposite", "across from", "catercorner from", "kitty-corner from", "vis-a-vis", "diagonally across from"], symmetric: true },
  "beyond": { label: "beyond", category: "frame-relative", lex: ["beyond", "on the far side of", "past"], inverse: "this-side-of", transitive: true },
  "this-side-of": { label: "this side of", category: "frame-relative", lex: ["this side of", "on the near side of", "short of"], inverse: "beyond", transitive: true },

  // ===== Region-relative (subregion of a single ground; NO converse) =====
  "in-the-middle-of": { label: "in the middle of", category: "region-relative", lex: ["in the middle of", "in the center of", "at the center of", "in the heart of", "at the heart of", "centered in"] },
  "at-the-edge-of": { label: "at the edge of", category: "region-relative", lex: ["at the edge of", "on the edge of", "at the side of", "on the outskirts of", "at the periphery of", "on the margin of"] },
  "at-the-corner-of": { label: "at the corner of", category: "region-relative", lex: ["at the corner of", "in the corner of"] },
  "at-the-top-of": { label: "at the top of", category: "region-relative", lex: ["at the top of", "at the upper part of"] },
  "at-the-bottom-of": { label: "at the bottom of", category: "region-relative", lex: ["at the bottom of", "at the foot of", "at the base of", "at the lower part of"] },
  "at-the-back-of": { label: "at the back of", category: "region-relative", lex: ["at the back of", "at the rear of", "in the back of"] },
  "at-the-front-of": { label: "at the front of", category: "region-relative", lex: ["at the front of", "in the front of", "at the head of"] },
  "at-the-end-of": { label: "at the end of", category: "region-relative", lex: ["at the end of", "at the tip of"] },

  // ===== Mereology (not prepositions, but core scene relations) =====
  "part-of": { label: "part of", category: "mereology", lex: ["part of", "a part of", "component of", "piece of"], inverse: "has-part", transitive: true },
  "has-part": { label: "has part", category: "mereology", lex: ["has part", "made up of", "composed of"], inverse: "part-of", transitive: true },

  // ===== Path / directional motion (dynamic; use `opposite`, NOT `inverse`) =====
  "to": { label: "to", category: "path-directional", lex: ["to", "up to", "all the way to"], opposite: "from" },
  "from": { label: "from", category: "path-directional", lex: ["from"], opposite: "to" },
  "into": { label: "into", category: "path-directional", lex: ["into"], opposite: "out-from" },
  "out-from": { label: "out of (motion)", category: "path-directional", lex: ["out from", "outward from", "out of"], opposite: "into" },
  "onto": { label: "onto", category: "path-directional", lex: ["onto", "on to", "up onto"], opposite: "off" },
  "off": { label: "off", category: "path-directional", lex: ["off", "off of", "down off"], opposite: "onto" },
  "toward": { label: "toward", category: "path-directional", lex: ["toward", "towards", "in the direction of", "headed for", "en route to"], opposite: "away-from" },
  "away-from": { label: "away from", category: "path-directional", lex: ["away from", "receding from"], opposite: "toward" },
  "up": { label: "up (motion)", category: "path-directional", lex: ["up", "upward", "upwards"], opposite: "down" },
  "down": { label: "down (motion)", category: "path-directional", lex: ["down", "downward", "downwards"], opposite: "up" },
  "over-path": { label: "over (path)", category: "path-directional", lex: ["over", "across the top of"], opposite: "under-path" },
  "under-path": { label: "under (path)", category: "path-directional", lex: ["under"], opposite: "over-path" },
  "through": { label: "through", category: "path-directional", lex: ["through", "by way of", "via"] },
  "across": { label: "across", category: "path-directional", lex: ["across", "over to the other side of"] },
  "along": { label: "along", category: "path-directional", lex: ["along", "down the length of"] },
  "past-path": { label: "past (path)", category: "path-directional", lex: ["past", "by", "going past"] },
  "around-path": { label: "around (path)", category: "path-directional", lex: ["around", "round", "about"] },
};

// keys that flow from a concept onto a derived edge type (lexicon-conformant);
// `lex`/`category`/`axis`/`contact`/`arity` stay on RELATION_CONCEPTS as reference.
const ALGEBRA_KEYS = ["inverse", "opposite", "symmetric", "transitive", "reflexive", "functional"];
const algebraOf = (concept) => {
  const out = {};
  for (const k of ALGEBRA_KEYS) if (concept[k] !== undefined) out[k] = concept[k];
  return out;
};

// ---- lexical resolution: surface form -> concept -------------------------
const norm = (s) =>
  String(s ?? "").toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "");

// normalized surface form -> Set of concept ids that realize it (many-to-many)
const LEX_INDEX = new Map();
const indexForm = (form, id) => {
  const k = norm(form);
  if (!k) return;
  if (!LEX_INDEX.has(k)) LEX_INDEX.set(k, new Set());
  LEX_INDEX.get(k).add(id);
};
const ID_BY_NORM = new Map();
for (const [id, c] of Object.entries(RELATION_CONCEPTS)) {
  ID_BY_NORM.set(norm(id), id);
  indexForm(id, id);
  indexForm(c.label, id);
  for (const form of c.lex || []) indexForm(form, id);
}

// Resolve a relation string (a concept id, a canonical label, or any lexical
// realization) to a concept. An exact concept-id match is unambiguous and wins.
// Otherwise the lexical index decides: exactly one candidate -> that concept;
// several -> ambiguous (id null, candidates listed); none -> unrecognized.
// Returns { id: string|null, candidates: string[] }.
export function resolveRelation(input) {
  const key = norm(input);
  if (!key) return { id: null, candidates: [] };
  if (ID_BY_NORM.has(key)) { const id = ID_BY_NORM.get(key); return { id, candidates: [id] }; }
  const set = LEX_INDEX.get(key);
  const candidates = set ? [...set] : [];
  return { id: candidates.length === 1 ? candidates[0] : null, candidates };
}

// convenience: the unique concept id for a relation string, or null if
// unrecognized or ambiguous.
export const relationConcept = (input) => resolveRelation(input).id;

// A curated seed of common relation concepts for the relation picker (canonical
// labels), so the editor and the algebra share one source of truth.
const SEED_IDS = [
  "above", "below", "left-of", "right-of", "in-front-of", "behind",
  "near", "adjacent-to", "inside", "contains", "on-top-of", "part-of",
  "touching", "surrounding",
];
export const SPATIAL_SEED = SEED_IDS.map((id) => ({ id, label: RELATION_CONCEPTS[id].label }));

// ---- vocabulary derivation -----------------------------------------------
const termOf = (t) => (t && t.id != null ? { id: String(t.id), label: t.label || String(t.id) } : null);
const addUnique = (arr, v) => { if (v != null && !arr.includes(v)) arr.push(v); };

// Derive the type VOCABULARY from instance scene graphs.
//   nodes: scene.node records  [{ uri, value:{ type:{id,label} } }]
//   edges: scene.edge records   [{ value:{ type:{id,label}, from, to } }]  (from/to = node AT-URIs)
// returns { nodeTypes:[{id,label}], edgeTypes:[{id,label,...algebra, domainIncludes, rangeIncludes}] }.
// Edge relation strings are normalized to their canonical relation concept when
// one resolves uniquely (so "lower than" and "below" merge into one edge type
// carrying the algebra); unrecognized or ambiguous relations are kept verbatim
// with no algebra. domainIncludes/rangeIncludes are the NON-EXHAUSTIVE source/
// target node types witnessed for each relation type (selectional-preference
// evidence, not a hard domain/range constraint).
export function deriveVocabulary(nodes = [], edges = [], { relationConcepts = RELATION_CONCEPTS } = {}) {
  const typeByNodeUri = new Map();
  const nodeTypes = new Map();
  for (const n of nodes) {
    const uri = n.uri ?? n.value?.uri;
    const t = termOf(n.value?.type ?? n.type);
    if (!t) continue;
    if (uri != null) typeByNodeUri.set(uri, t.id);
    if (!nodeTypes.has(t.id)) nodeTypes.set(t.id, t);
  }
  const edgeTypes = new Map();
  for (const e of edges) {
    const ev = e.value ?? e;
    const rel = termOf(ev.type);
    if (!rel) continue;
    const cid = resolveRelation(rel.id).id || resolveRelation(rel.label).id;
    const concept = cid ? relationConcepts[cid] : null;
    const key = concept ? cid : rel.id;
    let et = edgeTypes.get(key);
    if (!et) {
      et = concept
        ? { id: cid, label: concept.label, ...algebraOf(concept), domainIncludes: [], rangeIncludes: [] }
        : { ...rel, domainIncludes: [], rangeIncludes: [] };
      edgeTypes.set(key, et);
    }
    addUnique(et.domainIncludes, typeByNodeUri.get(ev.from));   // a witness for the relation's domain
    addUnique(et.rangeIncludes, typeByNodeUri.get(ev.to));      // a witness for its codomain
  }
  return { nodeTypes: [...nodeTypes.values()], edgeTypes: [...edgeTypes.values()] };
}
