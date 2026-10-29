import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "../src/data/presets.js";

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, "data", "curated-film-backs");

function loadRows() {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(SOURCE_DIR, name), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(JSON.parse),
    );
}

describe("data/curated-film-backs/*.jsonl", () => {
  const rows = loadRows();

  it("is a substantial, field-sourced catalog of detachable film carriers", () => {
    expect(rows.length).toBeGreaterThanOrEqual(90);
    for (const row of rows) {
      expect(row.make).toEqual(expect.any(String));
      expect(row.model).toEqual(expect.any(String));
      expect(row.backInterface).toEqual(expect.any(String));
      expect(row.datasheetUrl).toMatch(/^https:\/\//);
      expect(row.verifiedFields).toContain("backInterface");
      if (row.format) expect(row.verifiedFields).toContain("format");
      if (row.exposuresTotal) {
        expect(row.exposuresTotal).toBeGreaterThan(0);
        expect(row.verifiedFields).toContain("exposuresTotal");
      }
    }
  });

  it("has unique make + model identities", () => {
    const identities = rows.map((row) => `${row.make}\0${row.model}`.toLowerCase());
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("covers representative modular systems and non-square frame variants", () => {
    const models = new Set(rows.map((row) => `${row.make} ${row.model}`));
    expect(models).toContain("Bronica Film Back SQ-i 120");
    expect(models).toContain("Bronica Film Back SQ 135W");
    expect(models).toContain("Hasselblad Magazine A12");
    expect(models).toContain("Mamiya Pro-SD 120 Roll Film Holder HA701");
    expect(models).toContain("Mamiya RZ 6×4.5 120 Roll Film Holder HA704");
    expect(models).toContain("Fujifilm Roll Film Holder III 6×8cm N");
    expect(models).toContain("Contax Film Back Holder MFB-1");
    expect(models).toContain("Horseman Roll Film Holder 612");
    expect(models).toContain("Linhof Techno Rollex 45 6×12 (001560)");
    expect(models).toContain("Sinar Rollfilm Holder Zoom 2 (567.32)");
    expect(models).toContain("Toyo Roll Film Holder 69/45 (8033)");
    expect(models).toContain("Rollei 4560 Turnable Film Back");
  });

  it("uses manufacturer documents, official product pages, or brand-steward archives", () => {
    const allowedHosts = new Set([
      "cdn.hasselblad.com",
      "fujifilm.jp",
      "galerie-photo.com",
      "linhof.com",
      "mamiya.co.uk",
      "www.instructionsmanuals.com",
      "www.kenko-pi.co.jp",
      "www.pacificrimcamera.com",
      "rolleiflex.us",
      "toyoview.com",
      "www.cambo.com",
      "www.mamiya.uk",
      "www.tamron.com",
    ]);
    for (const row of rows) {
      const url = new URL(row.datasheetUrl);
      expect(allowedHosts.has(url.hostname), `${row.make} ${row.model}: ${url.hostname}`).toBe(true);
    }
  });

  it("loads all researched models into the film-back preset without duplicates", () => {
    const presets = PRESETS.filmBackType.items;
    expect(presets).toHaveLength(rows.length);
    const identities = presets.map((row) => `${row.make}\0${row.model}`.toLowerCase());
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("annotates catalog bodies with the same physical interface and leaves fixed bodies alone", () => {
    const cameras = PRESETS.cameraType.items;
    const byName = new Map(cameras.map((camera) => [`${camera.make} ${camera.model}`, camera]));
    expect(byName.get("Bronica SQ-Ai")?.backInterface).toBe("Bronica SQ");
    expect(byName.get("Mamiya RB67 Pro-SD")?.backInterface).toBe("Mamiya RB67");
    expect(byName.get("Hasselblad 503CW")?.backInterface).toBe("Hasselblad V");
    expect(byName.get("Mamiya Universal")?.backInterface).toBe("Mamiya Press M");
    expect(byName.get("Fujifilm GX680 III")?.backInterface).toBe("Fujifilm GX680");
    expect(byName.get("Contax 645")?.backInterface).toBe("Contax 645");
    expect(byName.get("Mamiya C330")?.backInterface).toBeUndefined();
    expect(byName.get("Bronica ETRC")?.backInterface).toBeUndefined();
  });
});
