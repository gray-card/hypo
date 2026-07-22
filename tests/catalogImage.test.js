import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { catalogImageUrl, curatedImageUrl, datasheetRef } from "../src/data/catalogImage.js";

// keep the Wikidata fallback hermetic: any network attempt fails, so the chain
// bottoms out at null instead of reaching wikidata.org.
beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn(async () => { throw new Error("offline"); });
});
afterEach(() => vi.restoreAllMocks());

describe("catalogImageUrl resolution order", () => {
  it("prefers the type record's own image link", async () => {
    const value = { brand: "Kodak", name: "Gold 200", image: { url: "https://example.test/box.jpg" } };
    expect(await catalogImageUrl("filmStock", value)).toBe("https://example.test/box.jpg");
  });

  it("falls back to an uploaded file via the caller's blob resolver", async () => {
    const blob = { $type: "blob", ref: { $link: "bafblob" }, mimeType: "image/jpeg" };
    const value = { brand: "Kodak", name: "Gold 200", image: { file: blob } };
    const blobUrl = vi.fn(async () => "blob:resolved");
    expect(await catalogImageUrl("filmStock", value, { blobUrl })).toBe("blob:resolved");
    expect(blobUrl).toHaveBeenCalledWith(blob);
  });

  it("ignores an uploaded file when no blob resolver is supplied", async () => {
    const value = { brand: "Nope", name: "Unknown Stock", image: { file: { $type: "blob" } } };
    expect(await catalogImageUrl("filmStock", value)).toBeNull();
  });

  it("a url beats a file when both are present", async () => {
    const value = { image: { url: "https://example.test/a.png", file: { $type: "blob" } } };
    const blobUrl = vi.fn(async () => "blob:should-not-be-used");
    expect(await catalogImageUrl("filmStock", value, { blobUrl })).toBe("https://example.test/a.png");
    expect(blobUrl).not.toHaveBeenCalled();
  });

  it("returns null for an unknown type with no image and no reachable Wikidata", async () => {
    expect(await catalogImageUrl("filmStock", { brand: "Nope", name: "Not A Real Film" })).toBeNull();
  });

  it("returns null for a missing value", async () => {
    expect(await catalogImageUrl("filmStock", null)).toBeNull();
  });
});

describe("curatedImageUrl", () => {
  it("returns null for a stock we have not curated", () => {
    expect(curatedImageUrl("filmStock", { brand: "Nope", name: "Not A Real Film" })).toBeNull();
  });

  it("resolves a curated stock to a manufacturer-hosted image", () => {
    const url = curatedImageUrl("filmStock", { brand: "Kodak", name: "Gold 200" });
    expect(url).toMatch(/^https:\/\/www\.kodak\.com\//);
  });

  it("resolves the Kodacolor rebrands to their official box shots", () => {
    expect(curatedImageUrl("filmStock", { brand: "Kodak", name: "Kodacolor 100" }))
      .toMatch(/kodak\.com\/.*kodacolor-film-100-36exp-box\.jpg/);
    expect(curatedImageUrl("filmStock", { brand: "Kodak", name: "Kodacolor 200" }))
      .toMatch(/kodak\.com\/.*kodacolor-film-200-36exp-box\.jpg/);
  });

  it("matches case- and punctuation-insensitively", () => {
    const a = curatedImageUrl("filmStock", { brand: "Kodak", name: "Gold 200" });
    const b = curatedImageUrl("filmStock", { brand: "  kodak ", name: "gold-200" });
    expect(b).toBe(a);
  });

  it("curated images are all manufacturer-hosted, never a retailer CDN", async () => {
    const { stocks } = (await import("../src/data/curated-film-stocks.json")).default;
    const withImage = stocks.filter((s) => s.image);
    expect(withImage.length).toBeGreaterThan(80);
    // Analogue Wonderland and other resellers are deliberately excluded: we link
    // the rights holder's own photo of its own product, or nothing.
    const retailer = withImage.filter((s) => /analoguewonderland|freestylephoto|bhphotovideo/i.test(s.image));
    expect(retailer.map((s) => `${s.brand} ${s.name}`)).toEqual([]);
  });

  it("a curated image is used when the record carries no image of its own", async () => {
    const url = await catalogImageUrl("filmStock", { brand: "Kodak", name: "Gold 200" });
    expect(url).toMatch(/kodak\.com/);
  });
});

describe("datasheetRef", () => {
  it("prefers the richer datasheet link", () => {
    expect(datasheetRef({ datasheet: { url: "https://x.test/a.pdf" }, datasheetUrl: "https://old.test/b.pdf" }))
      .toMatchObject({ url: "https://x.test/a.pdf", kind: "url" });
  });

  it("surfaces a record reference", () => {
    expect(datasheetRef({ datasheet: { record: "at://did:plc:x/app.graycard.artifact/1" } }))
      .toMatchObject({ kind: "record", record: "at://did:plc:x/app.graycard.artifact/1" });
  });

  it("surfaces an uploaded file", () => {
    const file = { $type: "blob" };
    expect(datasheetRef({ datasheet: { file } })).toMatchObject({ kind: "file", file });
  });

  it("falls back to the legacy flat datasheetUrl", () => {
    expect(datasheetRef({ datasheetUrl: "https://old.test/b.pdf" }))
      .toMatchObject({ url: "https://old.test/b.pdf", kind: "url" });
  });

  it("returns null when there is no datasheet at all", () => {
    expect(datasheetRef({})).toBeNull();
    expect(datasheetRef(null)).toBeNull();
  });
});
