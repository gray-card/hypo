import { describe, it, expect } from "vitest";
import { blobCid, parseAtUri, exifToForm, formToExifValue, formatExposure } from "../src/grain.js";

describe("blobCid", () => {
  it("reads a raw JSON blob ref ($link)", () => {
    expect(blobCid({ ref: { $link: "bafabc" }, mimeType: "image/jpeg" })).toBe("bafabc");
  });
  it("reads a hydrated BlobRef whose ref is a CID object (toString)", () => {
    const cidObj = { toString: () => "bafcid", constructor: { name: "CID" } };
    expect(blobCid({ ref: cidObj, mimeType: "image/jpeg" })).toBe("bafcid");
  });
  it("reads a bare string ref", () => {
    expect(blobCid({ ref: "bafstr" })).toBe("bafstr");
  });
  it("returns null for junk / missing", () => {
    expect(blobCid(null)).toBe(null);
    expect(blobCid({})).toBe(null);
    expect(blobCid({ ref: {} })).toBe(null);
  });
});

describe("parseAtUri", () => {
  it("splits a valid at-uri", () => {
    expect(parseAtUri("at://did:plc:abc/social.grain.photo/rkey1")).toEqual({
      did: "did:plc:abc", collection: "social.grain.photo", rkey: "rkey1",
    });
  });
  it("throws on a non at-uri", () => {
    expect(() => parseAtUri("https://example.com")).toThrow();
  });
});

describe("exif scaling round-trip", () => {
  it("exifToForm divides scaled integers back to human values", () => {
    const form = exifToForm({ fNumber: 2_800_000, iSO: 400_000_000, focalLengthIn35mmFormat: 50_000_000, make: "Leica" });
    expect(form.fNumber).toBe("2.8");
    expect(form.iSO).toBe("400");
    expect(form.focalLengthIn35mmFormat).toBe("50");
    expect(form.make).toBe("Leica");
  });

  it("formToExifValue scales human values back to integers", () => {
    const v = formToExifValue({ fNumber: "2.8", iSO: "400", focalLengthIn35mmFormat: "50", exposureTime: "1/125" }, "at://p", "2026-01-01T00:00:00Z");
    expect(v.fNumber).toBe(2_800_000);
    expect(v.iSO).toBe(400_000_000);
    expect(v.focalLengthIn35mmFormat).toBe(50_000_000);
    expect(v.exposureTime).toBe(Math.round((1 / 125) * 1_000_000));
    expect(v.photo).toBe("at://p");
  });

  it("omits empty fields", () => {
    const v = formToExifValue({ make: "", fNumber: "" }, "at://p");
    expect(v.make).toBeUndefined();
    expect(v.fNumber).toBeUndefined();
  });
});

describe("formatExposure", () => {
  it("formats sub-second as a fraction and >=1s as seconds", () => {
    expect(formatExposure(Math.round((1 / 125) * 1_000_000))).toBe("1/125");
    expect(formatExposure(2_000_000)).toBe("2");
  });
});
