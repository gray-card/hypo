import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUploadModal } from "../src/ui/uploadUI.js";

vi.mock("../src/ui/library.js", () => ({
  getStore: vi.fn(() => ({})),
  refreshStore: vi.fn(async () => ({})),
  instanceSelect: vi.fn(() => document.createElement("select")),
}));

describe("upload accessibility", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("names the photo picker and exposes selection and upload progress status", async () => {
    await openUploadModal({}, "did:plc:test");

    const dialog = document.querySelector('[role="dialog"][aria-label="New gallery"]');
    const picker = dialog.querySelector('input[type="file"]');
    const selection = dialog.querySelector("#upload-file-selection");
    const progress = dialog.querySelector('[role="progressbar"]');

    expect(picker.getAttribute("aria-label")).toBe("Photos to upload");
    expect(picker.getAttribute("aria-describedby")).toBe(selection.id);
    expect(selection.getAttribute("role")).toBe("status");
    expect(selection.textContent).toBe("No photos selected.");
    expect(progress.getAttribute("aria-label")).toBe("Photo upload progress");
    expect(progress.getAttribute("aria-valuenow")).toBe("0");

    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.jpg")],
    });
    picker.dispatchEvent(new Event("change"));
    expect(selection.textContent).toBe("2 photos selected");

    const results = await axe.run(dialog, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
