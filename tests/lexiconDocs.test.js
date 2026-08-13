import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { generateLexiconDocs, mdxText } from "../scripts/generate-lexicon-docs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEXICON_ROOT = resolve(ROOT, "lexicons");
const REFERENCE_ROOT = resolve(ROOT, "docs/reference/lexicons");

async function filesWithExtension(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? filesWithExtension(path, extension) : entry.name.endsWith(extension) ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

async function sourceLexicons() {
  const files = await filesWithExtension(LEXICON_ROOT, ".json");
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
}

beforeAll(async () => {
  await generateLexiconDocs();
});

describe("generated lexicon documentation", () => {
  it("writes exactly one generated page for every source NSID", async () => {
    const lexicons = await sourceLexicons();
    const pages = await filesWithExtension(REFERENCE_ROOT, ".md");
    const pageNames = new Set(pages.map((page) => page.slice(REFERENCE_ROOT.length + 1)));

    expect(pages).toHaveLength(lexicons.length + 1);
    expect(pageNames).toContain("index.md");
    for (const lexicon of lexicons) {
      expect(pageNames).toContain(`${lexicon.id}.md`);
    }
  });

  it("renders resolved refs, inherited known values, fields, and constraints", async () => {
    const page = await readFile(resolve(REFERENCE_ROOT, "app.graycard.instance.exposure.md"), "utf8");

    expect(page).toContain("## Resolved references");
    expect(page).toContain("[`app.graycard.defs#meteringMode`](./app.graycard.defs.md#meteringmode) → `string`");
    expect(page).toMatch(/\|\s+`createdAt`\s+\|\s+yes\s+\|\s+`string` \(`datetime`\)\s+\|/);
    expect(page).toContain("`center-weighted`<br />`spot`");
    expect(page).toMatch(/\|\s+`provenance\.source`\s+\|\s+no\s+\|\s+`string`\s+\|/);
  });

  it("resolves every generated definition link to an existing anchor", async () => {
    const pages = await filesWithExtension(REFERENCE_ROOT, ".md");
    const contents = new Map(await Promise.all(pages.map(async (page) => [page, await readFile(page, "utf8")])));
    const linkPattern = /\]\((?:(\.\/[^)#]+\.md))?#([^)]+)\)/g;

    for (const [page, markdown] of contents) {
      for (const match of markdown.matchAll(linkPattern)) {
        const target = match[1] ? resolve(dirname(page), match[1]) : page;
        expect(contents.has(target), `${page} links to missing ${target}`).toBe(true);
        expect(contents.get(target), `${page} links to missing #${match[2]} in ${target}`).toContain(
          `<a id="${match[2]}"></a>`,
        );
      }
    }
  });

  it("escapes source prose that MDX would parse as markup or expressions", async () => {
    const batch = await readFile(resolve(REFERENCE_ROOT, "app.graycard.rule.batch.md"), "utf8");

    expect(mdxText("A <-> B and {{field.path}}, but `A <-> B` remains code")).toBe(
      "A &lt;-&gt; B and &#123;&#123;field.path&#125;&#125;, but `A <-> B` remains code",
    );
    expect(batch).toContain("&#123;&#123;field.path&#125;&#125;");
    expect(batch).not.toContain("{{field.path}}");
  });

  it("keeps generated output deterministic", async () => {
    const page = resolve(REFERENCE_ROOT, "app.graycard.defs.md");
    const before = await readFile(page, "utf8");
    await generateLexiconDocs();
    expect(await readFile(page, "utf8")).toBe(before);
  });
});

describe("Docusaurus site configuration", () => {
  it("serves the existing docs tree from /docs/ and wires the generated sidebar", async () => {
    const configUrl = `${pathToFileURL(resolve(ROOT, "docs/site/docusaurus.config.mjs")).href}?test=1`;
    const { default: config } = await import(configUrl);
    const classic = config.presets.find(([name]) => name === "classic")[1];
    const sidebars = await readFile(resolve(ROOT, "docs/site/sidebars.mjs"), "utf8");
    const generatedSidebar = await readFile(resolve(ROOT, "docs/site/generated/lexiconSidebar.mjs"), "utf8");

    expect(config.baseUrl).toBe("/docs/");
    expect(classic.docs.path).toBe(resolve(ROOT, "docs"));
    expect(classic.docs.routeBasePath).toBe("/");
    expect(classic.docs.exclude).toContain("site/**");
    expect(sidebars).toContain('from "./generated/lexiconSidebar.mjs"');
    expect(sidebars).toContain('id: "reference/lexicons/index"');
    expect(generatedSidebar).toContain('"reference/lexicons/app.graycard.instance.camera"');
  });
});
