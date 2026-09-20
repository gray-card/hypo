import { describe, expect, it } from "vitest";

import { RecordTimeSpanValidationError, assertRecordTimeSpans, validateRecordTimeSpans } from "@hypo/domain";

describe("record time-span chronology", () => {
  it("accepts partial spans and equal endpoints at the shared write boundary", () => {
    expect(validateRecordTimeSpans({ finishedAt: "2026-09-20T12:00:00Z" })).toEqual([]);
    expect(
      validateRecordTimeSpans({
        startedAt: "2026-09-20T12:00:00Z",
        finishedAt: "2026-09-20T12:00:00Z",
      }),
    ).toEqual([]);
  });

  it.each(["finishedAt", "endedAt", "completedAt", "failedAt", "cancelledAt", "skippedAt"])(
    "rejects a reversed startedAt/%s span",
    (endField) => {
      const issues = validateRecordTimeSpans({
        startedAt: "2026-09-20T12:00:00Z",
        [endField]: "2026-09-20T11:59:00Z",
      });
      expect(issues).toEqual([
        expect.objectContaining({
          code: "chronology",
          path: `$.${endField}`,
          relatedPath: "$.startedAt",
        }),
      ]);
    },
  );

  it("finds reversed spans in nested process stages", () => {
    expect(
      validateRecordTimeSpans({
        steps: [
          {
            startedAt: "2026-09-20T12:00:00Z",
            finishedAt: "2026-09-20T11:00:00Z",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        path: "$.steps[0].finishedAt",
        relatedPath: "$.steps[0].startedAt",
      }),
    ]);
  });

  it("throws a structured error before a reversed record is written", () => {
    expect(() =>
      assertRecordTimeSpans("app.graycard.process.digitizeSession", {
        startedAt: "2026-09-20T12:00:00Z",
        finishedAt: "2026-09-20T11:00:00Z",
      }),
    ).toThrow(RecordTimeSpanValidationError);
  });
});
