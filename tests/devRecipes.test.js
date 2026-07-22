import { describe, it, expect } from "vitest";
import { resolveTimeSec, publishedTemps, parseMMSS } from "../src/devRecipes.js";

describe("resolveTimeSec — datasheet-only, no extrapolation", () => {
  const single = { temps: [{ tempC10: 200, timeSec: 405 }] };
  const multi = { temps: [{ tempC10: 200, timeSec: 600 }, { tempC10: 240, timeSec: 300 }] };

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

  it("never extrapolates outside the published range", () => {
    expect(resolveTimeSec(single, 220)).toBeNull();   // single point, other temp unsupported
    expect(resolveTimeSec(multi, 260)).toBeNull();    // above the highest published temp
    expect(resolveTimeSec(multi, 190)).toBeNull();    // below the lowest published temp
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
