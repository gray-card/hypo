// inspect.js: raw-record viewer: AT-URI, collection/rkey/cid, pretty JSON,
// copy buttons, and a link to an external ATProto record browser.

import { el } from "./dom.js";
import { parseAtUri } from "../grain.js";

function copy(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = t; }, 1200); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
}

export function openInspector(record) {
  const { uri, cid, value } = record;
  const parsed = (() => { try { return parseAtUri(uri); } catch { return null; } })();
  const json = JSON.stringify(value, null, 2);

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal scene-modal", role: "dialog", "aria-modal": "true", "aria-label": "Inspect record" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  modal.append(
    el("h2", {}, "Inspect record"),
    uri ? el("div", { class: "field" }, [
      el("span", {}, "AT-URI"),
      el("div", { class: "row" }, [
        el("code", { class: "inspect-uri mono" }, uri),
        el("button", { class: "ghost small-btn", onclick: (e) => copy(uri, e.target) }, "Copy"),
      ]),
    ]) : null,
    parsed ? el("div", { class: "mono small muted" }, `${parsed.collection} · ${parsed.rkey}${cid ? ` · ${cid}` : ""}`) : null,
    el("pre", { class: "inspect-json" }, json),
    el("div", { class: "row modal-actions" }, [
      el("button", { onclick: (e) => copy(json, e.target) }, "Copy JSON"),
      uri ? el("a", { class: "ghost linkbtn", href: `https://pdsls.dev/${uri}`, target: "_blank", rel: "noopener" }, "Open in PDSls ↗") : null,
      el("button", { class: "ghost", onclick: close }, "Close"),
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}
