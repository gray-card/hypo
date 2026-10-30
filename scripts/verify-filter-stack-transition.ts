import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Panproto } from "@panproto/core";
import { validateRecord } from "@hypo/lexicon/validators";

import { migrateFilterStackValue } from "../src/filterStackMigration.ts";

const [lensPath, dataPath, sourcePath, targetPath] = process.argv.slice(2).map((path) => resolve(path));
if (!lensPath || !dataPath || !sourcePath || !targetPath) {
  throw new Error("usage: verify-filter-stack-transition <lens> <data> <source-lexicons> <target-lexicons>");
}

const jsonFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();

const readBundle = (directory: string): object[] =>
  jsonFiles(directory).map((path) => JSON.parse(readFileSync(path, "utf8")));

const fixture = JSON.parse(readFileSync(dataPath, "utf8"));
const projectionPath = resolve(dirname(dataPath), fixture.projection);
const projectionLexicon = JSON.parse(readFileSync(projectionPath, "utf8"));
const lensDocument = JSON.parse(readFileSync(lensPath, "utf8"));
const nsid = lensDocument.source;
const root = `${nsid}:body`;

const panproto = await Panproto.init();
const sourceSchema = panproto.parseSchemaBundle("atproto", readBundle(sourcePath));
const targetSchema = panproto.parseSchemaBundle("atproto", readBundle(targetPath));
const projectionSchema = panproto.parseSchemaBundle("atproto", [projectionLexicon]);
const protocol = panproto.protocol("atproto");
for (const [label, schema] of [
  ["source", sourceSchema],
  ["target", targetSchema],
] as const) {
  const validation = schema.validate(protocol);
  if (validation.issues.length) throw new Error(`${label} schema is invalid: ${JSON.stringify(validation.issues)}`);
}

const chain = panproto.compileLensDocument(lensDocument, root);
if (!(chain.fieldTransforms()[root]?.length >= 1)) {
  throw new Error(`the reviewed Panproto lens has no ${nsid} field transform`);
}
const lens = chain.instantiate(projectionSchema);
if (!Array.isArray(fixture.records) || !fixture.records.length) throw new Error("transition fixture has no records");

for (const candidate of fixture.records) {
  const { expectedFilters, ...source } = candidate;
  const view = lens.getJson(source, root).view as { filters?: unknown[] };
  if (!Array.isArray(view.filters)) throw new Error("Panproto did not project a filter stack");
  const migrated = migrateFilterStackValue(source, view.filters.map(String));
  if ("filter" in migrated) throw new Error("migration retained the singular filter field");
  if (JSON.stringify(migrated.filters) !== JSON.stringify(expectedFilters)) {
    throw new Error(`migration produced the wrong stack: ${JSON.stringify(migrated.filters)}`);
  }
  const validation = validateRecord(nsid, migrated);
  if (!validation.success) throw new Error(`migrated fixture is invalid: ${JSON.stringify(validation.issues)}`);
}

lens[Symbol.dispose]?.();
chain[Symbol.dispose]?.();
sourceSchema[Symbol.dispose]?.();
targetSchema[Symbol.dispose]?.();
projectionSchema[Symbol.dispose]?.();

console.log(`Verified ${fixture.records.length} ${nsid} filter-stack migrations with ${lensDocument.id}.`);
