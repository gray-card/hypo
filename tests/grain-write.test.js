import { describe, it, expect } from "vitest";
import { createGallery, createPhoto, addGalleryItem, uploadImage, setGalleryItemPosition, replacePhoto, COLLECTIONS } from "../src/grain.js";
import { mockAgent } from "./setup.js";

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
    const blob = { $type: "blob", ref: { $link: "bafx" }, mimeType: "image/jpeg", size: 1 };
    await createPhoto(agent, "did:plc:test", { blob, aspectRatio: { width: 3, height: 2 }, alt: "a cat" });
    const rec = agent.created[0];
    expect(rec.collection).toBe(COLLECTIONS.photo);
    expect(rec.record.photo).toBe(blob);
    expect(rec.record.aspectRatio).toEqual({ width: 3, height: 2 });
    expect(rec.record.alt).toBe("a cat");
  });

  it("addGalleryItem links a photo into a gallery at a position", async () => {
    const agent = mockAgent();
    await addGalleryItem(agent, "did:plc:test", { gallery: "at://g", item: "at://p", position: 4 });
    const rec = agent.created[0];
    expect(rec.collection).toBe(COLLECTIONS.galleryItem);
    expect(rec.record).toMatchObject({ gallery: "at://g", item: "at://p", position: 4 });
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
    const item = { uri: "at://did:plc:test/social.grain.gallery.item/rk9", cid: "cid9", value: { gallery: "at://g", item: "at://p", position: 0, createdAt: "2026-01-01T00:00:00Z" } };
    await setGalleryItemPosition(agent, "did:plc:test", item, 3);
    const rec = agent.put[0];
    expect(rec.collection).toBe(COLLECTIONS.galleryItem);
    expect(rec.rkey).toBe("rk9");
    expect(rec.record.position).toBe(3);
    expect(rec.record.gallery).toBe("at://g"); // preserved
    expect(rec.record.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("replacePhoto updates the blob on the same photo rkey", async () => {
    const agent = mockAgent();
    const oldBlob = { $type: "blob", ref: { $link: "bafold" }, mimeType: "image/jpeg", size: 1 };
    const newBlob = { $type: "blob", ref: { $link: "bafnew" }, mimeType: "image/jpeg", size: 2 };
    const photo = {
      uri: "at://did:plc:test/social.grain.photo/rk1",
      cid: "cid-old",
      value: { photo: oldBlob, alt: "keep me", createdAt: "2026-01-01T00:00:00Z", aspectRatio: { width: 3, height: 2 } },
    };
    const result = await replacePhoto(agent, "did:plc:test", photo, {
      blob: newBlob,
      aspectRatio: { width: 4, height: 3 },
    });
    expect(agent.put).toHaveLength(1);
    const rec = agent.put[0];
    expect(rec.collection).toBe(COLLECTIONS.photo);
    expect(rec.rkey).toBe("rk1");
    expect(rec.record.photo).toBe(newBlob);
    expect(rec.record.alt).toBe("keep me");
    expect(rec.record.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(rec.record.aspectRatio).toEqual({ width: 4, height: 3 });
    expect(result.cid).toBeTruthy();
    expect(result.value.photo).toBe(newBlob);
  });
});
