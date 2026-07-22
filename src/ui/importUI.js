// importUI.js: the bundle modal: export all graycard records, or load a
// bundle, review the diff (with optional prune), and write it to the PDS.

import { collectionLabel } from "./labels.js";
import { el, field, toast, confirmModal } from "./dom.js";
import { parseBundle, diffBundle, pruneCandidates, writeBundle, exportBundle } from "../import.js";

const STATUS_LABEL = { create: "new", update: "changed", unchanged: "unchanged", delete: "delete" };

function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openBundleModal(agent, did) {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal scene-modal", role: "dialog", "aria-modal": "true", "aria-label": "Bundle" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  const status = el("span", { class: "status" });
  const review = el("div", {});
  let basePlan = null, pruneList = [], sourceDid = null;

  const exportBtn = el("button", {
    class: "ghost",
    onclick: async (e) => {
      e.target.disabled = true;
      const prev = e.target.textContent;
      e.target.textContent = "Exporting…";
      try { const b = await exportBundle(agent, did); download(`graycard-bundle-${Date.now()}.json`, b); toast(`Exported ${b.records.length} records`, "ok"); }
      catch (err) { toast(err.message || String(err), "err"); }
      finally { e.target.disabled = false; e.target.textContent = prev; }
    },
  }, "Export graycard bundle");

  const pruneChk = el("input", { type: "checkbox" });
  pruneChk.addEventListener("change", () => { if (basePlan) renderPlan(); });
  const pruneToggle = el("label", { class: "inline-check prune-toggle" }, [pruneChk, "Prune: delete records not in the bundle"]);

  const fileInput = el("input", { type: "file", accept: "application/json,.json" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    review.replaceChildren(el("p", { class: "muted small" }, "Diffing against your repo…"));
    try {
      const text = await file.text();
      let raw = {}; try { raw = JSON.parse(text); } catch { /* parseBundle will report */ }
      sourceDid = raw.did || null;
      const records = parseBundle(text);
      basePlan = await diffBundle(agent, did, records);
      pruneList = await pruneCandidates(agent, did, records);
      renderPlan();
    } catch (err) {
      basePlan = null;
      review.replaceChildren(el("p", { class: "error" }, `Error: ${err.message || err}`));
    }
  });

  function renderPlan() {
    const plan = [...basePlan, ...(pruneChk.checked ? pruneList : [])];
    review.replaceChildren();
    const c = plan.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
    review.append(el("div", { class: "mono small muted" },
      `${plan.length} records · ${c.create || 0} new · ${c.update || 0} changed · ${c.unchanged || 0} unchanged` + (pruneList.length ? ` · ${c.delete || 0} to delete` : "")));
    if (pruneList.length) review.append(pruneToggle);

    const list = el("div", { class: "bundle-list" });
    for (const p of plan) {
      const row = el("div", { class: "bundle-row" }, [
        el("div", { class: "row between" }, [
          el("span", { class: "small" }, `${collectionLabel(p.collection)}${p.rkey ? ` · ${p.rkey}` : " · (new)"}`),
          el("span", { class: `bundle-badge ${p.status}` }, STATUS_LABEL[p.status] || p.status),
        ]),
      ]);
      if (p.status !== "unchanged") {
        row.append(el("details", {}, [el("summary", { class: "small muted" }, "value"), el("pre", { class: "inspect-json" }, JSON.stringify(p.value, null, 2))]));
      }
      list.append(row);
    }
    review.append(list);

    const write = plan.filter((p) => p.status !== "unchanged");
    review.append(el("div", { class: "row modal-actions" }, [
      el("button", {
        disabled: write.length === 0,
        onclick: async (e) => {
          // only overwrites (update) and deletes touch existing data — ask before those.
          // brand-new records are added without a prompt.
          const overwrites = plan.filter((p) => p.status === "update");
          const deletes = plan.filter((p) => p.status === "delete");
          if (overwrites.length || deletes.length) {
            const parts = [];
            if (overwrites.length) parts.push(`overwrite ${overwrites.length} existing record${overwrites.length !== 1 ? "s" : ""}`);
            if (deletes.length) parts.push(`delete ${deletes.length} record${deletes.length !== 1 ? "s" : ""}`);
            const ok = await confirmModal(
              `This import will ${parts.join(" and ")} in your repo. New records are added as-is. Continue?`,
              { confirmLabel: "Overwrite & apply", danger: true },
            );
            if (!ok?.confirmed) return;
          }
          e.target.disabled = true;
          status.className = "status"; status.textContent = "Writing…";
          const results = await writeBundle(agent, did, plan, (it, done, total) => {
            const verb = it.status === "delete" ? "Deleting" : "Writing";
            status.textContent = `${verb} ${done} / ${total}…`;
          }, sourceDid);
          const n = (k) => results.filter((r) => r.result === k).length;
          const bad = n("conflict") + n("error");
          status.className = `status ${bad ? "err" : "ok"}`;
          status.textContent = `Wrote ${n("written")}, deleted ${n("deleted")}` + (n("conflict") ? `, ${n("conflict")} conflicts` : "") + (n("error") ? `, ${n("error")} errors` : "");
          toast(status.textContent, bad ? "err" : "ok");
        },
      }, `Apply ${write.length} change${write.length !== 1 ? "s" : ""}`),
      status,
    ]));
  }

  modal.append(
    el("h2", {}, "Bundle · dump ↔ write"),
    el("p", { class: "muted small" }, "Export every app.graycard.* record in your repo, or load a Gray Card bundle to review a diff and write it to your PDS. Re-importing an export is a no-op — unchanged records are skipped and you're asked before any overwrite."),
    el("h3", { class: "modal-sub" }, "Export"),
    exportBtn,
    el("h3", { class: "modal-sub" }, "Import"),
    field("Bundle file (.json)", fileInput),
    review,
    el("div", { class: "row" }, [el("button", { class: "ghost", onclick: close }, "Close")]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}
