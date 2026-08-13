#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEXICON_ROOT = resolve(ROOT, "lexicons");
const OUTPUT = resolve(ROOT, "packages/lexicon/src/generated.ts");
const NAMESPACE_OUTPUT = resolve(ROOT, "packages/lexicon/src/namespaces.ts");
// These are valid record schemas, but the web client consumes their curated
// data as static catalog assets and does not request a repo write grant for
// them. This is collection policy, not a second copy of the schema taxonomy.
const STATIC_CATALOG_RECORDS = new Set(["app.graycard.catalog.devRecipe"]);

async function jsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return files.flat().sort();
}

function identifier(nsid, defName) {
  return `${nsid}#${defName}`
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function refIdentifier(ref, currentNsid) {
  const [target, fragment = "main"] = ref.startsWith("#") ? [currentNsid, ref.slice(1)] : ref.split("#");
  return identifier(target, fragment);
}

function canonicalRef(ref, currentNsid) {
  const [nsid, fragment = "main"] = ref.startsWith("#") ? [currentNsid, ref.slice(1)] : ref.split("#");
  return { nsid, fragment, value: `${nsid}#${fragment}` };
}

function collectRefs(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (typeof value.ref === "string") out.add(value.ref);
  if (Array.isArray(value.refs)) value.refs.forEach((ref) => out.add(ref));
  Object.values(value).forEach((child) => collectRefs(child, out));
  return out;
}

function knownValueType(values) {
  if (!values?.length) return "string";
  const literals = values.map((value) => JSON.stringify(value)).join(" | ");
  // ATProto knownValues are suggestions, not a closed enum. The branded-string
  // tail preserves forward compatibility while retaining editor completion.
  return `KnownValue<${literals}>`;
}

function typeFor(schema, currentNsid, indent = "") {
  if (!schema || typeof schema !== "object") return "unknown";
  switch (schema.type) {
    case "string":
      return knownValueType(schema.knownValues);
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "bytes":
      return "Uint8Array | string";
    case "cid-link":
      return "CidLink";
    case "blob":
      return "BlobRef";
    case "ref":
      return refIdentifier(schema.ref, currentNsid);
    case "union":
      return (schema.refs || []).map((ref) => refIdentifier(ref, currentNsid)).join(" | ") || "unknown";
    case "array":
      return `Array<${typeFor(schema.items, currentNsid, indent)}>`;
    case "object": {
      if (!schema.properties || !Object.keys(schema.properties).length) return "Record<string, unknown>";
      const required = new Set(schema.required || []);
      const next = `${indent}  `;
      const props = Object.entries(schema.properties).map(
        ([name, property]) =>
          `${next}${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${typeFor(property, currentNsid, next)};`,
      );
      return `{\n${props.join("\n")}\n${indent}}`;
    }
    default:
      return "unknown";
  }
}

function nsTree(recordLexicons) {
  const root = {};
  for (const lexicon of recordLexicons) {
    const parts = lexicon.id.split(".").slice(2);
    let cursor = root;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) cursor[part] = lexicon.id;
      else cursor = cursor[part] ||= {};
    });
  }
  return root;
}

function collectKnownValues(value, path = "", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKnownValues(item, `${path}/${index}`, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value.knownValues)) out[path] = value.knownValues;
  Object.entries(value).forEach(([key, child]) => collectKnownValues(child, `${path}/${key}`, out));
  return out;
}

function renderTypes(lexicons) {
  const chunks = [];
  for (const lexicon of lexicons) {
    for (const [defName, def] of Object.entries(lexicon.defs || {})) {
      const name = identifier(lexicon.id, defName);
      const schema = def.type === "record" ? def.record : def;
      const body = typeFor(schema, lexicon.id);
      if (def.type === "record" && body.startsWith("{")) {
        chunks.push(`export type ${name} = ${body.slice(0, -1)}  $type?: ${JSON.stringify(lexicon.id)};\n};`);
      } else {
        chunks.push(`export type ${name} = ${body};`);
      }
    }
  }
  return chunks.join("\n\n");
}

