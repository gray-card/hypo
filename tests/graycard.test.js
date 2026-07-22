import { describe, it, expect } from "vitest";
import {
  catalogLabel, instanceLabel, resolvePhotoCapture, projectCaptureToExif, matchGear,
  scaledToDisplay, displayToScaled, displayToMeasure, measureToDisplay, parseFocalLengthFromModel,
  savePhotoCapture,
} from "../src/graycard.js";
import { mockAgent } from "./setup.js";

function makeStore() {
  const camType = { uri: "at://t/cam", value: { make: "Leica", model: "M6" } };
  const lensType = { uri: "at://t/lens", value: { make: "Leica", model: "Summicron 50mm f/2", maxAperture: 2_000_000, focalLengthMin: 50_000_000 } };
  const filmStock = { uri: "at://t/film", value: { brand: "Kodak", name: "Portra 400", iso: 400 } };
  const cam = { uri: "at://i/cam", value: { type: "at://t/cam", nickname: "black M6", serialNumber: "123" } };
  const cam2 = { uri: "at://i/cam2", value: { type: "at://t/cam", nickname: "silver M6" } };
  const lens = { uri: "at://i/lens", value: { type: "at://t/lens" } };
  const roll = { uri: "at://i/roll", value: { stock: "at://t/film", label: "Roll 12", quantity: 5 } };
  const store = {
    catalog: { cameraType: [camType], lensType: [lensType], filmStock: [filmStock], developerType: [], chemistryType: [], scannerType: [], lab: [], scanProfile: [], paperType: [] },
    instance: { camera: [cam, cam2], lens: [lens], filmRoll: [roll], developer: [], chemistry: [], scanner: [], labAccount: [], storageLocation: [], enlarger: [], intermediate: [] },
    byUri: new Map(),
  };
  const put = (uri, layer, kind, item) => store.byUri.set(uri, { layer, kind, item });
  put(camType.uri, "catalog", "cameraType", camType);
  put(lensType.uri, "catalog", "lensType", lensType);
  put(filmStock.uri, "catalog", "filmStock", filmStock);
  put(cam.uri, "instance", "camera", cam);
  put(cam2.uri, "instance", "camera", cam2);
  put(lens.uri, "instance", "lens", lens);
  put(roll.uri, "instance", "filmRoll", roll);
  return { store, cam, cam2, lens, roll };
}

describe("catalogLabel", () => {
  it("labels cameras, film, developers", () => {
    expect(catalogLabel("cameraType", { make: "Leica", model: "M6" })).toBe("Leica M6");
    expect(catalogLabel("filmStock", { brand: "Kodak", name: "Portra 400" })).toBe("Kodak Portra 400");
    expect(catalogLabel("developerType", { brand: "Kodak", name: "D-76", role: "developer" })).toBe("Kodak D-76 developer");
  });
});

describe("instanceLabel", () => {
  it("combines nickname, type, and serial", () => {
    const { store, cam } = makeStore();
    expect(instanceLabel("camera", cam.value, store)).toBe("black M6 · Leica M6 · 123");
  });
  it("shows on-hand quantity for film rolls", () => {
    const { store, roll } = makeStore();
    expect(instanceLabel("filmRoll", roll.value, store)).toBe("Roll 12 · Kodak Portra 400 · 5 on hand");
  });
  it("omits quantity when a single roll", () => {
    const { store } = makeStore();
    const single = { stock: "at://t/film", label: "One" };
    expect(instanceLabel("filmRoll", single, store)).toBe("One · Kodak Portra 400");
  });
});

describe("resolvePhotoCapture", () => {
  it("prefers per-photo capture over gallery defaults", () => {
    const capture = { value: { camera: "at://cam-a" } };
    const defaults = { value: { camera: "at://cam-b", lens: "at://lens-b" } };
    const r = resolvePhotoCapture(capture, defaults);
    expect(r.camera).toBe("at://cam-a");
    expect(r.lens).toBe("at://lens-b");
  });
});

describe("projectCaptureToExif", () => {
  it("fills EXIF from selected gear", () => {
    const { store, cam, lens, roll } = makeStore();
    const out = projectCaptureToExif({}, { camera: cam.uri, lens: lens.uri, filmRoll: roll.uri }, store);
    expect(out.make).toBe("Leica");
    expect(out.model).toBe("M6");
    expect(out.lensModel).toBe("Summicron 50mm f/2");
    expect(out.focalLengthIn35mmFormat).toBe("50");
    expect(out.fNumber).toBe("2");
    expect(out.iSO).toBe("400");
  });
  it("does not overwrite existing values in fill mode, but does in overwrite mode", () => {
    const { store, cam } = makeStore();
    const fill = projectCaptureToExif({ make: "OWN" }, { camera: cam.uri }, store);
    expect(fill.make).toBe("OWN");
    const over = projectCaptureToExif({ make: "OWN" }, { camera: cam.uri }, store, { mode: "overwrite" });
    expect(over.make).toBe("Leica");
  });
});

