import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const schemaBin = process.env.PANPROTO_SCHEMA_BIN || "schema";
const baseRef = process.env.PANPROTO_BASE_REF;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function latestReleaseBaseline(ref) {
  const tags = run("git", ["tag", "--merged", ref, "--list", "v[1-9]*", "--sort=-version:refname"], {
    allowFailure: true,
  });
  if (tags.status !== 0) return null;
  return tags.stdout
    .split("\n")
    .map((tag) => tag.trim())
    .find(Boolean);
}

const releaseBaseline = baseRef ? latestReleaseBaseline(baseRef) : null;

if (!baseRef || !releaseBaseline) {
  console.log(
    "Panproto PR compatibility: no v1+ release tag is reachable from the base ref; the integration gate remains authoritative.",
  );
  process.exit(0);
}

const mergeBase = run("git", ["merge-base", baseRef, "HEAD"]).stdout.trim();
if (!mergeBase) throw new Error(`No merge base exists for ${baseRef}`);

const sandbox = mkdtempSync(join(tmpdir(), "hypo-panproto-base-"));
try {
  const archive = run("git", ["archive", mergeBase, "lexicons"], { encoding: null }).stdout;
  run("tar", ["-x", "-C", sandbox], { input: archive });
  const compat = run(
    schemaBin,
    ["compat", join(sandbox, "lexicons"), "lexicons", "--protocol", "atproto", "--format", "json"],
    { allowFailure: true },
  );
  if (compat.status === 0) {
    console.log(
      `Panproto PR compatibility: ${JSON.parse(compat.stdout).classification} against merge base ${mergeBase} (release baseline ${releaseBaseline}).`,
    );
  } else if (compat.status !== 1) {
    throw new Error(`schema compat failed to load the merge-base suite:\n${compat.stdout}${compat.stderr}`);
  } else {
    const messages = run("git", ["log", "--format=%B", `${mergeBase}..HEAD`]).stdout;
    if (!messages.includes("[breaking-change-acknowledged]")) {
      throw new Error("Breaking schema changes require [breaking-change-acknowledged] in a commit message");
    }

    const manifestPath = join(root, "lenses", "breaking-change.json");
    if (!existsSync(manifestPath)) {
      throw new Error("Acknowledged breaking changes require lenses/breaking-change.json in the same PR");
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const transitions = Array.isArray(manifest.transitions) ? manifest.transitions : [];
    if (!transitions.length) throw new Error("lenses/breaking-change.json must declare at least one transition");

    for (const transition of transitions) {
      for (const field of ["source", "target", "mapping", "chain", "data"]) {
        if (typeof transition[field] !== "string" || !existsSync(join(root, transition[field]))) {
          throw new Error(`Breaking-change transition has no readable ${field} path`);
        }
      }
      run(schemaBin, [
        "check",
        "--src",
        transition.source,
        "--tgt",
        transition.target,
        "--mapping",
        transition.mapping,
        "--typecheck",
      ]);
      run(schemaBin, ["lens", "check", "--protocol", "atproto", transition.chain, "lexicons"]);
      run(schemaBin, ["lens", "verify", "--protocol", "atproto", transition.data, transition.target]);
    }
    run(schemaBin, ["data", "migrate", "--coverage", "--dry-run", "fixtures/records"]);
    console.log(`Panproto PR compatibility: acknowledged break verified against merge base ${mergeBase}.`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
