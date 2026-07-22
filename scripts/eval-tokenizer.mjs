#!/usr/bin/env node
// eval-tokenizer.mjs — offline, judgment-free comparison of the new tokenizer
// (normalize + S-stemmer-lite + learned phrases) against the old regex splitter.
// Prints coverage/calibration deltas and dumps the top phrases for spot-judging,
// and EXITS NON-ZERO on any hard-invariant failure so it doubles as a CI gate.
//
// Honest framing: this measures coverage, calibration, and required invariants,
// NOT proven relevance (there are no relevance labels). "OOV down" means better
// IDF calibration, not a proven ranking win.
//
// Usage:
//   node scripts/eval-tokenizer.mjs                       # built-in fixture corpus
//   node scripts/eval-tokenizer.mjs --input ~/Downloads/cc12m.tsv --sample 100000

import { createReadStream, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { norm, tokenize, makeTokenizer, buildTextIndex, bm25Search, PHRASE_JOINER } from "../src/sceneSearch.js";
import { buildIdfLookup } from "../src/data/captionIdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRATCH = "/private/tmp/claude-503/-Users-awhite48-Projects-grain-editor/82a2331a-d602-43bf-8987-782018dcb4a9/scratchpad";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

// The old tokenizer, reconstructed for a fair before/after (regex split, no stem).
const oldTok = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t && t.length <= 28 && !/^\d+$/.test(t));

const table = JSON.parse(readFileSync(resolve(ROOT, "src/data/caption-idf.json"), "utf8"));
let model = { phrases: [] };
try { model = JSON.parse(readFileSync(resolve(ROOT, "src/data/tokenizer-model.json"), "utf8")); } catch { /* placeholder */ }
const phraseTok = model?.phrases?.length ? makeTokenizer({ phrases: model.phrases }) : tokenize;

const FIXTURE = [
  "Two dogs playing near a hot air balloon at the beach",
  "a café au lait on a wooden table", "cities skyline at night with tall buildings",
  "a red double decker bus in london", "glasses of wine and a plate of cheese",
  "children riding bicycles in the park", "black and white photo of a cat",
  "a bunch of balloons at a birthday party", "the eiffel tower in paris france",
  "boxes of fresh vegetables at the market", "a person holding an umbrella in the rain",
];

async function loadCorpus() {
  const input = arg("--input");
  if (!input || !existsSync(input)) return FIXTURE;
  const cap = Number(arg("--sample", "100000"));
  const out = [];
  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of rl) { const t = line.indexOf("\t"); out.push(t >= 0 ? line.slice(t + 1) : line); if (out.length >= cap) break; }
  return out;
}

