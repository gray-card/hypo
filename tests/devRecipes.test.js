import { describe, it, expect } from "vitest";
import {
  estimateGeneralBWTemperatureTime,
  parseMMSS,
  publishedTemps,
  recipeRecommendationStatus,
  resolveTimeRecommendation,
  resolveTimeSec,
} from "../src/devRecipes.js";

describe("estimateGeneralBWTemperatureTime", () => {
  it("matches the Ilford chart relationship and 15-second rounding", () => {
    expect(estimateGeneralBWTemperatureTime(8 * 60, 200, 240)).toMatchObject({
      timeSec: 5 * 60 + 30,
      referenceTimeSec: 8 * 60,
      referenceTempC10: 200,
      targetTempC10: 240,
      roundingIncrementSec: 15,
      belowRecommendedMinimum: false,
      largeTemperatureChange: true,
    });
    expect(estimateGeneralBWTemperatureTime(5 * 60, 200, 180)?.timeSec).toBe(6 * 60);
  });

  it("warns below five minutes and refuses values outside the chart range", () => {
    expect(estimateGeneralBWTemperatureTime(5 * 60, 200, 220)?.belowRecommendedMinimum).toBe(true);
    expect(estimateGeneralBWTemperatureTime(8 * 60, 200, 280)).toBeNull();
    expect(estimateGeneralBWTemperatureTime(0, 200, 220)).toBeNull();
  });
});

describe("resolveTimeSec — datasheet-only, no extrapolation", () => {
  const single = { temps: [{ tempC10: 200, timeSec: 405 }] };
  const multi = {
    temps: [
      { tempC10: 200, timeSec: 600 },
      { tempC10: 240, timeSec: 300 },
    ],
    recommendationStatus: "manufacturer-supported",
    interpolationAllowed: true,
    interpolationMethod: "linear",
  };

  it("returns the exact published point", () => {
    expect(resolveTimeSec(single, 200)).toBe(405);
    expect(resolveTimeSec(multi, 240)).toBe(300);
  });

  it("interpolates linearly between two published points", () => {
    // halfway between 20°C(600s) and 24°C(300s) is 22°C → 450s
    expect(resolveTimeSec(multi, 220)).toBe(450);
    // a quarter of the way: 21°C → 600 - 0.25*300 = 525
    expect(resolveTimeSec(multi, 210)).toBe(525);
  });

  it("does not interpolate unless the recipe explicitly permits it", () => {
    const forbidden = { ...multi, interpolationAllowed: false };
    const unspecified = { temps: multi.temps };
    expect(resolveTimeSec(forbidden, 220)).toBeNull();
    expect(resolveTimeSec(unspecified, 220)).toBeNull();
  });

  it("preserves exact published rows even when interpolation is forbidden", () => {
    const forbidden = { ...multi, interpolationAllowed: false };
    expect(resolveTimeSec(forbidden, 200)).toBe(600);
    expect(resolveTimeRecommendation(forbidden, 200)).toMatchObject({
      timeSec: 600,
      kind: "published",
      derived: false,
      recommendationStatus: "manufacturer-supported",
    });
  });

  it("marks an allowed interpolation as a derived recommendation", () => {
    expect(resolveTimeRecommendation(multi, 220)).toMatchObject({
      timeSec: 450,
      tempC10: 220,
      kind: "interpolated",
      derived: true,
      recommendationStatus: "derived",
      interpolationMethod: "linear",
      points: [multi.temps[0], multi.temps[1]],
    });
  });

  it("marks published recipe rows as derived when their stored value is derived", () => {
    const derived = { ...multi, derived: true, interpolationAllowed: false };
    expect(recipeRecommendationStatus(derived)).toBe("derived");
    expect(resolveTimeRecommendation(derived, 200)).toMatchObject({
      kind: "published",
      derived: true,
      recommendationStatus: "derived",
    });
  });

  it("never extrapolates outside the published range", () => {
    expect(resolveTimeSec(single, 220)).toBeNull(); // single point, other temp unsupported
    expect(resolveTimeSec(multi, 260)).toBeNull(); // above the highest published temp
    expect(resolveTimeSec(multi, 190)).toBeNull(); // below the lowest published temp
  });

  it("publishedTemps returns ascending tenths-°C points", () => {
    expect(publishedTemps(multi)).toEqual([200, 240]);
  });
});

describe("parseMMSS", () => {
  it("parses m:ss and bare seconds", () => {
    expect(parseMMSS("6:45")).toBe(405);
    expect(parseMMSS("405")).toBe(405);
    expect(parseMMSS("0:30")).toBe(30);
  });
  it("rejects nonsense", () => {
    expect(parseMMSS("")).toBeNull();
    expect(parseMMSS("abc")).toBeNull();
    expect(parseMMSS("6:99")).toBeNull();
  });
});
