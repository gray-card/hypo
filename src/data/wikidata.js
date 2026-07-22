// wikidata.js: resolve a Wikimedia Commons image for a catalog type.
//
// Source order: a Wikidata QID stored on the record (links.externalIds,
// scheme "wikidata") → else a best-effort name search. From the QID we read
// property P18 (image) and build a Commons thumbnail URL. Results (including
// "no image") are cached in memory + localStorage so we don't re-query.
//
// All client-side, no key: <img> needs no CORS. The API calls use origin=*.

const API = "https://www.wikidata.org/w/api.php";
const LS_KEY = "hypo:wdimg";
const TTL = 30 * 864e5; // 30 days

const mem = new Map(); // cacheKey -> Promise<string|null>
let disk = {};
try { disk = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { /* ignore */ }

function persist(key, val) {
  try {
    disk[key] = { v: val, t: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(disk));
  } catch { /* quota / private mode */ }
}

const commonsThumb = (file, width = 240) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;

export async function searchEntities(query, limit = 7) {
  if (!query || query.trim().length < 2) return [];
  try {
    const j = await api({ action: "wbsearchentities", search: query.trim(), language: "en", type: "item", limit: String(limit) });
    return (j.search || []).map((r) => ({ id: r.id, label: r.label || r.id, description: r.description || "" }));
  } catch { return []; }
}

// Wikidata orders wbsearchentities by its own relevance, which favours named
// individuals: "post" yields a surname, a town in Texas, a Björk album and a 1929
// film before the thing you can actually photograph. A scene term — typed by hand
// or proposed by an object detector — is almost always an ordinary noun, so push
// named individuals down.
//
// This RE-ORDERS and never filters, so a demoted sense stays reachable, just not
// in the way. Patterns test the description Wikidata returns, not the label.
//
// Mirrors the structural rule: bury only what has no physical manifestation at
// all, and merely nudge every other particular thing. An album is a piece of
// vinyl, a novel is a paperback, a company is a storefront — all photographable,
// so a bare noun should prefer the general kind without putting the specific one
// out of reach.
const SENSE_DEMOTIONS = [
  [/\bwikimedia (disambiguation|category|list|template|project)\b/i, 6],
  [/\b(family|last|given|male given|female given) name\b/i, 5],
  // particular things: a nudge, not a burial
  [/\b(album|studio album|single|song|film|movie|television series|tv series|episode|novel|manga|anime|video game|opera|musical|poem)\b/i, 1],
  [/\b(political party|newspaper|magazine|website|record label|company|corporation|business|organi[sz]ation)\b/i, 1],
  [/\b(city|town|village|commune|municipality|hamlet|county|district|province|parish|borough|neighbou?rhood|suburb)\b\s+(in|of)\b/i, 1],
  [/\b(footballer|politician|actor|actress|singer|musician|composer|writer|author|painter|poet|philosopher|physicist|scientist|economist|historian|journalist|artist)\b/i, 1],
  [/\b(19|20)\d{2}\b/, 1],
];

// Almost anything has SOME photographable manifestation: an album is a piece of
// vinyl, a novel is a paperback, a film is a still on a screen, a company is a
// storefront. So rather than enumerate what may be photographed — a list that is
// wrong as often as it is right — enumerate only what genuinely cannot be. A
// naming convention and a wiki housekeeping page are not objects in the world at
// all; everything else is merely a particular thing rather than a kind, which is
// a much weaker reason to rank it down.
const UNPHOTOGRAPHABLE_TYPES = new Set([
  "Q101352", "Q12308941", "Q11879590", "Q3409032",  // family name, given names
  "Q4167410", "Q4167836", "Q13406463", "Q11266439", // disambiguation, category, list, template
]);

// Reorder search hits so the ordinary-noun sense of a term rises. Ties keep
// Wikidata's own ordering, so this only ever moves named individuals down.
//
// `kinds` is the structured signal from conceptKinds(): whether each entity is a
// CLASS (has P279 subclass-of) and what it is an INSTANCE of (P31). That is the
// real answer to "is this a kind of thing or a particular one", so when it is
// available it dominates. The description patterns above remain the instant and
// offline fallback, and still break ties.
export function rankConceptSenses(hits, query = "", kinds = null) {
  const q = String(query || "").trim().toLowerCase();
  return hits
    .map((h, i) => {
      const d = h.description || "";
      let score = 0;

      const k = kinds?.get(h.id);
      if (k) {
        // subclass-of is the signature of a universal: "post" the structural
        // element is a subclass of structural element; a surname is not.
        if (k.isClass) score += 5;
        else if ([...k.types].some((t) => UNPHOTOGRAPHABLE_TYPES.has(t))) score -= 6;
        else if (k.types.size) score -= 1;   // a particular thing: still photographable,
                                             // but a bare noun usually means the kind
      }

      for (const [re, penalty] of SENSE_DEMOTIONS) if (re.test(d)) score -= penalty;
      const label = (h.label || "").toLowerCase();
      // An exact label match is the strongest statement of intent there is, so it
      // outweighs even the class bonus: typing "bridge" should land on the kind,
      // but typing "Brooklyn Bridge" clearly means that one particular bridge.
      if (q && label === q) score += 8;
      else if (q && label.startsWith(q)) score += 1;
      if (!d) score -= 1;                          // an undescribed sense is rarely the one meant
      return { h, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.h);
}

// searchEntities + scene-appropriate ranking from the descriptions alone. Cheap
// and synchronous-feeling: no second round trip, so a typeahead can paint with
// it immediately. Use searchEntities directly when Wikidata's own order is the
// right one — notably catalog product lookups, where a company or brand IS the
// answer and would be demoted here.
export async function searchConcepts(query, limit = 25) {
  return rankConceptSenses(await searchEntities(query, limit), query);
}

// Ask Wikidata what each entity actually IS, rather than inferring it from
// English prose: P279 (subclass of) marks a kind, P31 (instance of) names the
// classes a particular thing belongs to. One batched query, cached in memory +
// localStorage like ancestorsOf, and degrading to "unknown" so ranking silently
// falls back to the description heuristic when WDQS is unreachable.
const kindMem = new Map();   // qid -> { isClass, types:Set<qid> }

async function sparqlKinds(qids) {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  // one row per (item, relation, value); no cross product between P31 and P279
  const query = `SELECT ?item ?rel ?val WHERE { VALUES ?item { ${values} } { ?item wdt:P31 ?val . BIND("t" AS ?rel) } UNION { ?item wdt:P279 ?val . BIND("s" AS ?rel) } }`;
  const r = await fetch(`${WDQS}?query=${encodeURIComponent(query)}&format=json`, {
    headers: { Accept: "application/sparql-results+json" },
  });
  if (!r.ok) throw new Error(`wdqs ${r.status}`);
  const j = await r.json();
  return (j.results?.bindings || []).map((b) => ({
    item: qidOf(b.item?.value), rel: b.rel?.value, val: qidOf(b.val?.value),
  }));
}

export async function conceptKinds(qids) {
  const want = [...new Set(qids)].filter((q) => /^Q\d+$/.test(q));
  const out = new Map();
  const missing = [];
  for (const q of want) {
    if (kindMem.has(q)) { out.set(q, kindMem.get(q)); continue; }
    const d = disk[`kind1:${q}`];
    if (d && Date.now() - d.t < TTL) {
      const v = { isClass: d.v.c, types: new Set(d.v.t) };
      kindMem.set(q, v); out.set(q, v); continue;
    }
    missing.push(q);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const byItem = new Map(chunk.map((q) => [q, { isClass: false, types: new Set() }]));
    let ok = true;
    try {
      for (const { item, rel, val } of await sparqlKinds(chunk)) {
        const e = byItem.get(item);
        if (!e || !val) continue;
        if (rel === "s") e.isClass = true; else e.types.add(val);
      }
    } catch { ok = false; }   // WDQS unreachable / rate-limited
    for (const [q, v] of byItem) {
      out.set(q, v);
      // only cache a verified answer: caching a failure would pin every qid to
      // "unknown" for the whole TTL and quietly disable structural ranking
      if (ok) { kindMem.set(q, v); persist(`kind1:${q}`, { c: v.isClass, t: [...v.types] }); }
    }
  }
  return out;
}

// Rank using what Wikidata says these entities ARE. Costs one batched WDQS round
// trip (cached), so callers that can afford it await this; a typeahead paints
// searchConcepts() first and refines with this when it lands.
export async function refineConceptRanking(hits, query = "") {
  if (!hits.length) return hits;
  try {
    return rankConceptSenses(hits, query, await conceptKinds(hits.map((h) => h.id)));
  } catch {
    return hits;   // keep whatever order we already had
  }
}

export function qidFromRecord(value) {
  const wd = (value?.links?.externalIds || []).find((x) => x.scheme === "wikidata");
  return wd?.value || null;
}

// resolve a free-text query term to its best Wikidata entity. Fetches a deep list
// and ranks it rather than trusting hit #1, which for an ambiguous word is
// usually a surname or an album rather than the thing meant.
export async function resolveConcept(text) {
  const [hit] = await refineConceptRanking(await searchConcepts(text, 15), text);
  return hit && /^Q\d+$/.test(hit.id) ? { qid: hit.id, label: hit.label } : null;
}

// Resolve a query term to its top-K candidate senses, so an ambiguous word
// (trunk, bat, tree, mole) matches ANY of its Wikidata senses at search time
// rather than gambling on the single top hit. A node matches if any candidate
// is in its class/part-of set. Returns { qids: [...], label } (label = top hit).
export async function resolveConcepts(text, k = 3) {
  // rank a deep list, THEN take the top k: taking k first would hand back
  // whichever named individuals Wikidata happened to rank highest.
  const deep = await refineConceptRanking(await searchConcepts(text, Math.max(15, k * 5)), text);
  const hits = deep.slice(0, k);
  const qids = hits.map((h) => h.id).filter((id) => /^Q\d+$/.test(id));
  return { qids, label: hits[0]?.label || text };
}

// ---------------------------------------------------------------------------
// Concept-broadening for semantic scene search: given a set of grounded node
// QIDs, return each one's transitive "covers" set, INCLUSIVE of itself, via three
// relations: superclass (P279), the classes of an instance (P31), AND the wholes
// it is PART OF (P361). A query concept matches a node when the query's QID is in
// that node's set, so "animal" matches "dog" (subclass) and "tree" matches
// "trunk" (part-of). Part-of adds recall for photos where the annotator tagged a
// part rather than the whole. Backed by the Wikidata Query Service; cached in
// memory + localStorage; degrades to self-only on failure so search keeps working
// (exact-QID + label matching) offline.
const WDQS = "https://query.wikidata.org/sparql";
const ancMem = new Map();   // qid -> Set<qid>
const qidOf = (uri) => { const m = /Q\d+$/.exec(uri || ""); return m ? m[0] : null; };

async function sparqlAncestors(qids) {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  // self + superclasses; an instance's classes + their superclasses; and the
  // wholes it is part of, then those wholes' superclasses / further wholes.
  const query = `SELECT ?item ?anc WHERE { VALUES ?item { ${values} } ?item wdt:P279*|wdt:P31/wdt:P279*|wdt:P361/(wdt:P279|wdt:P361)* ?anc . }`;
  const url = `${WDQS}?query=${encodeURIComponent(query)}&format=json`;
  const r = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!r.ok) throw new Error(`wdqs ${r.status}`);
  const j = await r.json();
  return (j.results?.bindings || []).map((b) => ({ item: qidOf(b.item?.value), anc: qidOf(b.anc?.value) }));
}

export async function ancestorsOf(qids) {
  const want = [...new Set(qids)].filter((q) => /^Q\d+$/.test(q));
  const out = new Map();
  const missing = [];
  for (const q of want) {
    if (ancMem.has(q)) { out.set(q, ancMem.get(q)); continue; }
    const d = disk[`anc2:${q}`];
    if (d && Date.now() - d.t < TTL) { const s = new Set(d.v); ancMem.set(q, s); out.set(q, s); continue; }
    missing.push(q);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const byItem = new Map(chunk.map((q) => [q, new Set([q])]));   // always include self
    let ok = true;
    try {
      for (const { item, anc } of await sparqlAncestors(chunk)) if (item && anc && byItem.has(item)) byItem.get(item).add(anc);
    } catch { ok = false; }   // WDQS unreachable/limited
    for (const [q, s] of byItem) {
      out.set(q, s);   // the current search still gets a (self-only) set so it degrades gracefully
      // but only CACHE a verified result — otherwise one transient failure would
      // pin every qid to self-only for the whole TTL and silently kill expansion.
      if (ok) { ancMem.set(q, s); persist(`anc2:${q}`, [...s]); }
    }
  }
  return out;
}

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`wikidata ${r.status}`);
  return r.json();
}

async function imageForQid(qid) {
  const j = await api({ action: "wbgetclaims", entity: qid, property: "P18" });
  const file = j.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file ? commonsThumb(file) : null;
}

async function qidForLabel(label) {
  const j = await api({ action: "wbsearchentities", search: label, language: "en", type: "item", limit: "1" });
  return j.search?.[0]?.id || null;
}

// resolve a catalog type's image URL. returns Promise<string|null>.
export function typeImage(value, label) {
  const key = qidFromRecord(value) || (label ? `q:${label}` : null);
  if (!key) return Promise.resolve(null);
  if (mem.has(key)) return mem.get(key);
  if (disk[key] && Date.now() - disk[key].t < TTL) {
    const p = Promise.resolve(disk[key].v);
    mem.set(key, p);
    return p;
  }
  const p = (async () => {
    try {
      let qid = qidFromRecord(value);
      if (!qid && label) qid = await qidForLabel(label);
      const img = qid ? await imageForQid(qid) : null;
      persist(key, img);
      return img;
    } catch {
      return null;
    }
  })();
  mem.set(key, p);
  return p;
}
