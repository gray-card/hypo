#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const IOS_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const REPOSITORY_ROOT = resolve(IOS_ROOT, "../..");
const LEXICON_ROOT = resolve(REPOSITORY_ROOT, "lexicons");
const PACKAGE_ROOT = resolve(IOS_ROOT, "Packages/HypoLexicon");
const GENERATED_ROOT = resolve(PACKAGE_ROOT, "Sources/HypoLexicon/Generated");
const CHECK = process.argv.includes("--check");

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return children.flat().sort((left, right) => left.localeCompare(right));
}

function upperCamel(value) {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const rendered = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  return rendered.match(/^[0-9]/) ? `Value${rendered}` : rendered || "Value";
}

function lowerCamel(value) {
  const rendered = upperCamel(value);
  return rendered[0].toLowerCase() + rendered.slice(1);
}

function swiftTypeName(nsid, definition) {
  return upperCamel(`${nsid}#${definition}`);
}

const SWIFT_KEYWORDS = new Set([
  "associatedtype",
  "as",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "defer",
  "deinit",
  "do",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "inout",
  "internal",
  "is",
  "let",
  "nil",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "repeat",
  "rethrows",
  "return",
  "self",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "typealias",
  "var",
  "where",
  "while",
]);

function swiftPropertyName(value) {
  if (value === "$type") return "recordType";
  let rendered = lowerCamel(value).replace(/[^A-Za-z0-9_]/g, "");
  if (/^[0-9]/.test(rendered)) rendered = `_${rendered}`;
  return SWIFT_KEYWORDS.has(rendered) ? `\`${rendered}\`` : rendered;
}

function unescapedIdentifier(value) {
  return value.replaceAll("`", "");
}

function swiftString(value) {
  return JSON.stringify(value)
    .replaceAll("\\/", "/")
    .replaceAll("\\u2028", "\\u{2028}")
    .replaceAll("\\u2029", "\\u{2029}");
}

function canonicalReference(reference, currentNsid) {
  if (reference.startsWith("#")) return [currentNsid, reference.slice(1)];
  const [nsid, definition = "main"] = reference.split("#");
  return [nsid, definition];
}

