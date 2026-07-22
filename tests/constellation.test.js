import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { countSetups, countSetupAuthors, listSetupPage } from "../src/constellation.js";
import { setConstellationBase, HYPO_REGISTRY } from "../src/registry.js";

const calls = [];
function mockFetch(map) {
  return vi.fn(async (url) => {
    calls.push(String(url));
    for (const [frag, body] of map) {
      if (String(url).includes(frag)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe("constellation client (the only place the unstable API is touched)", () => {
  beforeEach(() => { calls.length = 0; localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("countSetups reads {total} and queries the anchor/collection/path", async () => {
    global.fetch = mockFetch([["/links/count", { total: 42 }]]);
    expect(await countSetups()).toBe(42);
    const url = calls[0];
    expect(url).toContain("/links/count?");
    expect(url).toContain(`target=${encodeURIComponent(HYPO_REGISTRY)}`);
    expect(url).toContain("collection=app.graycard.setup");
    expect(url).toContain(`path=${encodeURIComponent(".registry")}`);
  });

  it("countSetupAuthors reads the distinct-dids total", async () => {
    global.fetch = mockFetch([["/links/distinct-dids", { total: 7, linking_dids: [], cursor: null }]]);
    expect(await countSetupAuthors()).toBe(7);
    expect(calls[0]).toContain("/links/distinct-dids?");
  });

  it("listSetupPage maps linking_records to at-uris, defaults collection, passes cursor+limit", async () => {
    global.fetch = mockFetch([["/links?", {
      total: 2,
      linking_records: [
        { did: "did:plc:a", collection: "app.graycard.setup", rkey: "r1" },
        { did: "did:plc:b", rkey: "r2" }, // collection omitted -> defaults to the setup nsid
      ],
      cursor: "next123",
    }]]);
    const page = await listSetupPage("cur0", 25);
    expect(page.items).toEqual([
      { did: "did:plc:a", collection: "app.graycard.setup", rkey: "r1", uri: "at://did:plc:a/app.graycard.setup/r1" },
      { did: "did:plc:b", collection: "app.graycard.setup", rkey: "r2", uri: "at://did:plc:b/app.graycard.setup/r2" },
    ]);
    expect(page.cursor).toBe("next123");
    expect(calls[0]).toContain("cursor=cur0");
    expect(calls[0]).toContain("limit=25");
  });

  it("drops rows missing did or rkey and normalizes a null cursor", async () => {
    global.fetch = mockFetch([["/links?", { total: 1, linking_records: [{ did: "did:plc:a" }, { rkey: "x" }], cursor: null }]]);
    const page = await listSetupPage();
    expect(page.items).toEqual([]);
    expect(page.cursor).toBeNull();
  });

  it("tolerates a bare-number count (older documented shape)", async () => {
    global.fetch = mockFetch([["/links/count", 5]]);
    expect(await countSetups()).toBe(5);
  });

  it("honors the Constellation base URL override", async () => {
    setConstellationBase("https://my.example.com");
    global.fetch = mockFetch([["/links/count", { total: 1 }]]);
    await countSetups();
    expect(calls[0]).toContain("https://my.example.com/links/count");
  });

  it("throws on a non-ok response", async () => {
    global.fetch = mockFetch([]);
    await expect(countSetups()).rejects.toThrow(/constellation 404/);
  });
});
