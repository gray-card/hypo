import { describe, it, expect, beforeEach, vi } from "vitest";
import { typeImage, qidFromRecord, searchEntities, searchConcepts, rankConceptSenses, refineConceptRanking } from "../src/data/wikidata.js";

// stub the Wikidata HTTP API. `handler(action, params)` returns the JSON body.
function stubWikidata(handler) {
  global.fetch = vi.fn(async (url) => {
    const u = new URL(url);
    return { ok: true, json: async () => handler(u.searchParams.get("action"), u.searchParams) };
  });
}
const withQid = (qid) => ({ links: { externalIds: [{ scheme: "wikidata", value: qid }] } });
const claimsWithImage = (file) => ({ claims: { P18: [{ mainsnak: { datavalue: { value: file } } }] } });

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("qidFromRecord", () => {
  it("reads a stored wikidata QID", () => {
    expect(qidFromRecord(withQid("Q123"))).toBe("Q123");
  });
  it("returns null when there is no wikidata link", () => {
    expect(qidFromRecord({})).toBe(null);
    expect(qidFromRecord({ links: { externalIds: [{ scheme: "gtin", value: "x" }] } })).toBe(null);
  });
});

describe("typeImage — stock thumbnail resolution", () => {
  it("builds a Commons thumbnail from the record's QID via P18", async () => {
    stubWikidata((action) => action === "wbgetclaims" ? claimsWithImage("Leica M6.jpg") : {});
    const url = await typeImage(withQid("Q-cam-1"), "Leica M6");
    expect(url).toContain("commons.wikimedia.org/wiki/Special:FilePath/");
    expect(url).toContain(encodeURIComponent("Leica M6.jpg"));
    expect(url).toContain("width=240");
    expect(global.fetch).toHaveBeenCalledTimes(1); // no name search needed
  });

  it("falls back to a name search when there is no QID", async () => {
    stubWikidata((action) => {
      if (action === "wbsearchentities") return { search: [{ id: "Q-found" }] };
      if (action === "wbgetclaims") return claimsWithImage("Portra400.jpg");
      return {};
    });
    const url = await typeImage({}, "Kodak Portra 400 search-case");
    expect(url).toContain("Portra400.jpg");
    expect(global.fetch).toHaveBeenCalledTimes(2); // search + claims
  });

  it("returns null (and caches it) when the entity has no P18 image", async () => {
    stubWikidata(() => ({ claims: {} }));
    const url = await typeImage(withQid("Q-noimg"), "No Image Cam");
    expect(url).toBe(null);
  });

  it("caches by QID so a repeat lookup does not re-query", async () => {
    stubWikidata((action) => action === "wbgetclaims" ? claimsWithImage("Cached.jpg") : {});
    const rec = withQid("Q-cache-key");
    const a = await typeImage(rec, "Cam");
    const b = await typeImage(rec, "Cam");
    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null without querying when there is neither QID nor label", async () => {
    stubWikidata(() => ({}));
    expect(await typeImage({}, null)).toBe(null);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("searchEntities", () => {
  it("maps wbsearchentities results", async () => {
    stubWikidata(() => ({ search: [{ id: "Q1", label: "Leica", description: "camera maker" }] }));
    const r = await searchEntities("leica");
    expect(r[0]).toMatchObject({ id: "Q1", label: "Leica", description: "camera maker" });
  });
  it("ignores queries under two characters without a request", async () => {
    stubWikidata(() => ({}));
    expect(await searchEntities("a")).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("asks Wikidata for the requested number of senses", async () => {
    let sentLimit = null;
    stubWikidata((action, params) => {
      if (action === "wbsearchentities") sentLimit = params.get("limit");
      return { search: [] };
    });
    await searchEntities("post", 25);
    expect(sentLimit).toBe("25");
  });

  it("leaves Wikidata's own order alone, for catalog product lookups", async () => {
    // a company or brand IS the answer when resolving a camera or film, so the
    // raw search must not inherit the scene ranking
    stubWikidata(() => ({ search: [
      { id: "Q1", label: "Leica", description: "German camera company" },
      { id: "Q2", label: "Leica", description: "genus of moths" },
    ] }));
    const r = await searchEntities("leica", 5);
    expect(r.map((x) => x.id)).toEqual(["Q1", "Q2"]);
  });

  it("returns every sense the API gives back, with no internal cap", async () => {
    // an ambiguous word ("post") buries its ordinary-noun sense under proper
    // nouns, so the deep list must survive intact to the caller
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `Q${i}`, label: `post ${i}`, description: "d" }));
    stubWikidata(() => ({ search: many }));
    expect(await searchEntities("post", 25)).toHaveLength(25);
  });
});

// The real "post" result set under Wikidata's own ranking, plus the ordinary-noun
// sense that a deeper search surfaces. The thing a photographer means is nowhere
// near the top until it is re-ranked.
const POST_SENSES = [
  { id: "Q1", label: "Post", description: "family name" },
  { id: "Q2", label: "Post", description: "city in Garza County, Texas, United States" },
  { id: "Q3", label: "Post", description: "1995 studio album by Bjork" },
  { id: "Q4", label: "mail", description: "system for transporting documents and other small packages" },
  { id: "Q5", label: "India Post", description: "government-operated postal system in India" },
  { id: "Q6", label: "Postcode data", description: "Dutch open data website" },
  { id: "Q7", label: "Post", description: "1929 animated film by Mikhail Tsekhanovsky" },
  { id: "Q8", label: "post", description: "vertical structural element set in the ground" },
];

describe("rankConceptSenses — ordinary nouns over named individuals", () => {
  it("lifts the thing you can photograph above surname, town, album and film", () => {
    const ranked = rankConceptSenses(POST_SENSES, "post");
    expect(ranked[0].id).toBe("Q8");                     // the vertical structural element
    const pos = (id) => ranked.findIndex((h) => h.id === id);
    for (const buried of ["Q1", "Q2", "Q3", "Q7"]) {
      expect(pos("Q8")).toBeLessThan(pos(buried));
    }
  });

  it("never drops a sense, only reorders", () => {
    const ranked = rankConceptSenses(POST_SENSES, "post");
    expect(ranked).toHaveLength(POST_SENSES.length);
    expect(new Set(ranked.map((h) => h.id))).toEqual(new Set(POST_SENSES.map((h) => h.id)));
  });

  it("keeps Wikidata's order among senses it treats alike", () => {
    const alike = [
      { id: "Qa", label: "tree", description: "perennial woody plant" },
      { id: "Qb", label: "tree", description: "data structure" },
    ];
    expect(rankConceptSenses(alike, "tree").map((h) => h.id)).toEqual(["Qa", "Qb"]);
  });

  it("does not demote photographable classes that merely name places", () => {
    // "river"/"mountain" are things you point a camera at; only a NAMED instance
    // ("city in X") should sink
    const hits = [
      { id: "Qc", label: "Springfield", description: "city in Illinois, United States" },
      { id: "Qd", label: "river", description: "natural flowing watercourse" },
    ];
    expect(rankConceptSenses(hits, "river")[0].id).toBe("Qd");
  });
});

describe("searchConcepts", () => {
  it("applies the scene ranking to a live search", async () => {
    stubWikidata(() => ({ search: POST_SENSES }));
    const r = await searchConcepts("post", 25);
    expect(r[0].id).toBe("Q8");
  });
});

// What Wikidata actually says these entities ARE (P31 instance-of / P279
// subclass-of), which is the structured answer the prose heuristic only guesses.
const kinds = (m) => new Map(Object.entries(m).map(([id, v]) => [id, { isClass: !!v.isClass, types: new Set(v.types || []) }]));

describe("rankConceptSenses — structural signal from P31 / P279", () => {
  it("prefers a class (has subclass-of) over a named individual", () => {
    const hits = [
      { id: "Q1", label: "Post", description: "" },     // no description at all
      { id: "Q8", label: "post", description: "" },
    ];
    const k = kinds({
      Q1: { types: ["Q101352"] },                       // instance of: family name
      Q8: { isClass: true },                            // subclass of: structural element
    });
    expect(rankConceptSenses(hits, "post", k)[0].id).toBe("Q8");
  });

  it("treats an album and a city alike: both have something you can photograph", () => {
    // a vinyl record is as photographable as a town, so neither is buried; they
    // are merely particular things rather than kinds, and rank equally
    const hits = [
      { id: "Qalbum", label: "Ridge", description: "" },
      { id: "Qcity", label: "Ridge", description: "" },
      { id: "Qname", label: "Ridge", description: "" },
    ];
    const k = kinds({
      Qalbum: { types: ["Q482994"] },                   // instance of: album
      Qcity: { types: ["Q515"] },                       // instance of: city
      Qname: { types: ["Q101352"] },                    // instance of: family name
    });
    const ranked = rankConceptSenses(hits, "ridge", k);
    // the surname sinks; the album and the town stay together above it
    expect(ranked.map((h) => h.id)).toEqual(["Qalbum", "Qcity", "Qname"]);
  });

  it("still prefers the general kind over any particular thing", () => {
    const hits = [
      { id: "Qalbum", label: "Ridge", description: "" },
      { id: "Qkind", label: "ridge", description: "" },
    ];
    const k = kinds({ Qalbum: { types: ["Q482994"] }, Qkind: { isClass: true } });
    expect(rankConceptSenses(hits, "ridge", k)[0].id).toBe("Qkind");
  });

  it("an exact name query still reaches the specific place", () => {
    const hits = [
      { id: "Qkind", label: "bridge", description: "structure spanning an obstacle" },
      { id: "Qbrooklyn", label: "Brooklyn Bridge", description: "bridge in New York City" },
    ];
    const k = kinds({ Qkind: { isClass: true }, Qbrooklyn: { types: ["Q12280"] } });
    // the general kind wins a bare "bridge"...
    expect(rankConceptSenses(hits, "bridge", k)[0].id).toBe("Qkind");
    // ...but naming it exactly surfaces the individual
    expect(rankConceptSenses(hits, "Brooklyn Bridge", k)[0].id).toBe("Qbrooklyn");
  });

  it("buries wiki plumbing regardless of label", () => {
    const hits = [
      { id: "Qdis", label: "post", description: "" },
      { id: "Qthing", label: "post", description: "" },
    ];
    const k = kinds({ Qdis: { types: ["Q4167410"] }, Qthing: { isClass: true } });
    expect(rankConceptSenses(hits, "post", k)[0].id).toBe("Qthing");
  });
});

describe("refineConceptRanking", () => {
  it("falls back to the given order when the query service is unreachable", async () => {
    global.fetch = vi.fn(async () => { throw new Error("offline"); });
    const hits = [{ id: "Q1", label: "a", description: "" }, { id: "Q2", label: "b", description: "" }];
    expect((await refineConceptRanking(hits, "a")).map((h) => h.id)).toEqual(["Q1", "Q2"]);
  });

  it("returns an empty list untouched without querying", async () => {
    global.fetch = vi.fn();
    expect(await refineConceptRanking([], "x")).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
