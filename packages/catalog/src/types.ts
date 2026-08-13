export const CATALOG_SCHEMA_VERSION = 1 as const;

export type CatalogDomain = "cameras" | "lenses" | "dev-times" | "film-stocks" | "darkroom-products" | (string & {});

export type CatalogItem = Record<string, unknown>;

export interface CatalogSource {
  file: string;
  collection: string;
  itemCount: number;
  metadata: Record<string, unknown>;
}

export interface CatalogShard<T extends CatalogItem = CatalogItem> {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  domain: CatalogDomain;
  sources: CatalogSource[];
  items: T[];
}

export interface CatalogShardDescriptor {
  path: string;
  sha256: string;
  bytes: number;
  itemCount: number;
}

export interface CatalogManifest {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  hashAlgorithm: "sha256";
  catalogHash: string;
  shards: Record<string, CatalogShardDescriptor>;
}

export interface CatalogResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

export type CatalogFetch = (url: string) => Promise<CatalogResponse>;

export interface CatalogCacheEntry {
  body: string;
  storedAt: number;
}

export interface CatalogCache {
  get(key: string): Promise<CatalogCacheEntry | undefined>;
  set(key: string, entry: CatalogCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CatalogSearchOptions {
  /** Domains to load and search. Omit to search every shard in the manifest. */
  domains?: ReadonlyArray<CatalogDomain>;
  /** Object fields to index. Omit to index all scalar values. */
  fields?: ReadonlyArray<string>;
  limit?: number;
}

export interface CatalogSearchResult<T extends CatalogItem = CatalogItem> {
  domain: CatalogDomain;
  item: T;
  label: string;
  score: number;
}
