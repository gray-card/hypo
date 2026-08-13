import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncRollExposureCount } from "../apps/web/src/views/library/film-frame.ts";
import { filmDating, framesForRoll, reserveQuantity } from "../apps/web/src/views/library/film-helpers.ts";
import { renderFilmView } from "../apps/web/src/views/library/film-view.ts";
import { openRollDetail } from "../apps/web/src/views/library/film-roll.ts";

beforeEach(() => {
  document.body.replaceChildren();
});

function services(store, overrides = {}) {
  return {
    collections: { filmStockpile: "stockpile", filmRoll: "roll", exposure: "exposure" },
    getStore: () => store,
    reloadStore: vi.fn(async () => {}),
    renderLibrary: vi.fn(),
    saveRecord: vi.fn(async () => "at://saved"),
    deleteRecord: vi.fn(async () => {}),
    splitRoll: vi.fn(async () => "at://roll"),
    addGear: vi.fn(),
    editGear: vi.fn(),
    openRoll: vi.fn(),
    instanceSelect: () => document.createElement("select"),
    instanceThumb: () => document.createElement("span"),
    instanceLabel: (_kind, value) => value.nickname || value.label || "Item",
    catalogLabel: (_kind, value) => [value.brand, value.name].filter(Boolean).join(" "),
    enumLabel: (value) => value,
    icon: () => document.createElement("span"),
    isAdvanced: () => false,
    inspect: vi.fn(),
    getPhotos: vi.fn(async () => []),
    blobUrl: vi.fn(async () => null),
    rollStatuses: ["loaded", "partial", "exposed"],
    cassetteTypes: [],
    ...overrides,
  };
}

describe("extracted Film view", () => {
  it("keeps quantity, expiry, and frame ordering as pure helpers", () => {
    expect(reserveQuantity({ quantity: -2 })).toBe(0);
    expect(
      filmDating({ expiresAt: "2025-01-01T00:00:00Z", format: "135" }, (value) => value, Date.UTC(2026, 0, 1)),
    ).toMatchObject({ expired: true, soon: false, text: expect.stringContaining("135") });
    const store = {
      catalog: {},
      instance: {
        exposure: [
          { uri: "frame-2", value: { roll: "roll-a", frameNumber: 2 } },
          { uri: "frame-1", value: { roll: "roll-a", frameNumber: 1 } },
        ],
      },
    };
    expect(framesForRoll(store, "roll-a").map((frame) => frame.uri)).toEqual(["frame-1", "frame-2"]);
  });

  it("renders reserve and roll sections through injected services", () => {
    const stock = "at://stock";
    const store = {
      catalog: { filmStock: [{ uri: stock, value: { brand: "Kodak", name: "Tri-X" } }] },
      instance: {
        filmStockpile: [{ uri: "at://reserve", value: { stock, quantity: 2 } }],
        filmRoll: [{ uri: "at://roll", value: { stock, label: "Roll 1", status: "loaded" } }],
        exposure: [],
      },
    };
    const body = document.createElement("div");
    renderFilmView(body, services(store));
    expect([...body.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "Film in reserve",
      "Rolls",
    ]);
    expect(body.textContent).toContain("Kodak Tri-X");
    expect(body.textContent).toContain("×2");
    expect(body.textContent).toContain("Roll 1");
  });

  it("derives roll usage and lifecycle through the injected record writer", async () => {
    const roll = { uri: "at://roll", value: { status: "loaded", exposuresTotal: 36, exposuresUsed: 0 } };
    const store = {
      catalog: {},
      instance: {
        filmRoll: [roll],
        exposure: [{ uri: "at://frame", value: { roll: roll.uri, frameNumber: 1 } }],
      },
    };
    const api = services(store);
    await syncRollExposureCount(roll.uri, api);
    expect(api.saveRecord).toHaveBeenCalledWith(
      "roll",
      expect.objectContaining({ exposuresUsed: 1, status: "partial", partialAt: expect.any(String) }),
      roll,
    );
  });

  it("shows optional lifecycle dates without fabricating a date for a manual status change", async () => {
    const stock = "at://stock";
    const roll = {
      uri: "at://roll",
      value: { stock, status: "partial", loadedAt: "2026-01-01T10:00:00Z" },
    };
    const store = {
      catalog: { filmStock: [{ uri: stock, value: { brand: "Kodak", name: "Tri-X" } }] },
      instance: { filmRoll: [roll], exposure: [] },
      photoCaptureByPhoto: new Map(),
    };
    const api = services(store, {
      rollStatuses: ["loaded", "partial", "exposed", "developed", "scanned"],
    });
    openRollDetail(roll, api);
    const modal = document.querySelector(".modal");
    const fields = Object.fromEntries(
      [...modal.querySelectorAll("label.field")].map((label) => [
        label.querySelector("span")?.textContent,
        label.querySelector("input,select"),
      ]),
    );
    for (const label of [
      "Loaded",
      "First frame exposed",
      "Fully exposed",
      "Unloaded",
      "Sent to lab",
      "Development started",
      "Developed",
      "Received from lab",
      "Scanned",
      "Archived",
      "Development location",
    ])
      expect(fields[label]).toBeTruthy();
    fields.Status.value = "exposed";
    expect(fields["Fully exposed"].value).toBe("");
    modal.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(api.saveRecord).toHaveBeenCalledTimes(1));
    expect(api.saveRecord.mock.calls[0][1]).toMatchObject({ status: "exposed", loadedAt: "2026-01-01T10:00:00.000Z" });
    expect(api.saveRecord.mock.calls[0][1].exposedAt).toBeUndefined();
  });
});
