// constellation.js: the ONLY place that talks to the Constellation backlink index.
//
// Constellation's API is explicitly unstable, so every request URL and response
// shape is isolated here; the rest of the app sees plain numbers and
// { items, cursor } pages. Confirmed against constellation.microcosm.blue (2026-07):
//
//   GET /links/count?target=&collection=&path=          -> { total }
//   GET /links/distinct-dids?target=&collection=&path=  -> { total, linking_dids, cursor }
//   GET /links?target=&collection=&path=&limit=&cursor= -> { total, linking_records: [{did,collection,rkey}], cursor }
//
// `cursor` is an opaque string, null when the last page has been returned.

import { SETUP_NSID, HYPO_REGISTRY, ANCHOR_PATH, constellationBase } from "./registry.js";

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, String(v));
  return u.toString();
}

async function getJson(path, params, { signal } = {}) {
  const res = await fetch(`${constellationBase()}${path}?${qs(params)}`, { signal });
  if (!res.ok) throw new Error(`constellation ${res.status}`);
  return res.json();
}

// tolerate { total } (current shape) or a bare number (older docs describe a
// plain-text u64) so a future response tweak degrades to 0 rather than NaN.
function readTotal(json) {
  if (typeof json === "number") return json;
  const n = Number(json?.total);
  return Number.isFinite(n) ? n : 0;
}

// every query is "backlinks to the anchor, from the setup collection, at .registry".
const anchorParams = (extra = {}) => ({ target: HYPO_REGISTRY, collection: SETUP_NSID, path: ANCHOR_PATH, ...extra });

// total number of published setup records.
export async function countSetups(opts) {
  return readTotal(await getJson("/links/count", anchorParams(), opts));
}

// number of distinct authors who have published a setup.
export async function countSetupAuthors(opts) {
  return readTotal(await getJson("/links/distinct-dids", anchorParams({ limit: 1 }), opts));
}

// One page of published-setup references, newest-first per Constellation ordering.
// Returns { items: [{ uri, did, collection, rkey }], cursor }. Rows missing a did
// or rkey are dropped rather than yielding a malformed at-uri.
export async function listSetupPage(cursor, limit = 50, opts) {
  const json = await getJson("/links", anchorParams({ limit, cursor }), opts);
  const rows = json.linking_records || json.links || [];
  const items = rows
    .map((r) => {
      const did = r.did;
      const collection = r.collection || SETUP_NSID;
      const rkey = r.rkey;
      return { did, collection, rkey, uri: `at://${did}/${collection}/${rkey}` };
    })
    .filter((r) => r.did && r.rkey);
  return { items, cursor: json.cursor || null };
}
