import { describe, it, expect, beforeEach } from "vitest";
import {
  compatibilityFindings, detectMediums, matchingDevelopmentRecipes, needsOnboarding,
  onboardingSteps, openOnboarding, readOnboardingState, workflowPayload, writeOnboardingState,
} from "../src/ui/onboarding.js";
import { mockAgent } from "./setup.js";

function storeWith(cameraTypes = [], cameras = [], extra = {}) {
  const instance = {
    camera: [], lens: [], filter: [], filmRoll: [], filmStockpile: [], developer: [],
    scanner: [], chemistry: [], labAccount: [], storageLocation: [], enlarger: [],
    enlargingLens: [], lightSource: [], printer: [], intermediate: [],
    ...extra.instance,
    camera: cameras,
  };
  return {
    catalog: {
      cameraType: cameraTypes, lensType: [], filmStock: [], developerType: [],
      chemistryType: [], scannerType: [], lab: [], ...extra.catalog,
    },
    instance,
    workflowTemplates: extra.workflowTemplates || [],
  };
}

describe("detectMediums", () => {
  it("detects film from a film camera", () => {
    const store = storeWith(
      [{ uri: "t1", value: { category: "film", format: "35mm" } }],
      [{ value: { type: "t1" } }],
    );
    expect(detectMediums(store)).toMatchObject({ film: true, digital: false });
  });

  it("detects digital from format suffix", () => {
    const store = storeWith(
      [{ uri: "t1", value: { format: "full-frame-digital" } }],
      [{ value: { type: "t1" } }],
    );
    expect(detectMediums(store)).toMatchObject({ digital: true, film: false });
  });

  it("detects instant and mixed setups", () => {
    const store = storeWith(
      [{ uri: "t1", value: { format: "instax-mini" } }, { uri: "t2", value: { category: "film", format: "120" } }],
      [{ value: { type: "t1" } }, { value: { type: "t2" } }],
    );
    expect(detectMediums(store)).toMatchObject({ instant: true, film: true, any: true });
  });

  it("reports nothing for an empty setup", () => {
    expect(detectMediums(storeWith())).toEqual({ film: false, digital: false, instant: false, any: false });
  });
});

describe("durable onboarding state", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips versioned state", () => {
    writeOnboardingState("did:plc:test", { status: "in-progress", stepKey: "film", practices: ["film-home"] });
    expect(readOnboardingState("did:plc:test")).toMatchObject({
      status: "in-progress", stepKey: "film", practices: ["film-home"],
    });
  });

  it("keeps partial non-camera setups eligible", () => {
    const store = storeWith([], [], { instance: { scanner: [{ value: { type: "scanner" } }] } });
    expect(needsOnboarding(store, "did:plc:test")).toBe(true);
  });

  it("does not let one camera suppress an incomplete setup, but accepts a workflow", () => {
    expect(needsOnboarding(storeWith([{ uri: "t", value: {} }], [{ value: { type: "t" } }]), "did:plc:test")).toBe(true);
    expect(needsOnboarding(storeWith([], [], { workflowTemplates: [{ value: { name: "Mine" } }] }), "did:plc:test")).toBe(false);
  });

  it("honors a durable dismissal and resumes an in-progress setup", () => {
    writeOnboardingState("did:plc:test", { status: "dismissed" });
    expect(needsOnboarding(storeWith(), "did:plc:test")).toBe(false);
    writeOnboardingState("did:plc:test", { status: "in-progress", stepKey: "practice" });
    expect(needsOnboarding(storeWith([{ uri: "t", value: {} }], [{ value: { type: "t" } }]), "did:plc:test")).toBe(true);
  });
});

describe("adaptive steps", () => {
  it("uses film reserve and separates home chemistry from lab processing", () => {
    const home = onboardingSteps({ practices: ["film-home"], digitize: "own" });
    expect(home.find((x) => x.key === "film").kinds).toEqual(["filmStockpile"]);
    expect(home.find((x) => x.key === "chemistry").kinds).toEqual(["developer", "chemistry"]);
    expect(home.some((x) => x.key === "scanner")).toBe(true);
    expect(home.some((x) => x.key === "lab")).toBe(false);

    const lab = onboardingSteps({ practices: ["film-lab"], digitize: "lab" });
    expect(lab.some((x) => x.key === "chemistry")).toBe(false);
    expect(lab.some((x) => x.key === "lab")).toBe(true);
    expect(lab.some((x) => x.key === "scanner")).toBe(false);
  });

  it("adds printing equipment only for darkroom users", () => {
    const steps = onboardingSteps({ practices: ["darkroom"], digitize: "none" });
    expect(steps.find((x) => x.key === "printing").kinds).toEqual(["enlarger", "enlargingLens", "lightSource", "printer"]);
    expect(onboardingSteps({ practices: ["digital"], digitize: "none" }).some((x) => x.key === "printing")).toBe(false);
  });

  it("builds workflow stage defaults from compatible owned gear", () => {
    const store = storeWith(
      [{ uri: "cam-type", value: { category: "film", format: "35mm", mount: "nikon-f" } }],
      [{ uri: "cam", value: { type: "cam-type" } }],
      {
        catalog: {
          lensType: [{ uri: "lens-type", value: { mount: "nikon-f" } }],
          developerType: [{ uri: "dev-type", value: { role: "developer" } }],
        },
        instance: {
          lens: [{ uri: "lens", value: { type: "lens-type" } }],
          developer: [{ uri: "dev", value: { type: "dev-type" } }],
          scanner: [{ uri: "scan", value: { type: "scan-type" } }],
        },
      },
    );
    const payload = workflowPayload(
      { name: "Film", medium: "film", stages: ["capture", "develop", "digitize"] },
      store,
      { practices: ["film-home"], digitize: "own" },
    );
    expect(payload).toMatchObject({
      defaultCamera: "cam", defaultLens: "lens", defaultDeveloper: "dev", defaultScanner: "scan",
    });
    expect(payload.stageDefaults).toEqual(expect.arrayContaining([
      { kind: "capture", fields: { camera: "cam", lens: "lens" } },
      { kind: "develop", fields: { developer: "dev" } },
      { kind: "digitize", fields: { scanner: "scan" } },
    ]));
  });
});