describe("matchGear", () => {
  it("returns both copies when two bodies share a model", () => {
    const { store } = makeStore();
    const m = matchGear({ make: "Leica", model: "M6" }, store);
    expect(m.camera.instances.map((i) => i.label)).toEqual([
      "black M6 · Leica M6 · 123",
      "silver M6 · Leica M6",
    ]);
  });
  it("matches despite a verbose EXIF make", () => {
    const { store } = makeStore();
    const m = matchGear({ make: "LEICA CAMERA AG", model: "M6" }, store);
    expect(m.camera.instances.length).toBe(2);
  });
  it("reports the exif label but no instances when the gear is not owned", () => {
    const { store } = makeStore();
    const m = matchGear({ make: "Canon", model: "AE-1" }, store);
    expect(m.camera.instances.length).toBe(0);
    expect(m.camera.exifLabel).toBe("Canon AE-1");
    expect(m.camera.make).toBe("Canon");
  });
});

describe("scaling helpers", () => {
  it("round-trips scaled integers", () => {
    expect(scaledToDisplay(displayToScaled("2.8"))).toBe("2.8");
    expect(displayToScaled("")).toBe(null);
  });
  it("builds and reads measure objects", () => {
    const m = displayToMeasure("20", "celsius");
    expect(m).toEqual({ value: 20_000_000, unit: "celsius", scale: 1_000_000 });
    expect(measureToDisplay(m)).toBe("20");
  });
  it("parses focal length from a model string", () => {
    expect(parseFocalLengthFromModel("Summicron 50mm f/2")).toBe(50);
    expect(parseFocalLengthFromModel("no numbers")).toBe(null);
  });
});

describe("savePhotoCapture — frame position on the roll", () => {
  const PHOTO = "at://did:plc:test/social.grain.photo/p1";
  const ROLL = "at://did:plc:test/app.graycard.instance.filmRoll/r1";

  it("persists frameIndex onto a new capture record", async () => {
    const agent = mockAgent();
    await savePhotoCapture(agent, "did:plc:test", PHOTO, { filmRoll: ROLL, frameIndex: 12 }, null);
    expect(agent.created).toHaveLength(1);
    const rec = agent.created[0].record;
    expect(rec.frameIndex).toBe(12);
    expect(rec.filmRoll).toBe(ROLL);
    expect(rec.photo).toBe(PHOTO);
  });

  it("updates frameIndex in place on an existing capture (stable rkey)", async () => {
    const agent = mockAgent();
    const existing = { uri: `${PHOTO.replace("social.grain.photo", "app.graycard.photo.capture")}`, cid: "cid0", rkey: "cap1", value: { photo: PHOTO, filmRoll: ROLL, createdAt: "2026-01-01T00:00:00Z" } };
    await savePhotoCapture(agent, "did:plc:test", PHOTO, { filmRoll: ROLL, frameIndex: 7 }, existing);
    expect(agent.put).toHaveLength(1);
    expect(agent.put[0].rkey).toBe("cap1");
    expect(agent.put[0].record.frameIndex).toBe(7);
  });
});

import { compareShootsByDate, shootDateKey } from "../src/graycard.js";

describe("shoot ordering", () => {
  const S = (v) => ({ uri: "at://s", value: v });
  it("keys on startedAt, falling back to createdAt", () => {
    expect(shootDateKey({ startedAt: "2026-01-02", createdAt: "2020-01-01" })).toBe("2026-01-02");
    expect(shootDateKey({ createdAt: "2020-01-01" })).toBe("2020-01-01");
    expect(shootDateKey({})).toBe("");
  });
  it("sorts newest-first, undated last", () => {
    const shoots = [
      S({ label: "old", startedAt: "2026-01-01T00:00:00Z" }),
      S({ label: "new", startedAt: "2026-06-01T00:00:00Z" }),
      S({ label: "undated" }),
      S({ label: "mid", createdAt: "2026-03-01T00:00:00Z" }),  // no startedAt -> uses createdAt
    ];
    shoots.sort(compareShootsByDate);
    expect(shoots.map((s) => s.value.label)).toEqual(["new", "mid", "old", "undated"]);
  });
});
