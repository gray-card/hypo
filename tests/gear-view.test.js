import { beforeEach, describe, expect, it, vi } from "vitest";
import { countTypeReferences } from "../apps/web/src/views/library/gear-config.ts";
import { technicalPayload } from "../apps/web/src/views/library/gear-controls.ts";
import { openGearMaintenance } from "../apps/web/src/views/library/gear-maintenance.ts";
import { renderGearTabView } from "../apps/web/src/views/library/gear-tab.ts";

const record = (uri, value) => ({ uri, value });

function services(store = { catalog: {}, instance: {} }) {
  return {
    collections: {
      catalog: {},
      instance: { camera: "app.graycard.instance.camera" },
      maintenanceSession: "app.graycard.process.maintenanceSession",
    },
    technicalSchemaKeys: { cameraType: new Set(["make", "model", "cropFactor", "sensor"]) },
    getStore: () => store,
    reloadStore: vi.fn(async () => {}),
    saveRecord: vi.fn(async () => "at://did:plc:test/record/new"),
    deleteRecord: vi.fn(async () => {}),
    instanceImageUrl: vi.fn(async () => "https://example.com/camera.jpg"),
    instanceLabel: (_kind, value) => value.nickname || "Camera",
    kindLabel: () => "Camera",
    kindLabelPlural: () => "Cameras",
    enumLabel: (value) => value.replaceAll("-", " "),
    technicalFieldLabel: (value) => value,
    icon: (name) => document.createTextNode(name),
    isAdvanced: () => false,
    inspect: vi.fn(),
    scaledToDisplay: (value) => value / 1_000_000,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("extracted Gear view boundaries", () => {
  it("counts shared type references across instance kinds and honors the excluded URI", () => {
    const typeUri = "at://did:plc:test/app.graycard.catalog.filmStock/gold";
    const store = {
      catalog: {},
      instance: {
        filmRoll: [record("roll/1", { stock: typeUri })],
        filmStockpile: [record("reserve/1", { stock: typeUri }), record("reserve/2", { stock: "other" })],
      },
    };
    expect(countTypeReferences(store, "filmStock", typeUri)).toBe(2);
    expect(countTypeReferences(store, "filmStock", typeUri, "roll/1")).toBe(1);
  });

  it("keeps only schema-native technical metadata without flattening structured values", () => {
    const deps = services();
    const sensor = { size: { value: 36, unit: "millimeter" }, source: { url: "https://example.com" } };
    expect(
      technicalPayload(
        "cameraType",
        {
          $type: "app.graycard.catalog.cameraType",
          make: "Nikon",
          model: "F3",
          cropFactor: 1_000_000,
          sensor,
          localOnly: "drop me",
        },
        deps,
        true,
      ),
    ).toEqual({ cropFactor: 1_000_000, sensor });
  });

  it("renders empty categories and delegates their add action", () => {
    const body = document.createElement("div");
    const deps = services();
    const actions = { addGear: vi.fn(), editGear: vi.fn(), maintain: vi.fn(), render: vi.fn() };
    renderGearTabView(body, ["camera"], deps, actions);
    expect(body.querySelector("h2")?.textContent).toBe("Cameras");
    expect(body.querySelector(".gear-empty")?.textContent).toBe("No cameras yet.");
    body.querySelector(".add-gear").click();
    expect(actions.addGear).toHaveBeenCalledWith("camera", actions.render);
  });

  it("deletes through injected storage, reloads, and exposes a working undo", async () => {
    const camera = record("at://did:plc:test/app.graycard.instance.camera/one", { nickname: "F3" });
    const deps = services({ catalog: {}, instance: { camera: [camera] } });
    const actions = { addGear: vi.fn(), editGear: vi.fn(), maintain: vi.fn(), render: vi.fn() };
    const body = document.createElement("div");
    document.body.append(body);
    renderGearTabView(body, ["camera"], deps, actions);
    body.querySelector('[aria-label="Remove"]').click();
    document.querySelector(".danger-solid").click();
    await vi.waitFor(() => expect(deps.deleteRecord).toHaveBeenCalledWith(camera.uri));
    expect(deps.reloadStore).toHaveBeenCalledTimes(1);
    document.querySelector(".toast-action").click();
    await vi.waitFor(() =>
      expect(deps.saveRecord).toHaveBeenCalledWith("app.graycard.instance.camera", camera.value, null),
    );
    expect(deps.reloadStore).toHaveBeenCalledTimes(2);
  });

  it("renders maintenance history and writes the new session through its injected collection", async () => {
    const subject = "at://did:plc:test/app.graycard.instance.camera/one";
    const store = {
      catalog: {},
      instance: {},
      maintenanceBySubject: new Map([
        [
          subject,
          [
            record("maintenance/1", {
              kind: "cla",
              performedAt: "2026-02-03T12:00:00.000Z",
              notes: "Bench tested",
            }),
          ],
        ],
      ]),
    };
    const deps = services(store);
    const done = vi.fn();
    openGearMaintenance(subject, done, deps);
    expect(document.querySelector(".modal")?.textContent).toContain("Service history");
    document.querySelector('[data-key="performedAt"]').value = "2026-08-11T12:30:00Z";
    document.querySelector('[data-key="shutterCountAfter"]').value = "1234";
    document.querySelector('[data-key="notes"]').value = "Calibrated";
    document.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(deps.saveRecord).toHaveBeenCalledTimes(1));
    expect(deps.saveRecord.mock.calls[0][0]).toBe("app.graycard.process.maintenanceSession");
    expect(deps.saveRecord.mock.calls[0][1]).toMatchObject({
      subject,
      kind: "cla",
      shutterCountAfter: 1234,
      notes: "Calibrated",
    });
    expect(done).toHaveBeenCalled();
  });
});
