// ruleBuilder.js: build an app.graycard.rule.batch record with the typed DSL
// (comparison / boolean group / action), preview it, apply it, or save it.

import { el, field, openModal, withButton, toast, confirmModal, autocomplete } from "./dom.js";
import { previewBatch, applyBatch } from "../batch.js";
import { saveRecord, NS } from "../graycard.js";

const FIELD_PATHS = [
  "exif.make",
  "exif.model",
  "exif.lensMake",
  "exif.lensModel",
  "exif.fNumber",
  "exif.iSO",
  "exif.exposureTime",
  "exif.focalLengthIn35mmFormat",
  "exif.dateTimeOriginal",
  "alt",
  "gallery.title",
  "gallery.description",
  "capture.camera",
  "capture.lens",
  "capture.filmRoll",
  "index",
];
const CMP_OPS = [
  "empty",
  "notEmpty",
  "exists",
  "notExists",
  "eq",
  "neq",
  "contains",
  "startsWith",
  "endsWith",
  "matches",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
];
const ACTION_OPS = [
  "setAlt",
  "setGalleryDescription",
  "setExif",
  "projectCaptureToExif",
  "associateCamera",
  "associateLens",
];
const MODES = ["fill", "overwrite", "ifEmpty"];
const OP_LABELS = {
  empty: "is empty",
  notEmpty: "is not empty",
  exists: "exists",
  notExists: "does not exist",
  eq: "equals",
  neq: "does not equal",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  matches: "matches pattern",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  in: "is one of",
  setAlt: "Set alt text",
  setGalleryDescription: "Set gallery description",
  setExif: "Set an EXIF field",
  projectCaptureToExif: "Copy capture metadata to EXIF",
  associateCamera: "Associate a camera",
  associateLens: "Associate a lens",
  fill: "Fill blank values",
  overwrite: "Replace existing values",
  ifEmpty: "Only when empty",
};

