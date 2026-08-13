import { beforeAll, describe, expect, it, vi } from "vitest";
import { imageAlt, lazyThumb } from "../src/ui/lazy.js";

vi.mock("../src/grain.js", () => ({
  blobUrl: vi.fn(async () => "blob:thumbnail"),
}));

let intersect;
const observe = vi.fn();
const unobserve = vi.fn();

beforeAll(() => {
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      intersect = callback;
    }
    observe = observe;
    unobserve = unobserve;
  };
});

describe("lazyThumb", () => {
  it("normalizes content labels while preserving an empty decorative default", () => {
    expect(imageAlt("  Sunset over Lake Ontario  ", "Photo 1")).toBe("Sunset over Lake Ontario");
    expect(imageAlt("   ", "Photo 1")).toBe("Photo 1");
    expect(imageAlt(null)).toBe("");
  });

  it("uses supplied alt text while keeping the default decorative", async () => {
    const named = lazyThumb({}, "did:plc:test", { ref: "named" }, "thumb", "Sunset over Lake Ontario");
    const decorative = lazyThumb({}, "did:plc:test", { ref: "decorative" });
    document.body.append(named, decorative);

    intersect([
      { isIntersecting: true, target: named },
      { isIntersecting: true, target: decorative },
    ]);

    await vi.waitFor(() => expect(named.querySelector("img")).toBeTruthy());
    expect(named.querySelector("img").alt).toBe("Sunset over Lake Ontario");
    expect(decorative.querySelector("img").alt).toBe("");
    expect(unobserve).toHaveBeenCalledWith(named);
    expect(unobserve).toHaveBeenCalledWith(decorative);
  });
});
