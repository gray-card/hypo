import { MemoryDatabase, openSyncDatabase, type SyncDatabase } from "@hypo/sync";
import type { FollowingFeedSnapshot } from "./following.js";

const CACHE_VERSION = 1;
const CACHE_PREFIX = "following-feed:";

interface StoredFollowingFeed {
  version: number;
  snapshot: FollowingFeedSnapshot;
}

export interface FollowingFeedCacheStore {
  read(viewerDid: string): Promise<FollowingFeedSnapshot | null>;
  write(viewerDid: string, snapshot: FollowingFeedSnapshot): Promise<void>;
}

export class FollowingFeedCache implements FollowingFeedCacheStore {
  constructor(private readonly database: SyncDatabase) {}

  async read(viewerDid: string): Promise<FollowingFeedSnapshot | null> {
    const row = await this.database.get("kv", `${CACHE_PREFIX}${viewerDid}`);
    const stored = row?.value as StoredFollowingFeed | undefined;
    if (!stored || stored.version !== CACHE_VERSION || !stored.snapshot) return null;
    return stored.snapshot;
  }

  async write(viewerDid: string, snapshot: FollowingFeedSnapshot): Promise<void> {
    await this.database.put("kv", {
      key: `${CACHE_PREFIX}${viewerDid}`,
      value: { version: CACHE_VERSION, snapshot } satisfies StoredFollowingFeed,
    });
  }
}

let cachePromise: Promise<FollowingFeedCache> | undefined;

export function openFollowingFeedCache(): Promise<FollowingFeedCache> {
  cachePromise ??= Promise.resolve()
    .then(() => (globalThis.indexedDB ? openSyncDatabase() : new MemoryDatabase()))
    .catch(() => new MemoryDatabase())
    .then((database) => new FollowingFeedCache(database));
  return cachePromise;
}
