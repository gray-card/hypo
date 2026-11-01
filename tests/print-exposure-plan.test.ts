import { describe, expect, it } from "vitest";
import {
  exposurePlanSnapshot,
  exposureTimeline,
  validateExposurePlan,
  developmentPlanSnapshot,
  validateDevelopmentPlan,
} from "@hypo/domain";
import { NS, validateRecord } from "@hypo/lexicon";

const photo = "at://did:plc:test/social.grain.photo/reference";

function printPlan() {
  return {
    name: "Split-grade portrait",
    referencePhoto: photo,
    imageWidth: 4000,
    imageHeight: 3000,
    exposures: [
      { id: "soft", action: "base" as const, durationMs: 12000, grade: "00" },
      {
        id: "face",
        action: "dodge" as const,
        baseId: "soft",
        startOffsetMs: 2000,
        durationMs: 3000,
        targetLabel: "face",
        selections: [{ kind: "brush" as const, points: [{ x: 5000, y: 4500 }], width: 300 }],
      },
      { id: "hard", action: "base" as const, durationMs: 8000, grade: "5" },
      {
        id: "sky",
        action: "burn" as const,
        durationMs: 5000,
        grade: "2",
        targetLabel: "sky",
        selections: [
          {
            kind: "polygon" as const,
            points: [
              { x: 0, y: 0 },
              { x: 10000, y: 0 },
              { x: 10000, y: 3200 },
              { x: 0, y: 3200 },
            ],
          },
        ],
      },
    ],
    createdAt: "2026-11-01T12:00:00Z",
  };
}

describe("print exposure plans", () => {
  it("stores split-grade base exposures, timed overlapping dodge, burn, and image geometry", () => {
    const plan = printPlan();
    expect(validateExposurePlan(plan)).toEqual({ sequentialDurationMs: 25000, baseCount: 2 });
    expect(exposureTimeline(plan).map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 12000],
      [2000, 5000],
      [12000, 20000],
      [20000, 25000],
    ]);
    expect(validateRecord(NS.print.exposurePlan, plan)).toMatchObject({ success: true });
  });

  it("snapshots the plan independently of later edits", () => {
    const plan = printPlan();
    const snapshot = exposurePlanSnapshot(plan);
    plan.exposures[1].selections![0].points[0].x = 8000;
    expect(snapshot.exposures[1].selections![0].points[0].x).toBe(5000);
    expect(
      validateRecord(NS.process.printSession, {
        exposurePlan: `at://did:plc:test/${NS.print.exposurePlan}/one`,
        exposurePlanSnapshot: snapshot,
        createdAt: plan.createdAt,
      }),
    ).toMatchObject({ success: true });
  });

  it.each([
    [
      "dodge past base",
      (plan: ReturnType<typeof printPlan>) => {
        plan.exposures[1].startOffsetMs = 11000;
      },
    ],
    [
      "missing burn mask",
      (plan: ReturnType<typeof printPlan>) => {
        plan.exposures[3].selections = [];
      },
    ],
    [
      "out-of-image point",
      (plan: ReturnType<typeof printPlan>) => {
        plan.exposures[3].selections![0].points[0].x = 11000;
      },
    ],
    [
      "duplicate step ID",
      (plan: ReturnType<typeof printPlan>) => {
        plan.exposures[3].id = "soft";
      },
    ],
    [
      "misordered dodge",
      (plan: ReturnType<typeof printPlan>) => {
        plan.exposures.unshift(plan.exposures.splice(1, 1)[0]);
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const plan = printPlan();
    mutate(plan);
    expect(() => validateExposurePlan(plan)).toThrow();
  });
});

describe("film-processing sequences", () => {
  it("keeps planned baths separate from session observations", () => {
    const plan = {
      name: "BW tank",
      process: "bw",
      tankType: "tank",
      steps: [
        { name: "Develop", roles: ["film-developer"], publishedTimeSeconds: 540, actualTimeSeconds: 590 },
        { name: "Fix", roles: ["fixer"], publishedTimeSeconds: 240 },
      ],
      createdAt: "2026-11-01T12:00:00Z",
    };
    const snapshot = developmentPlanSnapshot(plan);
    expect(snapshot.steps[0]).not.toHaveProperty("actualTimeSeconds");
    expect(validateDevelopmentPlan(plan)).toBe(plan);
    expect(validateRecord(NS.process.developmentPlan, { ...snapshot, createdAt: plan.createdAt })).toMatchObject({
      success: true,
    });
    expect(
      validateRecord(NS.process.developSession, {
        process: "bw",
        developmentPlan: `at://did:plc:test/${NS.process.developmentPlan}/one`,
        developmentPlanSnapshot: snapshot,
        steps: plan.steps,
        createdAt: plan.createdAt,
      }),
    ).toMatchObject({ success: true });
  });
});
