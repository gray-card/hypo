import { describe, it, expect } from "vitest";
import { PRESETS, ENUMS, MANUFACTURERS, FIELD_ENUMS } from "../src/data/presets.js";

describe("camera catalog (curated + lensfun merge)", () => {
  const cams = PRESETS.cameraType.items;
  const has = (make, model) => cams.some((c) => c.make === make && c.model === model);

  it("retains curated film bodies", () => {
    expect(has("Nikon", "FM2")).toBe(true);
    expect(has("Leica", "M6")).toBe(true);
    expect(has("Hasselblad", "500C/M")).toBe(true);
  });
  it("keeps the verified digital supplement lensfun lacks", () => {
    expect(has("Ricoh", "GR II")).toBe(true);
    expect(has("Sigma", "dp2 Quattro")).toBe(true);
  });
  it("includes lensfun digital bodies with human names, not EXIF codes", () => {
    expect(has("Sony", "A7 III")).toBe(true);
    expect(has("Panasonic", "S5 II")).toBe(true);
    expect(has("Nikon", "Z6 II")).toBe(true);
    expect(cams.some((c) => /ILCE-|DC-S|Z \d_/.test(c.model))).toBe(false);
  });
  it("has instant bodies and a sane total", () => {
    expect(has("Polaroid", "SX-70")).toBe(true);
    expect(cams.length).toBeGreaterThan(1000);
  });
  it("has no duplicate make+model", () => {
    const seen = new Set();
    const dupes = [];
    for (const c of cams) {
      const k = `${c.make}||${c.model}`;
      if (seen.has(k)) dupes.push(k);
      seen.add(k);
    }
    expect(dupes).toEqual([]);
  });
});

describe("lens catalog", () => {
  it("has the full lensfun set and a maker-qualified label", () => {
    const lenses = PRESETS.lensType.items;
    expect(lenses.length).toBeGreaterThan(1000);
    const l = lenses.find((x) => x.make && !x.model.toLowerCase().startsWith(x.make.toLowerCase()));
    if (l) expect(PRESETS.lensType.label(l)).toBe(`${l.make} ${l.model}`);
  });
});

describe("enum data", () => {
  it("exposes the enums the forms rely on", () => {
    expect(ENUMS.rollStatus).not.toContain("stored"); // the "in stock" state was removed
    expect(ENUMS.rollStatus[0]).toBe("loaded");        // a roll starts life loaded
    expect(FIELD_ENUMS.status).toContain("loaded");
    expect(FIELD_ENUMS.format).toContain("135");
    // level-of-analysis fixes hold: no paper-print process in film process, etc.
    expect(ENUMS.process).not.toContain("ra4");
    expect(ENUMS.filmType).not.toContain("motion-picture");
  });
  it("manufacturers are unique and sorted", () => {
    const sorted = [...MANUFACTURERS].sort((a, b) => a.localeCompare(b));
    expect(MANUFACTURERS).toEqual(sorted);
    expect(new Set(MANUFACTURERS).size).toBe(MANUFACTURERS.length);
  });
});

describe("film rebrands are aka-linked (same emulsion, two names)", () => {
  const films = PRESETS.filmStock.items;
  const find = (name) => films.find((f) => f.brand === "Kodak" && f.name === name);

  // Eastman Kodak's 2026 in-house rebrands: each name resolves to its counterpart.
  const PAIRS = [
    ["Portra 160", "Ektacolor Pro 160"],
    ["Portra 400", "Ektacolor Pro 400"],
    ["Portra 800", "Ektacolor Pro 800"],
    ["T-Max 100", "Ektapan 100"],
    ["T-Max 400", "Ektapan 400"],
    ["T-Max P3200", "Ektapan P3200"],
    ["Pro Image 100", "Kodacolor 100"],
    ["ColorPlus 200", "Kodacolor 200"],
  ];

  it("links every rebrand pair in both directions", () => {
    for (const [a, b] of PAIRS) {
      expect(find(a), a).toBeTruthy();
      expect(find(b), b).toBeTruthy();
      expect(find(a).aka, `${a} -> ${b}`).toContain(b);
      expect(find(b).aka, `${b} -> ${a}`).toContain(a);
    }
  });

  it("adds Kodacolor as the new name for Pro Image / ColorPlus", () => {
    expect(find("Kodacolor 100")).toMatchObject({ iso: 100, filmType: "color-negative", process: "c41" });
    expect(find("Kodacolor 200")).toMatchObject({ iso: 200, filmType: "color-negative", process: "c41" });
  });

  it("leaves unrebranded stocks without an aka", () => {
    expect(find("Gold 200").aka).toBeUndefined();
    expect(find("Ektar 100").aka).toBeUndefined();
  });
});

describe("developer and chemistry datasheets", () => {
  const allowedHosts = new Set([
    "business.kodakmoments.com",
    "cdn.shopify.com",
    "cinestillfilm.com",
    "site.photoformulary.com",
    "www.adox.de",
    "www.bellinifoto.it",
    "www.foma.cz",
    "www.ilfordphoto.com",
    "www.kodakprofessional.com",
    "www.moersch-photochemie.de",
  ]);

  it("uses optional HTTPS manufacturer references on 24 of 27 developers", () => {
    const items = PRESETS.developerType.items;
    const unresolved = items.filter((i) => !i.datasheetUrl).map((i) => `${i.brand} ${i.name}`);
    expect(items.filter((i) => i.datasheetUrl)).toHaveLength(24);
    expect(unresolved).toEqual([
      "Kodak D-23",
      "Diafine Diafine Two-Bath",
      "Tetenal Colortec C-41",
    ]);
    for (const item of items.filter((i) => i.datasheetUrl)) {
      const url = new URL(item.datasheetUrl);
      expect(url.protocol, `${item.brand} ${item.name}`).toBe("https:");
      expect(allowedHosts.has(url.hostname), `${item.brand} ${item.name}: ${url.hostname}`).toBe(true);
    }
  });

  it("uses optional HTTPS manufacturer references on 13 of 15 ancillary chemistries", () => {
    const items = PRESETS.chemistryType.items;
    const unresolved = items.filter((i) => !i.datasheetUrl).map((i) => `${i.brand} ${i.name}`);
    expect(items.filter((i) => i.datasheetUrl)).toHaveLength(13);
    expect(unresolved).toEqual([
      "Kodak C-41 Blix",
      "Kodak Selenium Toner",
    ]);
    for (const item of items.filter((i) => i.datasheetUrl)) {
      const url = new URL(item.datasheetUrl);
      expect(url.protocol, `${item.brand} ${item.name}`).toBe("https:");
      expect(allowedHosts.has(url.hostname), `${item.brand} ${item.name}: ${url.hostname}`).toBe(true);
    }
  });
});
