// the profile map's location filter draws its cells with the theme accent color.
// maplibre's style spec can't parse modern css colors (oklch), so the accent must
// be normalised to rgb() first — otherwise the cells-heat / cells-dot layers fail
// to add and there is nothing to tap. these guard that regression.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cssColorToRgb } from "../src/ui/mapView.js";

afterEach(() => vi.restoreAllMocks());

function stubCanvas(ctx) {
  vi.spyOn(document, "createElement").mockReturnValue({ getContext: () => ctx });
}

describe("cssColorToRgb — maplibre-safe accent color", () => {
  it("rasterises a color to an rgb() string maplibre can parse", () => {
    stubCanvas({ fillStyle: "", fillRect() {}, getImageData: () => ({ data: Uint8ClampedArray.from([245, 146, 58, 255]) }) });
    const out = cssColorToRgb("oklch(0.75 0.155 58)");
    expect(out).toBe("rgb(245, 146, 58)");
    expect(out).not.toMatch(/oklch/);
  });

  it("falls back to a parseable color when the canvas is unavailable", () => {
    stubCanvas(null);
    expect(cssColorToRgb("oklch(0.75 0.155 58)")).toBe("#e8763a");
  });

  it("uses the provided fallback and never emits an unparseable value", () => {
    stubCanvas(null);
    const out = cssColorToRgb("", "#123456");
    expect(out).toBe("#123456");
    expect(out).toMatch(/^(#|rgb)/);
  });
});
