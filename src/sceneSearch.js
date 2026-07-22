// sceneSearch.js — semantic search over scene graphs.
//
// A query is matched against the OBJECTS (node types), RELATIONS (edge types),
// and SPATIAL relations of each photo's scene graph. "Semantic" means the match
// leverages Wikidata's class hierarchy: a query concept matches a node when the
// node's grounded entity IS that concept OR a subclass/instance of it (so
// "animal" finds a photo grounded to "dog"). Relations reuse the relation-concept
// resolver (so "left of"/"beneath"/… collapse to one concept, with converses).
//
// PARSING. A query is parsed into a shared query IR consumed by ONE matcher:
//   { match: "all"|"any", clauses: Clause[] }
//   ObjectClause   = { kind:"object",   concept, negate?, minCount? }
//   RelationClause = { kind:"relation", subject|null, relation, object|null, negate? }
// Two parsers emit this IR: an offline heuristic (parseQueryToIR, the default) and
// an optional LLM (its raw output is run through validateIR, then falls back to
// the heuristic). Both emit plain LABELS only; Wikidata QID resolution + hierarchy
// expansion stay in this file (searchScenes), never in the parser.
//
// The engine is PURE and dependency-injected so it unit-tests fully offline:
//   - resolveTerm(text)  -> { qids: [id...], label } | { qid, label } | null   (query label -> Wikidata sense(s))
//   - ancestorsOf(qids)  -> Map<qid, Set<qid>>       (a node id -> its ancestors)
//   - llmParse(query)    -> raw IR | null            (optional; validated + falls back)

import { resolveRelation, RELATION_CONCEPTS } from "./ontology.js";

export const isQid = (s) => /^Q\d+$/.test(String(s ?? ""));
// norm() stays the string-level helper the ontology/query-parse code relies on
// (exact-id + lexicon matching). The BM25 tokenizer below is a separate, richer
// pipeline; do not fold the two together.
export const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "");

// ---- tokenizer (shared by BM25 query, corpus index, and the build scripts) --
// normalizeString -> split -> stem -> filter (-> phrase-merge). A SINGLE code
// path so df keys, indexed doc tokens, and query tokens can never drift; the
// exact same function is imported by scripts/build-tokenizer.mjs and
// scripts/build-caption-idf.mjs. See STYLE/data-provenance in those scripts.
export const MAX_BASE_LEN = 30;      // drop-whole (never truncate) longer unigrams
export const PHRASE_JOINER = "_";    // merged phrase tokens join components with "_"
export const STEMMER_VERSION = "s-lite-1";
export const NORM_VERSION = "norm-1";

// Contractions expanded on internal-apostrophe words (frozen; build == runtime).
const CONTRACTIONS = new Map([
  ["can't", "cannot"], ["won't", "will not"], ["don't", "do not"], ["i'm", "i am"],
  ["it's", "it is"], ["let's", "let us"], ["that's", "that is"], ["there's", "there is"],
  ["what's", "what is"], ["he's", "he is"], ["she's", "she is"], ["you're", "you are"],
  ["we're", "we are"], ["they're", "they are"], ["isn't", "is not"], ["aren't", "are not"],
  ["wasn't", "was not"], ["weren't", "were not"], ["doesn't", "does not"], ["didn't", "did not"],
  ["i've", "i have"], ["you've", "you have"], ["we've", "we have"], ["they've", "they have"],
  ["i'll", "i will"], ["you'll", "you will"], ["we'll", "we will"],
]);

