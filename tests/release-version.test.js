import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const script = resolve("scripts/sync-release-version.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(
  changelog = "# Web\n\n## 1.11.1\n\n### Patch Changes\n\n- Fix session startup.\n\n## 1.11.0\n\n- Older change.\n",
) {
  const dir = mkdtempSync(join(tmpdir(), "hypo-release-"));
  dirs.push(dir);
  mkdirSync(join(dir, "apps/web"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "hypo", version: "1.11.0", private: true }));
  writeFileSync(join(dir, "apps/web/package.json"), JSON.stringify({ name: "@hypo/web", version: "1.11.1" }));
  writeFileSync(join(dir, "apps/web/CHANGELOG.md"), changelog);
  writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\nRelease history.\n\n## [1.11.0]\n\n- Keep older notes.\n");
  return dir;
}

it("synchronizes the root release and changelog without duplicating entries on reruns", () => {
  const cwd = fixture();
  execFileSync(process.execPath, [script], { cwd });
  expect(JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))).toEqual({
    name: "hypo",
    version: "1.11.1",
    private: true,
  });
  const notes = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
  expect(notes).toContain("## 1.11.1\n\n### Patch Changes\n\n- Fix session startup.");
  expect(notes).toContain("## [1.11.0]\n\n- Keep older notes.");
  expect(notes).not.toContain("Older change.");
  execFileSync(process.execPath, [script], { cwd });
  expect(readFileSync(join(cwd, "CHANGELOG.md"), "utf8")).toBe(notes);
});

it("refuses to update the root version when release notes are missing", () => {
  const cwd = fixture("# Web\n\n## 1.11.0\n\n- Old notes.\n");
  const original = readFileSync(join(cwd, "package.json"), "utf8");
  expect(() => execFileSync(process.execPath, [script], { cwd, stdio: "pipe" })).toThrow();
  expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(original);
});
