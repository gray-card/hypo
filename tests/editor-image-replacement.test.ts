import { beforeEach, describe, expect, it, vi } from "vitest";
import { replacePhotoImage } from "../src/ui/editor.js";

const mocks = vi.hoisted(() => ({
  prepareAndUploadPhoto: vi.fn(),
  replacePhoto: vi.fn(),
}));

vi.mock("../src/ui/uploadUI.js", () => ({
  prepareAndUploadPhoto: mocks.prepareAndUploadPhoto,
}));

vi.mock("../src/grain.js", () => ({
  blobUrl: vi.fn(),
  exifToForm: vi.fn(() => ({})),
  getGalleries: vi.fn(),
  getGalleryDetail: vi.fn(),
  recordStore: vi.fn(),
  replacePhoto: mocks.replacePhoto,
  saveExif: vi.fn(),
  saveGallery: vi.fn(),
  savePhotoAlt: vi.fn(),
  setGalleryItemPosition: vi.fn(),
}));

describe("photo image replacement", () => {
  beforeEach(() => {
    mocks.prepareAndUploadPhoto.mockReset();
    mocks.replacePhoto.mockReset();
  });

  it("replaces with the prepared blob and processed dimensions", async () => {
    const agent = {};
    const file = new File(["original"], "replacement.png", { type: "image/png" });
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/photo-1",
      cid: "cid-old",
      value: { alt: "preserved", photo: { ref: { $link: "baf-old" } } },
    };
    const blob = { ref: { $link: "baf-prepared" }, mimeType: "image/jpeg", size: 800_000 };
    mocks.prepareAndUploadPhoto.mockResolvedValue({ blob, aspectRatio: { width: 1600, height: 1067 } });
    mocks.replacePhoto.mockResolvedValue({ cid: "cid-new", value: { ...photo.value, photo: blob } });

    await replacePhotoImage(agent, "did:plc:test", photo, file);

    expect(mocks.prepareAndUploadPhoto).toHaveBeenCalledWith(agent, file);
    expect(mocks.replacePhoto).toHaveBeenCalledWith(agent, "did:plc:test", photo, {
      blob,
      aspectRatio: { width: 1600, height: 1067 },
    });
  });

  it("does not write or mutate the photo when preparation fails", async () => {
    const file = new File(["original"], "replacement.heic", { type: "image/heic" });
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/photo-1",
      cid: "cid-old",
      value: { alt: "preserved", photo: { ref: { $link: "baf-old" } } },
    };
    const before = structuredClone(photo);
    mocks.prepareAndUploadPhoto.mockRejectedValue(new Error("Hypo couldn't prepare this image for Grain"));

    await expect(replacePhotoImage({}, "did:plc:test", photo, file)).rejects.toThrow(/couldn't prepare/);

    expect(mocks.replacePhoto).not.toHaveBeenCalled();
    expect(photo).toEqual(before);
  });
});
