import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// vitest runs with cwd at the repo root
const css = readFileSync("src/style.css", "utf8");

// A flex item may shrink to its min-content, which for wrapping text is its
// longest WORD. A button in a squeezed row therefore folds its label into a
// column ("How / it / works"). These guard the fix.
describe("button labels never fold into a column of words", () => {
  it("keeps button and link-button labels on one line", () => {
    expect(css).toMatch(/button,\s*\.linkbtn\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("never re-enables wrapping on plain buttons later in the cascade", () => {
    // a later `button { white-space: normal }` would silently undo the guard
    expect(css).not.toMatch(/(^|\n)\s*button\s*\{[^}]*white-space:\s*(normal|pre-wrap|pre-line)/);
  });

  it("lets tight rows wrap, so unbreakable labels cannot overflow instead", () => {
    // flex-wrap only engages when a row genuinely does not fit, so this costs
    // nothing on roomy layouts and prevents overflow on narrow ones.
    expect(css).toMatch(/\.view-head\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.search-hint-row\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.row\.between\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
