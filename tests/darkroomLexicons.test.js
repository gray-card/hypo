import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "lexicons/app/graycard");
const load = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const props = (path) => load(path).defs.main.record.properties;

describe("structured darkroom catalog lexicons", () => {
  it("keeps every new field optional for existing records", () => {
    expect(load("catalog/filmStock.json").defs.main.record.required).toEqual(["name", "createdAt"]);
    expect(load("catalog/developerType.json").defs.main.record.required).toEqual(["name", "process", "createdAt"]);
    expect(load("catalog/chemistryType.json").defs.main.record.required).toEqual(["name", "role", "createdAt"]);
    expect(load("catalog/devRecipe.json").defs.main.record.required).toEqual([
      "developerMake", "developerName", "filmMake", "filmName", "process", "temps", "source",
    ]);
    expect(load("process/developSession.json").defs.main.record.required).toEqual(["process", "createdAt"]);
  });

  it("models format-dependent and measurement-dependent film specifications", () => {
    const lex = load("catalog/filmStock.json");
    const p = lex.defs.main.record.properties;
    for (const field of [
      "variants", "reciprocityPoints", "resolvingPowerTests", "granularityMeasurements",
      "spectralRangeMinNm", "spectralRangeMaxNm", "spectralSamples", "colorBalance",
      "colorBalanceKelvin", "storageGuidance", "handlingGuidance", "recommendedRecipes",
    ]) expect(p[field], field).toBeTruthy();
    expect(p.variants.items.ref).toBe("#formatVariant");
    expect(lex.defs.formatVariant.properties.baseThickness.ref).toBe("app.graycard.defs#measure");
    expect(lex.defs.reciprocityPoint.properties.colorFilter.maxLength).toBeGreaterThan(0);
  });

  it.each(["catalog/developerType.json", "catalog/chemistryType.json"])(
    "%s models operational, compatibility, safety, and document data",
    (path) => {
      const p = props(path);
      for (const field of [
        "dilutions", "mixingInstructions", "minimumConcentratePerRoll", "capacity",
        "replenishment", "oneShot", "reusable", "shelfLives", "temperatureRanges",
        "compatibleProcesses", "compatibleFilmTypes", "compatibleMaterials", "ph",
        "kitBathSequence", "technicalDocuments", "sdsDocuments", "hazards",
        "disposalGuidance", "recommendedRecipes", "specSources",
      ]) expect(p[field], field).toBeTruthy();
      expect(p.sdsDocuments.items.ref).toBe("app.graycard.defs#productDocument");
    },
  );

  it("keeps film-specific developer-sheet facts on development recipes", () => {
    const p = props("catalog/devRecipe.json");
    for (const field of [
      "filmStock", "filmName", "developerType", "developerName", "ei", "pushPull",
      "dilution", "temps", "tankType", "rotaryRpm", "agitation", "contrastTarget",
      "gammaTarget", "recommendationStatus", "sourceDocument", "sourcePage",
      "sourceTable", "sourceRevision", "interpolationAllowed", "interpolationMethod",
      "derived", "derivationNotes",
    ]) expect(p[field], field).toBeTruthy();
    expect(p.filmStock.format).toBe("at-uri");
    expect(p.developerType.format).toBe("at-uri");
    expect(p.sourceDocument.ref).toBe("app.graycard.defs#productDocument");
  });

  it("distinguishes published targets from observed session values", () => {
    const p = props("process/developSession.json");
    expect(p.recipe.format).toBe("at-uri");
    expect(p.publishedTimeSeconds.minimum).toBe(0);
    expect(p.actualTimeSeconds.minimum).toBe(0);
    expect(p.temperatureSetpoint.ref).toBe("app.graycard.defs#measure");
    expect(p.actualTemperature.ref).toBe("app.graycard.defs#measure");
    expect(p.sourceSpec.ref).toBe("app.graycard.defs#specSource");
    expect(p.agitationScheme.ref).toBe("app.graycard.catalog.devRecipe#agitation");
  });
});
