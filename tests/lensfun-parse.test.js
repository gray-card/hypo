import { describe, it, expect } from "vitest";
import {
  canonicalTag, allTags, parseLensSpecs, mapMount, cleanMaker, stripMakerPrefix,
  isGenericCamera, cropToFormat, prettyCameraModel, parseLenses, parseCameras, buildCatalog,
} from "../scripts/lensfun-parse.mjs";

// a realistic slice of the lensfun XML format
const SAMPLE = `
<lensdatabase>
  <lens>
    <maker>Nikon</maker>
    <model>Nikon AF Nikkor 50mm f/1.8D</model>
    <model lang="en">Nikkor AF 50mm f/1.8D</model>
    <mount>Nikon F AF</mount>
    <cropfactor>1</cropfactor>
  </lens>
  <lens>
    <maker>Canon</maker>
    <model>Canon EF 24-70mm f/2.8L II USM</model>
    <mount>Canon EF</mount>
  </lens>
  <lens>
    <maker>Nikon</maker>
    <model>Nikon film: full frame</model>
    <mount>Nikon F</mount>
  </lens>
  <camera>
    <maker>Sony</maker>
    <model>Sony ILCE-7M3</model>
    <mount>Sony E</mount>
    <cropfactor>1</cropfactor>
  </camera>
  <camera>
    <maker>Generic</maker>
    <model>Crop-factor 1.0 (Full Frame)</model>
    <cropfactor>1</cropfactor>
  </camera>
  <camera>
    <maker>Nikon Corporation</maker>
    <model>Nikon D850</model>
    <mount>Nikon F</mount>
    <cropfactor>1.05</cropfactor>
  </camera>
</lensdatabase>`;

describe("canonicalTag", () => {
  it("prefers the non-localized value", () => {
    const block = `<model>Nikon AF Nikkor 50mm f/1.8D</model><model lang="en">Nikkor AF 50mm f/1.8D</model>`;
    expect(canonicalTag(block, "model")).toBe("Nikon AF Nikkor 50mm f/1.8D");
  });
  it("falls back to the first tag when only a localized one exists", () => {
    expect(canonicalTag(`<model lang="de">Objektiv</model>`, "model")).toBe("Objektiv");
  });
  it("returns null when the tag is absent", () => {
    expect(canonicalTag(`<maker>Nikon</maker>`, "model")).toBe(null);
  });
});

describe("parseLensSpecs", () => {
  it("parses a prime", () => {
    expect(parseLensSpecs("Nikkor 50mm f/1.8")).toEqual({ focalLengthMin: 50, focalLengthMax: 50, maxAperture: 1.8, lensTypeKind: "prime" });
  });
  it("parses a zoom with an aperture range", () => {
    const s = parseLensSpecs("AF-S 24-70mm f/2.8");
    expect(s.focalLengthMin).toBe(24);
    expect(s.focalLengthMax).toBe(70);
    expect(s.maxAperture).toBe(2.8);
    expect(s.lensTypeKind).toBe("zoom");
  });
  it("copes with no parseable spec", () => {
    expect(parseLensSpecs("Some Mystery Lens")).toEqual({ focalLengthMin: null, focalLengthMax: null, maxAperture: null, lensTypeKind: "prime" });
  });
});

describe("mapMount / cleanMaker / stripMakerPrefix", () => {
  it("aliases mount variants", () => {
    expect(mapMount("Nikon F AF")).toBe("Nikon F");
    expect(mapMount("Canon EF-S")).toBe("Canon EF");
    expect(mapMount("Sony E")).toBe("Sony E");
    expect(mapMount(null)).toBe(null);
  });
  it("strips corporate suffixes from makers", () => {
    expect(cleanMaker("Nikon Corporation")).toBe("Nikon");
    expect(cleanMaker("LEICA CAMERA AG")).toBe("LEICA CAMERA");
    expect(cleanMaker("Eastman Kodak Company")).toBe("Eastman Kodak");
  });
  it("strips a leading maker prefix from a model", () => {
    expect(stripMakerPrefix("Nikon D850", "Nikon")).toBe("D850");
    expect(stripMakerPrefix("D850", "Nikon")).toBe("D850");
  });
});

