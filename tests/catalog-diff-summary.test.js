import { describe, expect, it } from "vitest";
import { diffRecords, renderSummary } from "../scripts/catalog-diff-summary.mjs";

describe("catalog refresh diff summary", () => {
  it("classifies stable records as added, changed, or removed", () => {
    const before = [
      { make: "Nikon", model: "F2", year: 1971 },
      { make: "Nikon", model: "F3", year: 1980 },
    ];
    const after = [
      { make: "Nikon", model: "F2", year: 1971 },
      { make: "Nikon", model: "F3", year: 1981 },
      { make: "Nikon", model: "F4", year: 1988 },
    ];

    expect(diffRecords(before, after, ["make", "model"])).toEqual({ added: 1, changed: 1, removed: 0 });
    expect(diffRecords(after, before, ["make", "model"])).toEqual({ added: 0, changed: 1, removed: 1 });
  });

  it("renders a PR-ready aggregate table", () => {
    const body = renderSummary([
      { collection: "cameras", added: 2, changed: 1, removed: 0, total: 12 },
      { collection: "lenses", added: 0, changed: 3, removed: 1, total: 30 },
    ]);

    expect(body).toContain("| **Total** | **2** | **4** | **1** | |\n");
  });
});
