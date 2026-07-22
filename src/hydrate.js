// hydrate.js: turn Constellation setup references (bare AT-URIs) into rendered
// setup cards. Constellation returns only link structure, never record contents,
// so for each reference we read the setup record straight from its author's PDS —
// the same world-readable read the /<handle> profile page already performs — and
// batch-resolve author profiles (handle / display name / avatar) for the card.
// No auth, no backend.

import { resolvePds } from "./profile.js";

const PUBLIC = "https://public.api.bsky.app/xrpc";

async function json(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// A dead / slow PDS must not strand a whole page of cards; give each read a budget.
const READ_TIMEOUT_MS = 10_000;
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// resolve did -> PDS endpoint, cached (many refs share a repo).
const pdsCache = new Map();
function pdsFor(did) {
  if (!pdsCache.has(did)) {
    pdsCache.set(did, resolvePds(did).catch((e) => { pdsCache.delete(did); throw e; }));
  }
  return pdsCache.get(did);
}

// Read one setup record from its author's PDS. Returns null on any failure —
// notably a 404, which is normal: there is a small window where Constellation
// still lists a record the author just deleted, and a null there simply drops the
// card silently.
export async function hydrateSetup(ref) {
  try {
    const pds = await pdsFor(ref.did);
    const u = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
    u.searchParams.set("repo", ref.did);
    u.searchParams.set("collection", ref.collection);
    u.searchParams.set("rkey", ref.rkey);
    const j = await withTimeout(json(u), READ_TIMEOUT_MS);
    if (!j?.value) return null;
    return { uri: ref.uri, did: ref.did, rkey: ref.rkey, value: j.value };
  } catch {
    return null;
  }
}

// batch resolve did -> { did, handle, displayName, avatar }, 25 at a time, cached.
// Unknown DIDs fall back to a handle of the DID itself so a card always renders.
const profileCache = new Map();
export async function resolveProfiles(dids) {
  const need = [...new Set(dids)].filter((d) => d && !profileCache.has(d));
  for (let i = 0; i < need.length; i += 25) {
    try {
      const batch = need.slice(i, i + 25);
      const query = batch.map((d) => `actors=${encodeURIComponent(d)}`).join("&");
      const j = await json(`${PUBLIC}/app.bsky.actor.getProfiles?${query}`);
      for (const p of j.profiles || []) {
        profileCache.set(p.did, { did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar });
      }
    } catch { /* skip batch; unresolved DIDs fall back below */ }
  }
  const out = new Map();
  for (const d of dids) out.set(d, profileCache.get(d) || { did: d, handle: d });
  return out;
}

// Hydrate a page of refs with bounded concurrency, attaching each author's
// profile. Records that fail to read (deleted, blocked, dead PDS) are dropped, so
// the returned list is exactly the setups that are live and viewable right now.
export async function hydratePage(refs, { concurrency = 8 } = {}) {
  const records = [];
  for (let i = 0; i < refs.length; i += concurrency) {
    const batch = await Promise.all(refs.slice(i, i + concurrency).map((r) => hydrateSetup(r)));
    for (const rec of batch) if (rec) records.push(rec);
  }
  const profiles = await resolveProfiles(records.map((r) => r.did));
  return records.map((r) => ({ ...r, author: profiles.get(r.did) }));
}
