#!/usr/bin/env node
// build-tokenizer.mjs — PASS 1 of the tokenizer build. Learn a multiword-phrase
// list from a large, permissively-licensed image-caption corpus and write
// src/data/tokenizer-model.json. Pass 2 (build-caption-idf.mjs) then rebuilds the
// df table using this model so df keys, indexed doc tokens, and query tokens align.
//
// DEFAULT CORPUS: Conceptual Captions 12M (CC12M), a url<TAB>caption TSV, license
// "may be freely used for any purpose" (AS-IS). We ship ONLY the learned phrase
// strings (stemmed token sequences joined by "_") plus aggregate counts — never
// any caption text — so redistribution is clean.
//
// METHOD: NPMI (Bouma 2009) collocation scoring with a min-count floor and a
// boundary-stopword rule; trigrams via Mikolov merge-and-rescore over accepted
// bigrams; ranked by corpus occurrence count (a DF proxy), capped for a small asset.
//
// Usage:
//   node scripts/build-tokenizer.mjs --input ~/Downloads/cc12m.tsv
//   flags: --out --min2 50 --min3 30 --npmi 0.5 --maxlen 4 --top 40000 --cap 50000
//
// Runs offline/CI; a multi-hour budget is fine. Node built-ins only. IMPORTANT:
// imports the SAME base tokenizer the runtime uses, so phrases are counted over
// the identical (normalize+stem) token space and can never drift from production.

import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokenize, stem, PHRASE_JOINER, STEMMER_VERSION, NORM_VERSION } from "../src/sceneSearch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const DEFAULTS = {
  input: "https://storage.googleapis.com/conceptual_12m/cc12m.tsv",
  out: resolve(ROOT, "src/data/tokenizer-model.json"),
  min2: 50, min3: 30, npmi: 0.5, maxlen: 4, top: 40000, cap: 50000,
  source: "CC12M",
  sourceUrl: "https://github.com/google-research-datasets/conceptual-12m",
};

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  const nums = new Set(["min2", "min3", "npmi", "maxlen", "top", "cap"]);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, ""); const v = argv[i + 1];
    if (k && v != null && k in o) o[k] = nums.has(k) ? Number(v) : v;
  }
  return o;
}

// Redirect-following read stream over a local file or https URL (gunzip if .gz).
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

const captionOf = (line) => { const t = line.indexOf("\t"); return t >= 0 ? line.slice(t + 1) : line; };

// Boundary function words (build-side only; stored STEMMED so they compare
// against the stemmed tokens tokenize() emits). Interior stopwords are allowed
// ("black and white", "point of view"); only phrase BOUNDARIES are gated. NPMI
// already suppresses stopword pairs — this is the hard structural guard.
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each",
  "few", "for", "from", "further", "get", "got", "had", "has", "have", "having", "he", "her",
  "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "itself", "just", "may", "me", "might", "more", "most", "must", "my", "myself",
  "no", "nor", "not", "now", "of", "off", "on", "once", "one", "only", "or", "other", "our",
  "ours", "ourselves", "out", "over", "own", "per", "same", "shall", "she", "should", "so",
  "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "upon", "us", "very", "via", "was", "we", "were", "what", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself", "yourselves",
].map(stem));

// Web / stock-photo / file-format boilerplate. A phrase is rejected if ANY of
// its component tokens is one of these — they are caption-template noise
// ("royalty free stock photo", "image may contain", "vector illustration"),
// never visual concepts, and they dominate CC12M by raw frequency.
const BOILERPLATE = new Set([
  "stock", "royalty", "illustration", "vector", "clipart", "image", "photo", "photograph",
  "photography", "picture", "wallpaper", "png", "jpg", "jpeg", "gif", "svg", "eps", "psd",
  "hd", "uhd", "download", "downloadable", "printable", "watermark", "thumbnail", "dpi", "pixel",
].map(stem));

