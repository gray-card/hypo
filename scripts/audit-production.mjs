import { spawnSync } from "node:child_process";

const EXCEPTIONS = new Map([
  [
    "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5",
    {
      package: "zod",
      expires: "2026-11-30",
      reason: "ATProto's supported runtime still requires Zod 3; see .github/SECURITY_EXCEPTIONS.md",
    },
  ],
]);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["audit", "--omit=dev", "--audit-level=low", "--json"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) {
  console.error(`Production dependency audit could not run: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("Production dependency audit did not return valid JSON.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities || {};
if (!Object.keys(vulnerabilities).length) {
  console.log("Production dependency audit reports no known vulnerabilities.");
  process.exit(0);
}

function advisoryRoots(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return [{ package: name, url: null }];
  return (vulnerability.via || []).flatMap((via) =>
    typeof via === "string"
      ? advisoryRoots(via, new Set(seen))
      : [{ package: via.dependency || via.name || name, url: via.url || null }],
  );
}

const today = new Date();
const failures = [];
const accepted = new Map();
for (const name of Object.keys(vulnerabilities)) {
  const roots = advisoryRoots(name);
  if (!roots.length) failures.push(`${name}: no root advisory was reported`);
  for (const root of roots) {
    const exception = root.url ? EXCEPTIONS.get(root.url) : null;
    if (!exception) {
      failures.push(`${name}: ${root.url || `unresolved advisory through ${root.package}`}`);
      continue;
    }
    if (exception.package !== root.package) {
      failures.push(`${name}: ${root.url} was reported for unexpected package ${root.package}`);
      continue;
    }
    const expiresAt = new Date(`${exception.expires}T23:59:59.999Z`);
    if (!Number.isFinite(expiresAt.valueOf()) || today > expiresAt) {
      failures.push(`${name}: exception for ${root.url} expired ${exception.expires}`);
      continue;
    }
    accepted.set(root.url, exception);
  }
}

if (failures.length) {
  console.error("Production dependency audit found findings without an active exception:");
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.warn("Production dependency audit passed with temporary, documented exceptions:");
for (const [url, exception] of accepted) {
  console.warn(`- ${exception.package}: ${url} (expires ${exception.expires})`);
  console.warn(`  ${exception.reason}`);
}
