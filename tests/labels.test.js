import { describe, it, expect } from "vitest";
import {
  kindLabel, kindLabelPlural, enumLabel, collectionLabel, humanize, GEAR_GROUPS,
} from "../src/ui/labels.js";

describe("kindLabel / kindLabelPlural", () => {
  it("gives human singular and plural for instance kinds", () => {
    expect(kindLabel("camera")).toBe("Camera");
    expect(kindLabelPlural("camera")).toBe("Cameras");
    expect(kindLabel("filmRoll")).toBe("Roll");
    expect(kindLabelPlural("lens")).toBe("Lenses");
    expect(kindLabelPlural("enlarger")).toBe("Darkroom");
  });

  it("never returns the raw camelCase identifier", () => {
    for (const k of ["cameraType", "filmStock", "developerType", "labAccount", "storageLocation"]) {
      expect(kindLabel(k)).not.toBe(k);
      expect(kindLabel(k)).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it("falls back to humanize for unknown kinds", () => {
    expect(kindLabel("somethingNew")).toBe("Something new");
  });
});

describe("enumLabel", () => {
  it("expands known process codes", () => {
    expect(enumLabel("c41")).toBe("C-41");
    expect(enumLabel("e6")).toBe("E-6");
    expect(enumLabel("bw")).toBe("Black & white");
    expect(enumLabel("cla")).toBe("CLA (clean, lube, adjust)");
    expect(enumLabel("full-frame-digital")).toBe("Full-frame (digital)");
  });

  it("leaves proper-noun mount names intact", () => {
    expect(enumLabel("Nikon F")).toBe("Nikon F");
    expect(enumLabel("Canon EF")).toBe("Canon EF");
    expect(enumLabel("Micro Four Thirds")).toBe("Micro Four Thirds");
  });

  it("humanizes plain kebab values", () => {
    expect(enumLabel("sensor-clean")).toBe("Sensor clean");
    expect(enumLabel("")).toBe("");
    expect(enumLabel(null)).toBe("");
  });
});

describe("collectionLabel", () => {
  it("maps grain + graycard collections to friendly names", () => {
    expect(collectionLabel("social.grain.gallery")).toBe("Gallery");
    expect(collectionLabel("app.graycard.process.developSession")).toBe("Development");
    expect(collectionLabel("app.graycard.scene.graph")).toBe("Scene");
  });
  it("derives a label from the tail for catalog/instance collections", () => {
    expect(collectionLabel("app.graycard.catalog.cameraType")).toBe("Camera");
    expect(collectionLabel("app.graycard.instance.camera")).toBe("Camera");
  });
});

describe("humanize", () => {
  it("splits camelCase and fixes acronyms", () => {
    expect(humanize("cameraType")).toBe("Camera type");
    expect(humanize("iso")).toBe("ISO");
    expect(humanize("exifModel")).toBe("EXIF model");
    expect(humanize("scene-graph")).toBe("Scene graph");
  });
});

describe("GEAR_GROUPS", () => {
  it("is an ordered list of {kind, icon} with camera first", () => {
    expect(Array.isArray(GEAR_GROUPS)).toBe(true);
    expect(GEAR_GROUPS[0].kind).toBe("camera");
    for (const g of GEAR_GROUPS) {
      expect(typeof g.kind).toBe("string");
      expect(typeof g.icon).toBe("string");
    }
  });
});
