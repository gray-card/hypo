#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOTS = ["curated-cameras", "curated-dev-times", "curated-film-stocks", "curated-lenses"];

function visit(value, key, found, source) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, key, found, source));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    if (
      (key === "documents" || key === "specSources" || childKey === "documents" || childKey === "specSources") &&
      typeof child === "string"
    ) {
      if (/^https?:\/\//i.test(child)) found.push({ url: child, source });
    }
    if (typeof child === "string" && /^(url|sourceUrl|documentUrl)$/i.test(childKey) && /^https?:\/\//i.test(child)) {
      found.push({ url: child, source });
    } else {
      visit(child, childKey, found, source);
    }
  }
}

export function extractCatalogLinks(record, source = "record") {
  const found = [];
  visit(record, "", found, source);
  return [...new Map(found.map((item) => [item.url, item])).values()];
}

async function loadJsonlLinks(root = ROOT) {
  const links = [];
  for (const directory of DATA_ROOTS) {
    const base = join(root, "data", directory);
    for (const file of (await readdir(base)).filter((name) => extname(name) === ".jsonl").sort()) {
      const path = join(base, file);
      const lines = (await readFile(path, "utf8")).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || line.startsWith("#")) continue;
        links.push(...extractCatalogLinks(JSON.parse(line), `${directory}/${file}:${index + 1}`));
      }
    }
  }
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

export async function checkLink({ url, source }, fetchImpl = fetch, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "hypo-catalog-link-check/1" },
    });
    if (response.status === 403 || response.status === 405) {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { range: "bytes=0-0", "user-agent": "hypo-catalog-link-check/1" },
      });
    }
    return { url, source, ok: response.ok, status: response.status };
  } catch (error) {
    return { url, source, ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkCatalogLinks(options = {}) {
  const links = options.links ?? (await loadJsonlLinks(options.root));
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < links.length) {
      const link = links[cursor];
      cursor += 1;
      results.push(await checkLink(link, options.fetchImpl, options.timeoutMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
  return results.sort((a, b) => a.url.localeCompare(b.url));
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const results = await checkCatalogLinks();
  const failures = results.filter((result) => !result.ok);
  console.log(`Checked ${results.length} catalog links; ${failures.length} need review.`);
  for (const result of failures) {
    console.log(
      `- ${result.status || "ERR"} ${result.url} (${result.source})${result.error ? ` — ${result.error}` : ""}`,
    );
  }
  if (process.argv.includes("--strict") && failures.length) process.exitCode = 1;
}
