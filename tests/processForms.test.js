import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGE_PROCESS_KIND,
  buildProcessSessionForm,
  resolveWorkingSolutionUri,
  stageExtraFields,
} from "../src/ui/processForms.js";

vi.mock("../src/ui/library.js", () => {
  const select = (value = "") => {
    const element = document.createElement("select");
    element.append(new Option("(none)", ""), new Option(value || "selected", value || "selected"));
    element.value = value;
    return element;
  };
  return {
    catalogSelect: (_kind, value) => select(value),
    chemistrySelect: (value) => select(value),
    instanceSelect: (_kind, value) => select(value),
    shootSelect: (value) => select(value),
  };
});

const store = {
  catalog: { devRecipe: [] },
  instance: {
    chemistry: [{ uri: "at://chemistry", value: {} }],
  },
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("process form TypeScript compatibility facade", () => {
  it("exports stage mappings and resolves working-solution record kinds", () => {
    expect(STAGE_PROCESS_KIND.develop).toBe("developSession");
    expect(STAGE_PROCESS_KIND.capture).toBeUndefined();
    expect(STAGE_PROCESS_KIND.digital).toBe("renderSession");
    expect(resolveWorkingSolutionUri("at://chemistry", store)).toEqual({ chemistry: "at://chemistry" });
    expect(resolveWorkingSolutionUri("at://legacy", store)).toEqual({ chemistry: "at://legacy" });
    expect(resolveWorkingSolutionUri("", store)).toEqual({});
  });

  it("retains required edit-session validation and trims values", () => {
    const form = buildProcessSessionForm("editSession", store, { preset: "Portra" });
    document.body.append(...form.nodes);
    expect(() => form.read()).toThrow("Software is required");

    document.querySelector('[data-key="software"]').value = "  Darktable  ";
    const record = form.read();
    expect(record).toMatchObject({ software: "Darktable", preset: "Portra" });
    expect(record.createdAt).toEqual(expect.any(String));
  });

  it("reads digitize measurements and integer settings unchanged", () => {
    const form = buildProcessSessionForm("digitizeSession", store, {
      method: "dedicated-film-scanner",
      resolution: { value: 300, unit: "dpi" },
      bitDepth: 16,
      inversionMethod: "software-auto",
    });
    const record = form.read();
    expect(record).toMatchObject({
      method: "dedicated-film-scanner",
      resolution: { value: 300_000_000, scale: 1_000_000, unit: "dpi" },
      bitDepth: 16,
      inversionMethod: "software-auto",
    });
  });

  it("records render output settings without the removed general digital-session fields", () => {
    const form = buildProcessSessionForm("renderSession", store, {
      software: "Gray Card",
      outputFormat: "image/jpeg",
      colorSpace: "Display P3",
    });
    expect(form.read()).toMatchObject({
      software: "Gray Card",
      outputFormat: "image/jpeg",
      colorSpace: "Display P3",
      createdAt: expect.any(String),
    });
  });

  it("preserves stage-specific capture and custom fields", () => {
    expect(stageExtraFields("capture", store, { shoot: "at://shoot" }).read()).toEqual({
      shoot: "at://shoot",
    });
    expect(stageExtraFields("other", store, { kind: "cyanotype" }).read()).toEqual({ kind: "cyanotype" });
    expect(stageExtraFields("print", store).read()).toEqual({});
  });
});
