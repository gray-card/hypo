import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/data/presets.js";

const load = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const jsonl = (path) => existsSync(resolve(path))
  ? readFileSync(resolve(path), "utf8").split("\n").map((line) => line.trim()).filter(Boolean).map(JSON.parse)
  : [];

const lexicons = {
  cameraType: load("lexicons/app/graycard/catalog/cameraType.json"),
  lensType: load("lexicons/app/graycard/catalog/lensType.json"),
  filmStock: load("lexicons/app/graycard/catalog/filmStock.json"),
  developerType: load("lexicons/app/graycard/catalog/developerType.json"),
  chemistryType: load("lexicons/app/graycard/catalog/chemistryType.json"),
  devRecipe: load("lexicons/app/graycard/catalog/devRecipe.json"),
};
const defs = load("lexicons/app/graycard/defs.json");
const properties = (kind) => lexicons[kind].defs.main.record.properties;
const propertyNames = (kind) => new Set(Object.keys(properties(kind)));

const generated = {
  cameraType: [...load("src/data/curated-cameras.json").cameras, ...load("src/data/lensfun-cameras.json").cameras],
  lensType: [...load("src/data/curated-lenses.json").lenses, ...load("src/data/lensfun-lenses.json").lenses],
  filmStock: load("src/data/curated-film-stocks.json").stocks,
  developerType: jsonl("data/datasheets/developers.jsonl"),
  chemistryType: jsonl("data/datasheets/chemistries.jsonl"),
  devRecipe: load("src/data/curated-dev-times.json").recipes,
};

const SEED_ONLY = {
  cameraType: new Set(["datasheetUrl", "exifModel", "image", "source", "wikidata"]),
  lensType: new Set(["datasheetUrl", "image", "source", "wikidata"]),
  filmStock: new Set(["image", "productUrl", "resolvingPower"]),
  developerType: new Set(),
  chemistryType: new Set(),
  devRecipe: new Set(),
};

function resolveRef(ref, localLexicon) {
  if (ref.startsWith("#")) return localLexicon.defs[ref.slice(1)] || defs.defs[ref.slice(1)];
  const [ns, name] = ref.split("#");
  if (ns === "app.graycard.defs") return defs.defs[name];
  if (ns === "app.graycard.catalog.devRecipe") return lexicons.devRecipe.defs[name];
  throw new Error(`Unresolved lexicon ref ${ref}`);
}

function validate(value, schema, localLexicon, path) {
  if (value == null) return;
  if (!schema) throw new Error(`${path}: unresolved schema`);
  if (schema.type === "ref") return validate(value, resolveRef(schema.ref, localLexicon), localLexicon, path);
  if (schema.type === "string") {
    expect(typeof value, path).toBe("string");
    if (schema.maxLength != null) expect(value.length, path).toBeLessThanOrEqual(schema.maxLength);
    if (schema.format === "uri") expect(() => new URL(value), path).not.toThrow();
    if (schema.format === "at-uri") expect(value, path).toMatch(/^at:\/\//);
    if (schema.format === "datetime") expect(Number.isNaN(Date.parse(value)), path).toBe(false);
    return;
  }
  if (schema.type === "integer") {
    expect(Number.isInteger(value), path).toBe(true);
    if (schema.minimum != null) expect(value, path).toBeGreaterThanOrEqual(schema.minimum);
    if (schema.maximum != null) expect(value, path).toBeLessThanOrEqual(schema.maximum);
    return;
  }
  if (schema.type === "boolean") return expect(typeof value, path).toBe("boolean");
  if (schema.type === "blob") return;
  if (schema.type === "array") {
    expect(Array.isArray(value), path).toBe(true);
    if (schema.maxLength != null) expect(value.length, path).toBeLessThanOrEqual(schema.maxLength);
    value.forEach((item, i) => validate(item, schema.items, localLexicon, `${path}[${i}]`));
    return;
  }
  if (schema.type === "object") {
    expect(value && typeof value === "object" && !Array.isArray(value), path).toBe(true);
    for (const key of schema.required || []) expect(value[key], `${path}.${key}`).not.toBeUndefined();
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const [key, nested] of Object.entries(value)) {
      expect(allowed.has(key), `${path}.${key} is not schema-native`).toBe(true);
      if (allowed.has(key)) validate(nested, schema.properties[key], localLexicon, `${path}.${key}`);
    }
  }
}

function atprotoPayload(kind, record) {
  const schema = propertyNames(kind);
  const out = Object.fromEntries(Object.entries(record).filter(([key, value]) =>
    schema.has(key) && value != null && !(key === "image" && typeof value === "string")));
  // Lensfun/curated seed identity values are display units because the normal
  // form accepts millimetres and f-numbers; catalog creation scales them.
  if (kind === "lensType") {
    for (const key of ["focalLengthMin", "focalLengthMax", "maxAperture", "maxApertureAtTele", "minAperture"]) {
      if (typeof out[key] === "number") out[key] = Math.round(out[key] * 1_000_000);
    }
    if (Array.isArray(out.apertureSteps)) out.apertureSteps = out.apertureSteps.map((value) => Math.round(value * 1_000_000));
  }
  if (kind === "cameraType" && typeof out.cropFactor === "number" && Math.abs(out.cropFactor) < 1000) {
    out.cropFactor = Math.round(out.cropFactor * 1_000_000);
  }
  if (lexicons[kind].defs.main.record.required?.includes("createdAt") && !out.createdAt) {
    out.createdAt = "2026-07-23T00:00:00.000Z";
  }
  return out;
}

