// import.js: the "dump -> diff -> write" pipeline. A Gray Card bundle is a
// JSON file: { records: [ { collection, rkey?, value } ] }. We diff each
// record against the user's repo, then write (create/putRecord) on confirm,
// using swapRecord for optimistic concurrency on updates.

import { parseAtUri, listRecords, blobCid } from "./grain.js";
import { NS } from "./graycard.js";
import { resolvePds } from "./profile.js";

const stripType = (v) => { const { $type, ...rest } = v || {}; return rest; };
// stable, key-sorted serialisation so two records with identical content but a
// different key order compare equal. this is what makes export -> import a true
// no-op (unchanged) rather than a pile of spurious "update" rows.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
  }
  return JSON.stringify(v);
}
const eq = (a, b) => stableStringify(stripType(a)) === stableStringify(stripType(b));

export function parseBundle(text) {
  const b = JSON.parse(text);
  const records = Array.isArray(b) ? b : (b.records || []);
  if (!Array.isArray(records) || !records.length) throw new Error("Bundle has no records[]");
  for (const r of records) {
    if (!r.collection || !r.value) throw new Error("Each record needs a collection and value");
  }
  return records;
}

export async function diffBundle(agent, did, records) {
  const plan = [];
  for (const r of records) {
    let status = "create", existingCid = null, existingValue = null;
    if (r.rkey) {
      try {
        const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: r.collection, rkey: r.rkey });
        existingValue = res.data.value; existingCid = res.data.cid;
        status = eq(existingValue, r.value) ? "unchanged" : "update";
      } catch { status = "create"; }
    }
    plan.push({ collection: r.collection, rkey: r.rkey || null, value: r.value, status, existingCid, existingValue });
  }
  return plan;
}

// records in the repo (within collections the bundle touches) that are NOT in
// the bundle, candidates for deletion when the user opts into pruning.
export async function pruneCandidates(agent, did, records) {
  const keepByCollection = new Map();
  for (const r of records) {
    if (!r.rkey) continue;
    if (!keepByCollection.has(r.collection)) keepByCollection.set(r.collection, new Set());
    keepByCollection.get(r.collection).add(r.rkey);
  }
  const out = [];
  for (const [collection, keep] of keepByCollection) {
    for (const rec of await listRecords(agent, did, collection)) {
      const rkey = parseAtUri(rec.uri).rkey;
      if (!keep.has(rkey)) out.push({ collection, rkey, value: rec.value, status: "delete", existingCid: rec.cid });
    }
  }
  return out;
}

function isBlobRef(v) {
  return v && typeof v === "object" && (v.$type === "blob" || (v.mimeType && v.ref != null && blobCid(v) != null));
}

// re-upload blobs referenced in a record when importing across repos: fetch the
// bytes from the source PDS and upload to the target, swapping in the new ref.
async function rehydrateBlobs(agent, sourcePds, sourceDid, value) {
  const walk = async (v) => {
    if (isBlobRef(v)) {
      const cid = blobCid(v);
      const res = await fetch(`${sourcePds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(sourceDid)}&cid=${encodeURIComponent(cid)}`);
      if (!res.ok) return v;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const up = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: v.mimeType || "application/octet-stream" });
      return up.data.blob;
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = await walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

export async function writeBundle(agent, did, plan, onProgress, sourceDid = null) {
  const results = [];
  let sourcePds = null;
  const crossRepo = sourceDid && sourceDid !== did;
  if (crossRepo) { try { sourcePds = await resolvePds(sourceDid); } catch { sourcePds = null; } }
  const work = plan.filter((p) => p.status !== "unchanged" && !p.skip);
  let done = 0;
  for (const item of plan) {
    if (item.status === "unchanged" || item.skip) { results.push({ ...item, result: "skipped" }); continue; }
    done++;
    onProgress?.(item, done, work.length);
    try {
      if (item.status === "delete") {
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection: item.collection, rkey: item.rkey });
        results.push({ ...item, result: "deleted" });
        continue;
      }
      let record = { ...item.value };
      if (crossRepo && sourcePds) record = await rehydrateBlobs(agent, sourcePds, sourceDid, record);
      if (item.rkey) {
        await agent.com.atproto.repo.putRecord({
          repo: did, collection: item.collection, rkey: item.rkey, record,
          ...(item.existingCid ? { swapRecord: item.existingCid } : {}), validate: false,
        });
      } else {
        await agent.com.atproto.repo.createRecord({ repo: did, collection: item.collection, record, validate: false });
      }
      results.push({ ...item, result: "written" });
    } catch (e) {
      const msg = e?.message || String(e);
      results.push({ ...item, result: /swap|conflict/i.test(msg) ? "conflict" : "error", error: msg });
    }
  }
  return results;
}

// every app.graycard.* record collection the app knows about, derived from NS so
// the export can never silently miss a record type: a new lexicon added to NS is
// exported automatically (a test asserts NS covers every record lexicon).
export function graycardCollections() {
  const out = [];
  const walk = (v) => { if (typeof v === "string") { if (v.startsWith("app.graycard.")) out.push(v); } else if (v) Object.values(v).forEach(walk); };
  walk(NS);
  return [...new Set(out)].sort();
}

export async function exportBundle(agent, did) {
  const records = [];
  for (const collection of graycardCollections()) {
    try {
      const recs = (await listRecords(agent, did, collection))
        .map((r) => ({ collection, rkey: parseAtUri(r.uri).rkey, value: r.value }))
        .sort((a, b) => a.rkey.localeCompare(b.rkey));   // deterministic order for stable round-trips
      records.push(...recs);
    } catch { /* collection may not exist yet */ }
  }
  return { $type: "app.graycard.bundle", exportedAt: new Date().toISOString(), did, records };
}
