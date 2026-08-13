import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShootGearChecklist, openShootEditor } from "../apps/web/src/views/library/shoots-editor.ts";
import { openShootLogger } from "../apps/web/src/views/library/shoots-logger.ts";
import {
  effectiveShootGearUris,
  inheritedShootLocations,
  shootExposureRecords,
} from "../apps/web/src/views/library/shoots-selectors.ts";
import { renderShootsView } from "../apps/web/src/views/library/shoots-view.ts";

const item = (uri, value) => ({ uri, value });

function createServices(store, pending = []) {
  return {
    collections: { capture: "capture", exposure: "exposure", meterReading: "meter" },
    getStore: () => store,
    reloadStore: vi.fn(async () => {}),
    loadStore: vi.fn(async () => store),
    setStore: vi.fn(),
    saveRecord: vi.fn(async () => "at://shoot/saved"),
    deleteRecord: vi.fn(async () => {}),
    pendingExposures: () => pending,
    pendingCount: () => pending.length,
    pendingMeterReadingCount: () => 0,
    enqueueExposure: vi.fn(),
    flushOutbox: vi.fn(async () => ({ sent: 0 })),
    isOnline: () => false,
    loadMeterReadings: vi.fn(async () => []),
    loadSticky: () => undefined,
    saveSticky: vi.fn(),
    captureLocation: vi.fn(async () => ({})),
    framesForRoll: () => [],
    filmStockLabel: () => "Film",
    instanceLabel: (_kind, value) => value.nickname || value.label || "Item",
    kindLabelPlural: (kind) => ({ camera: "Cameras", lens: "Lenses", filmRoll: "Film rolls", filter: "Filters" })[kind],
    enumLabel: (value) => value,
    icon: (name) => document.createTextNode(name),
    isAdvanced: () => false,
    inspect: vi.fn(),
    meteringModes: ["center-weighted"],
    stopFractions: ["1/3"],
    buildApertureOptions: () => ["4", "5.6"],
    buildShutterOptions: () => ["1/60", "1/125"],
    usesExactApertureSteps: () => false,
    usesExactShutterSteps: () => false,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("extracted Shoots view", () => {
  it("reads queued exposures once from the remote-plus-pending store projection", () => {
    const shoot = item("at://shoot/one", { cameras: ["at://camera/a"] });
    const location = { latitude: 430000000, longitude: -770000000 };
    const store = {
      catalog: {},
      instance: {
        exposure: [
          item("at://exposure/stored", { shoot: shoot.uri, lens: "at://lens/a" }),
          item("queued:1", { shoot: shoot.uri, camera: "at://camera/b", location }),
        ],
      },
      shoots: [shoot],
    };
    expect(shootExposureRecords(shoot.uri, store).map((record) => record.uri)).toEqual([
      "at://exposure/stored",
      "queued:1",
    ]);
    expect(effectiveShootGearUris(shoot, "camera", store)).toEqual(["at://camera/a", "at://camera/b"]);
    expect(inheritedShootLocations(shoot.uri, store)).toEqual([location]);
  });

  it("uses the shared checklist primitive to lock inherited gear without saving it as explicit", () => {
    const store = {
      catalog: {},
      instance: {
        camera: [item("at://camera/a", { nickname: "Explicit" }), item("at://camera/b", { nickname: "Inherited" })],
      },
    };
    const control = createShootGearChecklist("camera", ["at://camera/a"], ["at://camera/b"], createServices(store));
    document.body.append(control.node);
    const inputs = [...control.node.querySelectorAll('input[type="checkbox"]')];
    expect(inputs.map((input) => [input.value, input.checked, input.disabled])).toEqual([
      ["at://camera/a", true, false],
      ["at://camera/b", true, true],
    ]);
    expect(control.node.querySelector(".check-row.locked .inherit-tag")?.textContent).toBe("in a photo");
    expect(control.getSelected()).toEqual(["at://camera/a"]);
  });

  it("shows queued inheritance in the editor but persists only manual gear and places", async () => {
    const shoot = item("at://shoot/one", {
      label: "Walk",
      cameras: ["at://camera/a"],
      places: [{ placemark: { name: "Manual place" } }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const store = {
      catalog: {},
      instance: {
        camera: [item("at://camera/a", { nickname: "Explicit" }), item("at://camera/b", { nickname: "Inherited" })],
        lens: [],
        filmRoll: [],
        filter: [],
        exposure: [
          item("queued:1", {
            shoot: shoot.uri,
            camera: "at://camera/b",
            location: { placemark: { name: "Photo place" } },
          }),
        ],
      },
      shoots: [shoot],
    };
    const pending = [
      {
        id: "queued-1",
        record: { shoot: shoot.uri, camera: "at://camera/b", location: { placemark: { name: "Photo place" } } },
      },
    ];
    const services = createServices(store, pending);
    openShootEditor(shoot, undefined, services);
    const modal = document.querySelector(".modal");
    expect(modal.textContent).toContain("1 location inherited from photos in this shoot.");
    expect(modal.textContent).toContain("Manual place");
    expect(modal.querySelector('input[value="at://camera/b"]').disabled).toBe(true);
    modal.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveRecord).toHaveBeenCalledTimes(1));
    expect(services.saveRecord.mock.calls[0]).toEqual([
      "capture",
      expect.objectContaining({ cameras: ["at://camera/a"], places: [{ placemark: { name: "Manual place" } }] }),
      shoot,
    ]);
    expect(services.reloadStore).toHaveBeenCalled();
  });

  it("does not double-count a pending exposure already present in the projected store", () => {
    const shoot = item("at://shoot/one", { label: "Photo walk", cameras: ["at://camera/a"] });
    const store = {
      catalog: {},
      instance: {
        camera: [item("at://camera/a", { nickname: "A" }), item("at://camera/b", { nickname: "B" })],
        exposure: [
          item("at://exposure/one", { shoot: shoot.uri, camera: "at://camera/a" }),
          item("outbox://exposure/two", { shoot: shoot.uri, camera: "at://camera/b" }),
        ],
      },
      shoots: [shoot],
    };
    const services = createServices(store, [{ id: "two", record: { shoot: shoot.uri, camera: "at://camera/b" } }]);
    const actions = { startShoot: vi.fn(), editShoot: vi.fn(), openLogger: vi.fn(), render: vi.fn() };
    const body = document.createElement("div");
    renderShootsView(body, services, actions);
    expect(body.textContent).toContain("1 shot queued offline");
    expect(body.querySelector(".gear-row")?.textContent).toContain("2 cameras");
    expect(body.querySelector(".gear-row")?.textContent).toContain("2 shots");
    [...body.querySelectorAll("button")].find((button) => button.textContent.includes("Log")).click();
    expect(actions.openLogger).toHaveBeenCalledWith(shoot);
  });

  it("gives the logger explicit and queued-inherited gear", () => {
    const shoot = item("at://shoot/one", { label: "Photo walk", cameras: ["at://camera/a"] });
    const store = {
      catalog: { cameraType: [], lensType: [] },
      instance: {
        camera: [item("at://camera/a", { nickname: "Camera A" }), item("at://camera/b", { nickname: "Camera B" })],
        lens: [],
        filter: [],
        filmRoll: [],
        exposure: [item("outbox://exposure/queued", { shoot: shoot.uri, camera: "at://camera/b" })],
      },
      shoots: [shoot],
    };
    const services = createServices(store, [{ id: "queued", record: { shoot: shoot.uri, camera: "at://camera/b" } }]);
    const controller = openShootLogger(shoot, services);
    expect(controller.overlay.textContent).toContain("Camera A");
    expect(controller.overlay.textContent).toContain("Camera B");
    controller.close();
  });
});
