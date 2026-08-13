import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { Panproto } from "@panproto/core";

const PANPROTO_VERSION = "0.70.1";
const root = resolve(import.meta.dirname, "..");
const schemaBin = process.env.PANPROTO_SCHEMA_BIN || "schema";

function run(args, cwd = root) {
  const result = spawnSync(schemaBin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${schemaBin} ${args.join(" ")} exited ${result.status}\n${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function jsonFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

const version = run(["--version"]).trim();
if (version !== `schema ${PANPROTO_VERSION}`) {
  throw new Error(`expected schema ${PANPROTO_VERSION}, received ${JSON.stringify(version)}`);
}

const sandbox = mkdtempSync(join(tmpdir(), "hypo-panproto-"));
try {
  cpSync(join(root, "panproto.toml"), join(sandbox, "panproto.toml"));
  cpSync(join(root, "lexicons"), join(sandbox, "lexicons"), { recursive: true });
  cpSync(join(root, "fixtures"), join(sandbox, "fixtures"), { recursive: true });

  run(["init"], sandbox);
  const addOutput = run(["add", ".", "--data", "fixtures/records"], sandbox);
  if (!addOutput.includes("Staged 2 data file(s)")) {
    throw new Error(`Panproto did not report the two staged fixtures:\n${addOutput}`);
  }

  const index = JSON.parse(readFileSync(join(sandbox, ".panproto", "index.json"), "utf8"));
  const diagnostics = index.staged?.gat_diagnostics;
  if (index.staged?.validation !== "Valid" || !diagnostics) {
    throw new Error("the ATProto project was not staged with successful theory diagnostics");
  }
  const notes = diagnostics.equation_notes || [];
  if (notes.some((note) => note.includes("no protocol theory registered"))) {
    throw new Error(`ATProto equation checking was bypassed: ${notes.join("; ")}`);
  }
  if (index.staged_data?.length !== 2) {
    throw new Error(`expected 2 staged data sets, received ${index.staged_data?.length ?? 0}`);
  }

  run(["compat", ".", ".", "--protocol", "atproto", "--format", "json"], sandbox);
  const diffOutput = run(["diff", ".", ".", "--stat"], sandbox);
  if (!diffOutput.includes("Schemas are identical")) {
    throw new Error(`Panproto did not load the manifest-backed directories for schema diff:\n${diffOutput}`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

const lexiconPaths = jsonFiles(join(root, "lexicons"));
const documents = lexiconPaths.map((path) => JSON.parse(readFileSync(path, "utf8")));
const panproto = await Panproto.init();
const schema = panproto.parseSchemaBundle("atproto", documents);
const protocol = panproto.protocol("atproto");
const expectedConstraintSorts = ["format", "knownValues", "ref"];
for (const sort of expectedConstraintSorts) {
  if (!protocol.spec.constraintSorts.includes(sort)) {
    throw new Error(`the WASM ATProto protocol is missing constraint sort ${sort}`);
  }
}
const validation = schema.validate(protocol);
if (validation.issues.length !== 0) {
  throw new Error(`the parsed bundle failed SDK validation: ${JSON.stringify(validation.issues)}`);
}

const dataStatus = run(["status", "--data", "fixtures/records"]);
if (!dataStatus.includes("2 data set(s) tracked at HEAD")) {
  throw new Error(`the checked-in sidecar does not track the complete corpus:\n${dataStatus}`);
}

const chainDirectory = join(root, "lenses", "chains");
const chainPaths = existsSync(chainDirectory)
  ? jsonFiles(chainDirectory).map((path) => path.slice(root.length + 1))
  : [];
for (const chainPath of chainPaths) {
  run(["lens", "check", "--protocol", "atproto", chainPath, "lexicons"]);
}

console.log(
  `Panproto ${PANPROTO_VERSION}: ${documents.length} ${basename(join(root, "lexicons"))} documents, ` +
    `ATProto equations checked, 2 data fixtures tracked, bundle compat and diff loaded, ` +
    `${chainPaths.length} chains checked, ` +
    "SDK validation clean.",
);
