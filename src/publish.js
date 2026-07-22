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

// the user's own published setups, newest-first (loaded straight from their repo,
// no Constellation needed — you already know whose records to read).
export async function listMySetups(agent, did) {
  const records = await listRecords(agent, did, SETUP_NSID);
  return records
    .map((r) => ({ uri: r.uri, cid: r.cid, rkey: parseAtUri(r.uri).rkey, value: r.value }))
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
    const res = await agent.com.atproto.repo.putRecord({
      repo: did, collection: SETUP_NSID, rkey: existing.rkey, record: value,
      swapRecord: existing.cid, validate: false,
    });
    return { uri: existing.uri, cid: res.data.cid, rkey: existing.rkey, value };
  }
  const res = await agent.com.atproto.repo.createRecord({
    repo: did, collection: SETUP_NSID, record: value, validate: false,
  });
  return { uri: res.data.uri, cid: res.data.cid, rkey: parseAtUri(res.data.uri).rkey, value };
}

// remove a published setup (unpublish from Discover).
export async function unpublishSetup(agent, did, rkey) {
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: SETUP_NSID, rkey });
}
