import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NS } from "../src/graycard.js";
import { pending } from "../src/outbox.js";
import { initLibrary, openShotLogger } from "../src/ui/library.js";
import { loadShotLoggerState, saveShotLoggerState } from "../src/ui/shotLoggerState.js";
import { createLoggerDial, openShotLoggerView } from "../apps/web/src/views/library/logger.ts";
import { mockAgent } from "./setup.js";

const did = "did:plc:shot-logger";

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
});

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  delete navigator.geolocation;
});

describe("shot logger sticky state", () => {
  it("retains exposure settings without persisting consent, notes, or reading attachments", () => {
    const shoot = `at://${did}/app.graycard.session.capture/shoot`;
    saveShotLoggerState(did, shoot, {
      quick: true,
      aperture: "8",
      shutter: "1/125",
      flash: true,
      gps: true,
      note: "private field note",
      meterReadings: ["at://reading"],
    });

    expect(loadShotLoggerState(did, shoot)).toEqual({
      quick: true,
      aperture: "8",
      shutter: "1/125",
      flash: true,
    });
  });
});

describe("shot logger quick mode", () => {
  it("starts location capture only after opt-in and attaches a synced meter reading", async () => {
    const camera = `at://${did}/app.graycard.instance.camera/camera`;
    const lens = `at://${did}/app.graycard.instance.lens/lens`;
    const stock = `at://${did}/app.graycard.catalog.filmStock/stock`;
    const roll = `at://${did}/app.graycard.instance.filmRoll/roll`;
    const reading = `at://${did}/app.graycard.meter.reading/reading`;
    const shoot = {
      uri: `at://${did}/app.graycard.session.capture/shoot`,
      value: { label: "Field test", cameras: [camera], lenses: [lens], rolls: [roll] },
    };
    const agent = mockAgent();
    agent.com.atproto.repo.listRecords = vi.fn(async ({ collection }) => ({
      data: {
        records:
          collection === NS.meter.reading
            ? [
                {
                  uri: reading,
                  cid: "cid-reading",
                  value: {
                    ev100: { value: 12_000, scale: 1_000, unit: "EV" },
                    shutterSeconds: { value: 20_417_000, scale: 1_000_000, unit: "s" },
                    reciprocity: {
                      applied: true,
                      model: "power:1.31",
                      meteredSeconds: { value: 10_000_000, scale: 1_000_000, unit: "s" },
                      filmStock: stock,
                    },
                    createdAt: "2026-08-11T12:00:00.000Z",
                  },
                },
              ]
            : [],
      },
    }));
    const watchPosition = vi.fn(() => 7);
    const clearWatch = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { watchPosition, clearWatch },
    });
    initLibrary({
      agent,
      did,
      store: {
        catalog: {
          cameraType: [],
          lensType: [],
          filterType: [],
          filmStock: [{ uri: stock, value: { brand: "Test", name: "ISO 400", iso: 400 } }],
        },
        instance: {
          camera: [{ uri: camera, value: { nickname: "Camera" } }],
          lens: [{ uri: lens, value: { nickname: "Lens" } }],
          filter: [],
          filmRoll: [{ uri: roll, value: { label: "Roll A", stock } }],
          exposure: [],
        },
      },
    });

    openShotLogger(shoot, null);
    const overlay = document.querySelector(".logger-overlay");
    expect(overlay.classList.contains("quick")).toBe(true);
    expect(watchPosition).not.toHaveBeenCalled();

    const location = [...overlay.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add location"),
    );
    location.click();
    expect(location.getAttribute("aria-pressed")).toBe("true");
    expect(watchPosition).toHaveBeenCalledOnce();

    const readingSelect = overlay.querySelector("#logger-meter-reading");
    await vi.waitFor(() => expect(readingSelect.options).toHaveLength(2));
    expect(readingSelect.options[1].textContent).toContain("10s → 20.42s");
    expect(readingSelect.options[1].textContent).toContain("Test ISO 400");
    expect(readingSelect.options[1].textContent).toContain("power 1.31");
    readingSelect.value = reading;
    [...overlay.querySelectorAll("button")].find((button) => button.textContent.includes("Log frame")).click();

    const record = pending(did, NS.instance.exposure)[0].record;
    expect(record.meterReadings).toEqual([reading]);
    expect(record.location).toBeUndefined();
    expect(readingSelect.value).toBe("");
  });
});

