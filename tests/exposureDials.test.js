import { describe, it, expect } from "vitest";
import {
  buildApertureOptions, buildShutterOptions,
  displayToShutterScaled, scaledShutterToDial, scaledApertureToDial,
  usesExactApertureSteps, usesExactShutterSteps,
  parseScaledList,
} from "../src/exposureDials.js";
import { displayToScaled } from "../src/graycard.js";

const S = 1_000_000;

describe("exposureDials", () => {
  it("round-trips shutter display values", () => {
    expect(scaledShutterToDial(displayToShutterScaled("1/500"))).toBe("1/500");
    expect(scaledShutterToDial(displayToShutterScaled("2s"))).toBe("2s");
  });

  it("uses exact aperture steps when provided", () => {
    const lens = { apertureSteps: [2_800_000, 4_000_000, 5_600_000] };
    expect(buildApertureOptions(lens)).toEqual(["2.8", "4", "5.6"]);
    expect(usesExactApertureSteps(lens)).toBe(true);
  });

  it("bounds aperture by min and max f-number", () => {
    const lens = { maxAperture: 2_800_000, minAperture: 8_000_000 };
    const opts = buildApertureOptions(lens, "1");
    expect(opts[0]).toBe("2.8");
    expect(opts[opts.length - 1]).toBe("8");
    expect(opts.every((a) => parseFloat(a) >= 2.8 && parseFloat(a) <= 8)).toBe(true);
  });

  it("uses exact shutter steps when provided", () => {
    const camera = { shutterSpeedSteps: [displayToShutterScaled("1/1000"), displayToShutterScaled("1/125"), displayToShutterScaled("1s")] };
    expect(buildShutterOptions(camera)).toEqual(["1/1000", "1/125", "1s"]);
    expect(usesExactShutterSteps(camera)).toBe(true);
  });

  it("bounds shutter by min and max duration", () => {
    const camera = {
      minShutterSpeed: displayToShutterScaled("1/1000"),
      maxShutterSpeed: displayToShutterScaled("1s"),
    };
    const opts = buildShutterOptions(camera, "1/3");
    expect(opts.includes("1/1000")).toBe(true);
    expect(opts.includes("1s")).toBe(true);
    expect(opts.includes("30s")).toBe(false);
    expect(opts.includes("1/8000")).toBe(false);
  });

  it("parses comma-separated scaled lists", () => {
    const apertures = parseScaledList("2.8, 4, 5.6", displayToScaled);
    expect(apertures.map(scaledApertureToDial)).toEqual(["2.8", "4", "5.6"]);
  });
});
