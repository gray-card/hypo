import { describe, it, expect } from "vitest";
import devTimes from "../src/data/curated-dev-times.json";
import filmStocks from "../src/data/curated-film-stocks.json";
import { PRESETS } from "../src/data/presets.js";

const norm = (s) => String(s || "").toLowerCase().replace(/plus/g, "").replace(/[^a-z0-9]/g, "");

// films that legitimately have development recipes but no current datasheet stock:
// discontinued (frozen-stock staples) or third-party emulsions no manufacturer
// datasheet covers as a stock. New unmatched names should NOT appear here silently —
// this list is the closed set of known exceptions.
const KNOWN_UNMATCHED = new Set([
  "chm100apx100new", "chm400apx400new", "neopan400", "neopan100acros",
  "streetpan400", "n74", "plusx",
].map(norm));

describe("film stock ⇄ dev-time reconciliation", () => {
  const stockNames = new Set(filmStocks.stocks.map((s) => norm(s.name)));

  it("every B&W/reversal/monobath recipe resolves to a stock (or a known exception)", () => {
    const orphans = [];
    for (const r of devTimes.recipes) {
      if (!["bw", "reversal-bw", "monobath"].includes(r.process)) continue;
      const k = norm(r.filmName);
      if (stockNames.has(k) || KNOWN_UNMATCHED.has(k)) continue;
      orphans.push(`${r.filmMake} / ${r.filmName}`);
    }
    expect(orphans).toEqual([]);   // a new orphan means a name drifted — fix the name or add the stock
  });

  it("stock names are unique (no duplicate emulsions)", () => {
    const seen = new Set(), dups = [];
    for (const s of filmStocks.stocks) { const k = norm(s.name); if (seen.has(k)) dups.push(s.name); seen.add(k); }
    expect(dups).toEqual([]);
  });

  it("every curated recipe and stock cites a source URL", () => {
    expect(devTimes.recipes.every((r) => /^https?:\/\//.test(r.source || ""))).toBe(true);
    expect(filmStocks.stocks.every((s) => /^https?:\/\//.test(s.datasheetUrl || ""))).toBe(true);
  });

  it("the datasheet stocks are merged into the film-stock suggestions", () => {
    const names = new Set(PRESETS.filmStock.items.map((i) => norm(i.name)));
    for (const n of ["Fomapan 400", "Kentmere Pan 100", "Ektapan 400", "Acros 100 II", "RPX 400"]) {
      expect(names.has(norm(n))).toBe(true);
    }
  });
});
