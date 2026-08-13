import { describe, expect, it } from "vitest";
import {
  CATALOG_KINDS,
  INSTANCE_KINDS,
  NS,
  RECORD_NSID_LIST,
  SCHEMAS,
  validateRecord,
} from "../packages/lexicon/src/index.ts";

describe("generated lexicon package", () => {
  it("derives record namespaces and collection kinds from the schema tree", () => {
    expect(NS.instance.camera).toBe("app.graycard.instance.camera");
    expect(NS.catalog.devRecipe).toBe("app.graycard.catalog.devRecipe");
    expect(CATALOG_KINDS).toContain("cameraType");
    expect(INSTANCE_KINDS).toContain("filmRoll");
    expect(new Set(RECORD_NSID_LIST).size).toBe(RECORD_NSID_LIST.length);
    expect(RECORD_NSID_LIST).toHaveLength(55);
  });

  it("ships every source schema for runtime validation", () => {
    expect(Object.keys(SCHEMAS)).toHaveLength(59);
    expect(SCHEMAS["app.graycard.defs"].defs.measure.type).toBe("object");
  });

  it("validates generated record shapes and resolves cross-schema refs", () => {
    const valid = validateRecord(NS.instance.camera, {
      type: "at://did:plc:test/app.graycard.catalog.cameraType/1",
      createdAt: "2026-08-11T00:00:00.000Z",
    });
    expect(valid.success).toBe(true);

    const invalid = validateRecord(NS.instance.camera, { createdAt: 42 });
    expect(invalid.success).toBe(false);
    expect(invalid.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["$.type", "$.createdAt"]));
  });

  it("enforces generated integer, string, array, and format constraints", () => {
    const camera = {
      type: "not-an-at-uri",
      nickname: "x".repeat(257),
      createdAt: "not-a-date",
    };
    const result = validateRecord(NS.instance.camera, camera);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.type", message: "Expected AT URI" }),
        expect.objectContaining({ path: "$.nickname", message: expect.stringContaining("UTF-8 bytes") }),
        expect.objectContaining({ path: "$.createdAt", message: "Expected datetime" }),
      ]),
    );

    const reading = validateRecord(NS.meter.reading, {
      geometry: "reflected-average",
      lightKind: "ambient",
      ev100: { value: 0, scale: 0, unit: "EV" },
      priorityMode: "ev-only",
      iso: 0,
      createdAt: "2026-08-11T00:00:00.000Z",
    });
    expect(reading.success).toBe(false);
    if (!reading.success) {
      expect(reading.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["$.ev100.scale", "$.iso"]));
    }
  });
});