describe("compatibility and datasheet guidance", () => {
  it("flags incompatible mounts and film formats", () => {
    const store = storeWith(
      [{ uri: "cam-type", value: { category: "film", format: "35mm", mount: "nikon-f" } }],
      [{ uri: "cam", value: { type: "cam-type" } }],
      {
        catalog: {
          lensType: [{ uri: "lens-type", value: { mount: "canon-ef" } }],
          filmStock: [{ uri: "film-type", value: { brand: "Kodak", name: "Tri-X 400" } }],
        },
        instance: {
          lens: [{ uri: "lens", value: { type: "lens-type" } }],
          filmStockpile: [{ uri: "film", value: { stock: "film-type", format: "120", quantity: 1 } }],
        },
      },
    );
    const text = compatibilityFindings(store).map((x) => x.text).join(" ");
    expect(text).toMatch(/mounts/i);
    expect(text).toMatch(/film formats/i);
  });

  it("treats 135 and 35mm as the same film format", () => {
    const store = storeWith(
      [{ uri: "cam-type", value: { category: "film", format: "35mm" } }],
      [{ uri: "cam", value: { type: "cam-type" } }],
      {
        catalog: { filmStock: [{ uri: "film-type", value: { brand: "Kodak", name: "Tri-X 400" } }] },
        instance: { filmStockpile: [{ value: { stock: "film-type", format: "135", quantity: 1 } }] },
      },
    );
    expect(compatibilityFindings(store).some((x) => x.kind === "format" && x.level === "warning")).toBe(false);
  });

  it("finds film-specific manufacturer recipes for selected film and developer", () => {
    const store = storeWith([], [], {
      catalog: {
        filmStock: [{ uri: "film-type", value: { brand: "ILFORD", name: "HP5 Plus" } }],
        developerType: [{ uri: "dev-type", value: { brand: "ILFORD", name: "ILFOTEC DD-X" } }],
      },
      instance: {
        filmStockpile: [{ value: { stock: "film-type", quantity: 2 } }],
        developer: [{ value: { type: "dev-type" } }],
      },
    });
    const recipes = matchingDevelopmentRecipes(store);
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes.every((r) => /hp5/i.test(r.filmName))).toBe(true);
  });
});

describe("openOnboarding", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("opens with named progress and explains shared models versus owned copies", async () => {
    await openOnboarding({ agent: mockAgent(), did: "did:plc:test", onDone: () => {} });
    const wizard = document.querySelector(".wizard");
    expect(wizard).toBeTruthy();
    expect(wizard.querySelector(".wizard-title").textContent).toMatch(/setup you actually use/i);
    expect(wizard.querySelector(".wizard-sub").textContent).toMatch(/shared model facts/i);
    expect(wizard.querySelector('[role="progressbar"]').textContent).toMatch(/step 1 of/i);
  });

  it("requires a practice and reveals the appropriate dynamic steps", async () => {
    await openOnboarding({ agent: mockAgent(), did: "did:plc:test", onDone: () => {} });
    document.querySelector(".wizard-foot button:last-child").click();
    expect(document.querySelector(".wizard-title").textContent).toMatch(/belongs in your setup/i);
    expect(document.querySelector(".wizard-foot button:last-child").disabled).toBe(true);
    const home = [...document.querySelectorAll(".wizard-practice")].find((x) => /process at home/i.test(x.textContent));
    home.click();
    expect(document.querySelector(".wizard-foot button:last-child").disabled).toBe(false);
    expect(readOnboardingState("did:plc:test").practices).toContain("film-home");
  });

  it("persists dismissal when Escape closes the dialog", async () => {
    let destination = null;
    await openOnboarding({ agent: mockAgent(), did: "did:plc:test", onDone: (next) => { destination = next; } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".wizard")).toBeNull();
    expect(readOnboardingState("did:plc:test").status).toBe("dismissed");
    expect(destination).toBe("setup");
  });
});
