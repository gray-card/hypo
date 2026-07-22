import { describe, it, expect } from "vitest";
import {
  normalizeString, stem, tokenize, makeTokenizer, buildTextIndex, bm25Search, PHRASE_JOINER,
} from "../src/sceneSearch.js";
import { buildIdfLookup } from "../src/data/captionIdf.js";
import captionIdfTable from "../src/data/caption-idf.json";
import phraseModel from "../src/data/tokenizer-model.json";

describe("normalizeString + base tokenize", () => {
  it("is idempotent at the string level", () => {
    const s = "Café  con LECHE!! — hot-air balloon's";
    expect(normalizeString(normalizeString(s))).toBe(normalizeString(s));
  });
  it("folds diacritics", () => {
    expect(tokenize("Café")).toEqual(["cafe"]);
    expect(tokenize("naïve")).toEqual(["naive"]);
  });
  it("expands contractions and strips possessives", () => {
    expect(tokenize("don't")).toEqual(["do", "not"]);
    expect(tokenize("a dog's bone")).toEqual(["a", "dog", "bone"]);
  });
  it("neutralizes underscores (the phrase joiner) so no raw '_' survives", () => {
    expect(tokenize("hot_air")).toEqual(["hot", "air"]);
    expect(tokenize("file_name").some((t) => t.includes("_"))).toBe(false);
  });
  it("rewrites connective symbols and splits number+unit", () => {
    expect(tokenize("r&d")).toEqual(["r", "and", "d"]);
    expect(tokenize("5km")).toEqual(["km"]);          // pure-digit dropped, unit kept
    expect(tokenize("2024")).toEqual([]);             // pure-digit dropped
  });
  it("drops overlong tokens whole (never truncates)", () => {
    expect(tokenize("a".repeat(31))).toEqual([]);
    expect(tokenize("a".repeat(30))).toEqual(["a".repeat(30)]);
  });
});

describe("stem (S-stemmer-lite)", () => {
  it("folds regular plurals to singular", () => {
    for (const [pl, sg] of [
      ["dogs", "dog"], ["trees", "tree"], ["cities", "city"], ["babies", "baby"],
      ["glasses", "glass"], ["boxes", "box"], ["churches", "church"], ["dishes", "dish"],
      ["buzzes", "buzz"], ["houses", "house"], ["roses", "rose"], ["prizes", "prize"],
    ]) expect(stem(pl)).toBe(sg);
  });
  it("leaves protected words and short/guarded forms intact", () => {
    for (const w of ["movies", "bus", "gas", "lens", "news", "virus", "analysis", "iris", "ties", "pies", "species"]) expect(stem(w)).toBe(w);
  });
  it("is idempotent", () => {
    for (const w of ["dog", "city", "glass", "house", "box"]) expect(stem(stem(w))).toBe(stem(w));
  });
  it("never over-conflates distinct words (no derivational stripping)", () => {
    for (const [a, b] of [
      ["universe", "university"], ["sparse", "spare"], ["flower", "flow"],
      ["arm", "army"], ["organ", "organic"], ["business", "busy"], ["relative", "relativity"],
    ]) expect(stem(a)).not.toBe(stem(b));
  });
});

describe("makeTokenizer factory + phrase merge", () => {
  const tk = makeTokenizer({ phrases: ["hot_air_balloon", "new_york", "new_york_city"] });
  it("with no phrases equals the base tokenizer", () => {
    for (const s of ["a dog in a field", "café au lait", "hot air balloon"]) {
      expect(makeTokenizer()(s)).toEqual(tokenize(s));
      expect(makeTokenizer({ phrases: [] })(s)).toEqual(tokenize(s));
      expect(makeTokenizer({})(s)).toEqual(tokenize(s));
    }
  });
  it("merges a learned multiword unit", () => {
    expect(tk("a hot air balloon over the sea")).toEqual(["a", "hot_air_balloon", "over", "the", "sea"]);
  });
  it("merges after stemming (plural input still matches a phrase)", () => {
    expect(tk("two hot air balloons")).toEqual(["two", "hot_air_balloon"]);
  });
  it("takes the longest match greedily", () => {
    expect(tk("new york city")).toEqual(["new_york_city"]);
    expect(tk("new york")).toEqual(["new_york"]);
  });
  it("round-trips a phrase token as a fixed point", () => {
    expect(tk("hot_air_balloon")).toEqual(["hot_air_balloon"]);
    const x = "a hot air balloon in new york city";
    expect(tk(tk(x).join(" "))).toEqual(tk(x));
  });
  it("merges a phrase with an interior stopword", () => {
    const tkp = makeTokenizer({ phrases: ["black_and_white"] });
    expect(tkp("a black and white portrait")).toEqual(["a", "black_and_white", "portrait"]);
  });
  it("does not cross-merge independently-tokenized labels (the rankScenes union)", () => {
    const tkp = makeTokenizer({ phrases: ["ice_cream"] });
    // separate concept labels tokenized independently must NOT fuse into a phrase
    expect(["ice", "cream"].flatMap((L) => tkp(L))).toEqual(["ice", "cream"]);
    // but a single multi-word label still merges within itself
    expect(tkp("ice cream")).toEqual(["ice_cream"]);
  });
});

