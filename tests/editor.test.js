import { describe, expect, it } from "vitest";
import * as facade from "../src/ui/editor.js";
import * as implementation from "../src/ui/editor.ts";

describe("editor TypeScript compatibility facade", () => {
  it("re-exports the strict implementation through the established JS path", () => {
    expect(Object.keys(facade).sort()).toEqual(Object.keys(implementation).sort());
    expect(facade.initEditor).toBe(implementation.initEditor);
    expect(facade.openGallery).toBe(implementation.openGallery);
    expect(facade.hasUnsavedChanges).toBe(implementation.hasUnsavedChanges);
    expect(facade.saveAllDirty).toBe(implementation.saveAllDirty);
  });

  it("keeps the initial dirty-state and save-all contracts", async () => {
    document.body.innerHTML = '<section id="editor-view"></section>';

    expect(facade.hasUnsavedChanges()).toBe(false);
    await expect(facade.saveAllDirty()).resolves.toBeUndefined();
  });
});
