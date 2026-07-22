#!/usr/bin/env node
// build-catalog.mjs: regenerate the gear seed catalogs from the lensfun database.
//
//   node scripts/build-catalog.mjs            # parse the vendored local snapshot
//   node scripts/build-catalog.mjs --fetch    # pull the latest db from upstream
//   node scripts/build-catalog.mjs --wikidata # also resolve canonical QIDs + images
//
// Pipeline: lensfun (intermediate spec layer) -> parsed lens/camera specs ->
// optional best-effort Wikidata QID resolution (canonical identity layer) ->
// JSON in src/data/. Meant to run locally / in CI, NOT in the browser app.
//
// Sources & licenses:
//   - lensfun database (data/lensfun-db/*.xml): CC-BY-SA 3.0
//   - Wikidata (wbsearchentities): CC0
// See src/data/CATALOG_ATTRIBUTION.md and data/lensfun-db/NOTICE.md.

import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCatalog } from "./lensfun-parse.mjs";
import { fetchWikidataLenses, resolveMakerQid } from "./wikidata-lenses.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data");
const LOCAL_DB = join(ROOT, "data", "lensfun-db");
const CURATED_DIR = join(ROOT, "data", "curated-lenses");
const CURATED_CAM_DIR = join(ROOT, "data", "curated-cameras");
const CURATED_DEV_DIR = join(ROOT, "data", "curated-dev-times");
const CURATED_FILM_DIR = join(ROOT, "data", "curated-film-stocks");
const RAW = "https://raw.githubusercontent.com/lensfun/lensfun/master/data/db";
const API = "https://api.github.com/repos/lensfun/lensfun/contents/data/db";
const RESOLVE_WIKIDATA = process.argv.includes("--wikidata");
const FETCH_UPSTREAM = process.argv.includes("--fetch");

// -- source loading -----------------------------------------------------------

async function loadXmlSources() {
  if (!FETCH_UPSTREAM) {
    const files = readdirSync(LOCAL_DB).filter((f) => f.endsWith(".xml"));
    console.log(`parsing ${files.length} local db files from data/lensfun-db/`);
    return files.map((f) => readFileSync(join(LOCAL_DB, f), "utf8"));
  }
  let names = [];
  try {
    const r = await fetch(API, { headers: { "User-Agent": "graycard-build" } });
    if (r.ok) names = (await r.json()).filter((f) => f.name.endsWith(".xml")).map((f) => f.name);
  } catch { /* ignore */ }
  console.log(`fetching ${names.length} db files from upstream`);
  const out = [];
  for (const name of names) {
    try { out.push(await (await fetch(`${RAW}/${name}`)).text()); } catch { /* skip */ }
  }
  return out;
}

// -- wikidata (optional) ------------------------------------------------------

