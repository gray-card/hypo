import { describe, it, expect, beforeEach, vi } from "vitest";
import { instanceImageUrl, gearThumb } from "../src/data/gearImage.js";

// agent whose sync.getBlob returns bytes, so blobUrl() can build an object URL.
function blobAgent() {
  return { com: { atproto: { sync: { getBlob: async () => ({ data: new Uint8Array([1, 2, 3]) }) } } } };
}
function stubWikidata(handler) {
  global.fetch = vi.fn(async (url) => {
    const u = new URL(url);
    return { ok: true, json: async () => handler(u.searchParams.get("action"), u.searchParams) };
  });
}
const P18 = (file) => ({ claims: { P18: [{ mainsnak: { datavalue: { value: file } } }] } });

function storeWithType(uri, layerValue) {
  return { byUri: new Map([[uri, { item: { value: layerValue } }]]) };
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("instanceImageUrl", () => {
  it("uses the user's own uploaded photo when present", async () => {
    const url = await instanceImageUrl(blobAgent(), "did:plc:test", { byUri: new Map() }, "camera", {
      image: { ref: { $link: "bafblob" }, mimeType: "image/jpeg" },
    });
    expect(url).toBe("blob:fake"); // from the object-URL polyfill
  });

  it("falls back to the type's Wikidata stock image (camera via type ref)", async () => {
    stubWikidata((action) => action === "wbgetclaims" ? P18("Leica_M6.jpg") : {});
    const store = storeWithType("at://t/cam", { make: "Leica", model: "M6", links: { externalIds: [{ scheme: "wikidata", value: "Q-gi-cam" }] } });
    const url = await instanceImageUrl(blobAgent(), "did:plc:test", store, "camera", { type: "at://t/cam" });
    expect(url).toContain("Special:FilePath/");
    expect(url).toContain("Leica_M6.jpg");
  });

  it("resolves film rolls through their stock reference", async () => {
    stubWikidata((action) => action === "wbgetclaims" ? P18("Portra.jpg") : {});
    const store = storeWithType("at://t/film", { brand: "Kodak", name: "Portra 400", links: { externalIds: [{ scheme: "wikidata", value: "Q-gi-film" }] } });
    const url = await instanceImageUrl(blobAgent(), "did:plc:test", store, "filmRoll", { stock: "at://t/film" });
    expect(url).toContain("Portra.jpg");
  });

  it("returns null when there is neither a photo nor a resolvable type", async () => {
    const url = await instanceImageUrl(blobAgent(), "did:plc:test", { byUri: new Map() }, "camera", {});
    expect(url).toBe(null);
  });

  it("returns null (not a throw) when the blob fetch fails", async () => {
    const badAgent = { com: { atproto: { sync: { getBlob: async () => { throw new Error("no blob"); } } } } };
    const url = await instanceImageUrl(badAgent, "did:plc:test", { byUri: new Map() }, "camera", {
      image: { ref: { $link: "bafblob" }, mimeType: "image/jpeg" },
    });
    expect(url).toBe(null);
  });
});

describe("gearThumb", () => {
  it("returns a .type-thumb element and paints the resolved image on refresh", async () => {
    stubWikidata((action) => action === "wbgetclaims" ? P18("Cam.jpg") : {});
    const store = storeWithType("at://t/cam", { make: "Leica", model: "M6", links: { externalIds: [{ scheme: "wikidata", value: "Q-gi-thumb" }] } });
    const { thumb, refresh } = gearThumb(blobAgent(), "did:plc:test", store, "camera", () => ({ type: "at://t/cam" }));
    expect(thumb.className).toContain("type-thumb");
    refresh();
    await vi.waitFor(() => {
      expect(thumb.classList.contains("has-img")).toBe(true);
      expect(thumb.style.backgroundImage).toContain("Cam.jpg");
    });
  });

  it("clears the image when the value becomes empty", () => {
    const store = { byUri: new Map() };
    const { thumb, refresh } = gearThumb(blobAgent(), "did:plc:test", store, "camera", () => null);
    thumb.classList.add("has-img");
    refresh();
    expect(thumb.classList.contains("has-img")).toBe(false);
  });
});