function renderRecordTypeMap(records) {
  const entries = records.map((lexicon) => `  ${JSON.stringify(lexicon.id)}: ${identifier(lexicon.id, "main")};`);
  return `export interface RecordTypeMap {\n${entries.join("\n")}\n}\nexport type RecordNsid = keyof RecordTypeMap;
export type RecordValue<Nsid extends RecordNsid> = RecordTypeMap[Nsid];`;
}

const files = await jsonFiles(LEXICON_ROOT);
const lexicons = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
lexicons.sort((a, b) => a.id.localeCompare(b.id));
const records = lexicons.filter((lexicon) => lexicon.defs?.main?.type === "record");
const schemas = Object.fromEntries(lexicons.map((lexicon) => [lexicon.id, lexicon]));
for (const lexicon of lexicons) {
  for (const ref of collectRefs(lexicon)) {
    const target = canonicalRef(ref, lexicon.id);
    if (!schemas[target.nsid]?.defs?.[target.fragment]) {
      throw new Error(`Unresolved lexicon ref ${target.value} (from ${lexicon.id})`);
    }
  }
}
const writableCatalogKinds = records
  .filter((lexicon) => lexicon.id.startsWith("app.graycard.catalog.") && !STATIC_CATALOG_RECORDS.has(lexicon.id))
  .map((lexicon) => lexicon.id.split(".").at(-1));
const knownValues = {};
for (const lexicon of lexicons) collectKnownValues(lexicon, lexicon.id, knownValues);

