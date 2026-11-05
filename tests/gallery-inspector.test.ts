import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhotoInspector } from "../apps/web/src/views/galleries/photo-inspector.ts";
import { scopeGalleryRule } from "../apps/web/src/views/galleries/batch-scope.ts";
import { evaluateCondition } from "../src/batch.js";

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const workspace = document.createElement("div");
  const photos = document.createElement("div");
  workspace.append(photos);
  document.body.append(workspace);
  const entries = [1, 2, 3].map((number) => {
    const card = document.createElement("div");
    card.dataset.frame = String(number);
    const control = document.createElement("div");
    control.dataset.gridPhotoLabel = `Photo ${number}`;
    card.append(control);
    photos.append(card);
    const fields = document.createElement("div");
    fields.innerHTML =
      '<textarea></textarea><details data-photo-section="exif"><summary>EXIF</summary><input /></details>';
    return { card, control, fields };
  });
  const inspector = createPhotoInspector(photos, entries);
  workspace.append(inspector.node);
  return { ...inspector, photos, entries };
}

describe("photo inspector navigation", () => {
  it("closes without restoring grid focus or scroll when revealing gallery settings", () => {
    const { entries, node, close } = fixture();
    entries[0].control.click();
    const frame = vi.spyOn(window, "requestAnimationFrame");
    close(false);
    expect(node.hidden).toBe(true);
    expect(document.activeElement).not.toBe(entries[0].control);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });
  it("restores the contact-sheet scroll position on a compact screen", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    vi.stubGlobal("scrollY", 240);
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { entries, close } = fixture();
    entries[0].control.click();
    vi.stubGlobal("scrollY", 0);
    entries[1].control.click();
    close();
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 240, behavior: "instant" });
  });
  it("opens with keyboard input, retains the form, and restores focus on close", () => {
    const { entries, node, close } = fixture();
    entries[0].control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(node.hidden).toBe(false);
    expect(entries[0].control.getAttribute("aria-expanded")).toBe("true");
    const draft = entries[0].fields.querySelector("textarea")!;
    draft.value = "A draft";
    close();
    expect(document.activeElement).toBe(entries[0].control);
    entries[0].control.click();
    expect(entries[0].fields.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("A draft");
  });

  it("navigates in displayed order and remembers expanded sections", () => {
    const { entries, photos, move } = fixture();
    photos.prepend(entries[2].card);
    entries[2].control.click();
    entries[2].fields.querySelector("details")!.open = true;
    move(1);
    expect(entries[0].fields.hidden).toBe(false);
    expect(entries[0].fields.querySelector("details")!.open).toBe(true);
    move(-1);
    move(-1);
    expect(entries[2].fields.hidden).toBe(false);
  });

  it("reveals the field and containing disclosure without replacing its node", () => {
    const { entries } = fixture();
    entries[0].control.click();
    const input = entries[1].fields.querySelector("input")!;
    input.dispatchEvent(new Event("reveal-photo-field", { bubbles: true }));
    expect(entries[1].fields.hidden).toBe(false);
    expect(entries[1].fields.querySelector("details")!.open).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("handles an empty gallery without opening an empty inspector", () => {
    const photos = document.createElement("div");
    const { node, move } = createPhotoInspector(photos, []);
    move(1);
    expect(node.hidden).toBe(true);
  });
});

describe("gallery batch scope", () => {
  it("preserves original indexes and intersects the existing rule", () => {
    const rule = scopeGalleryRule(
      { when: { field: "index", op: "neq", value: 1 }, actions: [] },
      ["a", "b", "c"],
      new Set(["a", "c"]),
    );
    expect([1, 2, 3].map((index) => evaluateCondition({ index }, rule.when))).toEqual([false, false, true]);
  });

  it("matches nothing when the selection is empty or stale", () => {
    for (const selected of [new Set<string>(), new Set(["missing"])]) {
      const rule = scopeGalleryRule({ actions: [] }, ["a"], selected);
      expect(evaluateCondition({ index: 1 }, rule.when)).toBe(false);
    }
  });
});
