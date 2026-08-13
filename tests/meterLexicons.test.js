import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Lexicons } from "@atproto/lexicon";

const ROOT = join(process.cwd(), "lexicons/app/graycard");
const METER_IDS = [
  "app.graycard.catalog.meterType",
  "app.graycard.instance.meter",
  "app.graycard.meter.defs",
  "app.graycard.meter.reading",
  "app.graycard.meter.calibration",
];

function allDocs() {
  const paths = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".json")) paths.push(path);
    }
  })(ROOT);
  return paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
}

function load(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function meterDocs() {
  return [
    load("catalog/meterType.json"),
    load("instance/meter.json"),
    load("meter/defs.json"),
    load("meter/reading.json"),
    load("meter/calibration.json"),
  ];
}

describe("metering lexicons", () => {
  it("lands the five planned NSIDs", () => {
    expect(meterDocs().map((doc) => doc.id)).toEqual(METER_IDS);
  });

  it("loads the suite and resolves every meter reference", () => {
    const lexicons = new Lexicons(allDocs());
    const broken = [];

    for (const doc of meterDocs()) {
      JSON.stringify(doc, (key, value) => {
        if (key === "ref" && typeof value === "string") {
          const ref = value.startsWith("#") ? `${doc.id}${value}` : value;
          if (!lexicons.getDef(ref)) broken.push(`${doc.id}: ${value}`);
        }
        return value;
      });
    }

    expect(broken).toEqual([]);
  });

  it("keeps capture requirements small and vocabularies open", () => {
    expect(load("catalog/meterType.json").defs.main.record.required).toEqual(["make", "model", "createdAt"]);
    expect(load("instance/meter.json").defs.main.record.required).toEqual(["createdAt"]);
    expect(load("meter/calibration.json").defs.main.record.required).toEqual(["meter", "createdAt"]);
    expect(load("meter/reading.json").defs.main.record.required).toEqual(["geometry", "lightKind", "createdAt"]);

    const defs = load("meter/defs.json").defs;
    for (const name of [
      "meterGeometry",
      "lightKind",
      "priorityMode",
      "flashSyncMode",
      "readingRole",
      "sensorPath",
      "cameraModule",
      "calibrationReference",
    ]) {
      expect(defs[name].type, name).toBe("string");
      expect(defs[name].knownValues.length, name).toBeGreaterThan(0);
      expect(defs[name].enum, `${name} must remain open`).toBeUndefined();
    }

    const lexicons = new Lexicons(allDocs());
    expect(
      lexicons.validate("app.graycard.meter.reading", {
        $type: "app.graycard.meter.reading",
        geometry: "future-meter-geometry",
        lightKind: "future-light-kind",
        createdAt: "2026-08-11T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("validates the worked minimal sunny-16 reading", () => {
    const lexicons = new Lexicons(allDocs());
    const result = lexicons.validate("app.graycard.meter.reading", {
      $type: "app.graycard.meter.reading",
      geometry: "reflected-average",
      lightKind: "ambient",
      ev100: { value: 15, unit: "EV" },
      note: "sunny 16 check",
      createdAt: "2026-08-11T12:00:00.000Z",
    });

    expect(result.success, result.success ? "" : result.error.message).toBe(true);
  });

  it("adds optional ordered reading linkage without changing exposure requirements", () => {
    const exposure = load("instance/exposure.json").defs.main.record;
    expect(exposure.required).toEqual(["createdAt"]);
    expect(exposure.properties.meterReadings).toEqual({
      type: "array",
      maxLength: 16,
      items: { type: "string", format: "at-uri" },
      description:
        "Optional app.graycard.meter.reading records that informed this exposure, in the order they were taken. The canonical reading→exposure aggregation.",
    });

    const lexicons = new Lexicons(allDocs());
    const result = lexicons.validate("app.graycard.instance.exposure", {
      $type: "app.graycard.instance.exposure",
      meterReadings: [
        "at://did:web:example.com/app.graycard.meter.reading/3m1",
        "at://did:web:example.com/app.graycard.meter.reading/3m2",
      ],
      createdAt: "2026-08-11T12:00:00.000Z",
    });

    expect(result.success, result.success ? "" : result.error.message).toBe(true);
  });
});
