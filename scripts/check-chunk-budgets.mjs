#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CHUNK_GZIP_LIMIT = 300_000;

export async function inspectChunks(directory, limit = DEFAULT_CHUNK_GZIP_LIMIT) {
  const results = [];
  for (const name of (await readdir(directory)).filter((file) => file.endsWith(".js")).sort()) {
    const bytes = await readFile(join(directory, name));
    results.push({ name, raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength, limit });
  }
  return results.sort((left, right) => right.gzip - left.gzip);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const directory = resolve(ROOT, process.argv[2] || "dist/assets");
  const chunks = await inspectChunks(directory);
  const failures = chunks.filter((chunk) => chunk.gzip > chunk.limit);
  const largest = chunks[0];
  if (largest) console.log(`Largest JavaScript chunk: ${largest.name} (${(largest.gzip / 1000).toFixed(2)} kB gzip)`);
  for (const chunk of failures) {
    console.error(`${chunk.name}: ${(chunk.gzip / 1000).toFixed(2)} kB gzip exceeds 300 kB`);
  }
  if (failures.length) process.exitCode = 1;
}
