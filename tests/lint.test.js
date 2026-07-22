import { describe, it, expect } from "vitest";
import { computeLintFindings } from "../src/lint.js";

const NOW = Date.parse("2026-07-07T00:00:00Z");

function store() {
  return {
    instance: {
      filmRoll: [
        { uri: "r1", value: { exposuresTotal: 36, exposuresUsed: 38, status: "exposed" } }, // overshot + awaiting
        { uri: "r2", value: { status: "developed" } },
      ],
      exposure: [
        { uri: "e1", value: { photo: "at://did/social.grain.photo/p1" } },
        { uri: "e2", value: {} },   // unlinked
      ],
      chemistry: [
        { uri: "c1", value: { expiresAt: "2026-01-01T00:00:00Z", volumeMl: 1000, volumeRemainingMl: 500 } }, // expired
        { uri: "c2", value: { volumeMl: 1000, volumeRemainingMl: 0 } },                                       // spent
      ],
    },
    photoCaptureByPhoto: new Map([
      ["p1", { value: { camera: "cam", lens: "lens" } }],
      ["p2", { value: { camera: "cam" } }],   // no lens
      ["p3", { value: {} }],                   // no camera, no lens
    ]),
  };
}

describe("computeLintFindings", () => {
  const f = computeLintFindings(store(), NOW);
  const by = (id) => f.find((x) => x.id === id);

  it("flags rolls over their frame count", () => expect(by("roll-overshot").count).toBe(1));
  it("flags rolls awaiting development", () => expect(by("roll-awaiting-dev").count).toBe(1));
  it("flags unlinked exposures", () => expect(by("exposure-unlinked").count).toBe(1));
  it("flags expired chemistry", () => expect(by("chem-expired").count).toBe(1));
  it("flags spent chemistry", () => expect(by("chem-spent").count).toBe(1));
  it("counts photos missing camera / lens", () => {
    expect(by("cap-no-camera").count).toBe(1);
    expect(by("cap-no-lens").count).toBe(2);
  });

  it("returns nothing for a clean store", () => {
    const clean = { instance: { filmRoll: [], exposure: [], chemistry: [] }, photoCaptureByPhoto: new Map() };
    expect(computeLintFindings(clean, NOW)).toEqual([]);
  });
});
