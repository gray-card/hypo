import { describe, expect, it } from "vitest";
import {
  canonicalProvenanceValue,
  digestProvenanceValue,
  provenancePointer,
  resolveEffectiveProvenance,
} from "@hypo/domain";

describe("value and relationship provenance", () => {
  it("normalizes legacy field names to JSON Pointer targets", () => {
    expect(provenancePointer("camera")).toBe("/camera");
    expect(provenancePointer("/filmRolls")).toBe("/filmRolls");
  });

  it("resolves a relationship member by stable value rather than position", () => {
    const roll = "at://did:plc:test/app.graycard.instance.filmRoll/roll-a";
    const result = resolveEffectiveProvenance(
      {
        provenance: { source: "manual" },
        fieldProvenance: [
          {
            field: "/filmRolls",
            relationship: roll,
            provenance: { source: "inferred", confidence: "likely" },
          },
        ],
      },
      "/filmRolls",
      { relationship: roll },
    );
    expect(result).toMatchObject({ state: "direct", provenance: { source: "inferred" } });
  });

  it("marks an assertion stale when its value binding no longer matches", () => {
    const result = resolveEffectiveProvenance(
      {
        provenance: { source: "manual" },
        fieldProvenance: [{ field: "/software", valueDigest: "sha256:old", provenance: { source: "imported-exif" } }],
      },
      "/software",
      { valueDigest: "sha256:new" },
    );
    expect(result.state).toBe("stale");
  });

  it("uses record provenance only when no narrow assertion exists", () => {
    expect(resolveEffectiveProvenance({ provenance: { source: "observed" } }, "/temperature")).toMatchObject({
      state: "fallback",
      provenance: { source: "observed" },
    });
  });

  it("canonicalizes object keys before producing a portable digest", async () => {
    expect(canonicalProvenanceValue({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    await expect(digestProvenanceValue({ b: 2, a: 1 })).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(digestProvenanceValue({ a: 1, b: 2 })).resolves.toBe(await digestProvenanceValue({ b: 2, a: 1 }));
  });
});
