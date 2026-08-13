// publish.js: write / update / remove the current user's public "setup" record —
// the opt-in that lists them in cross-network Discover.
//
// A published setup is a small app.graycard.setup record whose `registry` field
// links to the frozen discovery anchor. Constellation indexes that link in real
// time, so publishing is discoverable the instant the PDS write commits and
// unpublishing (a plain deleteRecord) drops it from Discover automatically —
// Constellation keeps link counts accurate through deletions.

import { SETUP_NSID, HYPO_REGISTRY } from "./registry.js";
import { parseAtUri, listRecords } from "./grain.js";
import { repoClient } from "./pds.js";
import { prepareSchemaWrite } from "./schemaRuntime.js";

// the user's own published setups, newest-first (loaded straight from their repo,
// no Constellation needed — you already know whose records to read).
export async function listMySetups(agent, did) {
  // Publication status is user-controlled external state. Refresh the snapshot
  // so a publish/unpublish performed by another session is visible immediately;
  // listRecords still falls back to the durable cache while offline.
  const records = await listRecords(agent, did, SETUP_NSID, { refresh: true });
  return records
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: parseAtUri(r.uri).rkey,
      value: r.value,
      schemaRuntime: r.schemaRuntime,
    }))
    .sort((a, b) => (b.value.createdAt || "").localeCompare(a.value.createdAt || ""));
}

// Hypo manages a single published setup per user; return the most recent one (or
// null when the user has not published).
export async function getMySetup(agent, did) {
  return (await listMySetups(agent, did))[0] || null;
}

// Create or update (when `existing` is passed) the setup record. `existing` is a
// loaded { uri, cid, rkey, value } from listMySetups; passing it updates in place
// with a compare-and-swap so a concurrent edit can't be clobbered.
export async function publishSetup(agent, did, input = {}, existing = null) {
  const now = new Date().toISOString();
  const value = {
    $type: SETUP_NSID,
    registry: HYPO_REGISTRY, // the anchor — must be exact for Discover to find it
    name: (input.name || "").trim() || "My setup",
    createdAt: existing?.value?.createdAt || now,
    updatedAt: now,
  };
  const summary = (input.summary || "").trim();
  if (summary) value.summary = summary;
  if (input.gallery) value.gallery = input.gallery;
  if (Array.isArray(input.gear) && input.gear.length) value.gear = input.gear.slice(0, 200);

  if (existing) {
    const prepared = await prepareSchemaWrite(SETUP_NSID, value, existing);
    const result = await repoClient(agent).put({
      repo: did,
      collection: SETUP_NSID,
      rkey: existing.rkey,
      record: { ...prepared, $type: SETUP_NSID },
      swapRecord: existing.cid,
    });
    return {
      uri: existing.uri,
      cid: result.cid,
      rkey: existing.rkey,
      value,
      schemaRuntime: existing.schemaRuntime,
    };
  }
  const result = await repoClient(agent).create({
    repo: did,
    collection: SETUP_NSID,
    record: value,
  });
  return { uri: result.uri, cid: result.cid, rkey: parseAtUri(result.uri).rkey, value };
}

// remove a published setup (unpublish from Discover).
export async function unpublishSetup(agent, did, rkey) {
  await repoClient(agent).delete({ repo: did, collection: SETUP_NSID, rkey });
}
