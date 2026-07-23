import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = join(process.cwd(), "data");
const rowsIn = (dir) => readdirSync(join(DATA, dir))
  .filter((name) => name.endsWith(".jsonl"))
  .flatMap((name) => readFileSync(join(DATA, dir, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
const fileRows = (file) => readFileSync(join(DATA, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

describe("structured darkroom datasheet enrichment", () => {
  it("keeps every film and recipe JSONL line parseable and fully sourced", () => {
    const films = rowsIn("curated-film-stocks");
    const recipes = rowsIn("curated-dev-times");
    expect(films).toHaveLength(103);
    expect(recipes).toHaveLength(993);
    for (const film of films) {
      expect(film.documents[0].asset.url).toBe(film.datasheetUrl);
      expect(film.specSources[0].document.asset.url).toBe(film.datasheetUrl);
      expect(film.specSources[0].fields.length).toBeGreaterThan(0);
    }
    for (const recipe of recipes) {
      expect(recipe.sourceDocument.asset.url).toBe(recipe.source);
      expect(recipe.specSources[0].document.asset.url).toBe(recipe.source);
      expect(recipe.recommendationStatus).toBe("manufacturer-supported");
      expect(typeof recipe.derived).toBe("boolean");
      expect(recipe.interpolationAllowed).toBe(false);
      expect(recipe.interpolationMethod).toBe("none");
    }
  });

  it("records directly supported film measurements without replacing legacy fields", () => {
    const films = rowsIn("curated-film-stocks");
    const find = (brand, name) => films.find((row) => row.brand === brand && row.name === name);
    const chs = find("Adox", "CHS 100 II");
    expect(chs.formats).toEqual(["135", "120", "4x5"]);
    expect(chs.variants.map((v) => v.baseThickness.value)).toEqual([100, 100, 175]);
    const acros = find("Fujifilm", "Acros 100 II");
    expect(acros.grainRms).toBe(7);
    expect(acros.granularityMeasurements[0]).toMatchObject({ value: 7, scale: 1, kind: "diffuse-rms" });
    expect(acros.resolvingPowerTests).toEqual(expect.arrayContaining([
      { linesPerMm: 200, contrastRatio: "1000:1" },
      { linesPerMm: 60, contrastRatio: "1.6:1" },
    ]));
    expect(find("Adox", "Scala 160").reciprocityPoints).toHaveLength(3);
  });

  it("marks only documented midpoint/representative recipe values as derived", () => {
    const recipes = rowsIn("curated-dev-times");
    const derived = recipes.filter((row) => row.derived);
    expect(derived).toHaveLength(73);
    expect(derived.every((row) => /midpoint|representative|mean of|average of|published .*range/i.test(`${row.notes} ${row.derivationNotes || ""}`))).toBe(true);
    expect(recipes.filter((row) => row.gammaTarget)).toHaveLength(269);
    expect(recipes.filter((row) => row.sourceRevision)).toHaveLength(342);
  });

  it("contains only the 37 presets with verified manufacturer references", () => {
    const developers = fileRows("datasheets/developers.jsonl");
    const chemistries = fileRows("datasheets/chemistries.jsonl");
    expect(developers).toHaveLength(24);
    expect(chemistries).toHaveLength(13);
    for (const row of [...developers, ...chemistries]) {
      expect(row.technicalDocuments.length).toBeGreaterThan(0);
      expect(row.technicalDocuments[0].asset.url).toMatch(/^https:\/\//);
      expect(row.specSources.length).toBeGreaterThan(0);
      expect(row.specSources[0].fields.length).toBeGreaterThan(0);
    }
    expect(developers.filter((row) => row.sdsDocuments)).toHaveLength(7);
    expect(chemistries.filter((row) => row.sdsDocuments)).toHaveLength(4);
  });

  it("does not emit unresolved product placeholders as verified enrichment", () => {
    const products = [...fileRows("datasheets/developers.jsonl"), ...fileRows("datasheets/chemistries.jsonl")]
      .map((row) => `${row.brand} ${row.name}`.toLowerCase());
    for (const unresolved of ["kodak d-23", "diafine diafine two-bath", "tetenal colortec c-41", "kodak c-41 blix", "kodak selenium toner"]) {
      expect(products).not.toContain(unresolved);
    }
  });
});
