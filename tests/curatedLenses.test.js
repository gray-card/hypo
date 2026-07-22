import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRESETS } from "../src/data/presets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURATED_DIR = join(ROOT, "data", "curated-lenses");

function loadAllCurated() {
  const rows = [];
  for (const f of readdirSync(CURATED_DIR).filter((f) => f.endsWith(".jsonl"))) {
    for (const l of readFileSync(join(CURATED_DIR, f), "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) {
      rows.push(JSON.parse(l));
    }
  }
  return rows;
}

describe("data/curated-lenses/*.jsonl", () => {
  const rows = loadAllCurated();

  it("is non-trivial and every line is a well-formed lens record", () => {
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) {
      expect(typeof r.model).toBe("string");
      expect(r.model.length).toBeGreaterThan(0);
      expect(typeof r.make).toBe("string");
      expect(r.make.length).toBeGreaterThan(0);
      expect(typeof r.mount).toBe("string");
      expect(r.mount.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.focalLengthMin)).toBe(true);
      expect(Number.isFinite(r.focalLengthMax)).toBe(true);
      expect(r.focalLengthMax).toBeGreaterThanOrEqual(r.focalLengthMin);
      expect(Number.isFinite(r.maxAperture)).toBe(true);
      expect(["prime", "zoom", "macro", "fisheye", "tilt-shift", "other"]).toContain(r.lensTypeKind);
    }
  });

  it("has no duplicate model names", () => {
    const models = rows.map((r) => r.model);
    expect(new Set(models).size).toBe(models.length);
  });

  it("fills the manual-focus gap that lensfun lacks (pre-AI / AI / Series E 50mm)", () => {
    const models = new Set(rows.map((r) => r.model));
    expect(models).toContain("Nikon Nikkor 50mm f/1.4");      // pre-AI
    expect(models).toContain("Nikon AI Nikkor 50mm f/1.4");   // AI
    expect(models).toContain("Nikon Series E 50mm f/1.8");    // Series E
  });
});

describe("PRESETS.lensType merges curated with lensfun (deduped)", () => {
  it("includes the curated manual Nikkors alongside lensfun", () => {
    const models = new Set(PRESETS.lensType.items.map((l) => l.model));
    expect(models).toContain("Nikon Nikkor 50mm f/1.4");        // curated pre-AI
    expect(models).toContain("Nikon AI-S Nikkor 50mm f/1.4");   // from lensfun
  });

  it("never lists the same lens model twice", () => {
    const models = PRESETS.lensType.items.map((l) => `${l.make}|${l.model}`.toLowerCase());
    expect(new Set(models).size).toBe(models.length);
  });
});
