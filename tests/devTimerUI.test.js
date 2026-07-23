import { beforeEach, describe, expect, it, vi } from "vitest";
import { allRecipes } from "../src/devRecipes.js";
import { NS } from "../src/graycard.js";
import { initLibrary } from "../src/ui/library.js";
import { openDevTimer, recipeTechnicalDetails } from "../src/ui/devTimer.js";
import { buildProcessSessionForm } from "../src/ui/processForms.js";
import { pending } from "../src/outbox.js";
import { mockAgent } from "./setup.js";

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("development recipe progressive disclosure", () => {
  it("shows published conditions, method, agitation, recommendation, and exact source", () => {
    const node = recipeTechnicalDetails({
      ei: 800,
      pushPull: { value: 1, unit: "stop" },
      dilution: "1+1",
      temps: [{ tempC10: 200, timeSec: 600 }, { tempC10: 240, timeSec: 360 }],
      tankType: "rotary",
      rotaryRpm: 30,
      agitation: { initialSec: 30, everySec: 60, forSec: 10, inversions: 4 },
      contrastTarget: "CI 0.58",
      gammaTarget: { value: 65, scale: 100, unit: "gamma" },
      recommendationStatus: "manufacturer-recommended",
      interpolationAllowed: true,
      interpolationMethod: "manufacturer-table",
      derived: true,
      derivationNotes: "Interpolated from the published table.",
      source: "https://manufacturer.example/sheet.pdf",
      sourceDocument: { asset: { url: "https://manufacturer.example/sheet.pdf" }, publisher: "Manufacturer", documentNumber: "F-1" },
      sourcePage: "4",
      sourceTable: "Development times",
      sourceRevision: "2026-01",
    });
    document.body.append(node);
    expect(node.textContent).toMatch(/20°C — 10:00/);
    expect(node.textContent).toMatch(/rotary · 30 rpm/i);
    expect(node.textContent).toMatch(/first 30s · every 60s for 10s · 4 inversions/i);
    expect(node.textContent).toMatch(/manufacturer-recommended/);
    expect(node.textContent).toMatch(/F-1 · 2026-01 · p\. 4 · table Development times/);
    expect(node.textContent).toMatch(/manufacturer-table/);
    expect(node.textContent).toMatch(/Interpolated from the published table/);
    expect(node.querySelector("a").href).toBe("https://manufacturer.example/sheet.pdf");
  });
});

