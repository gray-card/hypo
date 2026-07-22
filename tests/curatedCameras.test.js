import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRESETS } from "../src/data/presets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "curated-cameras");

const FORMAT = new Set(["35mm", "120", "220", "110", "aps", "4x5", "5x7", "8x10", "half-frame", "instax-mini", "instax-wide", "instax-square", "polaroid-600", "polaroid-i-type", "polaroid-sx70", "super8", "16mm", "full-frame-digital", "aps-c-digital", "medium-format-digital", "other"]);
const CATEGORY = new Set(["film", "digital", "instant", "motion-picture", "other"]);

function loadAll() {
  const rows = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".jsonl"))) {
    for (const l of readFileSync(join(DIR, f), "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) rows.push(JSON.parse(l));
  }
  return rows;
}

describe("data/curated-cameras/*.jsonl", () => {
  const rows = loadAll();

  it("is a substantial, well-formed film-body catalog", () => {
    expect(rows.length).toBeGreaterThan(400);
    for (const r of rows) {
      expect(r.make.length).toBeGreaterThan(0);
      expect(r.model.length).toBeGreaterThan(0);
      expect(FORMAT.has(r.format)).toBe(true);
      expect(CATEGORY.has(r.category)).toBe(true);
      expect(typeof r.mount).toBe("string");
    }
  });

  it("has no duplicate make+model", () => {
    const keys = rows.map((r) => `${r.make}|${r.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("surfaces classic film bodies in the camera preset (merged with lensfun)", () => {
    const models = new Set(PRESETS.cameraType.items.map((c) => `${c.make} ${c.model}`));
    expect(models).toContain("Nikon F3");
    expect(models).toContain("Pentax K1000");
    expect(models).toContain("Canon AE-1");
  });
});
