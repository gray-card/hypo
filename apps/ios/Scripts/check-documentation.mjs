#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const iosRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(iosRoot, "../..");
const packagesRoot = join(iosRoot, "Packages");

function filesBelow(directory, predicate) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".build") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path, predicate);
    return predicate(path) ? [path] : [];
  });
}

const manifests = filesBelow(packagesRoot, (path) => path.endsWith("/Package.swift"));
const errors = [];
let catalogCount = 0;
for (const manifest of manifests) {
  const packageDirectory = dirname(manifest);
  const sourceDirectory = join(packageDirectory, "Sources");
  const modules = readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const module of modules) {
    const landing = join(sourceDirectory, module, `${module}.docc`, `${module}.md`);
    if (!existsSync(landing)) {
      errors.push(`Missing DocC landing page: ${relative(repoRoot, landing)}`);
    } else {
      catalogCount += 1;
    }
  }
}

const documentationFiles = filesBelow(packagesRoot, (path) => /\.(?:md|tutorial)$/.test(path));
const canonicalPattern = /https:\/\/hypo\.graycard\.app\/docs\/([^\s)#?]+\/?)/g;
for (const path of documentationFiles) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(canonicalPattern)) {
    const reference = decodeURIComponent(match[1]).replace(/\/$/, "");
    const candidates = [join(repoRoot, "docs", `${reference}.md`), join(repoRoot, "docs", reference, "index.md")];
    if (!candidates.some(existsSync)) {
      errors.push(`${relative(repoRoot, path)} links to a missing canonical page: ${match[0]}`);
    }
  }
}

const requiredTutorials = [
  "End-to-end-roll.tutorial",
  "Build-with-SimulatedMeterDevice.tutorial",
  "Calibrate-a-meter.tutorial",
];
for (const name of requiredTutorials) {
  if (!documentationFiles.some((path) => path.endsWith(`/${name}`))) {
    errors.push(`Missing required DocC tutorial: ${name}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Checked ${manifests.length} Swift packages, ${catalogCount} DocC catalogs, and ${documentationFiles.length} documentation files.`,
);
