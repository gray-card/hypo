import { describe, expect, it } from "vitest";
import { recoverKnownWriterRecord } from "../src/schemaRuntime.js";

describe("known record-writer recovery", () => {
  it("salvages the chemistry integer written as a string without changing other fields", () => {
    const value = {
      $type: "app.graycard.instance.chemistry",
      type: "at://did:plc:test/app.graycard.catalog.chemistryType/type1",
      nickname: "D-76 working bottle",
      notes: "Mixed from the September packet",
      maxRollsRecommended: "8",
      createdAt: "2026-09-25T20:00:00.000Z",
    };

    expect(recoverKnownWriterRecord("app.graycard.instance.chemistry", value)).toEqual({
      changed: ["maxRollsRecommended"],
      value: { ...value, maxRollsRecommended: 8 },
    });
  });

  it("refuses broad or lossy coercion", () => {
    expect(
      recoverKnownWriterRecord("app.graycard.instance.chemistry", {
        $type: "app.graycard.instance.chemistry",
        type: "at://did:plc:test/app.graycard.catalog.chemistryType/type1",
        maxRollsRecommended: "eight",
        createdAt: "2026-09-25T20:00:00.000Z",
      }),
    ).toBeNull();
    expect(recoverKnownWriterRecord("app.graycard.instance.camera", { serialNumber: "8" })).toBeNull();
  });
});
