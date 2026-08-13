import type { CatalogCache, CatalogCacheEntry } from "./types.ts";

function copy(entry: CatalogCacheEntry): CatalogCacheEntry {
  return { body: entry.body, storedAt: entry.storedAt };
}

/** A deterministic cache implementation for tests, SSR, and private browsing fallbacks. */
export class MemoryCatalogCache implements CatalogCache {
  private readonly entries = new Map<string, CatalogCacheEntry>();

  async get(key: string): Promise<CatalogCacheEntry | undefined> {
    const entry = this.entries.get(key);
    return entry ? copy(entry) : undefined;
  }

  async set(key: string, entry: CatalogCacheEntry): Promise<void> {
    this.entries.set(key, copy(entry));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

const CACHE_KEY_ORIGIN = "https://catalog-cache.invalid/";

/**
 * Persists verified shard bodies in the browser Cache API. The request URLs are
 * synthetic and never leave the browser; CatalogClient still verifies every
 * cached body against the current manifest before returning it.
 */
export class BrowserCatalogCache implements CatalogCache {
  constructor(private readonly cacheName = "hypo-catalog-shards-v1") {}

  async get(key: string): Promise<CatalogCacheEntry | undefined> {
    if (!globalThis.caches) return undefined;
    const response = await (await globalThis.caches.open(this.cacheName)).match(this.request(key));
    if (!response?.ok) return undefined;
    try {
      return decodeEntry(await response.json());
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CatalogCacheEntry): Promise<void> {
    if (!globalThis.caches) return;
    await (
      await globalThis.caches.open(this.cacheName)
    ).put(
      this.request(key),
      new Response(JSON.stringify(copy(entry)), {
        headers: { "content-type": "application/json" },
      }),
    );
  }

  async delete(key: string): Promise<void> {
    if (!globalThis.caches) return;
    await (await globalThis.caches.open(this.cacheName)).delete(this.request(key));
  }

  private request(key: string): Request {
    return new Request(`${CACHE_KEY_ORIGIN}${encodeURIComponent(key)}`);
  }
}

export interface IndexedDbCatalogRecord {
  key: string;
  data: unknown;
  updatedAt: number;
  etag?: string;
}

/**
 * Structural subset of packages/sync's SyncDatabase. Keeping the dependency
 * structural avoids making the catalog package depend on the sync package.
 */
export interface CatalogShardDatabase {
  get(store: "catalog-shards", key: string): Promise<IndexedDbCatalogRecord | undefined>;
  put(store: "catalog-shards", value: IndexedDbCatalogRecord): Promise<void>;
  delete(store: "catalog-shards", key: string): Promise<void>;
}

function decodeEntry(value: unknown): CatalogCacheEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { body, storedAt } = value as Record<string, unknown>;
  return typeof body === "string" && typeof storedAt === "number" ? { body, storedAt } : undefined;
}

/** Adapts the shared IndexedDB `catalog-shards` object store to CatalogCache. */
export class IndexedDbCatalogCache implements CatalogCache {
  constructor(private readonly database: CatalogShardDatabase) {}

  async get(key: string): Promise<CatalogCacheEntry | undefined> {
    return decodeEntry((await this.database.get("catalog-shards", key))?.data);
  }

  async set(key: string, entry: CatalogCacheEntry): Promise<void> {
    await this.database.put("catalog-shards", {
      key,
      data: copy(entry),
      updatedAt: entry.storedAt,
    });
  }

  async delete(key: string): Promise<void> {
    await this.database.delete("catalog-shards", key);
  }
}

export { IndexedDbCatalogCache as IndexedDbCatalogCacheAdapter };