async function wikidataQid(label) {
  if (!RESOLVE_WIKIDATA) return null;
  try {
    const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(label)}&language=en&format=json&type=item&limit=1`;
    const j = await (await fetch(u, { headers: { "User-Agent": "graycard-build" } })).json();
    return j.search?.[0]?.id || null;
  } catch { return null; }
}
async function imageForQid(qid) {
  if (!qid) return null;
  try {
    const u = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json`;
    const j = await (await fetch(u, { headers: { "User-Agent": "graycard-build" } })).json();
    const file = j.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=320` : null;
  } catch { return null; }
}

// -- parse --------------------------------------------------------------------

const { lenses, cameras } = buildCatalog(await loadXmlSources());

if (RESOLVE_WIKIDATA) {
  for (const it of lenses) { it.wikidata = await wikidataQid(`${it.make} ${it.model}`); it.image = await imageForQid(it.wikidata); await new Promise((r) => setTimeout(r, 120)); }
  for (const it of cameras) { it.wikidata = await wikidataQid(`${it.make} ${it.model}`); it.image = await imageForQid(it.wikidata); await new Promise((r) => setTimeout(r, 120)); }
}

// -- curated lenses (non-lensfun; e.g. Nikon's manual-focus line) -------------
//
// `data/curated-lenses.jsonl` is the human/PR-editable source of lenses lensfun
// does not carry. It is loaded here (never packed into the app JS), deduped
// against lensfun so the same lens never appears twice, optionally enriched
// with a canonical Wikidata QID + image, and written to its own JSON file.

// dedupe key: the full model normalized (drops the family word + punctuation but
// keeps the era tokens AI / AI-S / AF etc., so pre-AI, AI and AI-S stay distinct).
// Matching on the whole model avoids cross-make / cross-era false positives.
const norm = (s) => String(s || "").toLowerCase().replace(/nikkor|nikon/g, "").replace(/[^a-z0-9]/g, "");

// load every data/curated-lenses/*.jsonl file (one per manufacturer), so a
// swarm of contributors can each own a file without merge conflicts.
function loadCurated() {
  if (!existsSync(CURATED_DIR)) return [];
  const out = [];
  for (const f of readdirSync(CURATED_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(CURATED_DIR, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => {
      try { out.push(JSON.parse(l)); }
      catch (e) { throw new Error(`${f}:${i + 1}: invalid JSON: ${e.message}`); }
    });
  }
  return out;
}

let curated = loadCurated();
if (curated.length) {
  // dedupe against lensfun (by normalized full model)
  const lfModels = new Set(lenses.map((l) => norm(l.model)));
  const before = curated.length;
  curated = curated.filter((e) => !lfModels.has(norm(e.model)));

  // enrich with canonical QID + image via the reusable Wikidata method
  if (RESOLVE_WIKIDATA) {
    const makers = [...new Set(curated.map((e) => e.make))];
    for (const make of makers) {
      const qid = await resolveMakerQid(make);
      if (!qid) continue;
      const wd = await fetchWikidataLenses(qid);
      const byName = new Map(wd.map((w) => [norm(w.model), w]));
      for (const e of curated) {
        if (e.make !== make) continue;
        const hit = byName.get(norm(e.model));       // exact normalized match only (safe)
        if (!hit) continue;
        if (!e.wikidata) e.wikidata = hit.wikidata;
        if (!e.image && hit.image) e.image = hit.image;
      }
    }
  }
  console.log(`curated: ${curated.length} kept (${before - curated.length} already in lensfun)`);
}

// -- curated cameras (non-lensfun; e.g. film bodies) --------------------------
// Same pattern as lenses: one data/curated-cameras/<maker>.jsonl per contributor.
const cameraNorm = (make, model) =>
  `${make} ${model}`.toLowerCase().replace(/\b(eos|mark|mk|lumix)\b/g, " ").replace(/[^a-z0-9]/g, "");

function loadCuratedCameras() {
  if (!existsSync(CURATED_CAM_DIR)) return [];
  const out = [];
  for (const f of readdirSync(CURATED_CAM_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(CURATED_CAM_DIR, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => {
      try { out.push(JSON.parse(l)); }
      catch (e) { throw new Error(`${f}:${i + 1}: invalid JSON: ${e.message}`); }
    });
  }
  return out;
}

let curatedCameras = loadCuratedCameras();
if (curatedCameras.length) {
  const lfCam = new Set(cameras.map((c) => cameraNorm(c.make, c.model)));
  const seen = new Set();
  const beforeC = curatedCameras.length;
  curatedCameras = curatedCameras.filter((c) => {
    const k = cameraNorm(c.make, c.model);
    if (lfCam.has(k) || seen.has(k)) return false;   // drop lensfun dupes + intra-curated dupes
    seen.add(k);
    return true;
  });
  console.log(`curated cameras: ${curatedCameras.length} kept (${beforeC - curatedCameras.length} dropped as lensfun/intra dupes)`);
}

// -- curated development recipes (from manufacturer datasheets) ---------------
// data/curated-dev-times/<maker>.jsonl holds development times transcribed from
// official manufacturer datasheets. Individual times are facts (not copyrightable);
// every recipe carries a `source` URL to the datasheet it came from. This is our
// own compilation built from primary specs — it does not copy any third-party chart.
function loadCuratedDevTimes() {
  if (!existsSync(CURATED_DEV_DIR)) return [];
  const out = [];
  for (const f of readdirSync(CURATED_DEV_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(CURATED_DEV_DIR, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => {
      let rec;
      try { rec = JSON.parse(l); }
      catch (e) { throw new Error(`${f}:${i + 1}: invalid JSON: ${e.message}`); }
      // minimal validation so a bad row fails the build loudly rather than silently
      for (const k of ["developerMake", "developerName", "filmMake", "filmName", "process", "temps", "source"]) {
        if (rec[k] == null) throw new Error(`${f}:${i + 1}: missing required field '${k}'`);
      }
      if (!Array.isArray(rec.temps) || !rec.temps.length) throw new Error(`${f}:${i + 1}: 'temps' must be a non-empty array`);
      for (const t of rec.temps) if (!Number.isInteger(t.tempC10) || !Number.isInteger(t.timeSec)) throw new Error(`${f}:${i + 1}: each temp needs integer tempC10 + timeSec`);
      out.push(rec);
    });
  }
  return out;
}
const devTimes = loadCuratedDevTimes();
if (devTimes.length) console.log(`curated dev recipes: ${devTimes.length} from ${readdirSync(CURATED_DEV_DIR).filter((f) => f.endsWith(".jsonl")).length} datasheet file(s)`);

// -- curated film stocks (from manufacturer datasheets) -----------------------
// data/curated-film-stocks/<maker>.jsonl holds film emulsion specs (formats, base,
// grain, ISO, spectral sensitivity, …) transcribed from official datasheets. Facts
// only; every record carries the `datasheetUrl` it was farmed from.
function loadCuratedFilmStocks() {
  if (!existsSync(CURATED_FILM_DIR)) return [];
  const out = [];
  for (const f of readdirSync(CURATED_FILM_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(CURATED_FILM_DIR, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => {
      let rec;
      try { rec = JSON.parse(l); }
      catch (e) { throw new Error(`${f}:${i + 1}: invalid JSON: ${e.message}`); }
      for (const k of ["brand", "name", "filmType", "process"]) {
        if (rec[k] == null) throw new Error(`${f}:${i + 1}: missing required field '${k}'`);
      }
      out.push(rec);
    });
  }
  return out;
}
const filmStocks = loadCuratedFilmStocks();
if (filmStocks.length) console.log(`curated film stocks: ${filmStocks.length} from ${readdirSync(CURATED_FILM_DIR).filter((f) => f.endsWith(".jsonl")).length} datasheet file(s)`);

const header = {
  _source: "lensfun (https://github.com/lensfun/lensfun), data/db, vendored in data/lensfun-db/",
  _license: "CC-BY-SA 3.0. See src/data/CATALOG_ATTRIBUTION.md and data/lensfun-db/NOTICE.md",
  _generated: new Date().toISOString(),
  _wikidata: RESOLVE_WIKIDATA
    ? "QIDs resolved best-effort via Wikidata wbsearchentities (CC0); review before trusting."
    : "run with --wikidata to resolve QIDs (the app also resolves images by name at runtime)",
};
const curatedHeader = {
  _source: "curated from Wikipedia article tables (e.g. 'Nikon F-mount') + Wikidata, authored in data/curated-lenses.jsonl",
  _license: "facts (names/specs) are not copyrightable; prose/images per Wikipedia CC-BY-SA 4.0 & Wikidata CC0. See src/data/CATALOG_ATTRIBUTION.md",
  _generated: new Date().toISOString(),
};
writeFileSync(join(OUT, "lensfun-lenses.json"), JSON.stringify({ ...header, lenses }, null, 2));
writeFileSync(join(OUT, "lensfun-cameras.json"), JSON.stringify({ ...header, cameras }, null, 2));
writeFileSync(join(OUT, "curated-lenses.json"), JSON.stringify({ ...curatedHeader, lenses: curated }, null, 2));
writeFileSync(join(OUT, "curated-cameras.json"), JSON.stringify({ ...curatedHeader, _source: "curated from Wikipedia + Wikidata, authored in data/curated-cameras/*.jsonl", cameras: curatedCameras }, null, 2));
const devHeader = {
  _source: "development times transcribed from official manufacturer datasheets, authored in data/curated-dev-times/*.jsonl; each recipe carries its own source URL",
  _license: "individual development times are non-copyrightable facts; this is our own compilation built from primary specs, not a copy of any third-party chart",
  _generated: new Date().toISOString(),
};
writeFileSync(join(OUT, "curated-dev-times.json"), JSON.stringify({ ...devHeader, recipes: devTimes }, null, 2));
const filmHeader = {
  _source: "film emulsion specs transcribed from official manufacturer datasheets, authored in data/curated-film-stocks/*.jsonl; each record carries its own datasheetUrl",
  _license: "individual specs are non-copyrightable facts; our own compilation built from primary datasheets",
  _generated: new Date().toISOString(),
};
writeFileSync(join(OUT, "curated-film-stocks.json"), JSON.stringify({ ...filmHeader, stocks: filmStocks }, null, 2));
console.log(`wrote ${lenses.length} lensfun lenses, ${cameras.length} cameras, ${curated.length} curated lenses, ${curatedCameras.length} curated cameras, ${devTimes.length} dev recipes, ${filmStocks.length} film stocks${RESOLVE_WIKIDATA ? " (+ Wikidata QIDs)" : ""}`);
