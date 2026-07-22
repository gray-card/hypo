// discover.js: cross-network "Discover setups" — enumerate every published setup
// via Constellation, hydrate each from its author's PDS, newest-first, paginated.
// This is the whole read side of Discover: no reindex request, no completion
// notice, no polling. Constellation's live firehose indexing is the freshness
// mechanism, so a setup shows up here the instant its author's PDS write commits.

import { listSetupPage, countSetups, countSetupAuthors } from "./constellation.js";
import { hydratePage } from "./hydrate.js";

// one page of discoverable setups. `cursor` is the opaque cursor from a prior page
// (omit for the first page). Returns hydrated cards + the next cursor.
export async function loadDiscover(cursor, { limit = 50 } = {}) {
  const page = await listSetupPage(cursor, limit);
  const setups = await hydratePage(page.items);
  return { setups, cursor: page.cursor, hasMore: Boolean(page.cursor) };
}

// header stats — "N setups from M photographers". Returns null when Constellation
// is unreachable, so the header simply omits the count rather than erroring.
export async function discoverCounts() {
  try {
    const [setups, authors] = await Promise.all([countSetups(), countSetupAuthors()]);
    return { setups, authors };
  } catch {
    return null;
  }
}
