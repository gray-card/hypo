import { CatalogFormatError, CatalogIntegrityError } from "./errors.ts";
import { CATALOG_SCHEMA_VERSION, type CatalogManifest, type CatalogShardDescriptor } from "./types.ts";

const SHA256 = /^[a-f0-9]{64}$/;

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CatalogIntegrityError(
      "SHA-256 verification requires the Web Crypto API",
      "Web Crypto API",
      "unavailable",
    );
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readDescriptor(domain: string, value: unknown): CatalogShardDescriptor {
  if (!isObject(value)) throw new CatalogFormatError(`Manifest shard ${domain} is not an object`);
  const { path, sha256, bytes, itemCount } = value;
  if (typeof path !== "string" || !path || path.includes("\\") || path.split("/").includes("..")) {
    throw new CatalogFormatError(`Manifest shard ${domain} has an unsafe path`);
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    throw new CatalogFormatError(`Manifest shard ${domain} has an invalid SHA-256 digest`);
  }
  if (!Number.isSafeInteger(bytes) || (bytes as number) < 0) {
    throw new CatalogFormatError(`Manifest shard ${domain} has an invalid byte count`);
  }
  if (!Number.isSafeInteger(itemCount) || (itemCount as number) < 0) {
    throw new CatalogFormatError(`Manifest shard ${domain} has an invalid item count`);
  }
  return { path, sha256, bytes: bytes as number, itemCount: itemCount as number };
}

export function catalogHashIdentity(shards: Record<string, CatalogShardDescriptor>): Record<string, unknown> {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    shards: Object.fromEntries(
      Object.keys(shards)
        .sort()
        .map((domain) => {
          const { bytes, itemCount, sha256 } = shards[domain];
          return [domain, { bytes, itemCount, sha256 }];
        }),
    ),
  };
}

export async function parseAndVerifyManifest(body: string): Promise<CatalogManifest> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new CatalogFormatError(
      `Catalog manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(value)) throw new CatalogFormatError("Catalog manifest must be an object");
  if (value.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new CatalogFormatError(`Unsupported catalog schema version ${String(value.schemaVersion)}`);
  }
  if (value.hashAlgorithm !== "sha256") {
    throw new CatalogFormatError(`Unsupported catalog hash algorithm ${String(value.hashAlgorithm)}`);
  }
  if (typeof value.catalogHash !== "string" || !SHA256.test(value.catalogHash)) {
    throw new CatalogFormatError("Catalog manifest has an invalid catalog hash");
  }
  if (!isObject(value.shards) || Object.keys(value.shards).length === 0) {
    throw new CatalogFormatError("Catalog manifest must describe at least one shard");
  }

  const shards = Object.fromEntries(
    Object.entries(value.shards).map(([domain, descriptor]) => [domain, readDescriptor(domain, descriptor)]),
  );
  for (const [domain, descriptor] of Object.entries(shards)) {
    if (!descriptor.path.startsWith(`${value.catalogHash}/`)) {
      throw new CatalogFormatError(`Manifest shard ${domain} is outside catalog version ${value.catalogHash}`);
    }
  }

  const actual = await sha256Hex(canonicalJson(catalogHashIdentity(shards)));
  if (actual !== value.catalogHash) {
    throw new CatalogIntegrityError(
      "Catalog manifest release hash does not match its shard descriptors",
      value.catalogHash,
      actual,
    );
  }
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    hashAlgorithm: "sha256",
    catalogHash: value.catalogHash,
    shards,
  };
}
