import { describe, it, expect, beforeEach, vi } from "vitest";
import { el, field, toast, openModal, confirmModal, isAdvanced, setAdvanced, autocomplete } from "../src/ui/dom.js";
import { icon, iconBtn } from "../src/ui/icons.js";

beforeEach(() => { document.body.innerHTML = ""; localStorage.clear(); });

describe("el", () => {
  it("applies class, text, attributes, events, and children", () => {
    const clicks = [];
    const child = el("span", {}, "hi");
    const node = el("div", { class: "box", title: "t", onclick: () => clicks.push(1) }, [child, "x"]);
    expect(node.className).toBe("box");
    expect(node.getAttribute("title")).toBe("t");
    expect(node.textContent).toBe("hix");
    node.click();
    expect(clicks).toEqual([1]);
  });
  it("skips null children", () => {
    const node = el("div", {}, [null, el("b", {}, "a"), undefined]);
    expect(node.childNodes.length).toBe(1);
  });
  it("treats disabled:false as enabled (no disabled attribute)", () => {
    const on = el("button", { disabled: true });
    const off = el("button", { disabled: false });
    expect(on.disabled).toBe(true);
    expect(off.disabled).toBe(false);
    expect(off.hasAttribute("disabled")).toBe(false);
  });
});

describe("field", () => {
  it("wraps a control in a labelled field", () => {
    const input = el("input", {});
    const f = field("Name", input);
    expect(f.querySelector("span").textContent).toBe("Name");
    expect(f.contains(input)).toBe(true);
  });
});

describe("advanced-mode flag", () => {
  it("defaults off and toggles via localStorage", () => {
    expect(isAdvanced()).toBe(false);
    setAdvanced(true);
    expect(isAdvanced()).toBe(true);
    setAdvanced(false);
    expect(isAdvanced()).toBe(false);
  });
});

describe("toast", () => {
  it("shows a message and mounts an action button", () => {
    const fn = vi.fn();
    toast("Saved", "ok", 9999, { label: "Undo", fn });
    const host = document.querySelector(".toast-host");
    expect(host.textContent).toContain("Saved");
    const btn = host.querySelector(".toast-action");
    expect(btn.textContent).toBe("Undo");
    btn.click();
    expect(fn).toHaveBeenCalled();
  });
});

describe("openModal", () => {
  it("renders title + body and runs onSave on save", async () => {
    const onSave = vi.fn(async () => {});
    openModal("Edit", [el("p", {}, "body")], onSave);
    const modal = document.querySelector(".modal");
    expect(modal.querySelector("h2").textContent).toBe("Edit");
    const saveBtn = [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save");
    saveBtn.click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalled();
  });
  it("closes on Escape", () => {
    openModal("X", [], async () => {});
    expect(document.querySelector(".modal-overlay")).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".modal-overlay")).toBeFalsy();
  });
});

describe("confirmModal", () => {
  it("resolves true when confirmed and false when cancelled", async () => {
    const p1 = confirmModal("Delete?");
    [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "Delete").click();
    expect(await p1).toBe(true);

    const p2 = confirmModal("Delete?");
    [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "Cancel").click();
    expect(await p2).toBe(false);
  });

  it("returns checkbox values when checks are provided (default unchecked)", async () => {
    const p = confirmModal("Replace?", {
      confirmLabel: "Replace",
      danger: false,
      checks: [{ key: "rereadExif", label: "Re-read EXIF", checked: false }],
    });
    const box = document.querySelector(".confirm-check input");
    expect(box.checked).toBe(false);
    [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "Replace").click();
    expect(await p).toEqual({ confirmed: true, checks: { rereadExif: false } });
  });
});

describe("autocomplete (custom, replaces native datalist)", () => {
  function setup(options, onPick) {
    const input = el("input", {});
    const wrap = el("div", {}, [input]);
    document.body.append(wrap);
    autocomplete(wrap, input, options, onPick);
    return { input, wrap, menu: () => wrap.querySelector(".ac-menu") };
  }

  it("filters options (startsWith first) and hides on empty query", () => {
    const { input, menu } = setup(["Nikon", "Canon", "Nikkor"]);
    input.value = "nik";
    input.dispatchEvent(new Event("input"));
    const opts = [...menu().querySelectorAll(".ac-opt")].map((o) => o.textContent);
    expect(opts).toEqual(["Nikon", "Nikkor"]);
    expect(menu().classList.contains("hidden")).toBe(false);
    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(menu().classList.contains("hidden")).toBe(true);
  });

  it("matches multiple tokens anywhere ('nikon 50' finds 'Nikon AF Nikkor 50mm')", () => {
    const { input, menu } = setup(["Nikon AF Nikkor 50mm f/1.8D", "Canon EF 50mm", "Nikon 24-70mm f/2.8"]);
    input.value = "nikon 50";
    input.dispatchEvent(new Event("input"));
    const opts = [...menu().querySelectorAll(".ac-opt")].map((o) => o.textContent);
    expect(opts).toContain("Nikon AF Nikkor 50mm f/1.8D");
    expect(opts).not.toContain("Canon EF 50mm");
    expect(opts).not.toContain("Nikon 24-70mm f/2.8");
  });

  it("picks on click: sets value, fires input, calls onPick, closes", () => {
    const picks = [];
    const { input, menu } = setup(["Nikon", "Canon"], (v) => picks.push(v));
    input.value = "n";
    input.dispatchEvent(new Event("input"));
    [...menu().querySelectorAll(".ac-opt")].find((o) => o.textContent === "Nikon").click();
    expect(input.value).toBe("Nikon");
    expect(picks).toEqual(["Nikon"]);
    expect(menu().classList.contains("hidden")).toBe(true);
  });

  it("supports keyboard navigation and Enter to select", () => {
    const { input, menu } = setup(["Nikon", "Nikkor"]);
    input.value = "nik";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(input.value).toBe("Nikon");
    expect(menu().classList.contains("hidden")).toBe(true);
  });

  it("shows an exact match (e.g. typing 'F2' still lists 'F2', ranked first)", () => {
    const { input, menu } = setup(["F", "F2", "F3", "FM2", "FE2"]);
    input.value = "F2";
    input.dispatchEvent(new Event("input"));
    const opts = [...menu().querySelectorAll(".ac-opt")].map((o) => o.textContent);
    expect(opts).toContain("F2");
    expect(opts[0]).toBe("F2");
  });

  it("uses no native datalist", () => {
    const { wrap, input } = setup(["A", "B"]);
    expect(input.hasAttribute("list")).toBe(false);
    expect(wrap.querySelector("datalist")).toBeFalsy();
  });
});

describe("icons", () => {
  it("returns an svg with a viewBox and requested size", () => {
    const svg = icon("camera", 22);
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("width")).toBe("22");
    expect(svg.innerHTML.length).toBeGreaterThan(0);
  });
  it("is empty for an unknown icon name", () => {
    expect(icon("nope").innerHTML).toBe("");
  });
  it("iconBtn builds a button with icon + label", () => {
    const b = iconBtn("plus", "Add", {});
    expect(b.querySelector("svg")).toBeTruthy();
    expect(b.textContent).toContain("Add");
  });
});
