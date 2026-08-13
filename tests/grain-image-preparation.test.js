import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRAIN_IMAGE_HARD_LIMIT_BYTES,
  GRAIN_IMAGE_MAX_EDGE,
  GRAIN_IMAGE_TARGET_BYTES,
  prepareAndUploadPhoto,
  prepareUpload,
} from "../src/ui/uploadUI.js";

const grainMocks = vi.hoisted(() => ({
  uploadImage: vi.fn(),
}));

vi.mock("../src/grain.js", () => ({
  addGalleryItem: vi.fn(),
  createGallery: vi.fn(),
  createPhoto: vi.fn(),
  saveExif: vi.fn(),
  uploadImage: grainMocks.uploadImage,
}));

vi.mock("../src/graycard.js", () => ({ saveGalleryDefaults: vi.fn() }));
vi.mock("../src/readExif.js", () => ({ fileToExifForm: vi.fn() }));
vi.mock("../src/ui/library.js", () => ({
  getStore: vi.fn(() => ({})),
  instanceSelect: vi.fn(() => document.createElement("select")),
  refreshStore: vi.fn(),
}));

let imageWidth;
let imageHeight;
let imageDecodeFails;
let encodedSize;
let renderCalls;

function dataUrlWithBytes(bytes) {
  return `data:image/jpeg;base64,${"A".repeat(Math.ceil(bytes / 3) * 4)}`;
}

class TestImage {
  constructor() {
    this.width = imageWidth;
    this.height = imageHeight;
  }

  set src(_value) {
    queueMicrotask(() => {
      if (imageDecodeFails) this.onerror?.(new Error("decode failed"));
      else this.onload?.();
    });
  }
}

describe("Grain image preparation", () => {
  beforeEach(() => {
    imageWidth = 4000;
    imageHeight = 3000;
    imageDecodeFails = false;
    renderCalls = [];
    encodedSize = (width, height, quality) => Math.round(width * height * (0.8 + quality * 0.4));
    vi.stubGlobal("Image", TestImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (_type, quality) {
      renderCalls.push({ width: this.width, height: this.height, quality });
      return dataUrlWithBytes(encodedSize(this.width, this.height, quality));
    });
    grainMocks.uploadImage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reduces dimensions when JPEG quality alone cannot reach the target", async () => {
    const prepared = await prepareUpload(new File(["original"], "scan.png", { type: "image/png" }));

    expect(renderCalls[0]).toMatchObject({ width: 2000, height: 1500, quality: 0.45 });
    expect(new Set(renderCalls.map((call) => call.width)).size).toBeGreaterThan(1);
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(GRAIN_IMAGE_MAX_EDGE);
    expect(prepared.width).toBeLessThan(2000);
    expect(prepared.blob.type).toBe("image/jpeg");
    expect(prepared.blob.size).toBeLessThanOrEqual(GRAIN_IMAGE_TARGET_BYTES);
    expect(prepared.blob.size).toBeLessThanOrEqual(GRAIN_IMAGE_HARD_LIMIT_BYTES);
  });

  it("uploads only the processed JPEG and returns its processed dimensions", async () => {
    imageWidth = 1200;
    imageHeight = 800;
    encodedSize = (width, height, quality) => Math.round(width * height * (0.2 + quality * 0.2));
    const uploadedBlob = {
      $type: "blob",
      ref: { $link: "baf-prepared" },
      mimeType: "image/jpeg",
      size: 400_000,
    };
    grainMocks.uploadImage.mockResolvedValue(uploadedBlob);
    const original = new File(["raw original bytes"], "scan.png", { type: "image/png" });

    await expect(prepareAndUploadPhoto({}, original)).resolves.toEqual({
      blob: uploadedBlob,
      aspectRatio: { width: 1200, height: 800 },
    });

    expect(grainMocks.uploadImage).toHaveBeenCalledOnce();
    const processed = grainMocks.uploadImage.mock.calls[0][1];
    expect(processed).toBeInstanceOf(Blob);
    expect(processed).not.toBe(original);
    expect(processed.type).toBe("image/jpeg");
    expect(processed.size).toBeLessThanOrEqual(GRAIN_IMAGE_TARGET_BYTES);
  });

  it("rejects an undecodable image without uploading the raw original", async () => {
    imageDecodeFails = true;

    await expect(prepareAndUploadPhoto({}, new File(["raw"], "scan.heic", { type: "image/heic" }))).rejects.toThrow(
      /couldn't decode.*smaller JPEG, PNG, or WebP/i,
    );
    expect(grainMocks.uploadImage).not.toHaveBeenCalled();
  });

  it("rejects an uploaded blob reference that exceeds Grain's hard limit", async () => {
    imageWidth = 1200;
    imageHeight = 800;
    encodedSize = (width, height, quality) => Math.round(width * height * (0.2 + quality * 0.2));
    grainMocks.uploadImage.mockResolvedValue({
      $type: "blob",
      ref: { $link: "baf-oversized" },
      mimeType: "image/jpeg",
      size: GRAIN_IMAGE_HARD_LIMIT_BYTES + 1,
    });

    await expect(prepareAndUploadPhoto({}, new File(["raw"], "scan.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      /PDS reported an uploaded blob over Grain's 1 MB limit/i,
    );
  });

  it("rejects when repeated dimension reduction cannot meet the hard limit", async () => {
    encodedSize = () => GRAIN_IMAGE_HARD_LIMIT_BYTES + 3;

    await expect(prepareAndUploadPhoto({}, new File(["raw"], "scan.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      /over Grain's 1 MB limit/i,
    );
    expect(new Set(renderCalls.map((call) => `${call.width}x${call.height}`)).size).toBeGreaterThan(1);
    expect(grainMocks.uploadImage).not.toHaveBeenCalled();
  });

  it("turns a missing canvas implementation into an actionable error", async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null);

    await expect(prepareAndUploadPhoto({}, new File(["raw"], "scan.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      /browser image processing failed.*smaller JPEG, PNG, or WebP/i,
    );
    expect(grainMocks.uploadImage).not.toHaveBeenCalled();
  });
});
