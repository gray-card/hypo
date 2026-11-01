import { describe, expect, it, vi } from "vitest";
import { userFacingError, withButton } from "@hypo/ui";

describe("actionable write errors", () => {
  it("explains storage-connection failures without showing IndexedDB jargon", () => {
    const error = new DOMException(
      "Failed to execute 'transaction': The database connection is closing",
      "InvalidStateError",
    );
    expect(userFacingError(error)).toMatch(/Reload Hypo and check whether the record already appears/);
    expect(userFacingError(error)).not.toMatch(/transaction|InvalidStateError/);
  });

  it("explains unsaved gallery links and conflicts", () => {
    expect(userFacingError(new Error("gallery must be an AT URI"))).toMatch(/retry the upload/);
    expect(userFacingError(Object.assign(new Error("invalid swap"), { name: "SwapConflict" }))).toMatch(
      /Needs attention/,
    );
  });

  it("shows the translated message in the save status", async () => {
    const button = document.createElement("button");
    const status = document.createElement("p");
    const error = new DOMException("The database connection is closing", "InvalidStateError");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await withButton(button, status, () => Promise.reject(error))).toBe(false);
      expect(status.textContent).toMatch(/Reload Hypo and check whether the record already appears/);
      expect(status.textContent).not.toContain("database connection is closing");
      expect(logged).toHaveBeenCalledWith("Action failed:", error);
    } finally {
      logged.mockRestore();
    }
  });
});