function collectReferences(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((child) => collectReferences(child, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeof value.ref === "string") output.add(value.ref);
  if (Array.isArray(value.refs)) value.refs.forEach((reference) => output.add(reference));
  Object.values(value).forEach((child) => collectReferences(child, output));
  return output;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

const files = await jsonFiles(LEXICON_ROOT);
const sources = await Promise.all(
  files.map(async (path) => {
    const data = await readFile(path);
    return { path, data, schema: JSON.parse(data.toString("utf8")) };
  }),
);
sources.sort((left, right) => left.schema.id.localeCompare(right.schema.id));

const schemas = Object.fromEntries(sources.map(({ schema }) => [schema.id, schema]));
for (const { schema } of sources) {
  for (const reference of collectReferences(schema)) {
    const [nsid, definition] = canonicalReference(reference, schema.id);
    if (!schemas[nsid]?.defs?.[definition]) {
      throw new Error(`Unresolved lexicon reference ${nsid}#${definition} from ${schema.id}`);
    }
  }
}

const declarations = new Map();
const pending = [];

function register(name, schema, nsid, recordNsid = null) {
  if (!declarations.has(name)) {
    declarations.set(name, null);
    pending.push({ name, schema, nsid, recordNsid });
  }
  return name;
}

function typeFor(schema, nsid, contextName) {
  if (!schema || typeof schema !== "object") return "JSONValue";
  switch (schema.type) {
    case "string":
      if (schema.knownValues?.length) return register(contextName, schema, nsid);
      if (schema.format === "at-uri") return "ATURI";
      if (schema.format === "datetime") return "ATProtoDate";
      return "String";
    case "integer":
      return "Int";
    case "boolean":
      return "Bool";
    case "bytes":
      return "Data";
    case "blob":
      return "LexiconBlobRef";
    case "ref": {
      const [targetNsid, definition] = canonicalReference(schema.ref, nsid);
      return swiftTypeName(targetNsid, definition);
    }
    case "union":
    case "unknown":
      return "JSONValue";
    case "array":
      return `[${typeFor(schema.items, nsid, `${contextName}Item`)}]`;
    case "object":
      return register(contextName, schema, nsid);
    default:
      return "JSONValue";
  }
}

function staticKnownValueName(value, used) {
  let name = lowerCamel(value);
  if (SWIFT_KEYWORDS.has(name)) name = `${name}Value`;
  if (!/^[A-Za-z_]/.test(name)) name = `value${upperCamel(name)}`;
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${name}${suffix++}`;
  used.add(candidate);
  return candidate;
}

function renderKnownValue(name, schema) {
  const used = new Set();
  const constants = schema.knownValues.map(
    (value) => `    public static let ${staticKnownValueName(value, used)} = Self(${swiftString(value)})`,
  );
  return `
/// An open AT Protocol known-value string. Unknown values remain decodable for forward compatibility.
public struct ${name}: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String

    public init(_ rawValue: String) {
        self.rawValue = rawValue
    }

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        rawValue = try container.decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

${constants.join("\n")}
}`;
}

function renderObject(name, schema, nsid, recordNsid) {
  const required = new Set(schema.required ?? []);
  const sourceProperties = Object.entries(schema.properties ?? {});
  if (recordNsid) {
    sourceProperties.push(["$type", { type: "string" }]);
  }
  const properties = sourceProperties.map(([wireName, propertySchema]) => {
    const propertyName = swiftPropertyName(wireName);
    const isRequired = required.has(wireName);
    const baseType = typeFor(
      propertySchema,
      nsid,
      `${name}${upperCamel(wireName === "$type" ? "recordType" : wireName)}`,
    );
    return {
      wireName,
      propertyName,
      plainName: unescapedIdentifier(propertyName),
      type: `${baseType}${isRequired ? "" : "?"}`,
      required: isRequired,
      defaultValue: wireName === "$type" ? swiftString(recordNsid) : "nil",
    };
  });
  const ordered = [
    ...properties.filter((property) => property.required),
    ...properties.filter((property) => !property.required),
  ];
  const stored = properties.map((property) => `    public var ${property.propertyName}: ${property.type}`);
  const parameters = ordered.map((property) => {
    if (property.required) return `        ${property.propertyName}: ${property.type}`;
    return `        ${property.propertyName}: ${property.type} = ${property.defaultValue}`;
  });
  const assignments = ordered.map((property) => `        self.${property.propertyName} = ${property.propertyName}`);
  const needsCodingKeys = properties.some((property) => property.plainName !== property.wireName);
  const codingKeys = needsCodingKeys
    ? `

    private enum CodingKeys: String, CodingKey {
${properties
  .map((property) => {
    if (property.plainName === property.wireName) return `        case ${property.propertyName}`;
    return `        case ${property.propertyName} = ${swiftString(property.wireName)}`;
  })
  .join("\n")}
    }`
    : "";
  return `
public struct ${name}: Codable, Hashable, Sendable {
${stored.join("\n")}

    public init(
${parameters.join(",\n")}
    ) {
${assignments.join("\n")}
    }${codingKeys}
}`;
}

function renderDeclaration({ name, schema, nsid, recordNsid }) {
  const effectiveSchema = schema.type === "record" ? schema.record : schema;
  if (effectiveSchema.type === "string" && effectiveSchema.knownValues?.length) {
    return renderKnownValue(name, effectiveSchema);
  }
  if (effectiveSchema.type === "object") {
    return renderObject(name, effectiveSchema, nsid, recordNsid);
  }
  return `\npublic typealias ${name} = ${typeFor(effectiveSchema, nsid, `${name}Value`)}`;
}

for (const { schema } of sources) {
  for (const [definition, value] of Object.entries(schema.defs ?? {})) {
    register(swiftTypeName(schema.id, definition), value, schema.id, value.type === "record" ? schema.id : null);
  }
}

while (pending.length) {
  const descriptor = pending.shift();
  declarations.set(descriptor.name, renderDeclaration(descriptor));
}

const records = sources.filter(({ schema }) => schema.defs?.main?.type === "record");
const recordMembers = records.map(({ schema }) => {
  const suffix = schema.id.split(".").slice(2).join("-");
  return `    public static let ${lowerCamel(suffix)} = try! NSID(${swiftString(schema.id)})`;
});
const recordList = records.map(({ schema }) => `        ${lowerCamel(schema.id.split(".").slice(2).join("-"))}`);

const sourceManifest = {
  format: 1,
  schemaTag: "lexicons-v1",
  source: "lexicons/",
  files: Object.fromEntries(
    sources
      .map(({ path, data }) => [relative(REPOSITORY_ROOT, path).replaceAll("\\", "/"), sha256(data)])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
};
const manifestText = `${JSON.stringify(sourceManifest, null, 2)}\n`;
const schemaText = `${JSON.stringify(schemas, null, 2)}\n`;
const schemaDigest = sha256(schemaText);

const header = `// Generated by apps/ios/Scripts/generate-hypo-lexicon-swift.mjs.
// Source: lexicons/**/*.json. Do not edit by hand.
// swiftlint:disable all

import Foundation
`;
const modelsText = `${header}
${[...declarations.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, declaration]) => declaration)
  .join("\n")}
