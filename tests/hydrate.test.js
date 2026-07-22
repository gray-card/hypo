import { describe, it, expect, afterEach, vi } from "vitest";
import { hydrateSetup, hydratePage } from "../src/hydrate.js";

// route fetch by URL substring; unmatched URLs 404 (as a missing PDS record would).
function router(map) {
  return vi.fn(async (url) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(map)) {
      if (u.includes(frag)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

const pdsDoc = (endpoint) => ({ service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: endpoint }] });

describe("hydrateSetup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the PDS and reads the record value", async () => {
    global.fetch = router({
      "plc.directory/did:plc:aaa": pdsDoc("https://pds.aaa"),
      "pds.aaa/xrpc/com.atproto.repo.getRecord": { value: { $type: "app.graycard.setup", name: "Kit" } },
    });
    const rec = await hydrateSetup({ did: "did:plc:aaa", collection: "app.graycard.setup", rkey: "r1", uri: "at://did:plc:aaa/app.graycard.setup/r1" });
    expect(rec.value.name).toBe("Kit");
    expect(rec.uri).toBe("at://did:plc:aaa/app.graycard.setup/r1");
  });

  it("returns null when the record 404s (deleted since indexing)", async () => {
    global.fetch = router({ "plc.directory/did:plc:bbb": pdsDoc("https://pds.bbb") });
    const rec = await hydrateSetup({ did: "did:plc:bbb", collection: "app.graycard.setup", rkey: "r1" });
    expect(rec).toBeNull();
  });
});

describe("hydratePage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops unreadable records and attaches author profiles", async () => {
    global.fetch = router({
      "plc.directory/did:plc:ccc": pdsDoc("https://pds.ccc"),
      "plc.directory/did:plc:ddd": pdsDoc("https://pds.ddd"),
      "pds.ccc/xrpc/com.atproto.repo.getRecord": { value: { name: "C" } },
      // ddd has no getRecord mapping -> 404 -> dropped
      "getProfiles": { profiles: [{ did: "did:plc:ccc", handle: "cee.test", displayName: "Cee", avatar: "http://a/av" }] },
    });
    const out = await hydratePage([
      { did: "did:plc:ccc", collection: "app.graycard.setup", rkey: "r", uri: "at://did:plc:ccc/app.graycard.setup/r" },
      { did: "did:plc:ddd", collection: "app.graycard.setup", rkey: "r", uri: "at://did:plc:ddd/app.graycard.setup/r" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].did).toBe("did:plc:ccc");
    expect(out[0].author).toMatchObject({ handle: "cee.test", displayName: "Cee" });
  });
});
