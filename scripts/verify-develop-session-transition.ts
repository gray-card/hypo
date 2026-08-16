import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Panproto } from "@panproto/core";
import { validateRecord } from "@hypo/lexicon/validators";

import projectionLexicon from "../lenses/develop-session-v2/projection-lexicon.json";
import {
  DEVELOP_SESSION,
  LEGACY_DEVELOPMENT_SUMMARY_FIELDS,
  migrateDevelopSessionValue,
} from "../src/developSessionMigration.ts";

const [lensPath, dataPath, sourcePath, targetPath] = process.argv.slice(2).map((path) => resolve(path));
if (!lensPath || !dataPath || !sourcePath || !targetPath) {
  throw new Error("usage: verify-develop-session-transition <lens> <data> <source-lexicons> <target-lexicons>");
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

const stripNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripNulls).filter((item) => item !== null && item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, stripNulls(item)]),
  );
};

const primaryFields = [
  "recipe",
  "sourceDocument",
  "sourceSpec",
  "chemistry",
  "dilution",
  "temperature",
  "temperatureSetpoint",
  "actualTemperature",
  "timeSeconds",
  "publishedTimeSeconds",
  "actualTimeSeconds",
  "agitation",
  "agitationScheme",
] as const;

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

const lensDocument = JSON.parse(readFileSync(lensPath, "utf8"));
const root = `${DEVELOP_SESSION}:body`;
const chain = panproto.compileLensDocument(lensDocument, root);
if (!(chain.fieldTransforms()[root]?.length >= 1)) {
  throw new Error("the reviewed Panproto lens has no development-session field transform");
}
const lens = chain.instantiate(projectionSchema);
const fixture = JSON.parse(readFileSync(dataPath, "utf8"));
if (!Array.isArray(fixture.records) || !fixture.records.length) throw new Error("transition fixture has no records");

for (const candidate of fixture.records) {
  const { expectedRoles = [], ...source } = candidate;
  const projection: Record<string, unknown> = {
    process: source.process || "other",
    createdAt: source.createdAt,
    steps: [],
  };
  for (const field of primaryFields) projection[field] = source[field] ?? null;
  const view = lens.getJson(projection, root).view as { steps?: unknown[] };
  const primary = stripNulls(view.steps?.[0]) as Record<string, unknown>;
  const migrated = migrateDevelopSessionValue(source, primary);
  for (const field of LEGACY_DEVELOPMENT_SUMMARY_FIELDS) {
    if (field in migrated) throw new Error(`migration retained legacy field ${field}`);
  }
  const actualRoles = (migrated.steps as Array<{ roles?: string[] }>).map((step) => (step.roles || []).join("+"));
  for (const expected of expectedRoles) {
    if (!actualRoles.includes(expected)) {
      throw new Error(`migration did not produce expected stage ${expected}: ${JSON.stringify(actualRoles)}`);
    }
  }
  const validation = validateRecord(DEVELOP_SESSION, migrated);
  if (!validation.success) throw new Error(`migrated fixture is invalid: ${JSON.stringify(validation.issues)}`);
}

lens[Symbol.dispose]?.();
chain[Symbol.dispose]?.();
sourceSchema[Symbol.dispose]?.();
targetSchema[Symbol.dispose]?.();
projectionSchema[Symbol.dispose]?.();

console.log(`Verified ${fixture.records.length} development-session migrations with ${lensDocument.id}.`);
