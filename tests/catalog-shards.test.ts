import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CatalogClient,
  CatalogIntegrityError,
  IndexedDbCatalogCache,
  MemoryCatalogCache,
  type CatalogFetch,
} from "../packages/catalog/src/index.ts";
// The build entry point intentionally remains plain Node ESM.
// @ts-expect-error No declaration file is needed by the runtime build script.
import { buildCatalogShards } from "../scripts/build-catalog-shards.mjs";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hypo-catalog-shards-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function fileFetch(outputDirectory: string, mutate?: (path: string, body: string) => string) {
  const calls: string[] = [];
  const fetch: CatalogFetch = async (url) => {
    calls.push(url);
    const relative = new URL(url).pathname.replace(/^\/catalog\//, "");
    try {
      const body = await readFile(join(outputDirectory, relative), "utf8");
      return {
        ok: true,
        status: 200,
        text: async () => mutate?.(relative, body) ?? body,
      };
    } catch {
      return { ok: false, status: 404, text: async () => "not found" };
    }
  };
  return { calls, fetch };
}

describe("catalog shard build", () => {
  it("emits deterministic content-addressed domain shards into temporary output", async () => {
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    const first = await buildCatalogShards({ outputDirectory: firstDirectory });
    const second = await buildCatalogShards({ outputDirectory: secondDirectory });

    expect(first.manifest).toEqual(second.manifest);
    expect(first.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(first.manifest.shards).sort()).toEqual([
      "cameras",
      "darkroom-products",
      "dev-times",
      "film-stocks",
      "lenses",
    ]);
    for (const [domain, descriptor] of Object.entries(first.manifest.shards)) {
      expect(descriptor.path).toBe(`${first.catalogHash}/${domain}.json`);
      expect((await readFile(join(firstDirectory, descriptor.path))).byteLength).toBe(descriptor.bytes);
    }
  });
});

describe("CatalogClient", () => {
  it("fetches only requested domains, searches asynchronously, and reuses its injected cache", async () => {
    const outputDirectory = await temporaryDirectory();
    await buildCatalogShards({ outputDirectory });
    const transport = fileFetch(outputDirectory);
    const cache = new MemoryCatalogCache();
    const first = new CatalogClient({
      manifestUrl: "https://example.test/catalog/manifest.json",
      fetch: transport.fetch,
      cache,
    });

    const results = await first.search("Leica M6", { domains: ["cameras"], limit: 5 });
    expect(results.some((result) => result.label.includes("Leica M6"))).toBe(true);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toMatch(/\/cameras\.json$/);

    const second = new CatalogClient({
      manifestUrl: "https://example.test/catalog/manifest.json",
      fetch: transport.fetch,
      cache,
    });
    await second.getDomain("cameras");
    expect(transport.calls).toHaveLength(3);
    expect(cache.size).toBe(2);
  });

  it("reuses verified manifest and shard bodies while offline", async () => {
    const outputDirectory = await temporaryDirectory();
    await buildCatalogShards({ outputDirectory });
    const transport = fileFetch(outputDirectory);
    const cache = new MemoryCatalogCache();
    const online = new CatalogClient({
      manifestUrl: "https://example.test/catalog/manifest.json",
      fetch: transport.fetch,
      cache,
    });
    const cameras = await online.getDomain("cameras");
    expect(cameras[0]?.catalogKind).toBe("cameraType");

    const offline = new CatalogClient({
      manifestUrl: online.manifestUrl,
      fetch: async () => {
        throw new Error("offline");
      },
      cache,
    });
    await expect(offline.getDomain("cameras")).resolves.toEqual(cameras);
  });

  it("rejects a shard whose bytes do not match the signed manifest descriptor", async () => {
    const outputDirectory = await temporaryDirectory();
    await buildCatalogShards({ outputDirectory });
    const transport = fileFetch(outputDirectory, (path, body) => (path.endsWith("cameras.json") ? `${body} ` : body));
    const client = new CatalogClient({
      manifestUrl: "https://example.test/catalog/manifest.json",
      fetch: transport.fetch,
    });

    await expect(client.getDomain("cameras")).rejects.toBeInstanceOf(CatalogIntegrityError);
  });

  it("adapts the shared IndexedDB catalog-shards store without importing sync", async () => {
    const records = new Map<string, { key: string; data: unknown; updatedAt: number }>();
    const database = {
      get: vi.fn(async (_store: "catalog-shards", key: string) => records.get(key)),
      put: vi.fn(async (_store: "catalog-shards", value: { key: string; data: unknown; updatedAt: number }) => {
        records.set(value.key, value);
      }),
      delete: vi.fn(async (_store: "catalog-shards", key: string) => {
        records.delete(key);
      }),
    };
    const cache = new IndexedDbCatalogCache(database);
    await cache.set("one", { body: "{}", storedAt: 42 });

    expect(await cache.get("one")).toEqual({ body: "{}", storedAt: 42 });
    await cache.delete("one");
    expect(await cache.get("one")).toBeUndefined();
  });
});