describe("extracted shot logger view", () => {
  it("keeps the logger dial keyboard-operable with one tab stop", () => {
    let selected = "4";
    const dial = createLoggerDial(
      ["2.8", "4", "5.6"],
      () => selected,
      (value) => {
        selected = value;
      },
      { label: "Aperture" },
    );
    document.body.append(dial);
    const buttons = [...dial.querySelectorAll("button")];
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);

    buttons[1].focus();
    buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(selected).toBe("5.6");
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  });

  it("logs normal and multiple exposures through injected persistence", () => {
    const camera = "at://camera";
    const lens = "at://lens";
    const roll = "at://roll";
    const queued = [];
    const store = {
      catalog: { cameraType: [], lensType: [] },
      instance: { exposure: [] },
    };
    const controller = openShotLoggerView({
      shoot: { uri: "at://shoot", value: { label: "Field test" } },
      store,
      gear: {
        camera: [{ uri: camera, value: { nickname: "Camera" } }],
        lens: [{ uri: lens, value: { nickname: "Lens" } }],
        filter: [],
        filmRoll: [{ uri: roll, value: { label: "Roll A", camera } }],
      },
      persistSticky: () => {},
      framesForRoll: () => [],
      pendingExposures: () => queued,
      pendingMeterReadingCount: () => 0,
      enqueueExposure: (record) => queued.push({ record }),
      flush: async () => ({ sent: 0 }),
      isOnline: () => false,
      reloadStore: async () => store,
      onStoreReloaded: () => {},
      loadMeterReadings: async () => [],
      instanceLabel: (_kind, value) => value.nickname || value.label || "Item",
      filmStockLabel: () => "Test film",
      enumLabel: (value) => value,
      meteringModes: ["center-weighted"],
      icon: () => document.createElement("span"),
      stopFractions: ["1/3"],
      buildApertureOptions: () => ["4", "5.6"],
      buildShutterOptions: () => ["1/60", "1/125"],
      usesExactApertureSteps: () => false,
      usesExactShutterSteps: () => false,
    });

    const first = controller.logExposure();
    const second = controller.logExposure(true);
    expect(first).toMatchObject({ shoot: "at://shoot", roll, frameNumber: 1, frameExposureIndex: 1 });
    expect(second).toMatchObject({
      shoot: "at://shoot",
      roll,
      frameNumber: 1,
      frameExposureIndex: 2,
      multipleExposure: true,
    });
    expect(queued).toHaveLength(2);
  });

  it("repaints an acknowledged pending exposure from cache and disposes its listener", async () => {
    const shoot = "at://shoot";
    const queued = [];
    const initialStore = { catalog: { cameraType: [], lensType: [] }, instance: { exposure: [] } };
    const persistedStore = {
      catalog: initialStore.catalog,
      instance: {
        exposure: [
          {
            uri: "at://did:plc:test/app.graycard.instance.exposure/acknowledged",
            value: { shoot, aperture: "5.6", createdAt: "2026-08-11T12:00:00.000Z" },
          },
        ],
      },
    };
    const reloadStore = vi.fn(async () => persistedStore);
    const onStoreReloaded = vi.fn();
    const unsubscribe = vi.fn();
    let acknowledge;
    const controller = openShotLoggerView({
      shoot: { uri: shoot, value: { label: "Digital test" } },
      store: initialStore,
      gear: { camera: [], lens: [], filter: [], filmRoll: [] },
      persistSticky: () => {},
      framesForRoll: () => [],
      pendingExposures: () => queued,
      subscribePendingAcknowledgements: (listener) => {
        acknowledge = listener;
        return unsubscribe;
      },
      pendingMeterReadingCount: () => 0,
      enqueueExposure: (record) => queued.push({ id: "pending", tempUri: "outbox://pending", record }),
      flush: async () => ({ sent: 0 }),
      isOnline: () => false,
      reloadStore,
      onStoreReloaded,
      loadMeterReadings: async () => [],
      instanceLabel: () => "Item",
      filmStockLabel: () => "Film",
      enumLabel: (value) => value,
      meteringModes: ["center-weighted"],
      icon: () => document.createElement("span"),
      stopFractions: ["1/3"],
      buildApertureOptions: () => ["5.6"],
      buildShutterOptions: () => ["1/125"],
      usesExactApertureSteps: () => false,
      usesExactShutterSteps: () => false,
    });

    controller.logExposure();
    expect(controller.overlay.querySelectorAll(".logger-recent-row.pending")).toHaveLength(1);

    queued.length = 0;
    await acknowledge();

    expect(controller.overlay.querySelectorAll(".logger-recent-row.pending")).toHaveLength(0);
    expect(controller.overlay.querySelectorAll(".logger-recent-row")).toHaveLength(1);
    expect(controller.overlay.querySelector(".logger-recent").textContent).toContain("ƒ/5.6");
    expect(reloadStore).toHaveBeenCalledOnce();
    expect(onStoreReloaded).toHaveBeenCalledWith(persistedStore);

    controller.close();
    controller.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
