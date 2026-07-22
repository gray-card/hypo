import { describe, it, expect } from "vitest";
import { lensRecordFromFields, lensIssueUrl, LENS_ISSUE_REPO } from "../src/data/lensSuggest.js";

describe("lensRecordFromFields", () => {
  it("builds a jsonl-ready record and drops blanks", () => {
    const rec = lensRecordFromFields({ make: "Nikon", model: "Nikkor 50mm f/1.4", mount: "Nikon F", focalLengthMin: "50", maxAperture: "1.4" });
    expect(rec).toMatchObject({
      make: "Nikon", model: "Nikkor 50mm f/1.4", mount: "Nikon F", mounts: ["Nikon F"],
      focalLengthMin: 50, focalLengthMax: 50, maxAperture: 1.4, lensTypeKind: "prime",
      wikidata: null, image: null, source: "user-suggested",
    });
  });

  it("infers zoom when focal min and max differ", () => {
    const rec = lensRecordFromFields({ make: "Nikon", model: "Zoom-Nikkor 80-200mm f/4", focalLengthMin: "80", focalLengthMax: "200", maxAperture: "4" });
    expect(rec.lensTypeKind).toBe("zoom");
    expect(rec.focalLengthMax).toBe(200);
  });
});

describe("lensIssueUrl", () => {
  it("points at the correct repo and encodes a prefilled issue", () => {
    const url = lensIssueUrl({ make: "Nikon", model: "AI Nikkor 50mm f/1.4", mount: "Nikon F", focalLengthMin: "50", maxAperture: "1.4" });
    expect(url).toContain(`https://github.com/${LENS_ISSUE_REPO}/issues/new?`);
    const u = new URL(url);
    expect(u.searchParams.get("title")).toBe("Add lens: Nikon AI Nikkor 50mm f/1.4");
    expect(u.searchParams.get("labels")).toBe("lens-request");
    const body = u.searchParams.get("body");
    expect(body).toContain("data/curated-lenses.jsonl");
    // the body carries a valid jsonl object the maintainer can paste
    const line = body.split("```jsonl\n")[1].split("\n```")[0];
    const rec = JSON.parse(line);
    expect(rec.model).toBe("AI Nikkor 50mm f/1.4");   // the model field as entered
    expect(rec.make).toBe("Nikon");
    expect(rec.source).toBe("user-suggested");
  });
});
