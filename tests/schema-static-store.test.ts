import { describe, expect, it, vi } from "vitest";

import { StaticPanprotoStore, StaticPanprotoStoreError } from "@hypo/schema-runtime";

const objectId = "ab".repeat(32);

function response(body: string | Uint8Array, status = 200) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe("static Panproto object store", () => {
  it("resolves a published ref to its content-addressed object", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(`${objectId}\n`))
      .mockResolvedValueOnce(response(new Uint8Array([1, 2, 3])));
    const store = new StaticPanprotoStore({ baseUrl: "https://hypo.test/.panproto/", fetch });

    await expect(store.resolveRef("heads/main")).resolves.toEqual({
      objectId,
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://hypo.test/.panproto/refs/heads/main",
      `https://hypo.test/.panproto/objects/${objectId.slice(0, 2)}/${objectId.slice(2)}`,
    ]);
  });

  it("rejects traversal and malformed object ids before fetching", async () => {
    const fetch = vi.fn();
    const store = new StaticPanprotoStore({ fetch });

    await expect(store.getRef("../HEAD")).rejects.toBeInstanceOf(StaticPanprotoStoreError);
    await expect(store.getObject("not-a-hash")).rejects.toBeInstanceOf(StaticPanprotoStoreError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
