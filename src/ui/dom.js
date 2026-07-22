// dom.js: shared UI helpers

import { fuzzyFilter } from "./fuzzy.js";

export const $ = (sel, root = document) => root.querySelector(sel);

// "advanced" mode surfaces power tools (raw-record inspector, collection ids).
// off by default so everyday UI stays human-friendly.
export function isAdvanced() {
  try { return localStorage.getItem("hypo:advanced") === "1"; } catch { return false; }
}
export function setAdvanced(on) {
  try { localStorage.setItem("hypo:advanced", on ? "1" : "0"); } catch { /* ignore */ }
}

// image-analysis provider connection, stored device-local (never uploaded).
// shape: { provider: string, apiKey: string, model: string }.
export function getVisionConfig() {
  try { return JSON.parse(localStorage.getItem("hypo:vision") || "null"); } catch { return null; }
}
export function setVisionConfig(config) {
  try {
    if (config) localStorage.setItem("hypo:vision", JSON.stringify(config));
    else localStorage.removeItem("hypo:vision");
  } catch { /* ignore */ }
}

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// run a DOM mutation inside a View Transition when supported (falls back cleanly).
// a fast second navigation aborts the previous transition. That rejection is
// expected and swallowed so it never reaches the console.
export function withTransition(mutate) {
  if (document.startViewTransition && !prefersReducedMotion()) {
    try {
      const t = document.startViewTransition(mutate);
      t?.finished?.catch(() => {});
      t?.updateCallbackDone?.catch(() => {});
    } catch { mutate(); }
  } else {
    mutate();
  }
}

export function showView(id) {
  withTransition(() => {
    for (const v of ["login-view", "list-view", "library-view", "editor-view", "profile-view"]) {
      $("#" + v)?.classList.toggle("hidden", v !== id);
    }
    window.scrollTo({ top: 0 });
  });
}

// apply a staggered entrance to a set of freshly-created elements.
export function stagger(nodes) {
  nodes.forEach((n, i) => {
    n.classList.add("reveal");
    n.style.setProperty("--i", String(i));
  });
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "value") node.value = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (typeof v === "boolean") {
      // HTML boolean attrs disable/enable via presence, not "false" string values.
      if (k in node) node[k] = v;
      else if (v) node.setAttribute(k, "");
      else node.removeAttribute(k);
    }
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function field(labelText, control) {
  return el("label", { class: "field" }, [el("span", {}, labelText), control]);
}

// ISO-8601 <-> native date/datetime-local input value (local timezone).
export function isoToLocalInput(iso, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  if (!withTime) {
    // date-only fields are timezone-agnostic calendar dates stored as UTC
    // midnight; read the UTC parts so the day never slips to the previous one
    // when the viewer is in a timezone behind UTC.
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${day}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function localInputToIso(val) {
  if (!val) return null;
  const d = new Date(val); // a bare "YYYY-MM-DDThh:mm" is parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// a labelled native date / datetime picker. type: "datetime-local" | "date".
export function dateField(labelText, value = "", { type = "datetime-local" } = {}) {
  const input = el("input", { type, class: "date-input" });
  input.value = isoToLocalInput(value, type === "datetime-local");
  return { wrap: field(labelText, input), input };
}

// transient bottom toast. kind: "ok" | "err" | "info".
// Returns a dismiss fn with `.update(msg)` for long-running waits (bulk analyze…).
export function toast(message, kind = "ok", ms = 2800, action = null) {
  let host = $("#toast-host");
  if (!host) {
    host = el("div", { id: "toast-host", class: "toast-host" });
    document.body.append(host);
  }
  const label = el("span", {}, message);
  const t = el("div", { class: `toast ${kind}`, role: "status" }, [label]);
  const kill = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 240); };
  kill.update = (msg) => { label.textContent = msg; };
  if (action) {
    t.append(el("button", { class: "toast-action", onclick: (e) => { e.stopPropagation(); clearTimeout(timer); action.fn(); kill(); } }, action.label));
    ms = Math.max(ms, 6000);
  }
  host.append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const timer = setTimeout(kill, ms);
  t.addEventListener("click", () => { clearTimeout(timer); kill(); });
  return kill;
}

// Status line that appears after `ms` if still mounted. Put under skeletons so
// short loads stay clean and longer PDS round-trips get a verb.
export function loadPhase(message, ms = 1600) {
  const node = el("p", { class: "muted small load-phase", role: "status" });
  let msg = message, shown = false;
  const t = setTimeout(() => {
    shown = true;
    if (node.isConnected) node.textContent = msg;
  }, ms);
  return {
    node,
    set(next) { msg = next; if (shown && node.isConnected) node.textContent = msg; },
    clear() { clearTimeout(t); },
  };
}

// Indeterminate bar + label for waits with no countable total (maplibre, etc.).
export function busyWait(label) {
  return el("div", { class: "busy-wait", role: "status", "aria-busy": "true", "aria-label": label }, [
    el("p", { class: "muted small", style: "margin:0 0 8px" }, label),
    el("div", { class: "bar-track busy-bar", "aria-hidden": "true" }, [el("div", { class: "bar-fill busy-bar-fill" })]),
  ]);
}

// returns true on success, false if fn threw (and surfaces the error).
// opts.working / opts.done override the default "Saving…" / "Saved ✓" labels
// (e.g. Generate alt text, which does not persist until the user saves).
export async function withButton(button, status, fn, opts = {}) {
  button.disabled = true;
  if (status) { status.className = "status"; status.textContent = opts.working || "Saving…"; }
  try {
    await fn();
    if (status) { status.classList.add("ok"); status.textContent = opts.done || "Saved ✓"; }
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    if (status) { status.classList.add("err"); status.textContent = `Error: ${msg}`; }
    toast(msg, "err", 4200);
    return false;
  } finally {
    button.disabled = false;
  }
}

function focusable(root) {
  return [...root.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )].filter((e) => e.offsetParent !== null);
}

