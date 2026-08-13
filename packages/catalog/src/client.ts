import { BrowserCatalogCache, MemoryCatalogCache } from "./cache.ts";
import { CatalogFetchError, CatalogFormatError, CatalogIntegrityError } from "./errors.ts";
import { byteLength, parseAndVerifyManifest, sha256Hex } from "./integrity.ts";
import { searchCatalogItems } from "./search.ts";
import {
  CATALOG_SCHEMA_VERSION,
  type CatalogCache,
  type CatalogDomain,
  type CatalogFetch,
  type CatalogItem,
  type CatalogManifest,
  type CatalogSearchOptions,
  type CatalogSearchResult,
  type CatalogShard,
  type CatalogShardDescriptor,
} from "./types.ts";

export interface CatalogClientOptions {
  manifestUrl?: string;
  fetch?: CatalogFetch;
  cache?: CatalogCache;
  now?: () => number;
}

function defaultFetch(): CatalogFetch {
  if (typeof globalThis.fetch !== "function") {
    throw new CatalogFetchError("CatalogClient requires an injected fetch implementation", "");
  }
  return (url) => globalThis.fetch(url);
}

function shardUrl(manifestUrl: string, path: string): string {
  try {
    return new URL(path, manifestUrl).toString();
  } catch {
    const base = manifestUrl.split(/[?#]/, 1)[0];
    return `${base.slice(0, base.lastIndexOf("/") + 1)}${path}`;
  }
}

async function responseBody(fetcher: CatalogFetch, url: string): Promise<string> {
  let response;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new CatalogFetchError(
      `Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
      url,
    );
  }
  if (!response.ok) {
    throw new CatalogFetchError(
      `Catalog request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`,
      url,
      response.status,
    );
  }
  return response.text();
}

function parseShard<T extends CatalogItem>(
  body: string,
  domain: CatalogDomain,
  descriptor: CatalogShardDescriptor,
): CatalogShard<T> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new CatalogFormatError(
      `Catalog shard ${domain} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogFormatError(`Catalog shard ${domain} must be an object`);
  }
  const shard = value as Partial<CatalogShard<T>>;
  if (shard.schemaVersion !== CATALOG_SCHEMA_VERSION || shard.domain !== domain) {
    throw new CatalogFormatError(`Catalog shard ${domain} does not match its manifest descriptor`);
  }
  if (!Array.isArray(shard.items) || shard.items.length !== descriptor.itemCount) {
    throw new CatalogFormatError(`Catalog shard ${domain} has an unexpected item count`);
  }
  if (!Array.isArray(shard.sources)) {
    throw new CatalogFormatError(`Catalog shard ${domain} has no source attribution`);
  }
  return shard as CatalogShard<T>;
}

export class CatalogClient {
  readonly manifestUrl: string;
  private readonly fetcher: CatalogFetch;
  private readonly cache: CatalogCache;
  private readonly now: () => number;
  private manifestPromise?: Promise<CatalogManifest>;
  private readonly shardPromises = new Map<string, Promise<CatalogShard>>();

  constructor(options: CatalogClientOptions = {}) {
    this.manifestUrl = options.manifestUrl ?? "/catalog/manifest.json";
    this.fetcher = options.fetch ?? defaultFetch();
    this.cache = options.cache ?? new MemoryCatalogCache();
    this.now = options.now ?? Date.now;
  }

  async manifest(refresh = false): Promise<CatalogManifest> {
    if (refresh) {
      this.manifestPromise = undefined;
      this.shardPromises.clear();
    }
    this.manifestPromise ??= this.loadManifest();
    try {
      return await this.manifestPromise;
    } catch (error) {
      this.manifestPromise = undefined;
      throw error;
    }
  }

  private async loadManifest(): Promise<CatalogManifest> {
    const cacheKey = `catalog-manifest:${this.manifestUrl}`;
    try {
      const body = await responseBody(this.fetcher, this.manifestUrl);
      const manifest = await parseAndVerifyManifest(body);
      try {
        await this.cache.set(cacheKey, { body, storedAt: this.now() });
      } catch {
        // A persistent-cache failure must not hide a valid network manifest.
      }
      return manifest;
    } catch (networkError) {
      // The pointer manifest is mutable, so prefer the network. A previously
      // verified copy nevertheless makes already-cached content-addressed
      // shards usable while offline.
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) return await parseAndVerifyManifest(cached.body);
      } catch {
        // Surface the original network/format error when the fallback is bad.
      }
      throw networkError;
    }
  }

  async getShard<T extends CatalogItem = CatalogItem>(domain: CatalogDomain): Promise<CatalogShard<T>> {
    const manifest = await this.manifest();
    const descriptor = manifest.shards[domain];
    if (!descriptor) throw new CatalogFormatError(`Unknown catalog domain ${domain}`);
    const key = `${manifest.catalogHash}:${domain}:${descriptor.sha256}`;
    let pending = this.shardPromises.get(key);
    if (!pending) {
      pending = this.loadShard(domain, descriptor);
      this.shardPromises.set(key, pending);
      pending.catch(() => this.shardPromises.delete(key));
    }
    return pending as Promise<CatalogShard<T>>;
  }

  async getDomain<T extends CatalogItem = CatalogItem>(domain: CatalogDomain): Promise<ReadonlyArray<T>> {
    return (await this.getShard<T>(domain)).items;
  }

  async search(query: string, options: CatalogSearchOptions = {}): Promise<CatalogSearchResult[]> {
    if (!query.trim()) return [];
    const domains = options.domains ?? Object.keys((await this.manifest()).shards);
    const shards = await Promise.all(domains.map((domain) => this.getShard(domain)));
    const results = shards.flatMap((shard) => searchCatalogItems(shard.domain, shard.items, query, options.fields));
    const limit = Math.max(0, Math.floor(options.limit ?? 25));
    return results
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, limit)
      .map((result) => ({ ...result, score: Math.floor(result.score) }));
  }

  private async loadShard(domain: CatalogDomain, descriptor: CatalogShardDescriptor): Promise<CatalogShard> {
    const cacheKey = `catalog-shard:${descriptor.sha256}`;
    let cached;
    try {
      cached = await this.cache.get(cacheKey);
    } catch {
      cached = undefined;
    }
    if (cached) {
      try {
        return await this.verifyShard(cached.body, domain, descriptor);
      } catch {
        try {
          await this.cache.delete(cacheKey);
        } catch {
          // A broken persistent cache must not prevent a network recovery.
        }
      }
    }

    const body = await responseBody(this.fetcher, shardUrl(this.manifestUrl, descriptor.path));
    const shard = await this.verifyShard(body, domain, descriptor);
    try {
      await this.cache.set(cacheKey, { body, storedAt: this.now() });
    } catch {
      // Catalog reads remain usable when IndexedDB is unavailable or over quota.
    }
    return shard;
  }

  private async verifyShard(
    body: string,
    domain: CatalogDomain,
    descriptor: CatalogShardDescriptor,
  ): Promise<CatalogShard> {
    const bytes = byteLength(body);
    if (bytes !== descriptor.bytes) {
      throw new CatalogIntegrityError(
        `Catalog shard ${domain} byte count does not match its manifest`,
        String(descriptor.bytes),
        String(bytes),
      );
    }
    const digest = await sha256Hex(body);
    if (digest !== descriptor.sha256) {
      throw new CatalogIntegrityError(
        `Catalog shard ${domain} digest does not match its manifest`,
        descriptor.sha256,
        digest,
      );
    }
    return parseShard(body, domain, descriptor);
  }
}

let sharedBrowserClient: CatalogClient | undefined;

/**
 * Return the application-wide browser client. A single client deduplicates the
 * manifest request and concurrent shard requests across otherwise independent
 * consumers such as setup presets and the development timer.
 */
export function getDefaultCatalogClient(): CatalogClient {
  sharedBrowserClient ??= new CatalogClient({ cache: new BrowserCatalogCache() });
  return sharedBrowserClient;
}

/** Replace the shared client, primarily for deterministic integration tests. */
export function setDefaultCatalogClient(client?: CatalogClient): void {
  sharedBrowserClient = client;
}
