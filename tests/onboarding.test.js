import { describe, it, expect, beforeEach } from "vitest";
import { detectMediums, needsOnboarding, openOnboarding } from "../src/ui/onboarding.js";
import { mockAgent } from "./setup.js";

function storeWith(cameraTypes, cameras) {
  const empty = { camera: [], lens: [], filmRoll: [], developer: [], scanner: [], chemistry: [], labAccount: [], storageLocation: [], enlarger: [], intermediate: [] };
  return {
    catalog: { cameraType: cameraTypes, lensType: [], filmStock: [] },
    instance: { ...empty, camera: cameras },
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
  it("detects instant, and mixed setups", () => {
    const store = storeWith(
      [{ uri: "t1", value: { format: "instax-mini" } }, { uri: "t2", value: { category: "film", format: "120" } }],
      [{ value: { type: "t1" } }, { value: { type: "t2" } }],
    );
    const m = detectMediums(store);
    expect(m.instant).toBe(true);
    expect(m.film).toBe(true);
    expect(m.any).toBe(true);
  });
  it("reports nothing for an empty setup", () => {
    expect(detectMediums(storeWith([], []))).toEqual({ film: false, digital: false, instant: false, any: false });
  });
});

describe("needsOnboarding", () => {
  it("is true when the user owns no gear", () => {
    expect(needsOnboarding(storeWith([], []))).toBe(true);
  });
  it("is false once any gear exists", () => {
    expect(needsOnboarding(storeWith([{ uri: "t1", value: {} }], [{ value: { type: "t1" } }]))).toBe(false);
  });
});

describe("openOnboarding", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  it("opens on a welcome step that explains what Hypo is", async () => {
    await openOnboarding({ agent: mockAgent(), did: "did:plc:test", onDone: () => {} });
    const wizard = document.querySelector(".wizard");
    expect(wizard).toBeTruthy();
    expect(wizard.querySelector(".wizard-title").textContent).toMatch(/build your setup/i);
    expect(wizard.querySelector(".wizard-sub").textContent).toMatch(/photographers/i);
    expect(wizard.querySelectorAll(".wizard-dot").length).toBeGreaterThan(3);
  });
});
