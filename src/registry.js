// registry.js: the discovery anchor + Constellation config for "Discover setups".
//
// Hypo stays a pure "no backend, everything is a record in a repo" app. Discovery
// works by giving every published setup a shared anchor link, then asking a shared
// backlink index (Constellation) "who links to this anchor?" Constellation indexes
// the whole network's links in real time from the firehose, so a setup becomes
// discoverable the instant its PDS write commits — no indexer round-trip, no index
// PDS, no signaling. This file holds the two constants that pin the query and the
// (overridable) index location.

export const SETUP_NSID = "app.graycard.setup";

// The frozen discovery anchor. Every published setup's `registry` field is this
// exact URL. A plain web URL keeps Hypo fully backendless — Constellation indexes
// web URLs, so there is no account or seed record to create anywhere. The trailing
// version segment lets us cut a new cohort later by bumping it; changing it orphans
// older setups from discovery, so it must only change deliberately.
export const HYPO_REGISTRY = "https://hypo.graycard.app/ns/registry/1";

// The JSON path Constellation indexes the anchor at — the top-level `registry`
// string field, so the path stays a single trivial segment.
export const ANCHOR_PATH = ".registry";

// The public Constellation instance. Constellation's API is self-hostable (and
// Asterism is a drop-in, API-compatible alternative), so the base URL is a single
// overridable setting — switching to your own instance is one line in Settings.
export const DEFAULT_CONSTELLATION = "https://constellation.microcosm.blue";

const CONSTELLATION_KEY = "hypo:constellation";

// current Constellation base URL (no trailing slash). Falls back to the public
// instance when unset or when storage is unavailable (private mode).
export function constellationBase() {
  try {
    const v = (localStorage.getItem(CONSTELLATION_KEY) || "").trim();
    return v ? v.replace(/\/+$/, "") : DEFAULT_CONSTELLATION;
  } catch {
    return DEFAULT_CONSTELLATION;
  }
}

// set (or clear, with a falsy value) the Constellation base URL override.
export function setConstellationBase(url) {
  try {
    const v = (url || "").trim().replace(/\/+$/, "");
    if (v) localStorage.setItem(CONSTELLATION_KEY, v);
    else localStorage.removeItem(CONSTELLATION_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}