export function openModal(title, bodyNodes, onSave, opts = {}) {
  const prevFocus = document.activeElement;
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", {
    class: "card modal" + (opts.wide ? " scene-modal" : ""),
    role: "dialog", "aria-modal": "true", "aria-label": title,
  });
  const status = el("span", { class: "status" });

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") {
      const f = focusable(modal);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  modal.append(el("h2", {}, title));
  for (const n of bodyNodes) modal.append(n);
  const saveBtn = el("button", {
    onclick: async (e) => {
      const ok = await withButton(e.target, status, onSave);
      if (ok) { toast("Saved", "ok"); close(); }
    },
  }, opts.saveLabel || "Save");
  modal.append(el("div", { class: "row modal-actions" }, [
    saveBtn,
    el("button", { class: "ghost", onclick: close }, opts.cancelLabel || "Cancel"),
    status,
  ]));

  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);

  (modal.querySelector("input,textarea,select") || saveBtn).focus();
  return { close, modal };
}

// styled confirm dialog. resolves true/false, or `{ confirmed, checks }` when
// `checks` (checkbox options) are provided.
export function confirmModal(message, {
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  checks,
} = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "card modal", role: "alertdialog", "aria-modal": "true" });
    const checkInputs = {};

    const readChecks = () => {
      const out = {};
      for (const c of checks || []) out[c.key] = !!checkInputs[c.key]?.checked;
      return out;
    };

    const done = (ok) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      if (checks?.length) resolve({ confirmed: ok, checks: readChecks() });
      else resolve(ok);
    };
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(false); } }

    modal.append(el("p", {}, message));
    if (checks?.length) {
      const list = el("div", { class: "confirm-checks" });
      for (const c of checks) {
        const input = el("input", { type: "checkbox", checked: !!c.checked });
        checkInputs[c.key] = input;
        list.append(el("label", { class: "confirm-check" }, [input, el("span", {}, c.label)]));
      }
      modal.append(list);
    }
    modal.append(el("div", { class: "row modal-actions" }, [
      el("button", { class: danger ? "danger-solid" : "", onclick: () => done(true) }, confirmLabel),
      el("button", { class: "ghost", onclick: () => done(false) }, cancelLabel),
    ]));
    overlay.append(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    modal.querySelector("button").focus();
  });
}

export function inputField(label, key, value = "", placeholder = "") {
  const input = el("input", { type: "text", value: value || "", placeholder, "data-key": key });
  return { wrap: field(label, input), input };
}

// theme-consistent autocomplete for a text input. Native <datalist> renders a
// browser-default popup that clashes with the app, so we build our own dropdown
// using the same look as every other menu. `wrap` is the field container the
// popup is positioned against. `options` is an array or a function returning one.
export function autocomplete(wrap, input, options, onPick) {
  wrap.classList.add("ac-field");
  const menu = el("ul", { class: "ac-menu hidden", role: "listbox" });
  wrap.append(menu);
  let items = [], idx = -1, picking = false;
  const list = () => (typeof options === "function" ? options() : options) || [];
  const hide = () => { menu.classList.add("hidden"); menu.replaceChildren(); idx = -1; items = []; };
  const render = () => {
    menu.replaceChildren(...items.map((it, i) =>
      el("li", { class: "ac-opt" + (i === idx ? " active" : ""), role: "option",
        onmousedown: (e) => e.preventDefault(), onclick: () => pick(it) }, it)));
    menu.classList.toggle("hidden", !items.length);
  };
  const pick = (v) => {
    picking = true;
    input.value = v;
    hide();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    onPick?.(v);
    picking = false;
    input.focus();
  };
  const refresh = () => {
    if (picking) return;
    const q = input.value.trim();
    if (!q) { hide(); return; }
    // include the exact match: "F2" is itself a valid Nikon model, so it must
    // appear (and rank first), not be hidden as "already typed". After a pick,
    // the `picking` guard keeps the menu from reopening.
    items = fuzzyFilter(q, list(), (x) => x, 12);
    idx = -1;
    render();
  };
  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", refresh);
  input.addEventListener("blur", () => setTimeout(hide, 120));
  input.addEventListener("keydown", (e) => {
    if (menu.classList.contains("hidden") || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); idx = (idx + 1) % items.length; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); pick(items[idx]); }
    else if (e.key === "Escape") { hide(); }
  });
  return input;
}
