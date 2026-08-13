import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NS, SCHEMAS, validateRecord } from "../packages/lexicon/src/index.ts";

const ROOT = process.cwd();
const CREATED_AT = "2026-08-11T00:00:00.000Z";

function rowsIn(relativeDirectory) {
  const directory = join(ROOT, relativeDirectory);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .map((line, index) => ({ file: `${relativeDirectory}/${name}`, line: index + 1, text: line.trim() }))
        .filter(({ text }) => text)
        .map(({ file, line, text }) => ({ file, line, value: JSON.parse(text) })),
    );
}

function rowsInFile(relativeFile) {
  return readFileSync(join(ROOT, relativeFile), "utf8")
    .split("\n")
    .map((line, index) => ({ file: relativeFile, line: index + 1, text: line.trim() }))
    .filter(({ text }) => text)
    .map(({ file, line, text }) => ({ file, line, value: JSON.parse(text) }));
}

function recordProperties(nsid) {
  return SCHEMAS[nsid].defs.main.record.properties;
}

function chemistrySource(source, sourceKind) {
  if (sourceKind === "developer") {
    const roles =
      source.process === "monobath"
        ? ["film-developer", "fixer"]
        : source.form !== "kit"
          ? ["film-developer"]
          : source.process === "e6"
            ? ["first-developer", "color-developer", "bleach", "fixer", "stabilizer"]
            : source.process === "c41"
              ? ["color-developer", "bleach", "fixer", "stabilizer"]
              : source.process === "ecn2"
                ? ["color-developer", "bleach", "fixer"]
                : ["film-developer"];
    return { ...source, roles, productKind: source.form === "kit" ? "process-kit" : "single-chemical" };
  }
  const roles =
    source.role === "blix"
      ? ["bleach", "fixer"]
      : source.role === "monobath"
        ? ["film-developer", "fixer"]
        : source.role === "developer"
          ? ["film-developer"]
          : source.role === "other" && source.name === "Hypo Clearing Agent"
            ? ["clearing-agent"]
            : [source.role];
  const { role: _role, ...record } = source;
  return {
    ...record,
    roles,
    productKind: source.form === "kit" ? "multi-part-chemical" : "single-chemical",
    specSources: source.specSources?.map((entry) => ({
      ...entry,
      fields: entry.fields?.map((field) => (field === "role" ? "roles" : field)),
    })),
  };
}

function projectSourceRow(nsid, source, seedOnly = new Set()) {
  const properties = recordProperties(nsid);
  for (const key of Object.keys(source)) {
    expect(
      key in properties || seedOnly.has(key),
      `${nsid}: source field '${key}' is neither schema-native nor declared pipeline metadata`,
    ).toBe(true);
  }
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => key in properties && value != null && !(key === "image" && typeof value === "string"),
    ),
  );
}

function normalizeRecord(nsid, source, seedOnly) {
  const record = projectSourceRow(nsid, source, seedOnly);
  if (nsid === NS.catalog.lensType) {
    for (const key of ["focalLengthMin", "focalLengthMax", "maxAperture", "maxApertureAtTele", "minAperture"]) {
      if (typeof record[key] === "number") record[key] = Math.round(record[key] * 1_000_000);
    }
    if (Array.isArray(record.apertureSteps)) {
      record.apertureSteps = record.apertureSteps.map((value) => Math.round(value * 1_000_000));
    }
  }
  if (nsid === NS.catalog.cameraType && typeof record.cropFactor === "number" && Math.abs(record.cropFactor) < 1_000) {
    record.cropFactor = Math.round(record.cropFactor * 1_000_000);
  }
  if (SCHEMAS[nsid].defs.main.record.required?.includes("createdAt")) record.createdAt ||= CREATED_AT;
  return record;
}

function expectValidSource(row, nsid, options = {}) {
  const source = options.sourceKind ? chemistrySource(row.value, options.sourceKind) : row.value;
  const record = normalizeRecord(nsid, source, options.seedOnly);
  const result = validateRecord(nsid, record);
  expect(
    result,
    `${row.file}:${row.line}\n${result.success ? "" : JSON.stringify(result.issues, null, 2)}`,
  ).toMatchObject({
    success: true,
  });
}

const SOURCE_GROUPS = [
  {
    directory: "data/curated-cameras",
    nsid: NS.catalog.cameraType,
    seedOnly: new Set(["datasheetUrl", "exifModel", "image", "source", "wikidata"]),
  },
  {
    directory: "data/curated-lenses",
    nsid: NS.catalog.lensType,
    seedOnly: new Set(["datasheetUrl", "image", "source", "wikidata"]),
  },
  {
    directory: "data/curated-film-stocks",
    nsid: NS.catalog.filmStock,
    seedOnly: new Set(["image", "productUrl", "resolvingPower"]),
  },
  { directory: "data/curated-dev-times", nsid: NS.catalog.devRecipe, seedOnly: new Set() },
];

describe("raw catalog JSONL conforms to generated lexicon validators", () => {
  for (const group of SOURCE_GROUPS) {
    const rows = rowsIn(group.directory);
    it(`${group.directory} validates all ${rows.length} rows before aggregation`, () => {
      for (const row of rows) expectValidSource(row, group.nsid, group);
    });
  }

  for (const [file, sourceKind] of [
    ["data/datasheets/developers.jsonl", "developer"],
    ["data/datasheets/chemistries.jsonl", "chemistry"],
  ]) {
    const rows = rowsInFile(file);
    it(`${file} validates all ${rows.length} rows`, () => {
      for (const row of rows) expectValidSource(row, NS.catalog.chemistryType, { sourceKind });
    });
  }

  const lensOverlays = rowsInFile("data/datasheets/lenses.jsonl");
  it(`data/datasheets/lenses.jsonl validates ${lensOverlays.length} schema-field overlays`, () => {
    for (const row of lensOverlays) {
      const schemaFields = new Set(Object.keys(recordProperties(NS.catalog.lensType)));
      for (const field of row.value.verifiedFields || []) {
        expect(schemaFields.has(field), `${row.file}:${row.line} unknown verified field '${field}'`).toBe(true);
      }
      expectValidSource(
        {
          ...row,
          value: Object.fromEntries(
            Object.entries(row.value).filter(
              ([key]) => schemaFields.has(key) || ["datasheetUrl", "verifiedFields"].includes(key),
            ),
          ),
        },
        NS.catalog.lensType,
        { seedOnly: new Set(["datasheetUrl", "verifiedFields"]) },
      );
    }
  });
});
