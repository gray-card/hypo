#!/usr/bin/env node
// build-caption-idf.mjs — build src/data/caption-idf.json (BM25 document
// frequencies) from a large, permissively-licensed image-caption corpus.
//
// DEFAULT CORPUS: Conceptual Captions 12M (CC12M), a single url<TAB>caption TSV,
// license "may be freely used for any purpose" (AS-IS). ~12.4M captions.
// We ship ONLY aggregate integer document-frequency counts + N/avgdl (facts),
// never any caption text, so redistribution is clean.
//
// Usage:
//   node scripts/build-caption-idf.mjs                      # stream the default CC12M URL
//   node scripts/build-caption-idf.mjs --input path.tsv     # a local TSV (url<TAB>caption)
//   node scripts/build-caption-idf.mjs --input url.tsv.gz   # gzip is auto-detected
//   flags: --out <path> --top <N> --source <name> --license <text>
//
// Runs offline/CI; a multi-hour download budget is fine. Node built-ins only.
// IMPORTANT: tokenizes with the SAME tokenizer the app uses (imported from
// src/sceneSearch.js) so df keys align exactly with query tokens.

import { createWriteStream, createReadStream, existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeTokenizer, tokenize, STEMMER_VERSION, NORM_VERSION } from "../src/sceneSearch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const DEFAULTS = {
  input: "https://storage.googleapis.com/conceptual_12m/cc12m.tsv",
  out: resolve(ROOT, "src/data/caption-idf.json"),
  top: 40000,
  source: "CC12M",
  sourceUrl: "https://github.com/google-research-datasets/conceptual-12m",
  license: "Conceptual 12M — may be freely used for any purpose (AS-IS); source Google.",
};

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, ""); const v = argv[i + 1];
    if (k && v != null && k in o) o[k] = k === "top" ? Number(v) : v;
  }
  return o;
}

// A readable stream over the corpus (local file or https URL, gunzip if .gz).
async function openStream(input) {
  const gz = /\.gz$/i.test(input);
  let raw;
  if (/^https?:\/\//i.test(input)) {
    raw = await new Promise((res, rej) => {
      const req = https.get(input, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return openStream(r.headers.location).then(res, rej); }
        if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode} for ${input}`)); }
        res(r);
      });
      req.on("error", rej);
    });
  } else {
    if (!existsSync(input)) throw new Error(`input not found: ${input}`);
    raw = createReadStream(input);
  }
  return gz ? raw.pipe(createGunzip()) : raw;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.error(`[caption-idf] corpus=${opts.source} input=${opts.input}`);

  // Tokenize WITH the learned phrase model so df keys include phrase tokens and
  // align with the runtime index/query tokenizer. Degrade to the base tokenizer
  // (unigram+stem) with a warning if pass 1 hasn't produced a model yet.
  const modelPath = resolve(ROOT, "src/data/tokenizer-model.json");
  let model = null;
  try { model = JSON.parse(readFileSync(modelPath, "utf8")); } catch { model = null; }
  const tk = model?.phrases?.length ? makeTokenizer({ phrases: model.phrases }) : tokenize;
  if (model?.phrases?.length) console.error(`[caption-idf] phrase model: ${model.phrases.length} phrases (v${model.version})`);
  else console.error("[caption-idf] WARNING: no tokenizer-model.json phrases — building df with the BASE tokenizer (run build-tokenizer first).");

  const stream = await openStream(opts.input);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const df = new Map();
  let N = 0, totalTokens = 0;
  for await (const line of rl) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const caption = tab >= 0 ? line.slice(tab + 1) : line;   // url<TAB>caption; also tolerate caption-only
    const toks = tk(caption);   // tokenizer owns normalize/stem/filter/phrase-merge; no re-filter (would clip phrase tokens)
    if (!toks.length) continue;
    N += 1; totalTokens += toks.length;
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);   // document frequency (once per caption)
    if (N % 500000 === 0) console.error(`[caption-idf] ${N.toLocaleString()} captions, ${df.size.toLocaleString()} terms`);
  }
  if (!N) throw new Error("no captions parsed — check the input format (expected url<TAB>caption)");

  const kept = [...df.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.top);
  const dfFloor = kept.length ? kept[kept.length - 1][1] : 1;
  const table = {
    source: opts.source, sourceUrl: opts.sourceUrl, license: opts.license,
    builtFrom: `${N} captions`, N, avgdl: totalTokens / N, dfFloor,
    // Alignment tags so a stale asset (built by a different tokenizer/model) is
    // detectable; buildIdfLookup ignores these unknown fields.
    tokenizer: {
      stemmerVersion: model?.meta?.stemmerVersion || STEMMER_VERSION,
      normVersion: model?.meta?.normVersion || NORM_VERSION,
      phraseModelVersion: model?.version ?? null,
      phrasesCount: model?.phrases?.length || 0,
    },
    df: Object.fromEntries(kept),
  };
  await writeFile(opts.out, JSON.stringify(table));
  console.error(`[caption-idf] wrote ${opts.out}: N=${N.toLocaleString()}, kept ${kept.length.toLocaleString()} terms, dfFloor=${dfFloor}, avgdl=${table.avgdl.toFixed(2)}`);
}

main().catch((e) => { console.error("[caption-idf] FAILED:", e.message); process.exit(1); });
