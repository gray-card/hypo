import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ui from "@hypo/ui";
import * as facade from "../src/ui/dom.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("@hypo/ui public primitives", () => {
  it("keeps the application facade on the package implementations", () => {
    for (const name of [
      "$",
      "el",
      "field",
      "inputField",
      "dateField",
      "toast",
      "withButton",
      "openModal",
      "confirmModal",
      "createModalFocusTrap",
    ]) {
      expect(facade[name]).toBe(ui[name]);
    }
  });

  it("exposes typed field controls without changing their DOM contract", () => {
    const text = ui.inputField("Name", "name", "Leica");
    expect(text.wrap.className).toBe("field");
    expect(text.wrap.textContent).toContain("Name");
    expect(text.input.value).toBe("Leica");
    expect(text.input.dataset.key).toBe("name");

    const date = ui.dateField("Released", "2026-08-11T00:00:00.000Z", { type: "date" });
    expect(date.input.type).toBe("date");
    expect(date.input.value).toBe("2026-08-11");
  });

  it("keeps inherited checklist values visible but out of editable selection", () => {
    const inherited = ui.checkList(
      [
        { value: "camera-1", label: "Camera 1" },
        { value: "lens-1", label: "Lens 1", locked: true, lockedLabel: "in a photo" },
      ],
      { selected: ["camera-1"] },
    );
    document.body.append(inherited.node);

    expect(inherited.inputs.map((input) => [input.checked, input.disabled])).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(inherited.getSelected()).toEqual(["camera-1"]);
    expect(inherited.node.textContent).toContain("in a photo");
  });

  it("keeps native property coercion in the shared element helper", () => {
    expect(ui.el("input", { value: null }).value).toBe("");
    expect(ui.el("span", { text: null }).textContent).toBe("");
  });

  it("offers focus trapping independently of the modal constructors", () => {
    const first = ui.el("button", {}, "First");
    const last = ui.el("button", {}, "Last");
    const modal = ui.el("div", { class: "modal" }, [first, last]);
    const overlay = ui.el("div", { class: "modal-overlay" }, modal);
    document.body.append(overlay);

    const trap = ui.createModalFocusTrap(overlay, modal, () => {});
    trap.activate();
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(first);
    trap.deactivate();
  });

  it("synchronizes spoken values for native range and spinbutton controls", () => {
    const range = ui.el("input", { type: "range", value: "12" });
    const sync = ui.bindValueText(range, (value) => `EV ${Number(value).toFixed(1)}`);
    expect(range.getAttribute("aria-valuetext")).toBe("EV 12.0");

    range.value = "13.5";
    range.dispatchEvent(new Event("input"));
    expect(range.getAttribute("aria-valuetext")).toBe("EV 13.5");

    range.value = "14";
    sync();
    expect(range.getAttribute("aria-valuetext")).toBe("EV 14.0");
  });

  it("exposes an accessible keyboard command palette and restores focus", () => {
    const trigger = ui.el("button", {}, "Open");
    document.body.append(trigger);
    trigger.focus();
    const run = vi.fn();
    ui.openCommandPalette(() => [{ label: "New roll", hint: "R", run }]);

    const input = document.querySelector('[role="combobox"]');
    expect(input.getAttribute("aria-controls")).toBe("command-palette-list");
    expect(document.querySelector('[role="option"]').getAttribute("aria-selected")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