function walkUrls(value, path = "record", out = []) {
  if (Array.isArray(value)) value.forEach((item, i) => walkUrls(item, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const next = `${path}.${key}`;
      if ((key === "url" || key === "datasheetUrl" || key === "source" || key === "productUrl") && typeof nested === "string" && /^https?:/.test(nested)) {
        out.push([next, nested]);
      }
      walkUrls(nested, next, out);
    }
  }
  return out;
}

function assertProvenance(kind, record, label) {
  const schema = propertyNames(kind);
  const sources = record.specSources || [];
  for (const [i, source] of sources.entries()) {
    for (const field of source.fields || []) {
      expect(schema.has(field), `${label}.specSources[${i}] references unknown '${field}'`).toBe(true);
      expect(record[field], `${label}.specSources[${i}] references absent '${field}'`).not.toBeUndefined();
    }
    expect(source.document?.asset?.url, `${label}.specSources[${i}] document URL`).toMatch(/^https:\/\//);
  }
}

describe("catalog technical data is schema-native", () => {
  it("retains the expected manufacturer-sourced coverage", () => {
    const sourced = Object.fromEntries(Object.entries(generated).map(([kind, records]) => [
      kind,
      records.filter((record) => record.specSources?.length).length,
    ]));
    expect(sourced.cameraType).toBeGreaterThanOrEqual(5);
    expect(sourced.lensType).toBeGreaterThanOrEqual(26);
    expect(sourced.filmStock).toBe(103);
    expect(sourced.developerType).toBe(24);
    expect(sourced.chemistryType).toBe(13);
    expect(sourced.devRecipe).toBe(993);
  });

  for (const kind of Object.keys(generated)) {
    it(`${kind}: validates ${generated[kind].length} records against its lexicon`, () => {
      const schema = propertyNames(kind);
      generated[kind].forEach((record, i) => {
        const label = `${kind}[${i}]`;
        for (const key of Object.keys(record)) {
          expect(schema.has(key) || SEED_ONLY[kind].has(key), `${label}.${key} is neither schema-native nor declared seed metadata`).toBe(true);
        }
        validate(atprotoPayload(kind, record), lexicons[kind].defs.main.record, lexicons[kind], label);
        assertProvenance(kind, record, label);
        for (const [urlPath, url] of walkUrls(record, label)) {
          expect(url, urlPath).toMatch(/^https:\/\//);
          expect(() => new URL(url), urlPath).not.toThrow();
        }
      });
    });
  }
});

describe("datasheet enrichment contracts", () => {
  for (const [fileKind, kind, identity] of [
    ["cameras", "cameraType", (r) => `${r.make}\0${r.model}`.toLowerCase()],
    ["lenses", "lensType", (r) => `${r.make}\0${r.model}`.toLowerCase()],
  ]) {
    const rows = jsonl(`data/datasheets/${fileKind}.jsonl`);
    it(`${fileKind}: ${rows.length} verifiedFields sets land unchanged in generated records`, () => {
      const schema = propertyNames(kind);
      const byIdentity = new Map(generated[kind].map((record) => [identity(record), record]));
      rows.forEach((row, i) => {
        expect(row.datasheetUrl, `${fileKind}[${i}].datasheetUrl`).toMatch(/^https:\/\//);
        expect(new Set(row.verifiedFields || []).size, `${fileKind}[${i}] duplicate verifiedFields`).toBe((row.verifiedFields || []).length);
        const record = byIdentity.get(identity(row));
        expect(record, `${fileKind}[${i}] did not match a generated record`).toBeTruthy();
        for (const field of row.verifiedFields || []) {
          expect(schema.has(field), `${fileKind}[${i}] unknown verified field '${field}'`).toBe(true);
          expect(row[field], `${fileKind}[${i}] missing verified value '${field}'`).not.toBeUndefined();
          expect(record?.[field], `${fileKind}[${i}] generated '${field}'`).toEqual(row[field]);
        }
        const source = record?.specSources?.find((item) => item.document?.asset?.url === row.datasheetUrl);
        if (row.verifiedFields?.length) expect(source?.fields, `${fileKind}[${i}] generated specSource`).toEqual(row.verifiedFields);
        expect(record?.documents?.some((doc) => doc.asset?.url === row.datasheetUrl), `${fileKind}[${i}] generated document`).toBe(true);
      });
    });
  }
});

describe("preset round trips", () => {
  for (const [kind, makeKey, primaryKey] of [
    ["cameraType", "make", "model"],
    ["lensType", "make", "model"],
    ["filmStock", "brand", "name"],
    ["developerType", "brand", "name"],
    ["chemistryType", "brand", "name"],
  ]) {
    it(`${kind}: datasheet-backed fields remain available to catalog creation`, () => {
      const presetItems = PRESETS[kind].items;
      const schema = propertyNames(kind);
      const records = generated[kind].filter((record) =>
        record.documents?.length || record.technicalDocuments?.length || record.sdsDocuments?.length || record.datasheetUrl);
      expect(records.length, `${kind} has representative sourced records`).toBeGreaterThan(0);
      for (const record of records) {
        const preset = presetItems.find((item) => item[makeKey] === record[makeKey] && item[primaryKey] === record[primaryKey]);
        expect(preset, `${kind} preset ${record[makeKey]} ${record[primaryKey]}`).toBeTruthy();
        if (!preset) continue;
        for (const key of Object.keys(record).filter((field) => schema.has(field) && record[field] != null)) {
          expect(preset[key], `${kind} preset lost '${key}' for ${record[primaryKey]}`).toEqual(record[key]);
        }
      }
    });
  }
});
