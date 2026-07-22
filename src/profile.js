// profile.js: read another user's public graycard setup with no backend and
// no auth. Records on atproto are world-readable: resolve handle → DID → PDS,
// then list their app.graycard.* records straight from their PDS.

import { NS, compareShootsByDate } from "./graycard.js";
import { blobCid } from "./grain.js";

const PUBLIC = "https://public.api.bsky.app/xrpc";

async function json(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function resolveHandleToDid(handle) {
  handle = handle.replace(/^@/, "").trim();
  // getProfile returns the DID for anyone the appview knows. Fall back to resolveHandle
  try {
    const p = await json(`${PUBLIC}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
    return { did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar };
  } catch {
    const r = await json(`${PUBLIC}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    return { did: r.did, handle };
  }
}

export async function resolvePds(did) {
  let doc;
  if (did.startsWith("did:plc:")) doc = await json(`https://plc.directory/${did}`);
  else if (did.startsWith("did:web:")) doc = await json(`https://${did.slice(8).replace(/:/g, "/")}/.well-known/did.json`);
  else throw new Error("Unsupported DID method");
  const svc = (doc.service || []).find((s) => (s.id || "").endsWith("atproto_pds") || s.type === "AtprotoPersonalDataServer");
  if (!svc) throw new Error("No PDS endpoint in DID document");
  return svc.serviceEndpoint.replace(/\/$/, "");
}

export async function resolveRepo(handle) {
  const id = await resolveHandleToDid(handle);
  const pds = await resolvePds(id.did);
  return { ...id, pds };
}

export async function listPublic(pds, did, collection) {
  const out = [];
  let cursor;
  do {
    const u = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    u.searchParams.set("repo", did);
    u.searchParams.set("collection", collection);
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    let j;
    try { j = await json(u); } catch { break; }
    for (const r of j.records || []) out.push({ uri: r.uri, cid: r.cid, value: r.value });
    cursor = j.cursor;
  } while (cursor);
  return out;
}

// public blob URL (works directly as <img src>, no auth / CORS needed)
export function publicBlobUrl(pds, did, blob) {
  const cid = blobCid(blob);
  return cid ? `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}` : null;
}

// load the shareable "setup": catalog types, instances, workflow templates, shoots.
export async function loadSetup(handle) {
  const repo = await resolveRepo(handle);
  const catalogKinds = Object.keys(NS.catalog);
  const instanceKinds = Object.keys(NS.instance);
  const catalog = {}, instance = {}, byUri = new Map();

  const grab = async (nsid) => listPublic(repo.pds, repo.did, nsid);
  await Promise.all([
    ...catalogKinds.map(async (k) => { catalog[k] = await grab(NS.catalog[k]); for (const it of catalog[k]) byUri.set(it.uri, { layer: "catalog", kind: k, item: it }); }),
    ...instanceKinds.map(async (k) => { instance[k] = await grab(NS.instance[k]); for (const it of instance[k]) byUri.set(it.uri, { layer: "instance", kind: k, item: it }); }),
  ]);
  const [templates, shoots, galleries, photos, galleryItems, captures, photoWorkflows, scenes, sceneNodes, sceneEdges, exif, galleryDefaults] = await Promise.all([
    grab(NS.workflow.template),
    grab(NS.session.capture),
    listPublic(repo.pds, repo.did, "social.grain.gallery"),
    listPublic(repo.pds, repo.did, "social.grain.photo"),
    listPublic(repo.pds, repo.did, "social.grain.gallery.item"),
    grab(NS.photo.capture),
    grab(NS.photo.workflow),
    grab(NS.scene.graph),
    grab(NS.scene.node),   // scene nodes/edges carry the grounded types + relations
    grab(NS.scene.edge),   // that semantic search matches against
    listPublic(repo.pds, repo.did, "social.grain.photo.exif"),
    grab(NS.gallery.defaults),
  ]);
  shoots.sort(compareShootsByDate);   // newest-first, matching the rest of the app
  const store = { catalog, instance, byUri };
  const counts = {
    types: catalogKinds.reduce((n, k) => n + (catalog[k]?.length || 0), 0),
    instances: instanceKinds.reduce((n, k) => n + (instance[k]?.length || 0), 0),
    templates: templates.length,
    galleries: galleries.length,
    photos: photos.length,
  };
  return { repo, store, templates, shoots, galleries, photos, galleryItems, captures, photoWorkflows, scenes, sceneNodes, sceneEdges, exif, galleryDefaults, counts };
}

// does a repo contain any app.graycard.* records? describeRepo lists every
// collection in the repo in a single request, so this is one cheap check per
// candidate. Cached (memory + localStorage) so repeats are instant.
const GC_KEY = "hypo:gcusers";
const gcMem = new Map();
let gcDisk = {};
try { gcDisk = JSON.parse(localStorage.getItem(GC_KEY) || "{}"); } catch { /* ignore */ }

export async function getFollows(did) {
  const out = [];
  let cursor;
  try {
    do {
      const u = `${PUBLIC}/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const j = await json(u);
      for (const f of j.follows || []) out.push({ did: f.did, handle: f.handle, displayName: f.displayName });
      cursor = j.cursor;
    } while (cursor);   // all follows (no cap)
  } catch { /* private / offline */ }
  return out;
}

// Resolve DIDs to profiles (handle + display name), batched 25 at a time.
async function resolveProfiles(dids) {
  const out = [];
  const uniq = [...new Set(dids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 25) {
    try {
      const qs = uniq.slice(i, i + 25).map((d) => `actors=${encodeURIComponent(d)}`).join("&");
      const j = await json(`${PUBLIC}/app.bsky.actor.getProfiles?${qs}`);
      for (const p of j.profiles || []) out.push({ did: p.did, handle: p.handle, displayName: p.displayName });
    } catch { /* skip batch */ }
  }
  return out;
}

// grain.social keeps its OWN follow graph (social.grain.graph.follow), separate
// from app.bsky.graph.follow. Read every record from the viewer's repo and
// resolve each subject DID to a profile.
export async function getGrainFollows(did) {
  const subjects = [];
  try {
    const pds = await resolvePds(did);
    let cursor;
    do {
      const u = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=social.grain.graph.follow&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const j = await json(u);
      for (const r of j.records || []) if (r.value?.subject) subjects.push(r.value.subject);
      cursor = j.cursor;
    } while (cursor);
  } catch { /* no grain follows / offline */ }
  return resolveProfiles(subjects);
}

// Per-lookup budget: a dead/slow PDS must not strand Discover at N-1 forever.
const GC_TIMEOUT_MS = 10_000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function hasGraycard(did) {
  if (!did) return Promise.resolve(false);
  if (gcMem.has(did)) return gcMem.get(did);
  const cached = gcDisk[did];
  // A positive ("has graycard") lasts 7 days; ANY negative — confirmed OR a soft
  // failure — lasts only 1 day, so someone who ADDS graycard records shows up to
  // their followers within a day instead of being cached out for a week.
  if (cached && Date.now() - cached.t < (cached.v ? 7 * 864e5 : 864e5)) {
    const p = Promise.resolve(cached.v);
    gcMem.set(did, p);
    return p;
  }
  const save = (rec) => { gcDisk[did] = rec; try { localStorage.setItem(GC_KEY, JSON.stringify(gcDisk)); } catch { /* quota */ } };
  const p = (async () => {
    try {
      const v = await withTimeout((async () => {
        const pds = await resolvePds(did);
        const j = await json(`${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`);
        return (j.collections || []).some((c) => c.startsWith("app.graycard."));
      })(), GC_TIMEOUT_MS);
      save({ v, t: Date.now() });
      return v;
    } catch {
      save({ v: false, t: Date.now(), soft: true });   // don't re-query a broken repo every reload
      return false;
    }
  })();
  gcMem.set(did, p);
  return p;
}

// Wipe the graycard-lookup cache (memory + disk) so the next check re-queries
// live. Backs the Discover "Refresh" button — the escape hatch when a follow has
// added graycard records but is still cached as having none.
export function clearGraycardCache() {
  gcMem.clear();
  gcDisk = {};
  try { localStorage.removeItem(GC_KEY); } catch { /* ignore */ }
}
