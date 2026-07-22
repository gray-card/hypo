import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter, fuzzyMatches } from "../src/ui/fuzzy.js";

describe("fuzzyScore", () => {
  it("returns null when characters are not all present in order", () => {
    expect(fuzzyScore("xyz", "Nikon")).toBe(null);
    expect(fuzzyScore("noki", "Nikon")).toBe(null); // out of order
  });
  it("matches a scattered subsequence (typo-ish skips)", () => {
    expect(fuzzyScore("nkn", "Nikon")).not.toBe(null);
    expect(fuzzyScore("nkr", "Nikkor")).not.toBe(null);
  });
  it("ranks a literal substring above a scattered match", () => {
    const substring = fuzzyScore("nik", "Nikon");
    const scattered = fuzzyScore("nkn", "Nikon");
    expect(substring).toBeGreaterThan(scattered);
  });
  it("ranks a prefix/exact match highest", () => {
    const items = ["Nikon", "Konica Minolta", "unknown"];
    expect(fuzzyFilter("nik", items)[0]).toBe("Nikon");
  });
  it("matches multiple whitespace tokens anywhere", () => {
    const t = "Nikon AF Nikkor 50mm f/1.8D";
    expect(fuzzyScore("nikon 50", t)).not.toBe(null);
    expect(fuzzyScore("nikkor 1.8", t)).not.toBe(null);
    expect(fuzzyScore("50 1.8", t)).not.toBe(null);
    expect(fuzzyScore("canon 50", t)).toBe(null); // "canon" absent
  });
});

describe("fuzzyFilter", () => {
  const lenses = [
    "Nikon AF Nikkor 50mm f/1.8D",
    "Nikon AF-S Nikkor 50mm f/1.4G",
    "Canon EF 50mm f/1.8 STM",
    "Nikon AF-S 24-70mm f/2.8",
  ];
  it("finds the nifty fifties by natural query and excludes non-matches", () => {
    const r = fuzzyFilter("nikon 50 1.8", lenses);
    expect(r[0]).toBe("Nikon AF Nikkor 50mm f/1.8D");
    expect(r).not.toContain("Canon EF 50mm f/1.8 STM");
    expect(r).not.toContain("Nikon AF-S 24-70mm f/2.8");
  });
  it("returns all items (optionally capped) for an empty query", () => {
    expect(fuzzyFilter("", lenses)).toHaveLength(4);
    expect(fuzzyFilter("", lenses, (x) => x, 2)).toHaveLength(2);
  });
  it("respects the limit", () => {
    expect(fuzzyFilter("nikon", lenses, (x) => x, 1)).toHaveLength(1);
  });
  it("uses a key function for objects", () => {
    const items = [{ name: "Portra 400" }, { name: "HP5" }];
    expect(fuzzyFilter("portra", items, (x) => x.name)).toEqual([{ name: "Portra 400" }]);
  });
});

describe("fuzzyMatches", () => {
  it("is a boolean predicate", () => {
    expect(fuzzyMatches("nik", "Nikon")).toBe(true);
    expect(fuzzyMatches("zzz", "Nikon")).toBe(false);
  });
});
