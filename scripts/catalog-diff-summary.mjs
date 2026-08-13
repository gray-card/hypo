#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CATALOG_COLLECTIONS = [
  { file: "src/data/curated-cameras.json", field: "cameras", keys: ["make", "model"] },
  { file: "src/data/curated-lenses.json", field: "lenses", keys: ["make", "model", "mount"] },
  {
    file: "src/data/curated-dev-times.json",
    field: "recipes",
    keys: ["developerMake", "developerName", "filmMake", "filmName", "dilution", "ei", "pushPull", "process"],
  },
  { file: "src/data/curated-film-stocks.json", field: "stocks", keys: ["brand", "name"] },
  {
    file: "src/data/curated-darkroom-products.json",
    field: "developers",
    keys: ["brand", "name", "process"],
  },
  {
    file: "src/data/curated-darkroom-products.json",
    field: "chemistries",
    keys: ["brand", "name", "role", "process"],
  },
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function identity(record, keys) {
  if (record.id || record.uri || record.$id) return String(record.id || record.uri || record.$id);
  return keys.map((key) => JSON.stringify(record[key] ?? null)).join("|");
}

function index(records, keys) {
  return new Map(records.map((record) => [identity(record, keys), JSON.stringify(canonical(record))]));
}

export function diffRecords(before = [], after = [], keys = []) {
  const oldRecords = index(before, keys);
  const newRecords = index(after, keys);
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [key, value] of newRecords) {
    if (!oldRecords.has(key)) added += 1;
    else if (oldRecords.get(key) !== value) changed += 1;
  }
  for (const key of oldRecords.keys()) if (!newRecords.has(key)) removed += 1;
  return { added, changed, removed };
}

function atHead(file) {
  try {
    return execFileSync("git", ["show", `HEAD:${file}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return "{}";
  }
}

export async function catalogDiffSummary(collections = CATALOG_COLLECTIONS) {
  const rows = [];
  for (const spec of collections) {
    const before = JSON.parse(atHead(spec.file));
    const after = JSON.parse(await readFile(resolve(ROOT, spec.file), "utf8"));
    rows.push({
      collection: spec.field,
      ...diffRecords(before[spec.field], after[spec.field], spec.keys),
      total: Array.isArray(after[spec.field]) ? after[spec.field].length : 0,
    });
  }
  return rows;
}

export function renderSummary(rows) {
  const totals = rows.reduce(
    (sum, row) => ({
      added: sum.added + row.added,
      changed: sum.changed + row.changed,
      removed: sum.removed + row.removed,
    }),
    { added: 0, changed: 0, removed: 0 },
  );
  return [
    "Automated weekly refresh of the Lensfun and Wikidata-backed catalogs.",
    "",
    "| Collection | Added | Changed | Removed | Current total |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.collection} | ${row.added} | ${row.changed} | ${row.removed} | ${row.total} |`),
    `| **Total** | **${totals.added}** | **${totals.changed}** | **${totals.removed}** | |`,
    "",
    "CI must pass before this PR can merge.",
    "",
  ].join("\n");
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--out");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const markdown = renderSummary(await catalogDiffSummary());
  if (output) await writeFile(resolve(output), markdown, "utf8");
  else process.stdout.write(markdown);
}