describe("shipped assets: df-table fixed point (stale-asset guard)", () => {
  const tk = phraseModel?.phrases?.length ? makeTokenizer({ phrases: phraseModel.phrases }) : tokenize;
  it("every df key re-tokenizes to exactly itself", () => {
    const keys = Object.keys(captionIdfTable.df || {});
    expect(keys.length).toBeGreaterThan(0);
    const bad = keys.filter((k) => { const t = tk(k); return t.length !== 1 || t[0] !== k; });
    expect(bad.slice(0, 20)).toEqual([]);
  });
  it("df phrase keys are all real learned phrases and each is a fixed point", () => {
    const phrases = new Set(phraseModel?.phrases || []);
    const phraseKeys = Object.keys(captionIdfTable.df || {}).filter((k) => k.includes(PHRASE_JOINER));
    if (phrases.size) {
      expect(phraseKeys.length).toBeGreaterThan(0);                       // a phrase-built df table MUST carry phrase keys
      expect(phraseKeys.filter((k) => !phrases.has(k))).toEqual([]);      // every phrase df key is a member of the shipped set
      expect(phraseKeys.filter((k) => { const t = tk(k); return t.length !== 1 || t[0] !== k; })).toEqual([]);   // and re-merges to itself
    } else {
      expect(phraseKeys).toEqual([]);   // a base-only build must not carry phrase keys
    }
  });
});

describe("IDF sanity on the shipped table", () => {
  const idf = buildIdfLookup(captionIdfTable);
  it("is a usable lookup with a positive corpus size", () => {
    expect(typeof idf).toBe("function");
    expect(captionIdfTable.N).toBeGreaterThan(0);
    expect(captionIdfTable.avgdl).toBeGreaterThan(0);
  });
  it("weights rarer terms higher and OOV highest", () => {
    const common = idf(Object.entries(captionIdfTable.df).sort((a, b) => b[1] - a[1])[0][0]);   // highest df
    const oov = idf("zzznotarealword");
    expect(oov).toBeGreaterThan(common);
    expect(common).toBeGreaterThan(0);
  });
});

describe("end-to-end BM25 through the shipped IDF table", () => {
  const tk = phraseModel?.phrases?.length ? makeTokenizer({ phrases: phraseModel.phrases }) : tokenize;
  const idf = buildIdfLookup(captionIdfTable);
  it("scores a real df term via the {idf} path, not as OOV", () => {
    const dfKeys = Object.keys(captionIdfTable.df);
    // prefer a phrase key (exercises the merge + df alignment); else a common unigram
    const key = dfKeys.find((k) => k.includes(PHRASE_JOINER)) || dfKeys.sort((a, b) => captionIdfTable.df[b] - captionIdfTable.df[a])[100];
    const text = key.split(PHRASE_JOINER).join(" ");
    const terms = tk(text);
    expect(terms).toContain(key);                                   // the surface text tokenizes to the df key
    const idx = buildTextIndex([{ uri: "d", text }], tk);
    expect(bm25Search(idx, terms, { idf }).get("d") || 0).toBeGreaterThan(0);
    expect(idf(key)).toBeLessThan(idf("zzznotarealword"));          // found in df -> below the OOV default
  });
});

describe("behavioral BM25 invariants", () => {
  it("A: a plural query matches a singular caption via stemming", () => {
    const idx = buildTextIndex([{ uri: "d1", text: "a dog in a field" }]);   // base tk stems 'dog'
    const s = bm25Search(idx, tokenize("dogs"));                             // query stems 'dogs' -> 'dog'
    expect((s.get("d1") || 0)).toBeGreaterThan(0);
  });
  it("B: a learned phrase concentrates the query on the right doc", () => {
    const tk = makeTokenizer({ phrases: ["hot_air_balloon"] });
    const docs = [
      { uri: "d1", text: "a hot air balloon in the sky" },
      { uri: "d2", text: "a cup of hot coffee" },
      { uri: "d3", text: "an air conditioner unit" },
      { uri: "d4", text: "a balloon animal at a party" },
    ];
    const idx = buildTextIndex(docs, tk);
    const s = bm25Search(idx, tk("hot air balloon"));
    expect(s.get("d1")).toBeGreaterThan(0);
    for (const d of ["d2", "d3", "d4"]) expect(s.get(d) || 0).toBe(0);   // phrase token matches only the target
    // base tokenizer instead lights up all four (splits into hot/air/balloon)
    const base = buildTextIndex(docs);
    const sb = bm25Search(base, tokenize("hot air balloon"));
    expect([...["d2", "d3", "d4"]].some((d) => (sb.get(d) || 0) > 0)).toBe(true);
  });
  it("C: a diacritic-folded query retrieves an accented caption", () => {
    const idx = buildTextIndex([{ uri: "c1", text: "café au lait on the table" }]);
    expect(bm25Search(idx, tokenize("cafe")).get("c1")).toBeGreaterThan(0);
  });
});
