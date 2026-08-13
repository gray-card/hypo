import { describe, expect, it } from "vitest";
import {
  apertureForEv100,
  applyReciprocity,
  cineShutterSeconds,
  ev100FromExposure,
  ev100FromLuminance,
  ev100FromLux,
  footCandlesToLux,
  footLambertsToLuminance,
  luminanceFromEv100,
  luxFromEv100,
  parseReciprocityModel,
  shutterForEv100,
} from "../packages/domain/src/index.ts";

describe("ISO 2720 meter domain", () => {
  it("round-trips exposure solutions across ISO", () => {
    const ev = ev100FromExposure(16, 1 / 125, 100);
    // Nominal 1/125 s is a rounded third-stop value, so the exact EV is 14.966.
    expect(ev).toBeCloseTo(15, 1);
    expect(shutterForEv100(ev, 16, 100)).toBeCloseTo(1 / 125, 12);
    expect(apertureForEv100(ev, 1 / 500, 400)).toBeCloseTo(16, 12);
  });

  it("round-trips incident and reflected photometry with explicit constants", () => {
    const incident = ev100FromLux(2.5 * 2 ** 12, 250);
    expect(incident).toBe(12);
    expect(luxFromEv100(incident, 250)).toBe(10_240);

    const reflected = ev100FromLuminance(0.125 * 2 ** 12, 12.5);
    expect(reflected).toBe(12);
    expect(luminanceFromEv100(reflected, 12.5)).toBe(512);
  });

  it("converts display units and cine shutter angle", () => {
    expect(footCandlesToLux(1)).toBeCloseTo(10.7639104167, 10);
    expect(footLambertsToLuminance(1)).toBeCloseTo(3.4262590996, 10);
    expect(cineShutterSeconds(24, 180)).toBeCloseTo(1 / 48, 12);
  });
});

describe("film reciprocity", () => {
  it("parses and applies the Ilford HP5 manufacturer power law", () => {
    const model = parseReciprocityModel({ notes: "Reciprocity Ta=Tm^1.31. Datasheet Nov 2018." });
    expect(model).toMatchObject({ kind: "power-law", exponent: 1.31 });
    expect(model && applyReciprocity(model, 10).correctedSeconds).toBeCloseTo(20.417, 3);
  });

  it("normalizes scaled correction points and interpolates in log-time", () => {
    const model = parseReciprocityModel({
      reciprocityPoints: [
        { meteredSeconds: 1, correctionStops: { value: 5, scale: 10, unit: "stop" } },
        { meteredSeconds: 100, correctionStops: { value: 2, unit: "stop" } },
      ],
    });
    expect(model).toMatchObject({ kind: "points" });
    expect(model && applyReciprocity(model, 10).correctionStops).toBeCloseTo(1.25, 10);
  });

  it("returns null when a stock publishes no machine-readable rule", () => {
    expect(parseReciprocityModel({ reciprocity: "Consult the latest datasheet" })).toBeNull();
  });
});
