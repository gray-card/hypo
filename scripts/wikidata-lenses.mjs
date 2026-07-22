#!/usr/bin/env node
// wikidata-lenses.mjs: fetch a manufacturer's lenses from Wikidata (CC0).
//
//   node scripts/wikidata-lenses.mjs Nikon
//   node scripts/wikidata-lenses.mjs --qid Q1218180
//   node scripts/wikidata-lenses.mjs Canon --out data/wikidata-canon.json
//
// This is the reusable "search Wikidata for a maker's lenses" method. Nikon's
// classic manual-focus line is largely absent from Wikidata (it lives in the
// curated JSONL instead), but modern autofocus and mirrorless lenses are well
// covered here, complete with a canonical QID and a P18 default image. Point it
// at any manufacturer to seed that maker's catalog.
//
// Wikidata models individual lenses as instance-of/subclass-of either
// "camera lens" (Q192234) or "lens model" (Q109672300), with manufacturer
// (P176) pointing at the corporate entity or its brand. We union both.

const SPARQL = "https://query.wikidata.org/sparql";
const API = "https://www.wikidata.org/w/api.php";
const UA = "graycard-build/1.0 (https://graycard.app)";

// resolve a maker name to the most likely company QID.
export async function resolveMakerQid(name) {
  const u = `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&type=item&limit=5`;
  const j = await (await fetch(u, { headers: { "User-Agent": UA } })).json();
  // prefer a hit whose description mentions a company / manufacturer
  const hit = (j.search || []).find((s) => /company|corporation|manufacturer|brand/i.test(s.description || ""))
           || (j.search || [])[0];
  return hit?.id || null;
}

// pull every lens item for a maker: label, QID, image, and focal length(s).
export async function fetchWikidataLenses(makerQid) {
  const query = `
    SELECT DISTINCT ?item ?itemLabel ?image (GROUP_CONCAT(DISTINCT ?fl; separator=",") AS ?focals) WHERE {
      ?item wdt:P176 wd:${makerQid} .
      ?item wdt:P31/wdt:P279* ?cls .
      VALUES ?cls { wd:Q192234 wd:Q109672300 }
      OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?item wdt:P2151 ?fl . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?item rdfs:label ?itemLabel. }
    }
    GROUP BY ?item ?itemLabel ?image
    LIMIT 5000`;
  const u = `${SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const j = await (await fetch(u, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } })).json();
  const rows = [];
  for (const b of j.results?.bindings || []) {
    const label = b.itemLabel?.value;
    if (!label || /^Q\d+$/.test(label)) continue; // skip unlabelled items
    const focals = (b.focals?.value || "").split(",").map(Number).filter((n) => n > 0).sort((a, z) => a - z);
    rows.push({
      wikidata: b.item.value.split("/").pop(),
      model: label,
      image: b.image?.value || null,
      focalLengthMin: focals.length ? focals[0] : null,
      focalLengthMax: focals.length ? focals[focals.length - 1] : null,
    });
  }
  return rows;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  const qidIdx = args.indexOf("--qid");
  let qid = qidIdx >= 0 ? args[qidIdx + 1] : null;
  const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--qid");

  if (!qid && name) qid = await resolveMakerQid(name);
  if (!qid) {
    console.error("usage: wikidata-lenses.mjs <MakerName> | --qid Q123 [--out file.json]");
    process.exit(1);
  }
  console.error(`fetching lenses for maker ${qid}${name ? ` (${name})` : ""} ...`);
  const rows = await fetchWikidataLenses(qid);
  console.error(`found ${rows.length} lenses, ${rows.filter((r) => r.image).length} with an image`);
  const text = JSON.stringify(rows, null, 2);
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, text);
    console.error(`wrote ${out}`);
  } else {
    process.stdout.write(text + "\n");
  }
}
