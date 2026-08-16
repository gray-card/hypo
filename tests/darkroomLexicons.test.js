import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "lexicons/app/graycard");
const load = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const props = (path) => load(path).defs.main.record.properties;

describe("structured darkroom catalog lexicons", () => {
  it("requires identity and atomic roles while keeping technical details optional", () => {
    expect(load("catalog/filmStock.json").defs.main.record.required).toEqual(["name", "createdAt"]);
    expect(load("catalog/chemistryType.json").defs.main.record.required).toEqual(["name", "roles", "createdAt"]);
    expect(load("catalog/devRecipe.json").defs.main.record.required).toEqual([
      "developerMake",
      "developerName",
      "filmMake",
      "filmName",
      "process",
      "temps",
      "source",
    ]);
    expect(load("process/developSession.json").defs.main.record.required).toEqual(["process", "createdAt"]);
  });

  it("models format-dependent and measurement-dependent film specifications", () => {
    const lex = load("catalog/filmStock.json");
    const p = lex.defs.main.record.properties;
    for (const field of [
      "variants",
      "reciprocityPoints",
      "resolvingPowerTests",
      "granularityMeasurements",
      "spectralRangeMinNm",
      "spectralRangeMaxNm",
      "spectralSamples",
      "colorBalance",
      "colorBalanceKelvin",
      "storageGuidance",
      "handlingGuidance",
      "recommendedRecipes",
    ])
      expect(p[field], field).toBeTruthy();
    expect(p.variants.items.ref).toBe("#formatVariant");
    expect(lex.defs.formatVariant.properties.baseThickness.ref).toBe("app.graycard.defs#measure");
    expect(lex.defs.reciprocityPoint.properties.colorFilter.maxLength).toBeGreaterThan(0);
  });

  it("models operational, compatibility, safety, and document data on one chemistry type", () => {
    const p = props("catalog/chemistryType.json");
    for (const field of [
      "dilutions",
      "mixingInstructions",
      "minimumConcentratePerRoll",
      "capacity",
      "replenishment",
      "oneShot",
      "reusable",
      "shelfLives",
      "temperatureRanges",
      "compatibleProcesses",
      "compatibleFilmTypes",
      "compatibleMaterials",
      "ph",
      "kitBathSequence",
      "technicalDocuments",
      "sdsDocuments",
      "hazards",
      "disposalGuidance",
      "recommendedRecipes",
      "specSources",
    ])
      expect(p[field], field).toBeTruthy();
    expect(p.sdsDocuments.items.ref).toBe("app.graycard.defs#productDocument");
    expect(p.roles.type).toBe("array");
    expect(p.productKind.ref).toBe("app.graycard.defs#chemistryProductKind");
    expect(load("catalog/chemistryType.json").defs.bathStep.properties.roles.type).toBe("array");
  });

  it("keeps film-specific developer-sheet facts on development recipes", () => {
    const p = props("catalog/devRecipe.json");
    for (const field of [
      "filmStock",
      "filmName",
      "chemistryType",
      "developerName",
      "ei",
      "pushPull",
      "dilution",
      "temps",
      "tankType",
      "rotaryRpm",
      "agitation",
      "contrastTarget",
      "gammaTarget",
      "recommendationStatus",
      "sourceDocument",
      "sourcePage",
      "sourceTable",
      "sourceRevision",
      "interpolationAllowed",
      "interpolationMethod",
      "derived",
      "derivationNotes",
    ])
      expect(p[field], field).toBeTruthy();
    expect(p.filmStock.format).toBe("at-uri");
    expect(p.chemistryType.format).toBe("at-uri");
    expect(p.sourceDocument.ref).toBe("app.graycard.defs#productDocument");
  });

  it("distinguishes published targets from observed session values", () => {
    const p = props("process/developSession.json");
    const step = load("process/developSession.json").defs.step.properties;
    expect(p.steps.maxLength).toBe(64);
    expect(step.recipe.format).toBe("at-uri");
    expect(step.publishedTimeSeconds.minimum).toBe(0);
    expect(step.actualTimeSeconds.minimum).toBe(0);
    expect(step.temperatureSetpoint.ref).toBe("app.graycard.defs#measure");
    expect(step.actualTemperature.ref).toBe("app.graycard.defs#measure");
    expect(step.sourceSpec.ref).toBe("app.graycard.defs#specSource");
    expect(step.agitationScheme.ref).toBe("app.graycard.catalog.devRecipe#agitation");
    expect(step.chemistries.items.format).toBe("at-uri");
    expect(step.disposition.ref).toBe("#bathDisposition");
    expect(step).not.toHaveProperty("chemistry");
    expect(step).not.toHaveProperty("temperature");
    expect(step).not.toHaveProperty("timeSeconds");
    expect(step).not.toHaveProperty("agitation");
    expect(props("instance/chemistry.json").lastUsedAt.format).toBe("datetime");
  });
});
