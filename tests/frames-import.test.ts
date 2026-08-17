import { beforeEach, describe, expect, it, vi } from "vitest";

import { inferFrameShoots, parseFramesArchive } from "../packages/domain/src/frames.ts";
import { openFramesImportReview, readFramesFiles } from "../apps/web/src/views/library/film-frames-import.ts";

const item = (uri: string, value: Record<string, unknown>) => ({ uri, value });
const at = (minutes: number) => new Date(Date.UTC(2026, 7, 16, 12, minutes)).toISOString();

const frame = (number: number, minute: number, location?: { latitude: number; longitude: number }) => ({
  id: `frame-${number}`,
  number,
  createdAt: at(minute),
  aperture: 5.6,
  shutterSpeed: 1 / 125,
  focal: 50,
  timeZoneIdentifier: "America/New_York",
  lens: { make: "Nikon", model: "Nikkor 50mm f/1.4 AI", serial: "lens-1" },
  ...location,
});

beforeEach(() => {
  document.body.replaceChildren();
});

describe(".frames import and shoot inference", () => {
  it("parses a .frames archive without retaining invalid timestamps", async () => {
    const source = { name: "Sunday walk", iso: 100, frames: [frame(1, 0), frame(2, 1)] };
    const archive = parseFramesArchive(source, "Sunday.frames");
    expect(archive).toMatchObject({ sourceName: "Sunday.frames", name: "Sunday walk", iso: 100 });
    expect(archive.frames).toHaveLength(2);
    await expect(
      readFramesFiles([{ name: "Sunday.frames", text: async () => JSON.stringify(source) } as File]),
    ).resolves.toEqual([archive]);
    expect(() => parseFramesArchive({ frames: [{ createdAt: "not-a-date" }] }, "Broken.frames")).toThrow(
      "Broken.frames frame 1 has an invalid timestamp",
    );
  });

  it("infers an arbitrary number of shoots from gamma-like waiting-time regimes", () => {
    const frames = [
      frame(1, 0),
      frame(2, 1),
      frame(3, 3),
      frame(4, 180),
      frame(5, 181),
      frame(6, 183),
      frame(7, 480),
      frame(8, 482),
    ];
    const result = inferFrameShoots(frames, { sensitivity: "balanced", useLocation: false });
    expect(result.clusters.map((cluster) => cluster.frames.map((candidate) => candidate.number))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8],
    ]);
  });

  it("uses a substantial location change to refine an otherwise continuous shoot", () => {
    const near = { latitude: 43.15, longitude: -77.61 };
    const far = { latitude: 43.15, longitude: -77.42 };
    const frames = [frame(1, 0, near), frame(2, 1, near), frame(3, 2, near), frame(4, 3, far), frame(5, 4, far)];
    expect(inferFrameShoots(frames, { useLocation: false }).clusters).toHaveLength(1);
    const result = inferFrameShoots(frames, { useLocation: true });
    expect(result.method).toBe("spatiotemporal-gamma-mixture");
    expect(result.clusters.map((cluster) => cluster.frames.length)).toEqual([3, 2]);
    expect(result.clusters[1]?.boundaryBefore?.distanceKm).toBeGreaterThan(10);
  });

  it("imports only new frames, links them to reviewed shoots, and keeps location private by default", async () => {
    const roll = item("at://roll", { label: "Sunday walk", status: "partial", exposuresUsed: 1 });
    const camera = item("at://camera", { nickname: "Nikon F2", serialNumber: "camera-1" });
    const lens = item("at://lens", { nickname: "50/1.4", serialNumber: "lens-1" });
    const prior = item("at://exposure/prior", {
      roll: roll.uri,
      frameNumber: 1,
      sourceIdentifier: "frames:frame-1",
      createdAt: at(0),
    });
    const store: any = {
      catalog: {},
      instance: { filmRoll: [roll], camera: [camera], lens: [lens], exposure: [prior] },
      byUri: new Map(),
    };
    let serial = 0;
    const saveRecord = vi.fn(async (collection: string, value: Record<string, any>, existing: any) => {
      if (existing) {
        existing.value = value;
        return existing.uri;
      }
      const uri = `at://${collection}/${++serial}`;
      const record = item(uri, value);
      if (collection === "exposure") store.instance.exposure.push(record);
      if (collection === "capture") (store.shoots ||= []).push(record);
      return uri;
    });
    const instanceSelect = (kind: string, selected = "") => {
      const select = document.createElement("select");
      select.append(new Option("None", ""));
      for (const record of store.instance[kind] || [])
        select.append(new Option(String(record.value.nickname), record.uri));
      select.value = selected;
      return select;
    };
    const services: any = {
      collections: { filmRoll: "film-roll", exposure: "exposure", capture: "capture", filmStockpile: "stockpile" },
      getStore: () => store,
      reloadStore: vi.fn(async () => {}),
      renderLibrary: vi.fn(),
      saveRecord,
      uploadBlob: vi.fn(),
      instanceSelect,
      instanceLabel: (_kind: string, value: any) => value?.nickname || value?.label || "Item",
      catalogLabel: () => "Film",
      matchGear: (description: any) =>
        description.lensModel ? { lens: { instances: [lens] } } : { camera: { instances: [camera] } },
    };
    const archive = parseFramesArchive(
      {
        name: "Sunday walk",
        camera: { make: "Nikon", model: "F2", serial: "camera-1" },
        frames: [
          frame(1, 0, { latitude: 43.15, longitude: -77.61 }),
          frame(2, 1, { latitude: 43.151, longitude: -77.611 }),
        ],
      },
      "Sunday.frames",
    );

    openFramesImportReview([archive], services);
    const modal = document.querySelector<HTMLElement>(".modal")!;
    expect(modal.textContent).toContain("1 frame already imported will be skipped");
    expect((modal.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    (modal.querySelector(".modal-actions button:not(.ghost)") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(services.renderLibrary).toHaveBeenCalledOnce());
    const captureWrite = saveRecord.mock.calls.find(([collection]) => collection === "capture")!;
    expect(captureWrite[1]).toMatchObject({
      rolls: [roll.uri],
      cameras: [camera.uri],
      startedAt: at(1),
      endedAt: at(1),
    });
    const exposureWrites = saveRecord.mock.calls.filter(([collection]) => collection === "exposure");
    expect(exposureWrites).toHaveLength(1);
    expect(exposureWrites[0]?.[1]).toMatchObject({
      roll: roll.uri,
      shoot: expect.stringMatching(/^at:\/\/capture\//),
      camera: camera.uri,
      lens: lens.uri,
      frameNumber: 2,
      sourceIdentifier: "frames:frame-2",
      takenAt: at(1),
      timeZone: "America/New_York",
      provenance: expect.objectContaining({
        confidence: "certain",
        note: "Imported from Sunday.frames",
      }),
    });
    expect(exposureWrites[0]?.[1]).not.toHaveProperty("location");
  });
});
