import { describe, expect, it } from "vitest";
import {
  assertConsumableLifecycle,
  ConsumableLifecycleValidationError,
  validateConsumableLifecycle,
} from "@hypo/domain";

const ROLL = "app.graycard.instance.filmRoll";
const CHEMISTRY = "app.graycard.instance.chemistry";

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;

describe("consumable lifecycle chronology", () => {
  it("accepts missing milestones and collections without a lifecycle", () => {
    expect(validateConsumableLifecycle(ROLL, { loadedAt: at(1) })).toEqual([]);
    expect(validateConsumableLifecycle(CHEMISTRY, { status: "active" })).toEqual([]);
    expect(validateConsumableLifecycle("app.graycard.instance.camera", { loadedAt: at(2), partialAt: at(1) })).toEqual(
      [],
    );
  });

  it("accepts a complete chronological film lifecycle", () => {
    expect(
      validateConsumableLifecycle(ROLL, {
        loadedAt: at(1),
        partialAt: at(2),
        exposedAt: at(3),
        unloadedAt: at(4),
        sentToLabAt: at(5),
        developmentStartedAt: at(6),
        developedAt: at(7),
        receivedFromLabAt: at(8),
        scannedAt: at(8),
        archivedAt: at(9),
      }),
    ).toEqual([]);
  });

  it("reports direct film milestone inversions with field paths", () => {
    expect(validateConsumableLifecycle(ROLL, { sentToLabAt: at(4), developmentStartedAt: at(3) })).toContainEqual({
      code: "chronology",
      path: "$.sentToLabAt",
      relatedPath: "$.developmentStartedAt",
      message: "$.sentToLabAt must not be after $.developmentStartedAt",
    });
  });

  it("checks transitive film ordering when intermediate dates are absent", () => {
    const issues = validateConsumableLifecycle(ROLL, { loadedAt: at(9), archivedAt: at(1) });
    expect(issues).toContainEqual(expect.objectContaining({ path: "$.loadedAt", relatedPath: "$.archivedAt" }));
  });

  it("does not impose an order between a lab scan and physical return", () => {
    expect(validateConsumableLifecycle(ROLL, { scannedAt: at(2), receivedFromLabAt: at(8) })).toEqual([]);
    expect(validateConsumableLifecycle(ROLL, { scannedAt: at(8), receivedFromLabAt: at(2) })).toEqual([]);
  });

  it("validates direct and transitive chemical milestones", () => {
    expect(
      validateConsumableLifecycle(CHEMISTRY, {
        acquiredAt: at(1),
        openedAt: at(2),
        mixedAt: at(3),
        replenishedAt: at(4),
        exhaustedAt: at(4),
        discardedAt: at(5),
      }),
    ).toEqual([]);

    expect(validateConsumableLifecycle(CHEMISTRY, { openedAt: at(8), discardedAt: at(2) })).toContainEqual(
      expect.objectContaining({ path: "$.openedAt", relatedPath: "$.discardedAt" }),
    );
  });

  it("leaves ambiguous chemical dates unordered", () => {
    expect(validateConsumableLifecycle(CHEMISTRY, { acquiredAt: at(8), openedAt: at(2) })).toEqual([]);
    expect(validateConsumableLifecycle(CHEMISTRY, { replenishedAt: at(8), exhaustedAt: at(2) })).toEqual([]);
    expect(validateConsumableLifecycle(CHEMISTRY, { replenishedAt: at(2), exhaustedAt: at(8) })).toEqual([]);
  });

  it("leaves malformed dates to lexicon validation", () => {
    expect(validateConsumableLifecycle(ROLL, { loadedAt: "not-a-date", archivedAt: at(1) })).toEqual([]);
  });

  it("throws the named validation error with all chronology issues", () => {
    expect(() => assertConsumableLifecycle(ROLL, { loadedAt: at(9), developedAt: at(2), archivedAt: at(1) })).toThrow(
      ConsumableLifecycleValidationError,
    );
    try {
      assertConsumableLifecycle(ROLL, { loadedAt: at(9), archivedAt: at(1) });
    } catch (error) {
      expect(error).toMatchObject({
        name: "ConsumableLifecycleValidationError",
        collection: ROLL,
        issues: expect.arrayContaining([expect.objectContaining({ path: "$.loadedAt", relatedPath: "$.archivedAt" })]),
      });
    }
  });
});