const isDigit = (t) => /^\d+$/.test(t);
const badBoundary = (t) => STOPWORDS.has(t) || isDigit(t);
const badPhraseToken = (t) => BOILERPLATE.has(t);

// Sharded bigram counter: a single V8 Map caps at 2^24 (~16.7M) entries, so
// spread ~56M unique bigrams across shards for exact counts (no lossy pruning).
const NSHARDS = 16;
const B = Array.from({ length: NSHARDS }, () => new Map());
const shardOf = (key) => { let h = 0; for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0; return (h & 0x7fffffff) % NSHARDS; };
const bump2 = (key) => { const m = B[shardOf(key)]; m.set(key, (m.get(key) || 0) + 1); };
const get2 = (key) => B[shardOf(key)].get(key) || 0;

const KEY = (...toks) => toks.join("\t");

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.error(`[tokenizer] corpus=${opts.source} input=${opts.input}`);
  console.error(`[tokenizer] gates: min2=${opts.min2} min3=${opts.min3} npmi>=${opts.npmi} maxlen=${opts.maxlen} top=${opts.top} cap=${opts.cap}`);

  // ---- Stream 1: unigrams + bigrams (sharded) + scalar totals N1/Nb/Nt --------
  const c1 = new Map();
  let N1 = 0, Nb = 0, Nt = 0, N = 0;
  {
    const rl = createInterface({ input: await openStream(opts.input), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const toks = tokenize(captionOf(line));
      if (!toks.length) continue;
      N += 1; N1 += toks.length;
      if (toks.length >= 2) Nb += toks.length - 1;
      if (toks.length >= 3) Nt += toks.length - 2;
      for (let i = 0; i < toks.length; i++) {
        c1.set(toks[i], (c1.get(toks[i]) || 0) + 1);
        if (i + 1 < toks.length) bump2(KEY(toks[i], toks[i + 1]));
      }
      if (N % 1000000 === 0) console.error(`[tokenizer] pass1 ${N.toLocaleString()} captions, ${c1.size.toLocaleString()} unigrams, ${B.reduce((a, m) => a + m.size, 0).toLocaleString()} bigrams`);
    }
  }
  if (!N) throw new Error("no captions parsed — check input format (url<TAB>caption)");
  console.error(`[tokenizer] pass1 done: N=${N.toLocaleString()} N1=${N1.toLocaleString()} Nb=${Nb.toLocaleString()} Nt=${Nt.toLocaleString()}`);

  // NPMI(a,b) = log2( p(ab)/(p(a)p(b)) ) / ( -log2 p(ab) ), bounded [-1,1].
  const npmi2 = (cab, ca, cb) => {
    const pab = cab / Nb, pa = ca / N1, pb = cb / N1;
    return Math.log2(pab / (pa * pb)) / -Math.log2(pab);
  };

  // ---- Accept bigrams ---------------------------------------------------------
  const accepted = new Map();   // "a\tb" -> occurrence count (the phrase list so far)
  const acceptedBi = new Set(); // "a\tb" that passed, for the trigram extension test
  for (const shard of B) {
    for (const [key, cab] of shard) {
      if (cab < opts.min2) continue;
      const [a, b] = key.split("\t");
      if (badBoundary(a) || badBoundary(b)) continue;
      if (badPhraseToken(a) || badPhraseToken(b)) continue;   // drop stock-photo/format boilerplate
      if (npmi2(cab, c1.get(a) || 1, c1.get(b) || 1) < opts.npmi) continue;
      accepted.set(key, cab);
      acceptedBi.add(key);
    }
  }
  console.error(`[tokenizer] accepted ${acceptedBi.size.toLocaleString()} bigrams`);

  // ---- Stream 2: trigrams that EXTEND an accepted bigram (bounded, one map) ----
  if (opts.maxlen >= 3 && acceptedBi.size) {
    const c3 = new Map();
    let N2 = 0;
    const rl = createInterface({ input: await openStream(opts.input), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const toks = tokenize(captionOf(line));
      if (toks.length < 3) continue;
      N2 += 1;
      for (let i = 0; i + 2 < toks.length; i++) {
        const a = toks[i], b = toks[i + 1], c = toks[i + 2];
        const ext = acceptedBi.has(KEY(a, b)) || acceptedBi.has(KEY(b, c));   // extends an accepted bigram
        const skip = STOPWORDS.has(b) && !badBoundary(a) && !badBoundary(c) && !badPhraseToken(a) && !badPhraseToken(c);   // "black and white", "point of view"
        if (ext || skip) c3.set(KEY(a, b, c), (c3.get(KEY(a, b, c)) || 0) + 1);
      }
      if (N2 % 2000000 === 0) console.error(`[tokenizer] pass2 ${N2.toLocaleString()} captions, ${c3.size.toLocaleString()} candidate trigrams`);
    }
    let acc3 = 0;
    for (const [key, cabc] of c3) {
      if (cabc < opts.min3) continue;
      const [a, b, c] = key.split("\t");
      if (badBoundary(a) || badBoundary(c)) continue;   // real boundary tokens must be content words
      if (badPhraseToken(a) || badPhraseToken(b) || badPhraseToken(c)) continue;   // no boilerplate anywhere
      const pJoint = cabc / Nt;
      let score;
      if (acceptedBi.has(KEY(a, b)) || acceptedBi.has(KEY(b, c))) {
        // Extension NPMI: treat the accepted adjacent bigram as an atomic unit U.
        const [pU, pOther] = acceptedBi.has(KEY(a, b))
          ? [get2(KEY(a, b)) / Nb, (c1.get(c) || 1) / N1]
          : [get2(KEY(b, c)) / Nb, (c1.get(a) || 1) / N1];
        score = Math.log2(pJoint / (pU * pOther)) / -Math.log2(pJoint);
      } else if (STOPWORDS.has(b)) {
        // Interior-stopword skip-gram: association of the two content boundaries.
        score = Math.log2(pJoint / (((c1.get(a) || 1) / N1) * ((c1.get(c) || 1) / N1))) / -Math.log2(pJoint);
      } else continue;
      if (score >= opts.npmi) { accepted.set(key, cabc); acc3 += 1; }
    }
    console.error(`[tokenizer] accepted ${acc3.toLocaleString()} trigrams`);
  }

  // ---- Rank by occurrence count (DF proxy), cap, emit -------------------------
  const ranked = [...accepted.entries()]
    .sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))   // count DESC, lexicographic tiebreak (deterministic)
    .slice(0, Math.min(opts.top, opts.cap));
  const phrases = ranked.map(([key]) => key.split("\t").join(PHRASE_JOINER));
  const bi = phrases.filter((p) => p.split(PHRASE_JOINER).length === 2).length;
  const achievedMax = phrases.reduce((m, p) => Math.max(m, p.split(PHRASE_JOINER).length), 0);

  const model = {
    version: 1,
    phrases,
    meta: {
      source: opts.source, sourceUrl: opts.sourceUrl, builtFrom: `${N} captions`,
      N1, Nb, Nt,
      params: { minCount2: opts.min2, minCount3: opts.min3, npmi: opts.npmi, maxPhraseLen: achievedMax, requestedMaxLen: opts.maxlen, top: opts.top, cap: opts.cap },
      stemmerVersion: STEMMER_VERSION, normVersion: NORM_VERSION,
      counts: { phrases: phrases.length, bi, tri: phrases.length - bi },
    },
  };
  await writeFile(opts.out, JSON.stringify(model));
  console.error(`[tokenizer] wrote ${opts.out}: ${phrases.length.toLocaleString()} phrases (${bi.toLocaleString()} bi, ${(phrases.length - bi).toLocaleString()} tri+)`);
  console.error(`[tokenizer] sample: ${phrases.slice(0, 12).join(", ")}`);
}

main().catch((e) => { console.error("[tokenizer] FAILED:", e.message); process.exit(1); });
