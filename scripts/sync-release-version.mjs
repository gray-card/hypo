import { readFile, writeFile } from "node:fs/promises";

const root = JSON.parse(await readFile("package.json", "utf8"));
const web = JSON.parse(await readFile("apps/web/package.json", "utf8"));

if (root.version !== web.version) {
  const webChangelog = await readFile("apps/web/CHANGELOG.md", "utf8");
  const entry = webChangelog.split(/^## /m).find((section) => section.split("\n")[0].trim() === web.version);
  if (!entry) throw new Error(`Missing @hypo/web changelog entry for ${web.version}`);
  const changelog = await readFile("CHANGELOG.md", "utf8");
  const firstEntry = changelog.search(/^## /m);
  const split = firstEntry < 0 ? changelog.length : firstEntry;
  const nextChangelog = `${changelog.slice(0, split).trimEnd()}\n\n## ${entry.trim()}\n\n${changelog.slice(split)}`;
  root.version = web.version;
  await writeFile("CHANGELOG.md", nextChangelog);
  await writeFile("package.json", `${JSON.stringify(root, null, 2)}\n`);
}
