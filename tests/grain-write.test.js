import { describe, it, expect } from "vitest";
import {
  createGallery,
  createPhoto,
  addGalleryItem,
  savePhotoAlt,
  uploadImage,
  setGalleryItemPosition,
  replacePhoto,
  COLLECTIONS,
} from "../src/grain.js";
import { mockAgent } from "./setup.js";

const BLOB_CID = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";

describe("direct gallery upload helpers", () => {
  it("createGallery writes a grain gallery with title + createdAt", async () => {
    const agent = mockAgent();
    const uri = await createGallery(agent, "did:plc:test", { title: "Trip", description: "  " });
    expect(uri).toContain(COLLECTIONS.gallery);
    const rec = agent.created[0];
    expect(rec.collection).toBe(COLLECTIONS.gallery);
    expect(rec.record.title).toBe("Trip");
    expect(rec.record.description).toBeUndefined(); // blank description dropped
    expect(rec.record.createdAt).toBeTruthy();
  });

  it("createGallery falls back to a default title", async () => {
    const agent = mockAgent();
    await createGallery(agent, "did:plc:test", { title: "   " });
    expect(agent.created[0].record.title).toBe("Untitled gallery");
  });

  it("createPhoto stores the blob and aspect ratio", async () => {
    const agent = mockAgent();
    const blob = { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1 };
    await createPhoto(agent, "did:plc:test", { blob, aspectRatio: { width: 3, height: 2 }, alt: "a cat" });
    const rec = agent.created[0];
    expect(rec.collection).toBe(COLLECTIONS.photo);
    expect(rec.record.photo).toEqual(blob);
    expect(rec.record.aspectRatio).toEqual({ width: 3, height: 2 });
    expect(rec.record.alt).toBe("a cat");
  });

  it("addGalleryItem links a photo into a gallery at a position", async () => {
    const agent = mockAgent();
    await addGalleryItem(agent, "did:plc:test", {
      gallery: "at://did:plc:test/social.grain.gallery/gallery",
      item: "at://did:plc:test/social.grain.photo/photo",
      position: 4,
    });
    const rec = agent.created[0];
    expect(rec.collection).toBe(COLLECTIONS.galleryItem);
    expect(rec.record).toMatchObject({
      gallery: "at://did:plc:test/social.grain.gallery/gallery",
      item: "at://did:plc:test/social.grain.photo/photo",
      position: 4,
    });
  });

  it("uploadImage uploads bytes and returns a blob ref", async () => {
    const agent = mockAgent();
    const file = { type: "image/png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const blob = await uploadImage(agent, file);
    expect(blob.$type).toBe("blob");
    expect(blob.ref.$link).toBeTruthy();
  });

  it("setGalleryItemPosition updates position and preserves other fields (reorder)", async () => {
    const agent = mockAgent();
    const item = {
      uri: "at://did:plc:test/social.grain.gallery.item/rk9",
      cid: "cid9",
      value: {
        gallery: "at://did:plc:test/social.grain.gallery/gallery",
        item: "at://did:plc:test/social.grain.photo/photo",
        position: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
    };
    await setGalleryItemPosition(agent, "did:plc:test", item, 3);
    const rec = agent.put[0];
    expect(rec.collection).toBe(COLLECTIONS.galleryItem);
    expect(rec.rkey).toBe("rk9");
    expect(rec.record.position).toBe(3);
    expect(rec.record.gallery).toBe("at://did:plc:test/social.grain.gallery/gallery"); // preserved
    expect(rec.record.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("replacePhoto updates the blob on the same photo rkey", async () => {
    const agent = mockAgent();
    const oldBlob = { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1 };
    const newBlob = {
      ref: { toString: () => BLOB_CID },
      mimeType: "image/jpeg",
      size: 2,
      original: {
        $type: "blob",
        ref: { $link: BLOB_CID },
        mimeType: "image/jpeg",
        size: 2,
      },
    };
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/rk1",
      cid: "cid-old",
      value: {
        photo: oldBlob,
        alt: "keep me",
        createdAt: "2026-01-01T00:00:00Z",
        aspectRatio: { width: 3, height: 2 },
      },
    };
    const result = await replacePhoto(agent, "did:plc:test", photo, {
      blob: newBlob,
      aspectRatio: { width: 4, height: 3 },
    });
    expect(agent.put).toHaveLength(1);
    const rec = agent.put[0];
    expect(rec.collection).toBe(COLLECTIONS.photo);
    expect(rec.rkey).toBe("rk1");
    expect(rec.record.photo).toEqual({
      $type: "blob",
      ref: { $link: BLOB_CID },
      mimeType: "image/jpeg",
      size: 2,
    });
    expect(rec.record.photo).not.toHaveProperty("original");
    expect(rec.record.alt).toBe("keep me");
    expect(rec.record.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(rec.record.aspectRatio).toEqual({ width: 4, height: 3 });
    expect(result.cid).toBeTruthy();
    expect(result.value.photo).toEqual(rec.record.photo);
  });

  it("canonicalizes a hydrated blob when editing alt text", async () => {
    const agent = mockAgent();
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/rk2",
      cid: "cid-old",
      value: {
        photo: {
          ref: { toString: () => BLOB_CID },
          mimeType: "image/jpeg",
          size: 2,
          original: { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 2 },
        },
        aspectRatio: { width: 3, height: 2 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    };

    await savePhotoAlt(agent, "did:plc:test", photo, "updated description");

    expect(agent.put[0].record.photo).toEqual({
      $type: "blob",
      ref: { $link: BLOB_CID },
      mimeType: "image/jpeg",
      size: 2,
    });
    expect(agent.put[0].record.photo).not.toHaveProperty("original");
  });

  it("rejects an oversized photo before creating a record", async () => {
    const agent = mockAgent();
    const blob = { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1_000_001 };

    await expect(createPhoto(agent, "did:plc:test", { blob, aspectRatio: { width: 3, height: 2 } })).rejects.toThrow(
      "photo.size",
    );
    expect(agent.created).toHaveLength(0);
  });

  it("rejects an existing oversized photo before editing its alt text", async () => {
    const agent = mockAgent();
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/oversized",
      cid: "cid-old",
      value: {
        photo: { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1_000_001 },
        aspectRatio: { width: 3, height: 2 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    };

    await expect(savePhotoAlt(agent, "did:plc:test", photo, "must not write")).rejects.toThrow("photo.size");
    expect(agent.put).toHaveLength(0);
  });

  it("rejects replacement photos without a valid aspect ratio", async () => {
    const agent = mockAgent();
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/photo",
      cid: "cid-old",
      value: {
        photo: { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1 },
        aspectRatio: { width: 3, height: 2 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    };

    await expect(
      replacePhoto(agent, "did:plc:test", photo, {
        blob: { $type: "blob", ref: { $link: BLOB_CID }, mimeType: "image/jpeg", size: 1 },
        aspectRatio: { width: 0, height: 2 },
      }),
    ).rejects.toThrow("aspectRatio.width");
    expect(agent.put).toHaveLength(0);
  });

  it("rejects a corrupt blob instead of rewriting the Grain photo", async () => {
    const agent = mockAgent();
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/rk3",
      cid: "cid-old",
      value: {
        photo: {
          ref: { $link: "[object Object]" },
          mimeType: "image/jpeg",
          size: 892396,
          original: {
            $type: "blob",
            ref: { $link: "[object Object]" },
            mimeType: "image/jpeg",
            size: 892396,
          },
        },
        createdAt: "2026-01-01T00:00:00Z",
      },
    };

    await expect(savePhotoAlt(agent, "did:plc:test", photo, "must not write")).rejects.toThrow("valid CID link");
    expect(agent.put).toHaveLength(0);
  });
});
