// palette.js: command palette (⌘K). `commands` is a function(query) -> items.
import { el } from "./dom.js";
import { icon } from "./icons.js";

export function openPalette(commands) {
  const overlay = el("div", { class: "modal-overlay palette-overlay" });
  const box = el("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" });
  const input = el("input", { class: "palette-input", type: "text", placeholder: "Type a command, gallery, or @handle…", autocomplete: "off" });
  const list = el("div", { class: "palette-list" });
  let items = [], idx = 0;
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  const run = (c) => { close(); c.run(); };

  function render() {
    items = commands(input.value.trim().toLowerCase());
    if (idx >= items.length) idx = Math.max(0, items.length - 1);
    list.replaceChildren(...items.map((c, i) => el("div", {
      class: "palette-item" + (i === idx ? " active" : ""),
      onmousedown: (e) => { e.preventDefault(); run(c); },
    }, [c.iconName ? icon(c.iconName) : null, el("span", { class: "palette-label" }, c.label), c.hint ? el("span", { class: "palette-hint muted small" }, c.hint) : null])));
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); render(); list.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); render(); list.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[idx]) run(items[idx]); }
  }
  input.addEventListener("input", () => { idx = 0; render(); });
  box.append(input, list);
  overlay.append(box);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  render();
  input.focus();
}
