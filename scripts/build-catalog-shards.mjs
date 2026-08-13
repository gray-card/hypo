#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CATALOG_SCHEMA_VERSION = 1;

const DOMAIN_SOURCES = {
  cameras: [
    ["curated-cameras.json", "cameras", "cameraType"],
    ["lensfun-cameras.json", "cameras", "cameraType"],
  ],
  lenses: [
    ["curated-lenses.json", "lenses", "lensType"],
    ["lensfun-lenses.json", "lenses", "lensType"],
  ],
  "dev-times": [["curated-dev-times.json", "recipes", "devRecipe"]],
  "film-stocks": [["curated-film-stocks.json", "stocks", "filmStock"]],
  "darkroom-products": [
    ["curated-darkroom-products.json", "developers", "chemistryType", "developer"],
    ["curated-darkroom-products.json", "chemistries", "chemistryType"],
  ],
};

function chemistryProjection(item, sourceKind) {
  if (sourceKind === "developer") {
    const roles =
      item.process === "monobath"
        ? ["film-developer", "fixer"]
        : item.form !== "kit"
          ? ["film-developer"]
          : item.process === "e6"
            ? ["first-developer", "color-developer", "bleach", "fixer", "stabilizer"]
            : item.process === "c41"
              ? ["color-developer", "bleach", "fixer", "stabilizer"]
              : item.process === "ecn2"
                ? ["color-developer", "bleach", "fixer"]
                : ["film-developer"];
    return {
      ...item,
      roles,
      productKind: item.form === "kit" ? "process-kit" : "single-chemical",
    };
  }
  const roles =
    item.roles ||
    (item.role === "blix"
      ? ["bleach", "fixer"]
      : item.role === "monobath"
        ? ["film-developer", "fixer"]
        : item.role === "developer"
          ? ["film-developer"]
          : item.role === "other" && item.name === "Hypo Clearing Agent"
            ? ["clearing-agent"]
            : [item.role]);
  const { role: _legacyRole, ...rest } = item;
  return {
    ...rest,
    roles,
    specSources: rest.specSources?.map((source) => ({
      ...source,
      fields: source.fields?.map((field) => (field === "role" ? "roles" : field)),
    })),
    productKind: item.productKind || (item.form === "kit" ? "multi-part-chemical" : "single-chemical"),
  };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

/** Serialize JSON independently of object insertion order. */
export function canonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

/** Return the lower-case SHA-256 digest of a UTF-8 string. */
export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function manifestIdentity(shards) {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    shards: Object.fromEntries(
      Object.keys(shards)
        .sort()
        .map((domain) => {
          const { bytes, itemCount, sha256: digest } = shards[domain];
          return [domain, { bytes, itemCount, sha256: digest }];
        }),
    ),
  };
}

async function readSource(dataDirectory, file, loaded) {
  if (!loaded.has(file)) {
    const path = join(dataDirectory, file);
    let source;
    try {
      source = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(`Could not read catalog input ${path}`, { cause: error });
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError(`Catalog input ${path} must contain a JSON object`);
    }
    loaded.set(file, source);
  }
  return loaded.get(file);
}

function sourceMetadata(source, file, collection, itemCount) {
  return {
    file,
    collection,
    itemCount,
    metadata: Object.fromEntries(Object.entries(source).filter(([, value]) => !Array.isArray(value))),
  };
}

/**
 * Build immutable catalog shards and a small pointer manifest.
 *
 * The catalog hash covers every shard digest, byte count, and item count. Each
 * shard digest in turn covers its full canonical JSON representation, including
 * source attribution. Repeating the build for identical inputs is byte-for-byte
 * deterministic.
 */
export async function buildCatalogShards(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? join(ROOT, "src", "data"));
  const outputDirectory = resolve(options.outputDirectory ?? join(ROOT, "public", "catalog"));
  const loaded = new Map();
  const builtShards = {};

  for (const domain of Object.keys(DOMAIN_SOURCES).sort()) {
    const items = [];
    const sources = [];
    for (const [file, collection, catalogKind, sourceKind] of DOMAIN_SOURCES[domain]) {
      const source = await readSource(dataDirectory, file, loaded);
      const collectionItems = source[collection];
      if (!Array.isArray(collectionItems)) {
        throw new TypeError(`${file}.${collection} must be an array`);
      }

      // catalogKind makes every shard directly consumable without rebuilding
      // knowledge of its source file layout in the browser.
      const projectedItems = collectionItems.map((item) => ({
        ...(catalogKind === "chemistryType" ? chemistryProjection(item, sourceKind) : item),
        catalogKind,
      }));
      items.push(...projectedItems);
      sources.push(sourceMetadata(source, file, collection, collectionItems.length));
    }

    const shard = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      domain,
      sources,
      items,
    };
    const body = canonicalJson(shard);
    builtShards[domain] = {
      body,
      bytes: Buffer.byteLength(body),
      itemCount: items.length,
      sha256: sha256(body),
    };
  }

  const catalogHash = sha256(canonicalJson(manifestIdentity(builtShards)));
  const shards = Object.fromEntries(
    Object.entries(builtShards).map(([domain, descriptor]) => [
      domain,
      {
        path: `${catalogHash}/${domain}.json`,
        sha256: descriptor.sha256,
        bytes: descriptor.bytes,
        itemCount: descriptor.itemCount,
      },
    ]),
  );
  const manifest = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    hashAlgorithm: "sha256",
    catalogHash,
    shards,
  };

  const versionDirectory = join(outputDirectory, catalogHash);
  await mkdir(versionDirectory, { recursive: true });
  await Promise.all(
    Object.entries(builtShards).map(([domain, descriptor]) =>
      writeFile(join(versionDirectory, `${domain}.json`), descriptor.body, "utf8"),
    ),
  );
  await writeFile(join(outputDirectory, "manifest.json"), canonicalJson(manifest), "utf8");

  return { catalogHash, manifest, outputDirectory };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  try {
    const result = await buildCatalogShards({
      dataDirectory: optionValue("--data"),
      outputDirectory: optionValue("--out"),
    });
    console.log(
      `catalog ${result.catalogHash}: ${Object.keys(result.manifest.shards).length} shards -> ${result.outputDirectory}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