describe("development timer logging", () => {
  it("persists recipe/source refs and published-vs-actual conditions", async () => {
    const agent = mockAgent();
    const recipe = allRecipes()[0];
    const saved = {
      sourceDocument: recipe.sourceDocument,
      sourcePage: recipe.sourcePage,
      sourceTable: recipe.sourceTable,
      agitation: recipe.agitation,
    };
    Object.assign(recipe, {
      sourceDocument: {
        kind: "technical-data",
        asset: { url: recipe.source },
        publisher: recipe.developerMake,
        revision: "test-revision",
      },
      sourcePage: "3",
      sourceTable: "Film development",
      agitation: { initialSec: 30, everySec: 60, forSec: 10, inversions: 4, note: "Four inversions" },
    });
    const recipeUri = "at://did:plc:test/app.graycard.catalog.devRecipe/recipe1";
    const store = {
      catalog: { devRecipe: [{ uri: recipeUri, value: recipe }] },
      instance: { chemistry: [], developer: [], filmRoll: [] },
    };
    const ctx = { agent, did: "did:plc:test", store };
    initLibrary(ctx);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      openDevTimer(ctx, { allowResume: false });
      const search = document.querySelector(".search-input");
      search.value = `${recipe.filmMake} ${recipe.filmName}`;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".devtimer-list .devtimer-opt").click();
      const lists = document.querySelectorAll(".devtimer-list");
      lists[1].querySelector(".devtimer-opt").click();

      expect(document.querySelector(".recipe-technical").textContent).toMatch(/Published temperature\/time points/);
      const actual = [...document.querySelectorAll("label.field")].find((l) => l.textContent.includes("Actual temperature"))?.querySelector("input");
      actual.value = "21.5";
      actual.dispatchEvent(new Event("input", { bubbles: true }));
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Start development").click();
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Finish & log").click();

      await vi.waitFor(() => expect(pending(ctx.did, NS.process.developSession)).toHaveLength(1));
      const rec = pending(ctx.did, NS.process.developSession)[0].record;
      expect(rec.recipe).toBe(recipeUri);
      expect(rec.sourceDocument.revision).toBe("test-revision");
      expect(rec.sourceSpec.page).toBe("3");
      expect(rec.sourceSpec.table).toBe("Film development");
      expect(rec.temperatureSetpoint).toEqual({ unit: "celsius", value: recipe.temps[0].tempC10, scale: 10 });
      expect(rec.actualTemperature).toEqual({ unit: "celsius", value: 215, scale: 10 });
      expect(rec.publishedTimeSeconds).toBe(recipe.temps[0].timeSec);
      expect(rec.actualTimeSeconds).toBe(0);
      expect(rec.agitationScheme).toEqual(recipe.agitation);
      expect(rec.timeSeconds).toBe(rec.actualTimeSeconds);
      expect(rec.temperature).toEqual(rec.actualTemperature);
    } finally {
      Object.assign(recipe, saved);
      for (const key of ["sourceDocument", "sourcePage", "sourceTable"]) if (saved[key] === undefined) delete recipe[key];
    }
  });
});

describe("manual development session form", () => {
  it("keeps legacy summaries while also saving structured recipe observations", () => {
    const agent = mockAgent();
    const developerUri = "at://did:plc:test/app.graycard.instance.developer/dev1";
    const recipeUri = "at://did:plc:test/app.graycard.catalog.devRecipe/r1";
    const store = {
      catalog: {
        developerType: [],
        chemistryType: [],
        devRecipe: [{
          uri: recipeUri,
          value: { filmMake: "Ilford", filmName: "HP5 Plus", developerMake: "Ilford", developerName: "ID-11", dilution: "1+1", ei: 400 },
        }],
      },
      instance: {
        developer: [{ uri: developerUri, value: { nickname: "ID-11 working" } }],
        chemistry: [], filmRoll: [],
      },
    };
    initLibrary({ agent, did: "did:plc:test", store });
    const form = buildProcessSessionForm("developSession", store, {
      developer: developerUri,
      recipe: recipeUri,
      process: "bw",
      temperature: { value: 20, unit: "celsius" },
      timeSeconds: 600,
      agitation: "4 inversions each minute",
      agitationScheme: { everySec: 60, inversions: 4 },
      sourceDocument: { kind: "technical-data", asset: { url: "https://manufacturer.example/id11.pdf" } },
      sourceSpec: { document: { kind: "technical-data", asset: { url: "https://manufacturer.example/id11.pdf" } }, fields: ["temps"], page: "2" },
    });
    document.body.append(...form.nodes);
    expect(document.querySelector("details.process-technical").textContent).toMatch(/Recipe, source, and observed values/);

    const rec = form.read();
    expect(rec.recipe).toBe(recipeUri);
    expect(rec.temperature).toEqual({ value: 20000000, scale: 1000000, unit: "celsius" });
    expect(rec.temperatureSetpoint).toEqual(rec.temperature);
    expect(rec.actualTemperature).toEqual(rec.temperature);
    expect(rec.timeSeconds).toBe(600);
    expect(rec.publishedTimeSeconds).toBe(600);
    expect(rec.actualTimeSeconds).toBe(600);
    expect(rec.agitation).toBe("4 inversions each minute");
    expect(rec.agitationScheme).toEqual({ everySec: 60, inversions: 4 });
    expect(rec.sourceSpec.page).toBe("2");
  });
});