// The 13-step alignment-safe normalization pipeline. Locale-independent; folds
// diacritics and typographic punctuation; neutralizes "_" before any merge.
export function normalizeString(s) {
  s = String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");   // 1-3: NFKD + drop combining marks
  s = s.toLowerCase();                                                     // 4: locale-independent case fold
  s = s.replace(/[‘’ʼ`´]/g, "'");                 // 5: typographic apostrophes -> ASCII '
  s = s.replace(/[‐-―−]/g, "-");                            // 6: unicode dashes/minus -> hyphen
  s = s.replace(/[a-z]+'[a-z]+/g, (m) => CONTRACTIONS.get(m) || m);        // 7: expand contractions
  s = s.replace(/([a-z0-9])'s\b/g, "$1").replace(/([a-z0-9])s'\b/g, "$1s").replace(/'/g, "");   // 8: possessives + strip '
  s = s.replace(/_/g, " ");                                                // 9: neutralize the phrase joiner
  s = s.replace(/&/g, " and ").replace(/\+/g, " and ").replace(/\//g, " ");   // 10: connective symbols
  s = s.replace(/(\d),(\d{3})\b/g, "$1$2");                                // 11a: thousands separators
  s = s.replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2"); // 11b: split number+unit (5km -> 5 km)
  s = s.replace(/[^a-z0-9 ]+/g, " ");                                      // 12: strip emoji/punct/residual (incl. CJK)
  return s.replace(/\s+/g, " ").trim();                                    // 13: collapse whitespace
}

// Singular nouns ending in -s and -ie plurals the rules would corrupt.
const PROTECTED = new Set([
  "news", "lens", "canvas", "atlas", "iris", "bus", "gas", "virus", "campus", "series",
  "species", "physics", "mathematics", "gymnastics", "means", "headquarters", "crossroads",
  "movies", "cookies", "calories", "zombies", "rookies", "brownies", "genies", "hippies",
]);

// S-stemmer-lite: plural-only folding (no derivational stripping, so
// universe/university, arm/army, organ/organization stay distinct). Input is
// already NFKD-folded ASCII lowercase with apostrophes removed by normalizeString.
export function stem(tok) {
  if (PROTECTED.has(tok)) return tok;
  if (tok.length < 4) return tok;                                          // bus, gas, cds, ...
  if (tok.endsWith("ies")) { const st = tok.slice(0, -3) + "y"; return st.length >= 3 ? st : tok; }        // cities -> city
  if (/(?:sses|xes|zzes|ches|shes)$/.test(tok)) { const st = tok.slice(0, -2); return st.length >= 3 ? st : tok; }   // glasses -> glass
  if (tok.endsWith("s") && !/(?:ss|us|is)$/.test(tok)) { const st = tok.slice(0, -1); return st.length >= 3 ? st : tok; }   // dogs -> dog
  return tok;
}

// Factory: the ONE tokenizer. With a non-empty `phrases` array it also merges
// learned multiword units by deterministic left-to-right longest match; without
// it, the base tokenizer (normalize+stem+filter). tokenize below is the base.
export function makeTokenizer({ phrases } = {}) {
  const baseTok = (s) => {
    const out = [];
    for (const w of normalizeString(s).split(" ")) {
      if (!w) continue;
      const t = stem(w);
      if (!t || /^\d+$/.test(t) || t.length > MAX_BASE_LEN) continue;
      out.push(t);
    }
    return out;
  };
  if (!Array.isArray(phrases) || !phrases.length) return baseTok;
  const phraseSet = new Set(phrases);
  const firstMax = new Map();   // first component token -> longest phrase length starting there
  for (const p of phrases) {
    const parts = p.split(PHRASE_JOINER);
    if (parts.length < 2) continue;
    firstMax.set(parts[0], Math.max(firstMax.get(parts[0]) || 0, parts.length));
  }
  return (s) => {
    const toks = baseTok(s);
    const out = [];
    for (let i = 0; i < toks.length;) {
      const maxK = Math.min(firstMax.get(toks[i]) || 0, toks.length - i);
      let merged = false;
      for (let k = maxK; k >= 2; k--) {
        const cand = toks.slice(i, i + k).join(PHRASE_JOINER);
        if (phraseSet.has(cand)) { out.push(cand); i += k; merged = true; break; }
      }
      if (!merged) { out.push(toks[i]); i += 1; }
    }
    return out;
  };
}

// Canonical base tokenizer (normalize + stem, NO phrases). Every non-BM25 caller
// and the degradation path use this; BM25 paths pass a phrase-aware tokenizer.
export const tokenize = makeTokenizer();
const push = (map, key, val) => { const a = map.get(key); if (a) a.push(val); else map.set(key, [val]); };

// ---- index -----------------------------------------------------------------
// Build a per-photo view of the scene graph from the public records.
//   scenes:     app.graycard.scene.graph  [{ uri, value:{ subject } }]
//   sceneNodes: app.graycard.scene.node   [{ uri, value:{ scene, type:{id,label}, label } }]
//   sceneEdges: app.graycard.scene.edge   [{ uri, value:{ scene, type:{id,label}, from, to } }]
export function buildSceneIndex({ scenes = [], sceneNodes = [], sceneEdges = [] } = {}) {
  const photoByGraph = new Map();
  for (const g of scenes) if (g?.uri && g.value?.subject) photoByGraph.set(g.uri, g.value.subject);

  const nodeById = new Map();
  const nodesByGraph = new Map();
  const objectForms = new Set();   // every node surface form, for local multi-word segmentation
  for (const n of sceneNodes) {
    const g = n.value?.scene; if (!g) continue;
    const t = n.value.type || {};
    const entry = {
      uri: n.uri,
      typeId: String(t.id ?? ""),
      label: t.label || n.value.label || String(t.id ?? ""),
      qid: isQid(t.id) ? String(t.id) : null,
    };
    nodeById.set(n.uri, entry);
    push(nodesByGraph, g, entry);
    if (entry.label) objectForms.add(norm(entry.label));
    if (!entry.qid && entry.typeId) objectForms.add(norm(entry.typeId));
  }

  const edgesByGraph = new Map();
  const relationForms = new Set();
  for (const e of sceneEdges) {
    const g = e.value?.scene; if (!g) continue;
    const t = e.value.type || {};
    const conceptId = resolveRelation(t.id).id || resolveRelation(t.label).id;
    const edge = {
      from: e.value.from, to: e.value.to,
      relId: String(t.id ?? ""), relLabel: t.label || String(t.id ?? ""),
      concept: conceptId,
    };
    relationForms.add(norm(edge.relId));
    relationForms.add(norm(edge.relLabel));
    if (conceptId) relationForms.add(norm(RELATION_CONCEPTS[conceptId]?.label || conceptId));
    push(edgesByGraph, g, edge);
  }

  const photos = new Map();   // photo uri -> { photo, nodes, edges }
  for (const [g, photo] of photoByGraph) {
    const rec = photos.get(photo) || { photo, nodes: [], edges: [] };
    rec.nodes.push(...(nodesByGraph.get(g) || []));
    for (const e of edgesByGraph.get(g) || []) rec.edges.push({ ...e, fromNode: nodeById.get(e.from) || null, toNode: nodeById.get(e.to) || null });
    photos.set(photo, rec);
  }

  const allNodeQids = [...new Set([...nodeById.values()].map((n) => n.qid).filter(Boolean))];
  return { photos, allNodeQids, relationForms, objectForms };
}

// ---- text index (BM25 over a photo's title + description + alt text) --------
// Complements the scene graph: most photos are not analyzed, but their text
// still describes them. docs: [{ uri, text }].
// `tokenizeFn` defaults to the base tokenizer; pass a phrase-aware tokenizer so
// the indexed doc tokens match the query tokens and the shipped df keys exactly.
export function buildTextIndex(docs = [], tokenizeFn = tokenize) {
  const postings = new Map();   // term -> Map<uri, term-frequency>
  const len = new Map();        // uri -> document length (tokens)
  let total = 0;
  for (const { uri, text } of docs) {
    if (!uri) continue;
    const toks = tokenizeFn(text || "");
    len.set(uri, toks.length); total += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) { let p = postings.get(t); if (!p) postings.set(t, (p = new Map())); p.set(uri, f); }
  }
  const N = len.size;
  return { N, avgdl: N ? total / N : 0, postings, len };
}

// Okapi BM25 scoring of `terms` over the text index. Returns Map<uri, score>.
// `idf(term, localDf)` (optional) supplies corpus-wide IDF from a shipped table;
// omitted, the per-profile formula is used.
export function bm25Search(index, terms, { k1 = 1.5, b = 0.75, idf } = {}) {
  const scores = new Map();
  if (!index || !index.N) return scores;
  for (const term of new Set(terms)) {
    const p = index.postings.get(term); if (!p) continue;
    const termIdf = idf ? idf(term, p.size) : Math.log(1 + (index.N - p.size + 0.5) / (p.size + 0.5));
    for (const [uri, tf] of p) {
      const dl = index.len.get(uri) || 0;
      scores.set(uri, (scores.get(uri) || 0) + termIdf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / (index.avgdl || 1)))));
    }
  }
  return scores;
}

// ---- heuristic parser (offline default) ------------------------------------
// Closed-class function words used to segment noun phrases without a POS tagger
// (Abney/NLTK base-NP): strip leading determiners/quantifiers, drop copula/filler.
const DET = new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their", "some", "any", "all", "both", "each", "every", "another", "such"]);
const FILLER = new Set(["is", "are", "was", "were", "be", "being", "been", "am", "there", "that", "'s"]);
const NEG = /^(?:no|not|without|sans|minus|lacking)\s+(.+)$/;
const NUMWORD = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, several: 2, many: 2 };
const known = (phrase, relationForms) => { const p = norm(phrase); return resolveRelation(p).id != null || relationForms.has(p); };

// Reduce a phrase to its base noun phrase: drop leading determiners, then filler.
function stripNP(text) {
  let words = norm(text).split(" ").filter(Boolean);
  while (words.length && DET.has(words[0])) words.shift();
  words = words.filter((w) => !FILLER.has(w));
  return words.join(" ").trim();
}

// Leading quantity -> { count, rest }, or null. "a"/"an"/"one" are NOT counts.
function leadingCount(s) {
  const w = s.split(" ");
  let i = 0, plus = 0;
  if (w[0] === "at" && w[1] === "least") i = 2;
  else if (w[0] === "more" && w[1] === "than") { plus = 1; i = 2; }
  const tok = w[i];
  const n = /^\d+$/.test(tok || "") ? parseInt(tok, 10) : NUMWORD[tok];
  if (!n || i + 1 >= w.length) return null;   // need a noun after the count
  return { count: Math.max(1, n + plus), rest: w.slice(i + 1).join(" ") };
}

// Leftmost-longest relation detection, generalized to allow a wildcard subject
// ("near a tree") or object ("dog on top of"). Returns {subj, phrase, obj} or null.
function detectRelation(s, relationForms) {
  const w = s.split(" ");
  if (w.length < 2) return null;
  for (let span = Math.min(4, w.length); span >= 1; span--) {
    for (let i = 0; i + span <= w.length; i++) {
      const phrase = w.slice(i, i + span).join(" ");
      if (!known(phrase, relationForms)) continue;
      const subj = w.slice(0, i).join(" ").trim();
      const obj = w.slice(i + span).join(" ").trim();
      if (subj || obj) return { subj, phrase, obj };
    }
  }
  return null;
}

// Forward maximum matching against the profile's node vocabulary, so "dog tree"
// splits into two object concepts when both are known labels, while "fire
// hydrant" stays whole when that label exists. Unknown runs are left whole.
function segmentObjects(np, objectForms) {
  const w = np.split(" ").filter(Boolean);
  if (!objectForms.size || w.length < 2) return [np];
  const segs = [];
  let i = 0, buf = [];
  const flush = () => { if (buf.length) { segs.push(buf.join(" ")); buf = []; } };
  while (i < w.length) {
    let hit = null;
    for (let j = Math.min(w.length, i + 5); j > i; j--) { const cand = w.slice(i, j).join(" "); if (objectForms.has(cand)) { hit = { cand, len: j - i }; break; } }
    if (hit) { flush(); segs.push(hit.cand); i += hit.len; }   // known label
    else { buf.push(w[i]); i += 1; }                            // buffer unknown words; resume scanning
  }
  flush();   // trailing unknown run kept whole
  return segs.length ? segs : [np];
}

function parseSpan(span, relationForms, objectForms) {
  let s = norm(span);
  if (!s) return [];
  let negate = false, minCount;
  const nm = NEG.exec(s);   // leading "-x" is rewritten to ", not x" upstream in parseQueryToIR
  if (nm) { negate = true; s = nm[1].trim(); }
  const lc = leadingCount(s);
  if (lc) { minCount = lc.count; s = lc.rest; }
  if (!s) return [];

  const rel = detectRelation(s, relationForms);
  if (rel) {
    const subject = stripNP(rel.subj) || null;
    const object = stripNP(rel.obj) || null;
    // both arguments collapsed to determiner/filler -> not a usable relation (and
    // validateIR would reject it); fall through to object parsing instead.
    if (subject || object) {
      const clause = { kind: "relation", subject, relation: rel.phrase, object };
      if (negate) clause.negate = true;
      return [clause];
    }
  }
  const np = stripNP(s);
  if (!np) return [];
  // a negated or counted run is kept as one concept (splitting muddies the flag)
  if (negate || minCount != null) {
    const clause = { kind: "object", concept: np };
    if (negate) clause.negate = true;
    else if (minCount > 1) clause.minCount = minCount;
    return [clause];
  }
  return segmentObjects(np, objectForms).map((concept) => ({ kind: "object", concept }));
}

// Parse free text into the shared query IR. Deterministic, synchronous, offline.
// A mixed query ("dog and cat or bird") becomes OR-of-AND: match "any" over group
// clauses ({ kind:"group", match:"all", clauses:[...] }), so AND binds tighter than
// OR. Single-clause groups collapse to a bare clause (keeping simple IR simple).
export function parseQueryToIR(text, { relationForms = new Set(), objectForms = new Set() } = {}) {
  // a token-initial "-x" is negation; rewrite BEFORE norm collapses the hyphen.
  const q = norm(String(text ?? "").replace(/(^|[\s,])-(?=\S)/g, "$1, not "));
  if (!q) return { match: "all", clauses: [] };
  const parseGroup = (g) => g.split(/\s*,\s*|\s+and\s+/).flatMap((span) => parseSpan(span, relationForms, objectForms));
  const groups = q.split(/\s+or\s+/).map((s) => s.trim()).filter(Boolean);
  if (groups.length <= 1) {
    const clauses = parseGroup(groups[0] || q);
    return { match: "all", clauses: clauses.length ? clauses : [{ kind: "object", concept: q }] };
  }
  const clauses = groups
    .map((g) => { const inner = parseGroup(g); return inner.length === 1 ? inner[0] : { kind: "group", match: "all", clauses: inner }; })
    .filter((c) => c && (c.kind !== "group" || c.clauses.length));
  return { match: "any", clauses: clauses.length ? clauses : [{ kind: "object", concept: q }] };
}

// Validate + repair an externally-produced IR (from the LLM). Drops malformed
// clauses, strips leaked QIDs, and forbids negate+minCount (an unsound upper
// bound). Returns a clean IR or null if nothing usable survives.
const cleanLabel = (v) => (v == null || isQid(String(v).trim()) ? "" : norm(v));
export function validateIR(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.clauses)) return null;
  const match = raw.match === "any" ? "any" : "all";
  const clauses = [];
  for (const c of raw.clauses) {
    if (!c || typeof c !== "object") continue;
    const negate = c.negate === true;
    if (c.kind === "relation") {
      const relation = cleanLabel(c.relation);
      const subject = cleanLabel(c.subject) || null;
      const object = cleanLabel(c.object) || null;
      if (!relation || (!subject && !object)) continue;
      clauses.push({ kind: "relation", subject, relation, object, ...(negate ? { negate: true } : {}) });
    } else {
      const concept = cleanLabel(c.concept);
      if (!concept) continue;
      const clause = { kind: "object", concept };
      if (negate) clause.negate = true;                                              // negate wins; drop any minCount
      else if (Number.isInteger(c.minCount) && c.minCount > 1) clause.minCount = c.minCount;
      clauses.push(clause);
    }
  }
  return clauses.length ? { match, clauses } : null;
}

// ---- matching --------------------------------------------------------------
// Graded node<->term match: exact QID 1.0; hierarchy member 0.7 (subclass /
// instance / part-of — the flat ancestor set grades members equally; a tagged
// Map<qid,weight> is honored when present); ungrounded label/typeId substring 0.4;
// no match 0. When both sides are grounded the hierarchy is authoritative (no
// substring fallback, so "car" != "scarf"). nodeMatches is the boolean >0 view.
function nodeMatchWeight(node, term, ancestors) {
  if (!node) return 0;
  // A query term may carry several candidate senses (qids); the node matches at
  // the STRONGEST sense — exact QID (1.0) beats a class/part-of ancestor (<=0.7).
  const qids = term.qids || (term.qid ? [term.qid] : []);
  if (qids.length && node.qid) {
    const anc = ancestors.get(node.qid);
    let best = 0;
    for (const q of qids) {
      if (node.qid === q) return 1.0;
      if (anc instanceof Map) { const w = anc.get(q); if (w != null && w > best) best = w; }
      else if (anc && typeof anc.has === "function" && anc.has(q)) best = Math.max(best, 0.7);
    }
    return best;   // both sides grounded -> hierarchy is authoritative, no label fallback
  }
  const t = norm(term.text);
  if (!t) return 0;
  return (norm(node.label).includes(t) || norm(node.typeId).includes(t)) ? 0.4 : 0;
}
const nodeMatches = (node, term, ancestors) => nodeMatchWeight(node, term, ancestors) > 0;

// Resolve a raw relation phrase to { concept, text }: a relation-concept id when
// spatial/known to the algebra, else null (then match the edge's raw label).
function resolveRel(phrase) {
  const r = resolveRelation(phrase);
  return { concept: r.id, text: norm(phrase) };
}

function edgeRelationMatches(edge, rel) {
  if (rel.concept && edge.concept) {
    // symmetric relations (near, next to, touching, opposite, parallel to …)
    // hold in both directions, so the argument order in the query is free.
    if (edge.concept === rel.concept) return { ok: true, inverse: false, symmetric: RELATION_CONCEPTS[rel.concept]?.symmetric === true };
    if (RELATION_CONCEPTS[rel.concept]?.inverse === edge.concept) return { ok: true, inverse: true };
    return { ok: false };
  }
  // raw-label match (non-spatial relations like "riding", "holding")
  if (rel.text && (norm(edge.relLabel).includes(rel.text) || norm(edge.relId).includes(rel.text))) return { ok: true, inverse: false, raw: true };
  return { ok: false };
}

const WILDCARD = Symbol("any-node");
const nodeMatchOrWild = (n, X, ancestors) => (X === WILDCARD ? !!n : nodeMatches(n, X, ancestors));

function evalObject(c, rec, resolved, ancestors) {
  const C = resolved.get(c.concept) || { text: c.concept };
  const k = rec.nodes.filter((n) => nodeMatches(n, C, ancestors)).length;
  const ok = k >= (c.minCount ?? 1);
  // open-world: a negated clause means "the graph does not WITNESS this", and only
  // for photos that actually have an indexed graph (so empty graphs don't flood).
  return c.negate ? (rec.nodes.length > 0 && !ok) : ok;
}

function evalRelation(c, rec, resolved, ancestors) {
  const S = c.subject == null ? WILDCARD : (resolved.get(c.subject) || { text: c.subject });
  const O = c.object == null ? WILDCARD : (resolved.get(c.object) || { text: c.object });
  const R = resolveRel(c.relation);
  const ok = rec.edges.some((e) => {
    const m = edgeRelationMatches(e, R);
    if (!m.ok) return false;
    const [s, o] = m.inverse ? [e.toNode, e.fromNode] : [e.fromNode, e.toNode];
    if (nodeMatchOrWild(s, S, ancestors) && nodeMatchOrWild(o, O, ancestors)) return true;
    if (m.symmetric && nodeMatchOrWild(o, S, ancestors) && nodeMatchOrWild(s, O, ancestors)) return true;
    return false;
  });
  return c.negate ? (rec.edges.length > 0 && !ok) : ok;
}

// Evaluate a query IR against one photo's scene graph. A `group` clause recurses,
// giving one level of OR-of-AND nesting.
export function evaluateIR(rec, ir, resolved, ancestors) {
  if (!ir.clauses.length) return false;
  const rs = ir.clauses.map((c) =>
    c.kind === "group" ? evaluateIR(rec, c, resolved, ancestors)
      : c.kind === "relation" ? evalRelation(c, rec, resolved, ancestors)
        : evalObject(c, rec, resolved, ancestors));
  return ir.match === "any" ? rs.some(Boolean) : rs.every(Boolean);
}

// ---- graded scoring (for ranking) ------------------------------------------
const wildWeight = (n, X, ancestors) => (X === WILDCARD ? (n ? 1 : 0) : nodeMatchWeight(n, X, ancestors));

function objectScore(c, rec, resolved, ancestors) {
  if (c.negate) return evalObject(c, rec, resolved, ancestors) ? 1 : 0;   // negation is boolean
  const C = resolved.get(c.concept) || { text: c.concept };
  const w = rec.nodes.map((n) => nodeMatchWeight(n, C, ancestors)).filter((x) => x > 0).sort((a, b) => b - a);
  const m = c.minCount ?? 1;
  return Math.min(1, w.slice(0, m).reduce((a, b) => a + b, 0) / m);   // partial credit; meeting the count -> ~1
}
function relationScore(c, rec, resolved, ancestors) {
  if (c.negate) return evalRelation(c, rec, resolved, ancestors) ? 1 : 0;
  const S = c.subject == null ? WILDCARD : (resolved.get(c.subject) || { text: c.subject });
  const O = c.object == null ? WILDCARD : (resolved.get(c.object) || { text: c.object });
  const R = resolveRel(c.relation);
  let best = 0;
  for (const e of rec.edges) {
    const m = edgeRelationMatches(e, R);
    if (!m.ok) continue;
    const f = m.raw ? 0.6 : 1;   // concept/inverse match is stronger than a raw-label substring match
    const [s, o] = m.inverse ? [e.toNode, e.fromNode] : [e.fromNode, e.toNode];
    best = Math.max(best, Math.min(wildWeight(s, S, ancestors), wildWeight(o, O, ancestors)) * f);
    if (m.symmetric) best = Math.max(best, Math.min(wildWeight(o, S, ancestors), wildWeight(s, O, ancestors)) * f);
  }
  return best;
}
function clauseScore(c, rec, resolved, ancestors) {
  if (c.kind === "group") { const rs = c.clauses.map((x) => clauseScore(x, rec, resolved, ancestors)); return c.match === "any" ? Math.max(0, ...rs) : (rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0); }
  return c.kind === "relation" ? relationScore(c, rec, resolved, ancestors) : objectScore(c, rec, resolved, ancestors);
}
// Graded [0,1] relevance of a photo to the query IR: "all" -> MEAN of clause
// scores (2-of-3 outranks 1-of-3), "any" -> MAX.
export function scoreIR(rec, ir, resolved, ancestors) {
  if (!ir.clauses.length) return 0;
  const rs = ir.clauses.map((c) => clauseScore(c, rec, resolved, ancestors));
  return ir.match === "any" ? Math.max(0, ...rs) : rs.reduce((a, b) => a + b, 0) / rs.length;
}
// A negated clause is VIOLATED only when the forbidden thing is actually
// WITNESSED — evaluate it UN-negated (positive presence), so an empty/edge-less
// graph is never a violator (it just lacks evidence).
function negationViolated(ir, rec, resolved, ancestors) {
  const bad = (clauses) => clauses.some((c) => {
    if (c.kind === "group") return bad(c.clauses);
    if (!c.negate) return false;
    return c.kind === "relation" ? evalRelation({ ...c, negate: false }, rec, resolved, ancestors) : evalObject({ ...c, negate: false }, rec, resolved, ancestors);
  });
  return bad(ir.clauses);
}

// ---- rank fusion (weighted Reciprocal Rank Fusion) -------------------------
function rankMap(scoreMap) {
  const r = new Map();
  [...scoreMap.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).forEach(([uri], i) => r.set(uri, i + 1));
  return r;
}
// fused(uri) = sum over available lists of  w / (k + rank). Missing lists skipped;
// absence from a list contributes 0. Order only, not magnitude.
function rrf(lists, { k = 60, weights = [] } = {}) {
  const fused = new Map();
  lists.forEach((L, i) => { if (!L) return; const w = weights[i] ?? 1; for (const [uri, rank] of L) fused.set(uri, (fused.get(uri) || 0) + w / (k + rank)); });
  return fused;
}

const PRESETS = { strict: { tau: 0.6 }, balanced: { tau: 0.4 }, broad: { tau: 0.2 } };

// ---- ranked entry point ----------------------------------------------------
// Fuses the Wikidata-semantic signal, BM25 (title/desc/alt), and an optional LLM
// reranker into one ranking, then bands. Returns
//   [{ uri, score, band: "match"|"near", signals: { wd, bm25, llm } }]
// "match" = boolean matches + surviving BM25 tail; "near" = partial semantic.
// Any signal may be absent; RRF degrades gracefully.
export async function rankScenes(index, query, deps = {}) {
  const { resolveTerm, ancestorsOf, llmParse, llmRerank, textIndex, tokenizer, captionIdf, preset = "balanced", tuning, onStage } = deps;
  const cfg = { k: 60, wWd: 1.0, wBm25: 0.7, wLlm: 1.5, thetaNear: 0.15, kMax: 50, ...(PRESETS[preset] || PRESETS.balanced), ...(tuning || {}) };

  let ir = null;
  if (llmParse) {
    onStage?.("parse");
    try { ir = validateIR(await llmParse(query)); } catch { ir = null; }
  }
  if (!ir) ir = parseQueryToIR(query, { relationForms: index.relationForms, objectForms: index.objectForms });
  if (!ir.clauses.length) return [];

  onStage?.("match");
  const labels = new Set(), textLabels = new Set();
  const collect = (cs) => { for (const c of cs) { if (c.kind === "group") collect(c.clauses); else if (c.kind === "relation") { for (const L of [c.subject, c.object]) if (L) { labels.add(L); if (!c.negate) textLabels.add(L); } } else if (c.concept) { labels.add(c.concept); if (!c.negate) textLabels.add(c.concept); } } };
  collect(ir.clauses);

  const resolved = new Map();
  await Promise.all([...labels].map(async (t) => {
    let hit = null; try { hit = resolveTerm ? await resolveTerm(t) : null; } catch { hit = null; }
    const qids = hit?.qids ? hit.qids.slice() : (hit?.qid ? [hit.qid] : []);   // multi-sense, or single, or none
    if (!qids.length && isQid(t)) qids.push(t);                                // the query term is itself a QID
    resolved.set(t, { qids, text: t, label: hit?.label });
  }));
  let ancestors = new Map();
  try { if (ancestorsOf && index.allNodeQids.length) ancestors = await ancestorsOf(index.allNodeQids); } catch { ancestors = new Map(); }

  // scene-graph signals per photo
  const wd = new Map(), boolMatch = new Set(), nodeCount = new Map(), excluded = new Set();
  for (const rec of index.photos.values()) {
    const uri = rec.photo;
    nodeCount.set(uri, rec.nodes.length);
    if (negationViolated(ir, rec, resolved, ancestors)) { excluded.add(uri); continue; }   // hard drop
    const g = scoreIR(rec, ir, resolved, ancestors);
    if (g > 0) wd.set(uri, g);
    if (evaluateIR(rec, ir, resolved, ancestors)) boolMatch.add(uri);
  }

  // BM25 signal (negation gate applies to text hits too)
  // Tokenize each concept label INDEPENDENTLY, then union — joining separate
  // labels first would let two distinct adjacent concepts (e.g. "ice", "cream")
  // fuse into a learned phrase ("ice_cream") the query never intended. A single
  // multi-word label still phrase-merges within itself.
  const bm25 = textIndex ? bm25Search(textIndex, [...textLabels].flatMap((L) => (tokenizer || tokenize)(L)), { idf: captionIdf }) : new Map();
  for (const uri of excluded) bm25.delete(uri);

  // Band the fused ranking. Called first with NO LLM signal (instant) for the
  // progressive render, then again once the LLM reranker returns.
  const buildResults = (llm) => {
    const fused = rrf([rankMap(wd), rankMap(bm25), llm.size ? rankMap(llm) : undefined], { k: cfg.k, weights: [cfg.wWd, cfg.wBm25, cfg.wLlm] });
    const match = [], near = [], tail = [];
    for (const uri of new Set([...fused.keys(), ...boolMatch])) {
      if (excluded.has(uri)) continue;
      const sig = { wd: wd.get(uri) || 0, bm25: bm25.get(uri) || 0, llm: llm.get(uri) || 0 };
      const row = { uri, score: fused.get(uri) || 0, signals: sig, _n: nodeCount.get(uri) || 0 };
      if (boolMatch.has(uri)) match.push({ ...row, band: "match" });
      else if (sig.wd > cfg.thetaNear) near.push({ ...row, band: "near" });
      else if (sig.bm25 > 0) tail.push({ ...row, band: "match" });
    }
    tail.sort((a, b) => b.signals.bm25 - a.signals.bm25);
    const tailMax = tail[0]?.signals.bm25 || 0;
    for (let i = 0; i < tail.length; i++) if (i === 0 || tail[i].signals.bm25 >= cfg.tau * tailMax) match.push(tail[i]);   // keep top-1, then fraction-of-max
    const byScore = (a, b) => (b.score - a.score) || (b._n - a._n);
    match.sort(byScore); near.sort(byScore);
    const clean = (r) => ({ uri: r.uri, score: r.score, band: r.band, signals: r.signals });
    return [...match.slice(0, cfg.kMax).map(clean), ...near.map(clean)];
  };

  // Fast path (Wikidata + BM25) is instant — return it now unless an LLM
  // reranker can refine it. When it can, hand the fast result to onPartial so
  // the UI paints immediately, then block ONLY the refinement on the slow call.
  const fast = buildResults(new Map());
  if (!llmRerank) return fast;
  onStage?.("rerank");
  if (deps.onPartial) { try { deps.onPartial(fast); } catch { /* a render error must not abort search */ } }

  let llm = new Map();
  const prelim = rrf([rankMap(wd), rankMap(bm25)], { k: cfg.k, weights: [cfg.wWd, cfg.wBm25] });
  const cands = [...prelim.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([uri]) => uri);
  try { const r = await llmRerank(query, cands); llm = r instanceof Map ? r : new Map(Object.entries(r || {})); } catch { llm = new Map(); }
  for (const uri of excluded) llm.delete(uri);
  return buildResults(llm);
}

// Legacy shim: string[] of "match"-band photo URIs, preserving the old contract.
export async function searchScenes(index, query, deps = {}) {
  return (await rankScenes(index, query, deps)).filter((r) => r.band === "match").map((r) => r.uri);
}

// Legacy shim: the old {terms, triple} shape, kept for its unit tests and any
// caller expecting it. Backed by the new engine (no objectForms, so it never
// splits multi-word terms), so relation logic has a single source of truth.
export function parseQuery(text, relationForms = new Set()) {
  const ir = parseQueryToIR(text, { relationForms });
  const only = ir.clauses.length === 1 ? ir.clauses[0] : null;
  if (only && only.kind === "relation" && only.subject && only.object && !only.negate) {
    return { terms: [], triple: { subj: only.subject, rel: only.relation, obj: only.object } };
  }
  const terms = ir.clauses.filter((c) => c.kind === "object").map((c) => c.concept);
  return { terms: terms.length ? terms : [norm(text)], triple: null };
}
