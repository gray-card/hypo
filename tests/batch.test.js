import { describe, it, expect } from "vitest";
import { readField, isEmpty, evaluateCondition, renderTemplate } from "../src/batch.js";

const ctx = {
  gallery: { value: { title: "Sunset", description: "" } },
  photo: { value: { alt: "" } },
  exif: { value: { make: "Leica", model: "M6", iSO: 400_000_000 } },
  index: 3,
};

describe("readField", () => {
  it("reads nested gallery, exif, and index fields", () => {
    expect(readField(ctx, "gallery.title")).toBe("Sunset");
    expect(readField(ctx, "exif.make")).toBe("Leica");
    expect(readField(ctx, "exif.iSO")).toBe("400"); // scaled back by exifValueToForm
    expect(readField(ctx, "index")).toBe(3);
    expect(readField(ctx, "unknown.path")).toBe("");
  });
});

describe("isEmpty", () => {
  it("treats null, undefined, and whitespace as empty", () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty("   ")).toBe(true);
    expect(isEmpty("x")).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("evaluates comparison operators", () => {
    expect(evaluateCondition(ctx, { field: "exif.make", op: "eq", value: "Leica" })).toBe(true);
    expect(evaluateCondition(ctx, { field: "exif.make", op: "contains", value: "eic" })).toBe(true);
    expect(evaluateCondition(ctx, { field: "gallery.description", op: "empty" })).toBe(true);
    expect(evaluateCondition(ctx, { field: "exif.iSO", op: "gte", value: "200" })).toBe(true);
    expect(evaluateCondition(ctx, { field: "exif.make", op: "matches", pattern: "^lei", flags: "i" })).toBe(true);
  });
  it("evaluates boolean groups (and / or / not)", () => {
    const and = { operator: "and", operands: [
      { field: "exif.make", op: "eq", value: "Leica" },
      { field: "exif.model", op: "eq", value: "M6" },
    ] };
    expect(evaluateCondition(ctx, and)).toBe(true);
    const not = { operator: "not", operands: [{ field: "exif.make", op: "eq", value: "Nikon" }] };
    expect(evaluateCondition(ctx, not)).toBe(true);
    const or = { operator: "or", operands: [
      { field: "exif.make", op: "eq", value: "Nikon" },
      { field: "exif.model", op: "eq", value: "M6" },
    ] };
    expect(evaluateCondition(ctx, or)).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("interpolates {{field}} placeholders", () => {
    expect(renderTemplate("{{gallery.title}} #{{index}}", ctx)).toBe("Sunset #3");
  });
});