let failures = 0;
const check = (name, ok) => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`); if (!ok) failures += 1; };

async function main() {
  const corpus = await loadCorpus();
  console.log(`\n=== tokenizer eval over ${corpus.length.toLocaleString()} captions (phrases: ${model.phrases.length}) ===\n`);

  // Vocabulary + OOV (measured against the shipped, new-tokenizer df table).
  const df = table.df || {};
  const vOld = new Set(), vBase = new Set(), vPhrase = new Set();
  let phraseTokenOcc = 0, oovTypeMiss = 0, tokenOcc = 0, oovTokenMiss = 0;
  for (const cap of corpus) {
    for (const t of oldTok(cap)) vOld.add(t);
    for (const t of tokenize(cap)) vBase.add(t);
    for (const t of phraseTok(cap)) {
      vPhrase.add(t);
      tokenOcc += 1;
      if (t.includes(PHRASE_JOINER)) phraseTokenOcc += 1;
      if (!(t in df)) oovTokenMiss += 1;
    }
  }
  for (const t of vPhrase) if (!(t in df)) oovTypeMiss += 1;

  console.log("VOCAB");
  console.log(`  |V| old regex split:        ${vOld.size.toLocaleString()}`);
  console.log(`  |V| new base (stemmed):     ${vBase.size.toLocaleString()}  (stemming ${vBase.size <= vOld.size ? "reduced" : "grew"} types by ${Math.abs(vOld.size - vBase.size).toLocaleString()})`);
  console.log(`  |V| new with phrases:       ${vPhrase.size.toLocaleString()}`);
  console.log(`  phrase-token occurrences:   ${phraseTokenOcc.toLocaleString()} (${(100 * phraseTokenOcc / Math.max(1, tokenOcc)).toFixed(2)}% of tokens)`);
  console.log("\nOOV (new tokenizer vs shipped df table)");
  console.log(`  OOV_type:  ${(100 * oovTypeMiss / Math.max(1, vPhrase.size)).toFixed(2)}%`);
  console.log(`  OOV_token: ${(100 * oovTokenMiss / Math.max(1, tokenOcc)).toFixed(2)}%`);

  // IDF summary + monotonicity.
  const idf = buildIdfLookup(table);
  const dfEntries = Object.entries(df).sort((a, b) => b[1] - a[1]);
  const idfHi = idf(dfEntries[0][0]);                       // most common -> lowest idf
  const idfLo = idf(dfEntries[dfEntries.length - 1][0]);    // rarest kept -> highest idf
  console.log("\nIDF");
  console.log(`  N=${table.N.toLocaleString()} avgdl=${table.avgdl?.toFixed(2)} dfFloor=${table.dfFloor}`);
  console.log(`  idf(most common '${dfEntries[0][0]}')=${idfHi.toFixed(3)}  idf(rarest kept)=${idfLo.toFixed(3)}  idf(OOV)=${idf("zzznotaword").toFixed(3)}`);

  console.log("\nHARD INVARIANTS");
  check("df fixed point: every df key re-tokenizes to itself", Object.keys(df).every((k) => { const t = phraseTok(k); return t.length === 1 && t[0] === k; }));
  check("IDF monotonic (common < rare < OOV)", idfHi < idfLo && idfLo <= idf("zzznotaword"));
  // Probe A: plural query matches singular caption.
  { const ix = buildTextIndex([{ uri: "a", text: "a dog in a field" }]); check("A: 'dogs' query matches 'dog' caption (stemming)", (bm25Search(ix, tokenize("dogs")).get("a") || 0) > 0); }
  // Probe B: learned phrase concentrates (only meaningful with a real model).
  if (model.phrases.includes("hot_air_balloon")) {
    const docs = [{ uri: "d1", text: "a hot air balloon in the sky" }, { uri: "d2", text: "a cup of hot coffee" }, { uri: "d3", text: "an air conditioner" }, { uri: "d4", text: "a balloon animal" }];
    const ix = buildTextIndex(docs, phraseTok); const s = bm25Search(ix, phraseTok("hot air balloon"));
    check("B: 'hot air balloon' concentrates on the target doc", (s.get("d1") || 0) > 0 && ["d2", "d3", "d4"].every((d) => (s.get(d) || 0) === 0));
  } else console.log("  [skip] B: phrase model missing 'hot_air_balloon' (placeholder?)");
  // Probe C: diacritic-folded query.
  { const ix = buildTextIndex([{ uri: "c", text: "café au lait" }]); check("C: 'cafe' query retrieves 'café' caption", (bm25Search(ix, tokenize("cafe")).get("c") || 0) > 0); }

  // Dump top phrases for human spot-judging.
  if (model.phrases.length) {
    const top = model.phrases.slice(0, 60).map((p) => `${p.replace(new RegExp(PHRASE_JOINER, "g"), " ")}\t`).join("\n");
    const out = resolve(SCRATCH, "phrases-to-judge.tsv");
    try { writeFileSync(out, "phrase\ttrue_MWU(y/n)\n" + top + "\n"); console.log(`\nWrote top-60 phrases for spot-judging -> ${out}`); } catch { /* scratch not writable */ }
  }

  console.log(`\n=== ${failures ? failures + " HARD INVARIANT FAILURE(S)" : "all hard invariants passed"} ===`);
  console.log("NOTE: coverage/calibration diagnostics, not proven relevance.\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("eval failed:", e); process.exit(1); });
