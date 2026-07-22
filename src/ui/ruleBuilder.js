// ruleBuilder.js: build an app.graycard.rule.batch record with the typed DSL
// (comparison / boolean group / action), preview it, apply it, or save it.

import { el, field, openModal, withButton, toast, confirmModal, autocomplete } from "./dom.js";
import { previewBatch, applyBatch } from "../batch.js";
import { saveRecord, NS } from "../graycard.js";

const FIELD_PATHS = [
  "exif.make", "exif.model", "exif.lensMake", "exif.lensModel", "exif.fNumber",
  "exif.iSO", "exif.exposureTime", "exif.focalLengthIn35mmFormat", "exif.dateTimeOriginal",
  "alt", "gallery.title", "gallery.description", "capture.camera", "capture.lens", "capture.filmRoll", "index",
];
const CMP_OPS = ["empty", "notEmpty", "exists", "notExists", "eq", "neq", "contains", "startsWith", "endsWith", "matches", "gt", "gte", "lt", "lte", "in"];
const ACTION_OPS = ["setAlt", "setGalleryDescription", "setExif", "projectCaptureToExif", "associateCamera", "associateLens"];
const MODES = ["fill", "overwrite", "ifEmpty"];

export function openRuleBuilder(ctx, onApplied, initial = null, onSaved = null) {
  const condWrap = el("div", {});
  const actWrap = el("div", {});
  const combinator = el("select", {}, [el("option", { value: "and" }, "Match ALL"), el("option", { value: "or" }, "Match ANY")]);
  const nameInput = el("input", { type: "text", placeholder: "rule name (to save)", value: initial?.name || "" });
  const preview = el("pre", { class: "batch-preview muted" }, "Preview matches.");
  const status = el("span", { class: "status" });

  const condRows = [], actRows = [];
  function addCond(init = {}) {
    const f = el("input", { type: "text", placeholder: "field", value: init.field || "" });
    const fWrap = el("div", { class: "rb-field" }, [f]);
    autocomplete(fWrap, f, FIELD_PATHS);
    const op = el("select", {}, CMP_OPS.map((o) => el("option", { value: o }, o))); op.value = init.op || "eq";
    const v = el("input", { type: "text", placeholder: "value", value: init.value ?? "" });
    const rec = { f, op, v };
    const row = el("div", { class: "row wrap rb-row" }, [fWrap, op, v, el("button", { class: "ghost small-btn danger", onclick: () => { row.remove(); condRows.splice(condRows.indexOf(rec), 1); } }, "×")]);
    condRows.push(rec); condWrap.append(row);
  }
  function addAct(init = {}) {
    const op = el("select", {}, ACTION_OPS.map((o) => el("option", { value: o }, o))); op.value = init.op || "setAlt";
    const f = el("input", { type: "text", placeholder: "field (setExif)", value: init.field || "" });
    const v = el("input", { type: "text", placeholder: "value / template", value: init.value ?? "" });
    const ref = el("input", { type: "text", placeholder: "ref at-uri (associate)", value: init.ref || "" });
    const mode = el("select", {}, MODES.map((m) => el("option", { value: m }, m))); mode.value = init.mode || "fill";
    const rec = { op, f, v, ref, mode };
    const row = el("div", { class: "row wrap rb-row" }, [op, f, v, ref, mode, el("button", { class: "ghost small-btn danger", onclick: () => { row.remove(); actRows.splice(actRows.indexOf(rec), 1); } }, "×")]);
    actRows.push(rec); actWrap.append(row);
  }

  // seed from an existing rule or a starter row
  if (initial) {
    const w = initial.when;
    const cmps = w?.operator ? w.operands : (w ? [w] : []);
    if (w?.operator) combinator.value = w.operator === "or" ? "or" : "and";
    cmps.forEach((c) => addCond(c));
    (initial.actions || []).forEach((a) => addAct(a));
  }
  if (!condRows.length) addCond();
  if (!actRows.length) addAct();

  function buildRule() {
    const cmps = condRows.filter((r) => r.f.value.trim()).map((r) => {
      const c = { field: r.f.value.trim(), op: r.op.value };
      if (!["empty", "notEmpty", "exists", "notExists"].includes(c.op) && r.v.value.trim()) c.value = r.v.value.trim();
      return c;
    });
    const when = cmps.length === 1 ? cmps[0] : { operator: combinator.value, operands: cmps };
    const actions = actRows.filter((r) => r.op.value).map((r) => {
      const a = { op: r.op.value };
      if (r.f.value.trim()) a.field = r.f.value.trim();
      if (r.v.value.trim()) a.value = r.v.value.trim();
      if (r.ref.value.trim()) a.ref = r.ref.value.trim();
      if (r.mode.value) a.mode = r.mode.value;
      return a;
    });
    return { name: nameInput.value.trim() || "Untitled rule", when, actions };
  }

  const body = [
    el("h3", { class: "modal-sub" }, "Conditions"),
    field("Combine", combinator),
    condWrap,
    el("button", { class: "ghost small-btn", onclick: () => addCond() }, "+ Condition"),
    el("h3", { class: "modal-sub" }, "Actions"),
    actWrap,
    el("button", { class: "ghost small-btn", onclick: () => addAct() }, "+ Action"),
    field("Save as", nameInput),
    el("div", { class: "row" }, [
      el("button", { class: "ghost", onclick: () => {
        const rule = buildRule();
        const r = previewBatch(ctx.detail, ctx.store, rule);
        preview.textContent = r.matched.length ? r.matched.map((m) => `#${m.index}: ${m.changes.map((c) => c.kind).join(", ")}`).join("\n") : "No matches.";
      } }, "Preview"),
      el("button", { onclick: async (e) => { if (!(await confirmModal("Apply this rule to all matching photos?", { confirmLabel: "Apply", danger: false }))) return; await withButton(e.target, status, async () => { await applyBatch(ctx.agent, ctx.did, ctx.detail, ctx.store, buildRule(), (done, total) => { status.textContent = `Applying ${done} / ${total}…`; }); onApplied?.(); }); } }, "Apply"),
      el("button", { class: "ghost", onclick: async (e) => { await withButton(e.target, status, async () => {
        const rule = buildRule();
        const uri = await saveRecord(ctx.agent, ctx.did, NS.rule.batch, { name: rule.name, when: rule.when, actions: rule.actions, createdAt: new Date().toISOString() }, null);
        onSaved?.({ id: uri, name: rule.name, when: rule.when, actions: rule.actions });
        toast(`Saved rule "${rule.name}"`, "ok");
      }); } }, "Save rule"),
      status,
    ]),
    preview,
  ];
  openModal("Batch rule builder", body, null, { saveLabel: "Done", cancelLabel: "Close" });
}
