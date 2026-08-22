import { describe, expect, it } from "vitest";
import { BlobRef as AtprotoBlobRef } from "@atproto/lexicon";
import { CID } from "multiformats/cid";
import { canonicalizeAndValidateGrainRecord, GRAIN_PHOTO_MAX_BYTES } from "../src/grainValidation.js";

const BLOB_CID = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";
const CREATED_AT = "2026-08-18T12:00:00.000Z";

function blob(size = 892396, mimeType = "image/jpeg") {
  return { $type: "blob", ref: { $link: BLOB_CID }, mimeType, size };
}

describe("Grain record validation", () => {
  it("canonicalizes structured-cloned BlobRefs and removes non-lexicon fields", () => {
    const hydrated = new AtprotoBlobRef(CID.parse(BLOB_CID), "image/jpeg", 892396, blob());
    const denatured = structuredClone(hydrated);

    const record = canonicalizeAndValidateGrainRecord("social.grain.photo", {
      photo: denatured,
      aspectRatio: { width: 3, height: 2 },
      createdAt: CREATED_AT,
    });

    expect(record.$type).toBe("social.grain.photo");
    expect(record.photo).toEqual(blob());
    expect(record.photo).not.toHaveProperty("original");
  });

  it.each([
    ["oversized blobs", blob(GRAIN_PHOTO_MAX_BYTES + 1), "photo.size"],
    ["non-image blobs", blob(1, "application/pdf"), "photo.mimeType"],
  ])("rejects %s", (_name, photo, message) => {
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.photo", {
        photo,
        aspectRatio: { width: 3, height: 2 },
        createdAt: CREATED_AT,
      }),
    ).toThrow(message);
  });

  it("requires Grain's aspect ratio and RFC 3339 timestamp", () => {
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.photo", {
        photo: blob(),
        createdAt: CREATED_AT,
      }),
    ).toThrow("record must be an object");
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.photo", {
        photo: blob(),
        aspectRatio: { width: 3, height: 2 },
        createdAt: "yesterday",
      }),
    ).toThrow("RFC 3339");
  });

  it("enforces gallery, gallery-item, and EXIF field contracts", () => {
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.gallery", {
        title: "x".repeat(101),
        createdAt: CREATED_AT,
      }),
    ).toThrow("at most 100");
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.gallery.item", {
        gallery: "not-an-at-uri",
        item: "at://did:plc:test/social.grain.photo/photo",
        createdAt: CREATED_AT,
      }),
    ).toThrow("gallery must be an AT URI");
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.photo.exif", {
        photo: "at://did:plc:test/social.grain.photo/photo",
        createdAt: CREATED_AT,
        iSO: 1.5,
      }),
    ).toThrow("iSO must be an integer");
  });

  it("validates the optional rich-text, label, location, and address fields Grain defines", () => {
    const gallery = canonicalizeAndValidateGrainRecord("social.grain.gallery", {
      title: "Rochester",
      description: "Photographs from #Rochester",
      facets: [
        {
          index: { byteStart: 17, byteEnd: 27 },
          features: [{ $type: "app.bsky.richtext.facet#tag", tag: "Rochester" }],
        },
      ],
      labels: { $type: "com.atproto.label.defs#selfLabels", values: [{ val: "nudity" }] },
      location: { value: "872a1072dffffff", name: "Rochester" },
      address: { country: "US", region: "NY", locality: "Rochester" },
      createdAt: CREATED_AT,
    });
    expect(gallery).toMatchObject({ title: "Rochester", address: { country: "US" } });

    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.gallery", {
        title: "Invalid facet",
        facets: [{ index: { byteStart: -1, byteEnd: 2 }, features: [] }],
        createdAt: CREATED_AT,
      }),
    ).toThrow("byteStart");
    expect(() =>
      canonicalizeAndValidateGrainRecord("social.grain.gallery", {
        title: "Invalid address",
        address: { country: "U" },
        createdAt: CREATED_AT,
      }),
    ).toThrow("at least 2");
  });

  it("does not alter non-Grain records", () => {
    const value = { nested: { ref: { $link: BLOB_CID } } };
    expect(canonicalizeAndValidateGrainRecord("app.graycard.test", value)).toBe(value);
  });
});