export function openRuleBuilder(ctx, onApplied, initial = null, onSaved = null, options = {}) {
  const condWrap = el("div", {});
  const actWrap = el("div", {});
  const combinator = el("select", {}, [
    el("option", { value: "and" }, "Match ALL"),
    el("option", { value: "or" }, "Match ANY"),
  ]);
  const nameInput = el("input", { type: "text", placeholder: "rule name (to save)", value: initial?.name || "" });
  const preview = el("pre", { class: "batch-preview muted" }, "Preview matches.");
  const status = el("span", { class: "status" });

  const condRows = [],
    actRows = [];
  function addCond(init = {}) {
    const f = el("input", { type: "text", placeholder: "field", value: init.field || "" });
    const fWrap = el("div", { class: "rb-field" }, [f]);
    autocomplete(fWrap, f, FIELD_PATHS);
    const op = el(
      "select",
      {},
      CMP_OPS.map((o) => el("option", { value: o }, OP_LABELS[o] || o)),
    );
    op.value = init.op || "eq";
    const v = el("input", { type: "text", placeholder: "value", value: init.value ?? "" });
    const valueField = field("Value", v);
    const rec = { f, op, v };
    const row = el("div", { class: "rule-entry rule-condition" }, [
      field("Field", fWrap),
      field("Match", op),
      valueField,
      el(
        "button",
        {
          class: "ghost small-btn danger",
          onclick: () => {
            row.remove();
            condRows.splice(condRows.indexOf(rec), 1);
          },
        },
        "×",
      ),
    ]);
    const refresh = () =>
      valueField.classList.toggle("hidden", ["empty", "notEmpty", "exists", "notExists"].includes(op.value));
    op.addEventListener("change", refresh);
    refresh();
    condRows.push(rec);
    condWrap.append(row);
  }
  function addAct(init = {}) {
    const op = el(
      "select",
      {},
      ACTION_OPS.map((o) => el("option", { value: o }, OP_LABELS[o] || o)),
    );
    op.value = init.op || "setAlt";
    const f = el("input", { type: "text", placeholder: "EXIF field", value: init.field || "" });
    const v = el("input", { type: "text", placeholder: "Text or template", value: init.value ?? "" });
    const ref = el("select");
    const mode = el(
      "select",
      {},
      MODES.map((m) => el("option", { value: m }, OP_LABELS[m] || m)),
    );
    mode.value = init.mode || "fill";
    const rec = { op, f, v, ref, mode };
    const fieldField = field("EXIF field", f);
    const valueField = field("Value or template", v);
    const refField = field("Camera or lens", ref);
    const modeField = field("Write mode", mode);
    const row = el("div", { class: "rule-entry rule-action" }, [
      field("Change", op),
      modeField,
      fieldField,
      valueField,
      refField,
      el(
        "button",
        {
          class: "ghost small-btn danger",
          onclick: () => {
            row.remove();
            actRows.splice(actRows.indexOf(rec), 1);
          },
        },
        "×",
      ),
    ]);
    const refreshResources = (kind) => {
      const previous = init.ref || ref.value;
      const records = ctx.store?.instance?.[kind] || [];
      ref.replaceChildren(
        el("option", { value: "" }, `Choose ${kind}`),
        ...records.map((record) =>
          el(
            "option",
            { value: record.uri },
            record.value.nickname || record.value.label || record.value.serialNumber || record.rkey || record.uri,
          ),
        ),
      );
      if (previous && ![...ref.options].some((option) => option.value === previous))
        ref.append(el("option", { value: previous }, previous));
      ref.value = previous;
    };
    const refresh = () => {
      const action = op.value;
      const associates = action === "associateCamera" || action === "associateLens";
      fieldField.classList.toggle("hidden", action !== "setExif");
      valueField.classList.toggle("hidden", !["setAlt", "setGalleryDescription", "setExif"].includes(action));
      refField.classList.toggle("hidden", !associates);
      if (associates) refreshResources(action === "associateCamera" ? "camera" : "lens");
    };
    op.addEventListener("change", refresh);
    refresh();
    actRows.push(rec);
    actWrap.append(row);
  }

  // seed from an existing rule or a starter row
  if (initial) {
    const w = initial.when;
    const cmps = w?.operator ? w.operands : w ? [w] : [];
    if (w?.operator) combinator.value = w.operator === "or" ? "or" : "and";
    cmps.forEach((c) => addCond(c));
    (initial.actions || []).forEach((a) => addAct(a));
  }
  if (!condRows.length) addCond();
  if (!actRows.length) addAct();

  function buildRule() {
    const cmps = condRows
      .filter((r) => r.f.value.trim())
      .map((r) => {
        const c = { field: r.f.value.trim(), op: r.op.value };
        if (!["empty", "notEmpty", "exists", "notExists"].includes(c.op) && r.v.value.trim())
          c.value = r.v.value.trim();
        return c;
      });
    const when = cmps.length === 1 ? cmps[0] : { operator: combinator.value, operands: cmps };
    const actions = actRows
      .filter((r) => r.op.value)
      .map((r) => {
        const a = { op: r.op.value };
        if (r.f.value.trim()) a.field = r.f.value.trim();
        if (r.v.value.trim()) a.value = r.v.value.trim();
        if (r.ref.value.trim()) a.ref = r.ref.value.trim();
        if (r.mode.value) a.mode = r.mode.value;
        return a;
      });
    return { name: nameInput.value.trim() || "Untitled rule", when, actions };
  }

  const galleryActions = Boolean(ctx.detail)
    ? [
        el(
          "button",
          {
            class: "ghost",
            onclick: () => {
              const rule = buildRule();
              const r = previewBatch(ctx.detail, ctx.store, rule);
              preview.textContent = r.matched.length
                ? r.matched.map((m) => `#${m.index}: ${m.changes.map((c) => c.kind).join(", ")}`).join("\n")
                : "No matches.";
            },
          },
          "Preview",
        ),
        el(
          "button",
          {
            onclick: async (e) => {
              if (
                !(await confirmModal("Apply this rule to all matching photos?", {
                  confirmLabel: "Apply",
                  danger: false,
                }))
              )
                return;
              await withButton(e.target, status, async () => {
                await applyBatch(ctx.agent, ctx.did, ctx.detail, ctx.store, buildRule(), (done, total) => {
                  status.textContent = `Applying ${done} / ${total}…`;
                });
                onApplied?.();
              });
            },
          },
          "Apply",
        ),
      ]
    : [];
  const body = [
    el(
      "p",
      { class: "muted small rule-builder-intro" },
      "A batch rule is a reusable instruction: when a photo or gallery matches the conditions, Hypo applies the changes you specify. Saving a rule does not change any photos until you choose it in a gallery's Batch edit panel.",
    ),
    el("h3", { class: "modal-sub" }, "Conditions"),
    field("Combine", combinator),
    condWrap,
    el("button", { class: "ghost small-btn", onclick: () => addCond() }, "+ Condition"),
    el("h3", { class: "modal-sub" }, "Actions"),
    actWrap,
    el("button", { class: "ghost small-btn", onclick: () => addAct() }, "+ Action"),
    field("Save as", nameInput),
    el("div", { class: "row wrap" }, [
      ...galleryActions,
      el(
        "button",
        {
          class: "ghost",
          onclick: async (e) => {
            await withButton(e.target, status, async () => {
              const rule = buildRule();
              const now = new Date().toISOString();
              const uri = await saveRecord(
                ctx.agent,
                ctx.did,
                NS.rule.batch,
                {
                  name: rule.name,
                  when: rule.when,
                  actions: rule.actions,
                  createdAt: options.existing?.value?.createdAt || now,
                  ...(options.existing ? { updatedAt: now } : {}),
                },
                options.existing || null,
              );
              onSaved?.({ id: uri, name: rule.name, when: rule.when, actions: rule.actions });
              toast(`Saved rule "${rule.name}"`, "ok");
            });
          },
        },
        "Save rule",
      ),
      status,
    ]),
    ctx.detail ? preview : null,
  ];
  openModal(options.existing ? "Edit batch rule" : "Create batch rule", body, null, {
    wide: true,
    hideSave: true,
    cancelLabel: "Close",
  });
}
