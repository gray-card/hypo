import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { geoToScaled, scaledToGeo } from "../src/graycard.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lex = (p) => JSON.parse(readFileSync(join(ROOT, "lexicons/app/graycard", p), "utf8"));

describe("data model covers everything the Frames app records", () => {
  const exposure = lex("instance/exposure.json").defs.main.record.properties;
  const defs = lex("defs.json").defs;
  const geo = defs.geoLocation.properties;
  const placemark = defs.placemark.properties;
  const shoot = lex("session/capture.json").defs.main.record.properties;

  it("per-frame exposure settings Frames logs are all present", () => {
    for (const f of ["aperture", "shutterSpeed", "exposureCompensation", "focalLength",
      "focusDistance", "meteringMode", "exposureProgram", "flash", "shotAtIso",
      "frameNumber", "takenAt", "note"]) {
      expect(exposure[f], `exposure.${f}`).toBeTruthy();
    }
  });

  it("per-frame gear links (lens, filter, camera, roll) + photo are present", () => {
    for (const f of ["lens", "filter", "camera", "roll", "photo", "shoot"]) {
      expect(exposure[f], `exposure.${f}`).toBeTruthy();
    }
  });

  it("multiple exposures on one frame are representable", () => {
    // several exposures share roll + frameNumber; the flag + sub-index make it explicit
    expect(exposure.multipleExposure.type).toBe("boolean");
    expect(exposure.frameExposureIndex.type).toBe("integer");
  });

  it("location (lat/lon/altitude) + reverse-geocoded placemark are modeled", () => {
    for (const f of ["latitude", "longitude", "altitude"]) expect(geo[f]).toBeTruthy();
    for (const f of ["name", "locality", "postalCode", "administrativeArea", "country"]) {
      expect(placemark[f], `placemark.${f}`).toBeTruthy();
    }
    expect(exposure.location.ref).toBe("app.graycard.defs#geoLocation");
  });

  it("filter is full gear (a catalog type + kind enum)", () => {
    const filterType = lex("catalog/filterType.json").defs.main.record.properties;
    expect(filterType.make).toBeTruthy();
    expect(filterType.filterKind.ref).toBe("app.graycard.defs#filterKind");
    expect(defs.filterKind.knownValues).toContain("contrast");
  });

  it("a shoot holds multiple cameras, lenses and rolls", () => {
    expect(shoot.cameras.type).toBe("array");
    expect(shoot.lenses.type).toBe("array");
    expect(shoot.rolls.type).toBe("array");
    expect(shoot.places.type).toBe("array");
    expect(shoot.places.items.ref).toBe("app.graycard.defs#geoLocation");
  });
});

describe("geo scaling round-trips", () => {
  it("scales lat/lon by 1e7 and altitude to millimetres", () => {
    const s = geoToScaled({ latitude: 43.144814, longitude: -77.521724, altitude: 131.8, accuracy: 5 });
    expect(s.latitude).toBe(431448140);
    expect(s.longitude).toBe(-775217240);
    expect(s.altitude).toBe(131800);
    expect(s.accuracy).toBe(5000);
    const back = scaledToGeo(s);
    expect(back.latitude).toBeCloseTo(43.144814, 6);
    expect(back.longitude).toBeCloseTo(-77.521724, 6);
    expect(back.altitude).toBeCloseTo(131.8, 3);
  });
});
