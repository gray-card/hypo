import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Panproto } from "@panproto/core";
import { format, resolveConfig } from "prettier";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "fixtures/panproto-conformance/manifest.json");
const oraclePath = resolve(root, "fixtures/panproto-conformance/oracle.json");
const write = process.argv.includes("--write");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedVersion = "0.70.1";

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

async function canonicalJson(value) {
  const configuration = (await resolveConfig(oraclePath)) ?? {};
  return format(JSON.stringify(canonical(value)), { ...configuration, parser: "json" });
}

function sha256(path) {
  return createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex");
}

if (manifest.formatVersion !== 1) {
  throw new Error(`unsupported Panproto conformance manifest version ${manifest.formatVersion}`);
}
if (manifest.panprotoVersion !== expectedVersion) {
  throw new Error(`expected Panproto corpus ${expectedVersion}, received ${JSON.stringify(manifest.panprotoVersion)}`);
}

const packageVersion = JSON.parse(
  readFileSync(resolve(root, "node_modules/@panproto/core/package.json"), "utf8"),
).version;
if (packageVersion !== expectedVersion) {
  throw new Error(`expected @panproto/core ${expectedVersion}, received ${packageVersion}`);
}

const panproto = await Panproto.init();
const results = [];
const versionedResults = [];
try {
  for (const testCase of manifest.cases) {
    const record = readJson(testCase.record);
    const lexicon = readJson(testCase.lexicon);
    const schema = panproto.parseLexicon(lexicon);
    const validation = schema.validate(panproto.protocol("atproto"));
    if (validation.issues.length !== 0) {
      throw new Error(`${testCase.id}: invalid lexicon: ${JSON.stringify(validation.issues)}`);
    }

    const parsed = panproto.parseJson(schema, JSON.stringify(record));
    const recordValidation = parsed.validate();
    if (!recordValidation.isValid) {
      throw new Error(`${testCase.id}: invalid record: ${JSON.stringify(recordValidation.errors)}`);
    }
    const emitted = JSON.parse(new TextDecoder().decode(panproto.toJson(schema, parsed)));

    const result = {
      id: testCase.id,
      inputSha256: sha256(testCase.record),
      lexiconSha256: sha256(testCase.lexicon),
      validated: canonical(emitted),
    };
    if (!testCase.identityRecord) {
      result.identityLimitation = testCase.identityLimitation;
      results.push(result);
      schema[Symbol.dispose]();
      continue;
    }

    const identityRecord = readJson(testCase.identityRecord);

    let migration = panproto.migration(schema, schema);
    for (const vertex of Object.keys(schema.vertices)) migration = migration.map(vertex, vertex);
    for (const edge of schema.edges) migration = migration.mapEdge(edge, edge);
    const compiled = migration.compile();
    try {
      const lifted = compiled.liftJson(identityRecord, testCase.rootVertex);
      const projection = compiled.getJson(identityRecord, testCase.rootVertex);
      const restored = compiled.putJson(projection.view, projection.complement, testCase.rootVertex);
      results.push({
        ...result,
        identityInputSha256: sha256(testCase.identityRecord),
        lift: canonical(lifted),
        get: canonical(projection.view),
        put: canonical(restored),
      });
    } finally {
      compiled[Symbol.dispose]();
      schema[Symbol.dispose]();
    }
  }

  for (const testCase of manifest.versionedCases ?? []) {
    const record = readJson(testCase.record);
    const sourceLexicon = readJson(testCase.sourceLexicon);
    const targetLexicon = readJson(testCase.targetLexicon);
    const sourceSchema = panproto.parseLexicon(sourceLexicon);
    const targetSchema = panproto.parseLexicon(targetLexicon);
    const protocol = panproto.protocol("atproto");
    const sourceValidation = sourceSchema.validate(protocol);
    const targetValidation = targetSchema.validate(protocol);
    if (sourceValidation.issues.length !== 0 || targetValidation.issues.length !== 0) {
      throw new Error(
        `${testCase.id}: invalid version endpoint: ${JSON.stringify({ source: sourceValidation.issues, target: targetValidation.issues })}`,
      );
    }

    const sourceRecord = panproto.parseJson(sourceSchema, JSON.stringify(record));
    const recordValidation = sourceRecord.validate();
    if (!recordValidation.isValid) {
      throw new Error(`${testCase.id}: invalid source record: ${JSON.stringify(recordValidation.errors)}`);
    }

    const chain = panproto.compileLensDocument(
      {
        id: testCase.id,
        source: "v1.2.0",
        target: "v1.3.0",
        steps: [],
      },
      testCase.rootVertex,
    );
    const migration = chain.instantiate(sourceSchema);
    try {
      const projection = migration.getJson(record, testCase.rootVertex);
      const lifted = projection.view;
      const restored = migration.putJson(projection.view, projection.complement, testCase.rootVertex);
      const targetRecord = panproto.parseJson(targetSchema, JSON.stringify(lifted));
      const liftedValidation = targetRecord.validate();
      if (!liftedValidation.isValid) {
        throw new Error(`${testCase.id}: migration output violates target: ${JSON.stringify(liftedValidation.errors)}`);
      }
      versionedResults.push({
        id: testCase.id,
        inputSha256: sha256(testCase.record),
        sourceLexiconSha256: sha256(testCase.sourceLexicon),
        targetLexiconSha256: sha256(testCase.targetLexicon),
        lift: canonical(lifted),
        get: canonical(projection.view),
        put: canonical(restored),
      });
    } finally {
      migration[Symbol.dispose]();
      chain[Symbol.dispose]();
      sourceSchema[Symbol.dispose]();
      targetSchema[Symbol.dispose]();
    }
  }
} finally {
  panproto[Symbol.dispose]();
}

const generated = await canonicalJson({
  formatVersion: manifest.formatVersion,
  panprotoVersion: manifest.panprotoVersion,
  cases: results,
  versionedCases: versionedResults,
});

if (write) {
  writeFileSync(oraclePath, generated);
  console.log(`Wrote ${oraclePath}`);
} else {
  const checkedIn = readFileSync(oraclePath, "utf8");
  if (checkedIn !== generated) {
    throw new Error("Panproto conformance oracle is stale; run npm run generate:panproto-conformance");
  }
  console.log(
    `Panproto ${expectedVersion}: ${results.length} current records and ${versionedResults.length} release transition match the TypeScript lift/get/put oracle.`,
  );
}