const header = `// Generated by scripts/generate-lexicons.mjs from lexicons/**/*.json.\n// Do not edit by hand.\n\n`;
const runtime = `
export type KnownValue<T extends string> = T | (string & Record<never, never>);
export interface CidLink { $link: string }
export interface BlobRef { $type?: "blob"; ref: CidLink; mimeType: string; size: number }

export const KNOWN_VALUES = ${JSON.stringify(knownValues, null, 2)} as const;
export const SCHEMAS: Readonly<Record<string, LexiconSchema>> = ${JSON.stringify(schemas, null, 2)};

export interface ValidationIssue { path: string; message: string }
export type ValidationResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };
type LexiconSchema = { lexicon: number; id: string; defs: Record<string, any> };

function resolveSchema(ref: string, currentNsid: string): { nsid: string; schema: any } | null {
  const [nsid, fragment = "main"] = ref.startsWith("#")
    ? [currentNsid, ref.slice(1)]
    : ref.split("#");
  const schema = SCHEMAS[nsid]?.defs?.[fragment];
  if (!schema) return null;
  return { nsid, schema: schema.type === "record" ? schema.record : schema };
}

function graphemeLength(value: string): number {
  type Segmenter = new (
    locales?: string | readonly string[],
    options?: { granularity: "grapheme" },
  ) => { segment(input: string): Iterable<unknown> };
  const Segmenter = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;
  return Segmenter ? [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length : [...value].length;
}

function inspect(schema: any, value: unknown, nsid: string, path: string, issues: ValidationIssue[]): void {
  if (!schema) return;
  if (schema.type === "ref") {
    const target = resolveSchema(schema.ref, nsid);
    if (!target) issues.push({ path, message: "Unresolved ref " + schema.ref });
    else inspect(target.schema, value, target.nsid, path, issues);
    return;
  }
  if (schema.type === "union") {
    const valid = (schema.refs || []).some((ref: string) => {
      const target = resolveSchema(ref, nsid);
      if (!target) return false;
      const branch: ValidationIssue[] = [];
      inspect(target.schema, value, target.nsid, path, branch);
      return branch.length === 0;
    });
    if (!valid) issues.push({ path, message: "Value does not match any union member" });
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push({ path, message: "Expected object" });
      return;
    }
    const object = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (object[key] === undefined || object[key] === null) issues.push({ path: path + "." + key, message: "Required field is missing" });
    }
    for (const [key, property] of Object.entries<any>(schema.properties || {})) {
      if (object[key] !== undefined && object[key] !== null) inspect(property, object[key], nsid, path + "." + key, issues);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) issues.push({ path, message: "Expected array" });
    else {
      if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: "Expected at least " + schema.minLength + " items" });
      if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: "Expected at most " + schema.maxLength + " items" });
      value.forEach((item, index) => inspect(schema.items, item, nsid, path + "[" + index + "]", issues));
    }
    return;
  }
  const expected = schema.type === "integer" ? "number" : schema.type === "cid-link" || schema.type === "blob" || schema.type === "bytes" ? "object" : schema.type;
  if (expected && expected !== "unknown" && typeof value !== expected) issues.push({ path, message: "Expected " + expected });
  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) issues.push({ path, message: "Expected integer" });
    else {
      if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: "Expected value >= " + schema.minimum });
      if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: "Expected value <= " + schema.maximum });
    }
  }
  if (schema.type === "string" && typeof value === "string") {
    const byteLength = new TextEncoder().encode(value).length;
    const graphemes = graphemeLength(value);
    if (schema.minLength !== undefined && byteLength < schema.minLength) issues.push({ path, message: "Expected at least " + schema.minLength + " UTF-8 bytes" });
    if (schema.maxLength !== undefined && byteLength > schema.maxLength) issues.push({ path, message: "Expected at most " + schema.maxLength + " UTF-8 bytes" });
    if (schema.minGraphemes !== undefined && graphemes < schema.minGraphemes) issues.push({ path, message: "Expected at least " + schema.minGraphemes + " graphemes" });
    if (schema.maxGraphemes !== undefined && graphemes > schema.maxGraphemes) issues.push({ path, message: "Expected at most " + schema.maxGraphemes + " graphemes" });
    if (schema.const !== undefined && value !== schema.const) issues.push({ path, message: "Expected constant " + schema.const });
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) issues.push({ path, message: "Expected an enumerated value" });
    if (schema.format === "at-uri") {
      const parts = value.startsWith("at://") ? value.slice(5).split("/") : [];
      if (parts.length < 3 || parts.some((part: string) => !part)) issues.push({ path, message: "Expected AT URI" });
    }
    if (schema.format === "datetime" && !Number.isFinite(Date.parse(value))) issues.push({ path, message: "Expected datetime" });
    if (schema.format === "uri") {
      try { new URL(value); } catch { issues.push({ path, message: "Expected URI" }); }
    }
  }
}

export function validateRecord<T = unknown>(nsid: string, value: unknown): ValidationResult<T> {
  const main = SCHEMAS[nsid]?.defs?.main;
  if (!main || main.type !== "record") return { success: false, issues: [{ path: "$", message: "Unknown record NSID: " + nsid }] };
  const issues: ValidationIssue[] = [];
  inspect(main.record, value, nsid, "$", issues);
  return issues.length ? { success: false, issues } : { success: true, data: value as T };
}

export function assertRecord<T = unknown>(nsid: string, value: unknown): asserts value is T {
  const result = validateRecord<T>(nsid, value);
  if (!result.success) throw new TypeError(result.issues.map((issue) => issue.path + ": " + issue.message).join("; "));
}
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(
  OUTPUT,
  `${header}${renderTypes(lexicons)}\n\n${renderRecordTypeMap(records)}\n\n${runtime.trimStart()}`,
  "utf8",
);
const namespaces = `${header}export const NS = ${JSON.stringify(nsTree(records), null, 2)} as const;
export const RECORD_NSID_LIST = ${JSON.stringify(
  records.map((lexicon) => lexicon.id),
  null,
  2,
)} as const;
export const CATALOG_KINDS = Object.freeze(${JSON.stringify(writableCatalogKinds)});
export const ALL_CATALOG_KINDS = Object.freeze(Object.keys(NS.catalog));
export const INSTANCE_KINDS = Object.freeze(Object.keys(NS.instance));
`;
await writeFile(NAMESPACE_OUTPUT, namespaces, "utf8");
console.log(
  `Generated ${relative(ROOT, OUTPUT)} and ${relative(ROOT, NAMESPACE_OUTPUT)} from ${lexicons.length} lexicons (${records.length} records).`,
);