`;
const namespacesText = `${header}
/// Generated collection identifiers for every writable or readable Gray Card record.
public enum GeneratedRecordNSID {
${recordMembers.join("\n")}

    public static let all: [NSID] = [
${recordList.join(",\n")}
    ]
}

/// Reproducibility metadata for the generated record layer.
public enum GeneratedLexiconMetadata {
    public static let schemaCount = ${sources.length}
    public static let recordCount = ${records.length}
    public static let sourceSHA256 = ${swiftString(schemaDigest)}
}
`;

async function formattedSwift(filename, contents) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "hypo-lexicon-generation-"));
  const path = join(temporaryDirectory, filename);
  try {
    await writeFile(path, contents);
    const result = spawnSync(
      "swift",
      ["format", "format", "--in-place", "--configuration", resolve(IOS_ROOT, ".swift-format"), path],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `swift format failed for ${filename}`);
    }
    return await readFile(path, "utf8");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const outputs = new Map([
  [
    resolve(GENERATED_ROOT, "LexiconModels.generated.swift"),
    await formattedSwift("LexiconModels.generated.swift", modelsText),
  ],
  [
    resolve(GENERATED_ROOT, "LexiconNamespaces.generated.swift"),
    await formattedSwift("LexiconNamespaces.generated.swift", namespacesText),
  ],
  [resolve(GENERATED_ROOT, "LexiconSchemas.json"), schemaText],
  [resolve(GENERATED_ROOT, "LexiconSourceManifest.json"), manifestText],
]);

let drift = false;
for (const [path, expected] of outputs) {
  if (CHECK) {
    const actual = await readFile(path, "utf8").catch(() => null);
    if (actual !== expected) {
      console.error(`Generated HypoLexicon artifact is stale: ${relative(REPOSITORY_ROOT, path)}`);
      drift = true;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, expected);
    console.log(`Generated ${relative(REPOSITORY_ROOT, path)}`);
  }
}

if (drift) {
  console.error(`Run ${relative(REPOSITORY_ROOT, fileURLToPath(import.meta.url))} and commit the result.`);
  process.exitCode = 1;
} else if (CHECK) {
  console.log(`HypoLexicon generated artifacts match ${sources.length} source lexicons.`);
}