describe("isGenericCamera", () => {
  it("filters the generic format markers lensfun ships", () => {
    expect(isGenericCamera("Generic", "Crop-factor 1.0 (Full Frame)")).toBe(true);
    expect(isGenericCamera("Nikon", "35mm film: full frame")).toBe(true);
    expect(isGenericCamera("Nikon", "D850")).toBe(false);
  });
});

describe("cropToFormat", () => {
  it("buckets crop factors", () => {
    expect(cropToFormat(0.79)).toBe("medium-format-digital");
    expect(cropToFormat(1)).toBe("full-frame-digital");
    expect(cropToFormat(1.05)).toBe("full-frame-digital");
    expect(cropToFormat(1.5)).toBe("aps-c-digital");
    expect(cropToFormat(2)).toBe("other");
  });
});

describe("prettyCameraModel (EXIF code -> human name)", () => {
  it("maps the machine-coded makers", () => {
    expect(prettyCameraModel("Sony", "ILCE-7M3")).toBe("A7 III");
    expect(prettyCameraModel("Sony", "ILCE-7RM4")).toBe("A7R IV");
    expect(prettyCameraModel("Sony", "DSC-RX100M7")).toBe("RX100 VII");
    expect(prettyCameraModel("Panasonic", "DC-S5M2")).toBe("S5 II");
    expect(prettyCameraModel("Panasonic", "DC-GX7MK3")).toBe("GX7 III");
    expect(prettyCameraModel("Nikon", "Z 6_2")).toBe("Z6 II");
    expect(prettyCameraModel("Nikon", "Z5_2")).toBe("Z5 II");
    expect(prettyCameraModel("Canon", "EOS R5m2")).toBe("EOS R5 Mark II");
    expect(prettyCameraModel("Olympus", "E-M1MarkII")).toBe("E-M1 Mark II");
    expect(prettyCameraModel("Leica", "M9 Digital Camera")).toBe("M9");
  });
  it("leaves already-friendly names untouched", () => {
    expect(prettyCameraModel("Nikon", "D850")).toBe("D850");
    expect(prettyCameraModel("Fujifilm", "X-T4")).toBe("X-T4");
  });
});

describe("parseLenses", () => {
  const lenses = parseLenses(SAMPLE);
  it("extracts the nifty fifty with the canonical model, aliased mount, and specs", () => {
    const fifty = lenses.find((l) => /50mm f\/1\.8D/.test(l.model));
    expect(fifty).toBeTruthy();
    expect(fifty.model).toBe("Nikon AF Nikkor 50mm f/1.8D");
    expect(fifty.make).toBe("Nikon");
    expect(fifty.mount).toBe("Nikon F");            // "Nikon F AF" aliased
    expect(fifty.maxAperture).toBe(1.8);
    expect(fifty.lensTypeKind).toBe("prime");
  });
  it("skips the film-format calibration markers", () => {
    expect(lenses.some((l) => /film:/i.test(l.model))).toBe(false);
  });
});

describe("parseCameras", () => {
  const cams = parseCameras(SAMPLE);
  it("prettifies EXIF codes and derives format/mount", () => {
    const sony = cams.find((c) => c.make === "Sony");
    expect(sony.model).toBe("A7 III");
    expect(sony.exifModel).toBe("ILCE-7M3");
    expect(sony.format).toBe("full-frame-digital");
    expect(sony.mount).toBe("Sony E");
  });
  it("filters generic markers and cleans makers", () => {
    expect(cams.some((c) => /generic|crop-factor/i.test(c.make + c.model))).toBe(false);
    expect(cams.find((c) => c.model === "D850").make).toBe("Nikon");
  });
});

describe("buildCatalog", () => {
  it("dedupes across files and sorts, keeping the nifty fifty", () => {
    const { lenses, cameras } = buildCatalog([SAMPLE, SAMPLE]); // same file twice
    // 2 real lenses (film marker dropped), deduped despite duplication
    expect(lenses.filter((l) => /50mm f\/1\.8D/.test(l.model))).toHaveLength(1);
    expect(lenses).toHaveLength(2);
    expect(cameras).toHaveLength(2); // Sony + Nikon, generic dropped
    // sorted by make+model
    const labels = lenses.map((l) => l.make + l.model);
    expect(labels).toEqual([...labels].sort());
  });
});
