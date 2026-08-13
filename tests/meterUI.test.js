import { beforeEach, describe, expect, it, vi } from "vitest";
import * as outbox from "../src/outbox.js";
import {
  METER_CALIBRATION_COLLECTION,
  METER_READING_COLLECTION,
  buildCalibrationRecord,
  buildReadingRecord,
  cameraMeterCapability,
  closeMeter,
  ev100FromMeterInput,
  openMeter,
  solveMeterValues,
} from "../src/ui/meter.js";

vi.mock("../src/outbox.js", () => ({
  enqueue: vi.fn((_did, collection) => ({ tempUri: `outbox://${collection}/test` })),
}));

const did = "did:plc:test";

beforeEach(() => {
  closeMeter();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("meter conversions", () => {
  it("converts lux and solves aperture and shutter priority through @hypo/domain", () => {
    expect(ev100FromMeterInput({ measurement: "lux", value: 10_240, geometry: "incident-flat" })).toBe(12);

    const shutter = solveMeterValues({ ev100: 15, priorityMode: "aperture-priority", iso: 100, aperture: 16 });
    expect(shutter.shutterSeconds).toBeCloseTo(1 / 128, 10);

    const aperture = solveMeterValues({
      ev100: 15,
      priorityMode: "shutter-priority",
      iso: 100,
      shutterSeconds: 1 / 128,
    });
    expect(aperture.aperture).toBeCloseTo(16, 10);
  });
});

describe("meter record shapes", () => {
  it("builds a scaled reading with solved exposure and optional exposure attachment", () => {
    const exposure = `at://${did}/app.graycard.instance.exposure/frame-1`;
    const record = buildReadingRecord(
      {
        did,
        measurement: "lux",
        value: 10_240,
        geometry: "incident-flat",
        priorityMode: "aperture-priority",
        iso: 100,
        aperture: 8,
        shutterSeconds: 1 / 125,
        exposure,
      },
      "2026-08-11T12:00:00.000Z",
    );

    expect(record).toMatchObject({
      geometry: "incident-flat",
      lightKind: "ambient",
      ev100: { value: 12_000, scale: 1_000, unit: "EV" },
      illuminance: { value: 10_240_000, scale: 1_000, unit: "lx" },
      priorityMode: "aperture-priority",
      iso: 100,
      aperture: "8",
      exposure,
      createdAt: "2026-08-11T12:00:00.000Z",
    });
    expect(record.shutterSeconds.value / record.shutterSeconds.scale).toBeCloseTo(1 / 64, 6);
  });

  it("retains metered time and film model when reciprocity changes the exposure", () => {
    const filmStock = `at://${did}/app.graycard.catalog.filmStock/hp5`;
    const record = buildReadingRecord(
      {
        did,
        measurement: "ev100",
        value: 5,
        geometry: "reflected-average",
        priorityMode: "shutter-priority",
        iso: 100,
        aperture: 8,
        shutterSeconds: 10,
        filmStock,
        reciprocityStock: {
          brand: "Ilford",
          name: "HP5 Plus",
          notes: "Reciprocity Ta=Tm^1.31.",
        },
      },
      "2026-08-11T12:00:00.000Z",
    );

    expect(record.reciprocity).toEqual({
      applied: true,
      model: "power:1.31",
      meteredSeconds: { value: 10_000_000, scale: 1_000_000, unit: "s" },
      filmStock,
    });
    expect(record.shutterSeconds.value / record.shutterSeconds.scale).toBeCloseTo(20.417, 3);
  });

  it("builds a roaming calibration record", () => {
    const meter = `at://${did}/app.graycard.instance.meter/phone`;
    expect(buildCalibrationRecord({ did, meter, offsetStops: -0.3 })).toMatchObject({
      meter,
      reference: "reference-meter",
      offsetStops: { value: -300, scale: 1_000, unit: "stop" },
      constantK: { value: 12_500, scale: 1_000 },
      constantCFlat: { value: 250_000, scale: 1_000 },
      constantCDome: { value: 330_000, scale: 1_000 },
    });
  });
});

describe("camera capability fallback", () => {
  it("keeps manual metering available when ImageCapture and track settings are absent", () => {
    const capability = cameraMeterCapability({ navigator: { mediaDevices: { getUserMedia() {} } } });
    expect(capability).toMatchObject({ supported: false });

    openMeter({ did });
    expect(document.querySelector("#meter-view")).not.toBeNull();
    expect(document.querySelector("#meter-camera-start").disabled).toBe(true);
    expect(document.querySelector(".meter-capability-note").textContent).toContain("Manual metering remains available");
    expect(document.querySelector("#meter-ev-dial").getAttribute("aria-valuetext")).toBe("EV 12.0");
  });
});

describe("meter outbox writes", () => {
  it("queues readings and calibrations without waiting for the network", () => {
    openMeter({
      did,
      store: {
        instance: {
          exposure: [
            {
              uri: `at://${did}/app.graycard.instance.exposure/frame-2`,
              value: { frameNumber: 2 },
            },
          ],
        },
      },
    });

    const exposure = document.querySelector("#meter-exposure");
    exposure.value = exposure.options[1].value;
    document.querySelector("#meter-reading-form").requestSubmit();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      did,
      METER_READING_COLLECTION,
      expect.objectContaining({ exposure: exposure.value, geometry: "reflected-average" }),
    );

    document.querySelector("#meter-calibration-meter").value = `at://${did}/app.graycard.instance.meter/phone`;
    document.querySelector("#meter-calibration-form").requestSubmit();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      did,
      METER_CALIBRATION_COLLECTION,
      expect.objectContaining({ meter: `at://${did}/app.graycard.instance.meter/phone` }),
    );
  });

  it("previews and queues a selected film stock's corrected exposure", () => {
    const filmStock = `at://${did}/app.graycard.catalog.filmStock/hp5`;
    openMeter({
      did,
      store: {
        catalog: {
          filmStock: [
            {
              uri: filmStock,
              value: {
                brand: "Ilford",
                name: "HP5 Plus",
                notes: "Reciprocity Ta=Tm^1.31.",
              },
            },
          ],
        },
        instance: { exposure: [] },
      },
    });

    const priority = document.querySelector("#meter-priority");
    priority.value = "shutter-priority";
    priority.dispatchEvent(new Event("change", { bubbles: true }));
    const shutter = document.querySelector("#meter-shutter");
    shutter.value = "8s";
    shutter.dispatchEvent(new Event("input", { bubbles: true }));
    const stock = document.querySelector("#meter-film-stock");
    stock.value = filmStock;
    stock.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector("#meter-result-reciprocity").textContent).toContain("Metered 8s → corrected 15.24s");

    document.querySelector("#meter-reading-form").requestSubmit();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      did,
      METER_READING_COLLECTION,
      expect.objectContaining({
        reciprocity: expect.objectContaining({
          applied: true,
          model: "power:1.31",
          filmStock,
        }),
      }),
    );
    const queuedRecord = outbox.enqueue.mock.calls.at(-1)[2];
    expect(queuedRecord.reciprocity.meteredSeconds.value / queuedRecord.reciprocity.meteredSeconds.scale).toBe(8);
    expect(queuedRecord.shutterSeconds.value / queuedRecord.shutterSeconds.scale).toBeCloseTo(15.242, 3);
  });
});
