#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IOS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(IOS_ROOT, "../..");
const SOURCE_ROOT = join(REPO_ROOT, "public", "catalog");
const DESTINATION_ROOT = join(IOS_ROOT, "Packages", "CatalogKit", "Sources", "CatalogKit", "Resources", "Catalog");
const CHECK = process.argv.includes("--check");

const manifestPath = join(SOURCE_ROOT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sourceFiles = [manifestPath];

for (const descriptor of Object.values(manifest.shards)) {
  const source = resolve(SOURCE_ROOT, descriptor.path);
  if (!source.startsWith(`${SOURCE_ROOT}/`)) {
    throw new Error(`Catalog shard escapes the catalog root: ${descriptor.path}`);
  }
  sourceFiles.push(source);
}

const expectedRelativePaths = new Set(sourceFiles.map((file) => relative(SOURCE_ROOT, file)));

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

if (CHECK) {
  let drifted = false;
  for (const source of sourceFiles) {
    const relativePath = relative(SOURCE_ROOT, source);
    const destination = join(DESTINATION_ROOT, relativePath);
    if (!existsSync(destination) || !readFileSync(destination).equals(readFileSync(source))) {
      console.error(`Bundled catalog file is missing or stale: ${relativePath}`);
      drifted = true;
    }
  }
  for (const destination of collectFiles(DESTINATION_ROOT)) {
    const relativePath = relative(DESTINATION_ROOT, destination);
    if (!expectedRelativePaths.has(relativePath)) {
      console.error(`Bundled catalog contains an obsolete file: ${relativePath}`);
      drifted = true;
    }
  }
  if (drifted) process.exit(1);
} else {
  mkdirSync(DESTINATION_ROOT, { recursive: true });
  for (const destination of collectFiles(DESTINATION_ROOT)) {
    const relativePath = relative(DESTINATION_ROOT, destination);
    if (!expectedRelativePaths.has(relativePath)) rmSync(destination);
  }
  for (const source of sourceFiles) {
    const destination = join(DESTINATION_ROOT, relative(SOURCE_ROOT, source));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

console.log(
  `${CHECK ? "checked" : "staged"} catalog ${manifest.catalogHash} (${manifest.shards ? Object.keys(manifest.shards).length : 0} shards)`,
);
