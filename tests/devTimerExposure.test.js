import { beforeEach, describe, expect, it, vi } from "vitest";
import { allRecipes } from "../src/devRecipes.js";
import { NS } from "../src/graycard.js";
import { pending } from "../src/outbox.js";
import {
  closestExposureRecipe,
  deriveExposureObservation,
  selectedVsObservedText,
} from "../src/ui/devTimerExposure.js";
import { initLibrary } from "../src/ui/library.js";
import { openDevTimer } from "../src/ui/devTimer.js";
import { mockAgent } from "./setup.js";

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
});

describe("reading-aware development suggestion", () => {
  it("derives observed EI from attached readings while leaving recipe selection explicit", () => {
    const roll = "at://did:plc:test/app.graycard.instance.filmRoll/roll";
    const stock = "at://did:plc:test/app.graycard.catalog.filmStock/stock";
    const exposure = "at://did:plc:test/app.graycard.instance.exposure/frame";
    const reading = "at://did:plc:test/app.graycard.meter.reading/reading";
    const store = {
      catalog: { filmStock: [{ uri: stock, value: { iso: 400 } }] },
      instance: {
        filmRoll: [{ uri: roll, value: { stock } }],
        exposure: [{ uri: exposure, value: { roll, meterReadings: [reading] } }],
      },
    };
    const observation = deriveExposureObservation({
      store,
      rollUris: [roll],
      meterReadings: [{ uri: reading, value: { iso: 800, exposure } }],
    });
    const boxRecipe = { ei: 400 };
    const pushRecipe = { ei: 800 };

    expect(observation).toMatchObject({ observedIso: 800, boxIso: 400, stops: 1, source: "linked meter reading" });
    expect(closestExposureRecipe([boxRecipe, pushRecipe], observation)).toBe(pushRecipe);
    expect(selectedVsObservedText(observation, boxRecipe)).toMatch(/Observed EI 800.*Selected recipe: EI 400/i);
  });

  it("persists the selected recipe separately from the observed EI suggestion", async () => {
    const recipes = allRecipes();
    const filmMake = "Meter Test";
    const filmName = "Observed EI Film";
    const common = {
      filmMake,
      filmName,
      developerMake: "Test",
      developerName: "Developer",
      dilution: "stock",
      process: "bw",
      temps: [{ tempC10: 200, timeSec: 60 }],
      recommendationStatus: "manufacturer-supported",
      source: "https://manufacturer.example/dev.pdf",
    };
    const boxRecipe = { ...common, ei: 400, pushPull: { value: 0, unit: "stop" } };
    const pushRecipe = { ...common, ei: 800, pushPull: { value: 1, unit: "stop" } };
    recipes.push(boxRecipe, pushRecipe);

    const did = "did:plc:dev-reading";
    const stock = `at://${did}/app.graycard.catalog.filmStock/stock`;
    const roll = `at://${did}/app.graycard.instance.filmRoll/roll`;
    const exposure = `at://${did}/app.graycard.instance.exposure/frame`;
    const reading = `at://${did}/app.graycard.meter.reading/reading`;
    const recipe400 = `at://${did}/app.graycard.catalog.devRecipe/box`;
    const recipe800 = `at://${did}/app.graycard.catalog.devRecipe/push`;
    const agent = mockAgent();
    const store = {
      catalog: {
        filmStock: [{ uri: stock, value: { brand: filmMake, name: filmName, iso: 400 } }],
        devRecipe: [
          { uri: recipe400, value: boxRecipe },
          { uri: recipe800, value: pushRecipe },
        ],
      },
      instance: {
        filmRoll: [{ uri: roll, cid: "cid-roll", rkey: "roll", value: { label: "Observed roll", stock } }],
        exposure: [{ uri: exposure, value: { roll, meterReadings: [reading] } }],
        chemistry: [],
      },
    };
    const meterReadings = [{ uri: reading, value: { iso: 800, exposure } }];
    initLibrary({ agent, did, store });
    try {
      openDevTimer({ agent, did, store }, { allowResume: false, rolls: [roll], meterReadings });
      expect(document.querySelector(".devtimer-exposure-evidence").textContent).toMatch(/Observed EI 800/i);
      expect(document.querySelector(".devtimer-suggested").textContent).toMatch(/EI 800.*Closest EI/i);

      [...document.querySelectorAll(".devtimer-list .devtimer-opt")]
        .find((button) => button.textContent.includes("EI 400"))
        .click();
      expect(document.querySelector(".devtimer-exposure-evidence").textContent).toMatch(
        /Observed EI 800.*Selected recipe: EI 400/i,
      );
      [...document.querySelectorAll("button")].find((button) => button.textContent === "Start development").click();
      [...document.querySelectorAll("button")].find((button) => button.textContent === "Finish & log").click();

      await vi.waitFor(() => expect(pending(did, NS.process.developSession)).toHaveLength(1));
      const record = pending(did, NS.process.developSession)[0].record;
      expect(record.steps[0].recipe).toBe(recipe400);
      expect(record.pushPull).toEqual({ value: 0, unit: "stop" });
      expect(record.filmRolls).toEqual([roll]);
      expect(record.notes).toMatch(/Observed EI 800.*Selected recipe: EI 400/i);
      expect(record.provenance.note).toMatch(/Observed EI 800.*Selected recipe: EI 400/i);
      await vi.waitFor(() => expect(pending(did, NS.instance.filmRoll)).toHaveLength(1));
      expect(pending(did, NS.instance.filmRoll)[0].record).toMatchObject({
        status: "developed",
        developedAt: expect.any(String),
        developmentLocation: "home",
      });
    } finally {
      recipes.splice(-2, 2);
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});
