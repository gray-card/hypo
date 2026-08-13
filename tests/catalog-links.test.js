import { describe, expect, it, vi } from "vitest";
import { checkCatalogLinks, checkLink, extractCatalogLinks } from "../scripts/check-catalog-links.mjs";

describe("catalog link checker", () => {
  it("extracts only provenance document URLs", () => {
    expect(
      extractCatalogLinks({
        website: "https://ignored.example",
        documents: [{ url: "https://docs.example/manual.pdf" }],
        specSources: [{ documentUrl: "https://docs.example/spec.pdf", page: 2 }],
      }).map((item) => item.url),
    ).toEqual(["https://docs.example/manual.pdf", "https://docs.example/spec.pdf"]);
  });

  it("falls back to a ranged GET when HEAD is unsupported", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })
      .mockResolvedValueOnce({ ok: true, status: 206 });
    await expect(
      checkLink({ url: "https://docs.example/manual.pdf", source: "fixture" }, fetchImpl),
    ).resolves.toMatchObject({
      ok: true,
      status: 206,
    });
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: "GET" });
  });

  it("reports failures without making the advisory runner throw", async () => {
    const results = await checkCatalogLinks({
      links: [{ url: "https://docs.example/missing", source: "fixture" }],
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    });
    expect(results).toEqual([expect.objectContaining({ ok: false, status: 404, source: "fixture" })]);
  });
});
