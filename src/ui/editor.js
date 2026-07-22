// editor.js: gallery editor, workflow builder, photo cards

import {
  getGalleries, getGalleryDetail, blobUrl, exifToForm,
  saveGallery, savePhotoAlt, saveExif, replacePhoto, setGalleryItemPosition,
  uploadImage,
} from "../grain.js";
import { aspectRatioOf } from "./uploadUI.js";
import { fileToExifForm } from "../readExif.js";
import {
  resolvePhotoCapture, projectCaptureToExif, savePhotoCapture, saveGalleryDefaults, matchGear,
} from "../graycard.js";
import { previewBatch, applyBatch, RULE_PRESETS } from "../batch.js";
import { openRuleBuilder } from "./ruleBuilder.js";
import {
  STAGE_LABELS, MEDIUMS,
  buildWorkflowForPhoto, linkPhotoWorkflow,
  describeStage, getRunForPhoto, stepsFromTemplate, applyTemplateDefaults,
  templateFromSteps, saveTemplate, STAGE_PROCESS_KIND,
} from "../workflow.js";
import { el, field, $, withButton, openModal, inputField, toast, stagger, confirmModal, isAdvanced, getVisionConfig, loadPhase } from "./dom.js";
import { analyzeAndSave, analyzePhoto, describePhoto, writeSceneGraph, getProvider } from "../vision.js";
import { distinctTerms, lookupGroundings, applyGroundings } from "../grounding.js";
import { locationField } from "./mapView.js";
import { lazyThumb } from "./lazy.js";
import { icon } from "./icons.js";

import {
  instanceSelect, shootSelect, refreshStore, openCreateInstanceModal, openAddGear,
} from "./library.js";
import { buildProcessSessionForm, stageExtraFields } from "./processForms.js";
import { openSceneEditor } from "./sceneEditor.js";
import { openInspector } from "./inspect.js";
import { gearThumb } from "../data/gearImage.js";

const EXIF_FIELDS = [
  { key: "make", label: "Camera make" },
  { key: "model", label: "Camera model" },
  { key: "lensMake", label: "Lens make" },
  { key: "lensModel", label: "Lens model" },
  { key: "fNumber", label: "Aperture", placeholder: "2.8" },
  { key: "exposureTime", label: "Exposure", placeholder: "1/125" },
  { key: "iSO", label: "ISO", placeholder: "400" },
  { key: "focalLengthIn35mmFormat", label: "Focal length (35mm)", placeholder: "50" },
  { key: "flash", label: "Flash" },
  { key: "dateTimeOriginal", label: "Date taken", placeholder: "2025-06-01T14:30:00Z" },
];

let ctx = null;

export function initEditor(context) {
  ctx = context;
}

// A .card that collapses to just its title. Native <details>, starts collapsed;
// the whole header row is one tap target (mobile-first). Uses the global
// .collapse-card styles.
function collapseCard(title, children) {
  return el("details", { class: "card collapse-card" }, [
    el("summary", { class: "collapse-summary" }, [el("h2", { style: "margin:0" }, title), el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄")]),
    ...children,
  ]);
}

// ---- per-photo dirty tracking + sticky save bar ----
let cardCtls = [];
let saveBarEl = null, saveBarCount = null, saveAllBtn = null;

// ---- bulk selection ----
let selected = new Set();
let selectBarEl = null, selectCount = null;
function refreshSelectBar() {
  if (!selectBarEl) return;
  const n = selected.size;
  if (!n) { selectBarEl.setAttribute("hidden", ""); return; }
  selectBarEl.removeAttribute("hidden");
  selectCount.textContent = `${n} selected`;
}
function ensureSelectBar() {
  const view = $("#editor-view");
  if (!view) return;
  if (!view.querySelector(".select-bar")) {
    selectCount = el("span", { class: "save-count" });
    selectBarEl = el("div", { class: "select-bar save-bar", hidden: "" }, [
      el("div", { class: "save-bar-inner" }, [
        selectCount,
        el("div", { class: "row" }, [
          el("button", { class: "ghost small-btn", onclick: () => { selected.clear(); document.querySelectorAll(".photo-select").forEach((c) => (c.checked = false)); refreshSelectBar(); } }, "Clear"),
          el("button", { class: "ghost small-btn", onclick: openBulkAnalyze }, "Analyze…"),
          el("button", { onclick: openBulkGear }, "Set gear…"),
        ]),
      ]),
    ]);
    view.append(selectBarEl);
  } else selectBarEl = view.querySelector(".select-bar");
  refreshSelectBar();
}
function openBulkGear() {
  const camSel = instanceSelect("camera", "");
  const lensSel = instanceSelect("lens", "");
  const rollSel = instanceSelect("filmRoll", "");
  openModal(`Set gear on ${selected.size} photo${selected.size > 1 ? "s" : ""}`, [
    field("Camera", camSel), field("Lens", lensSel), field("Film roll", rollSel),
  ], async () => {
    const patch = {};
    if (camSel.value) patch.camera = camSel.value;
    if (lensSel.value) patch.lens = lensSel.value;
    if (rollSel.value) patch.filmRoll = rollSel.value;
    if (!Object.keys(patch).length) throw new Error("Pick at least one");
    let n = 0;
    for (const uri of selected) {
      const saved = await savePhotoCapture(ctx.agent, ctx.did, uri, patch, ctx.store.photoCaptureByPhoto.get(uri));
      if (saved) ctx.store.photoCaptureByPhoto.set(uri, saved);
      n++;
    }
    ctx.store = await refreshStore();
    toast(`Set gear on ${n} photo${n > 1 ? "s" : ""}`, "ok");
    selected.clear(); refreshSelectBar();
    openGallery(ctx.galleryUri);
  });
}

// Bulk-analyze the selected photos with the connected provider. Each image is
// sent to the provider (cost-gated by a confirm), then alt text + a scene graph
// are written per photo; failures are counted, not fatal.
// After analysis, offer to link each detected type/relation to a Wikidata entity.
// Confident (unique exact) matches are pre-selected; the user can pick a better
// one or keep it as plain text, and "Keep as text" leaves everything ungrounded.
// Resolves with the (possibly grounded) analysis result either way.
function openGroundingModal(result) {
  return new Promise((resolve) => {
    const { nodes: nodeTerms, edges: edgeTerms } = distinctTerms(result);
    if (!nodeTerms.length && !edgeTerms.length) { resolve(result); return; }

    const bodyEl = el("div", {}, [el("p", { class: "muted small" }, "Looking up Wikidata…")]);
    const actions = el("div", { class: "row modal-actions" });
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "Link terms to Wikidata" }, [
      el("h2", {}, "Link terms to Wikidata"),
      el("p", { class: "muted small" }, "Ground each detected type to a Wikidata entity so it becomes a reusable ontology node, pick a better match, or keep it as plain text. Skip to keep everything as text."),
      bodyEl, actions,
    ]);
    const settle = (r) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(r); };
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); settle(result); } }
    overlay.append(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) settle(result); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);

    Promise.all([lookupGroundings(nodeTerms), lookupGroundings(edgeTerms)]).then(([nLook, eLook]) => {
      const selects = { node: new Map(), edge: new Map() };
      const section = (title, terms, look, bucket) => {
        if (!terms.length) return null;
        const rows = terms.map((text) => {
          const { candidates, suggested } = look.get(text) || { candidates: [], suggested: null };
          const sel = el("select", {}, [
            ...candidates.map((c) => el("option", { value: c.id }, `${c.label}${c.description ? ` — ${c.description}` : ""} (${c.id})`)),
            el("option", { value: "" }, "Keep as text"),
          ]);
          sel.value = suggested ? suggested.id : "";
          sel._byId = new Map(candidates.map((c) => [c.id, c]));
          selects[bucket].set(text, sel);
          return el("label", { class: "field" }, [el("span", {}, `${text}${suggested ? "  ✓ match" : candidates.length ? "  ?" : "  (no match)"}`), sel]);
        });
        return el("div", {}, [el("h3", { class: "modal-sub" }, title), ...rows]);
      };
      bodyEl.replaceChildren(...[section("Objects", nodeTerms, nLook, "node"), section("Relations", edgeTerms, eLook, "edge")].filter(Boolean));
      const collect = (bucket) => {
        const m = new Map();
        for (const [text, sel] of selects[bucket]) { const c = sel.value && sel._byId.get(sel.value); if (c) m.set(text, { id: c.id, label: c.label }); }
        return m;
      };
      actions.replaceChildren(
        el("button", { onclick: () => settle(applyGroundings(result, collect("node"), collect("edge"))) }, "Apply groundings"),
        el("button", { class: "ghost", onclick: () => settle(result) }, "Keep as text"),
      );
      (modal.querySelector("select") || modal).focus();
    });
  });
}

let bulkAnalyzing = false;
async function openBulkAnalyze() {
  if (bulkAnalyzing) return;
  const cfg = getVisionConfig();
  if (!cfg?.apiKey) { toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000); return; }
  const n = selected.size;
  if (!n) return;
  const provider = getProvider(cfg);
  const ok = await confirmModal(
    `Analyze ${n} photo${n > 1 ? "s" : ""} with ${provider.label}? Each image is sent to the provider and may incur cost. This replaces any existing scene graph.`,
    { confirmLabel: "Analyze", danger: false },
  );
  if (!ok) return;

  bulkAnalyzing = true;
  const uris = [...selected];
  let done = 0, failed = 0, skipped = 0, processed = 0;
  const dismiss = toast(`Photo 0 / ${n} · starting…`, "info", 3_600_000);
  const label = (msg) => dismiss.update?.(msg);
  try {
    for (const uri of uris) {
      const i = processed + 1;
      const p = ctx.detail.photos.find((x) => x.photo.uri === uri);
      if (!p?.photo?.value) { skipped++; processed++; label(`Photo ${processed} / ${n} · skipped (no image)`); continue; }
      label(`Photo ${i} / ${n} · starting…`);
      try {
        await analyzeAndSave(ctx.agent, ctx.did, p.photo, cfg, {
          autoGround: true,
          onProgress: (msg) => label(`Photo ${i} / ${n} · ${msg}`),
        });
        done++;
      } catch { failed++; }
      processed++;
      label(`Photo ${processed} / ${n} · done`);
    }
  } finally {
    dismiss?.();
    bulkAnalyzing = false;
  }
  ctx.store = await refreshStore();
  const parts = [`Analyzed ${done}`];
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  toast(parts.join(", "), failed ? "err" : "ok");
  selected.clear(); refreshSelectBar();
  openGallery(ctx.galleryUri);
}

export function hasUnsavedChanges() {
  const editorVisible = !$("#editor-view")?.classList.contains("hidden");
  return editorVisible && cardCtls.some((c) => c.dirty);
}

function refreshSaveBar() {
  if (!saveBarEl) return;
  const n = cardCtls.filter((c) => c.dirty).length;
  if (n === 0) { saveBarEl.setAttribute("hidden", ""); return; }
  saveBarEl.removeAttribute("hidden");
  saveBarCount.textContent = `${n} unsaved photo${n > 1 ? "s" : ""}`;
}

export async function saveAllDirty() { await saveAll(); }

async function saveAll() {
  const dirty = cardCtls.filter((c) => c.dirty);
  if (!dirty.length) return;
  saveAllBtn.disabled = true;
  const total = dirty.length;
  let done = 0, failed = 0;
  saveAllBtn.textContent = `Saving 0 / ${total}…`;
  for (const c of dirty) {
    try { await c.save(); done++; } catch { failed++; }
    saveAllBtn.textContent = `Saving ${done + failed} / ${total}…`;
    refreshSaveBar();
  }
  saveAllBtn.disabled = false;
  saveAllBtn.textContent = "Save all";
  ctx.store = await refreshStore();
  toast(failed ? `Saved ${done}, ${failed} failed` : `Saved ${done} photo${done > 1 ? "s" : ""}`, failed ? "err" : "ok");
  refreshSaveBar();
}

function ensureSaveBar() {
  const view = $("#editor-view");
  if (!view) return;
  if (!view.querySelector(".save-bar")) {
    saveBarCount = el("span", { class: "save-count" });
    saveAllBtn = el("button", { onclick: saveAll }, "Save all");
    saveBarEl = el("div", { class: "save-bar", hidden: "" }, [
      el("div", { class: "save-bar-inner" }, [saveBarCount, saveAllBtn]),
    ]);
    view.append(saveBarEl);
  } else {
    saveBarEl = view.querySelector(".save-bar");
  }
  refreshSaveBar();
}

function skeletonCards(n) {
  return Array.from({ length: n }, () =>
    el("div", { class: "card" }, [
      el("div", { class: "photo-head" }, [
        el("div", { class: "thumb skeleton" }),
        el("div", { style: "flex:1" }, [
          el("div", { class: "skeleton skeleton-title" }),
          el("div", { class: "skeleton skeleton-line" }),
        ]),
      ]),
    ]),
  );
}

function coverageBadges(p, capture, wf) {
  const items = [
    ["exif", !!p.exif],
    ["capture", !!(capture && (capture.value.camera || capture.value.lens || capture.value.filmRoll || capture.value.shoot))],
    ["workflow", !!wf?.run],
    ["scene", !!ctx.store.sceneGraphByPhoto?.has(p.photo.uri)],
    ["alt", !!p.photo?.value?.alt],
  ].filter(([, on]) => on);
  if (!items.length) return null;
  return el("div", { class: "badge-row" }, items.map(([label]) => el("span", { class: "badge" }, label)));
}

function gearField(labelText, kind, sel) {
  const { thumb, refresh } = gearThumb(ctx.agent, ctx.did, ctx.store, kind, () =>
    sel.value ? ctx.store.byUri.get(sel.value)?.item?.value : null);
  sel.addEventListener("change", refresh);
  refresh();
  return el("label", { class: "field" }, [el("span", {}, labelText), el("div", { class: "row gear-select" }, [thumb, sel])]);
}

function exifReadout(form) {
  const cell = (pre, val, post = "") => el("span", val ? {} : { class: "rd-dim" }, `${pre}${val || "-"}${val ? post : ""}`);
  return el("div", { class: "exif-readout mono" }, [
    cell("ƒ", form.fNumber), cell("", form.exposureTime, "s"), cell("ISO ", form.iSO), cell("", form.focalLengthIn35mmFormat, "mm"),
  ]);
}

const EXIF_VALIDATORS = {
  fNumber: (v) => /^\d+(\.\d+)?$/.test(v) || "number, e.g. 2.8",
  exposureTime: (v) => /^\d+(\.\d+)?$/.test(v) || /^\d+\/\d+$/.test(v) || "e.g. 1/125 or 0.5",
  iSO: (v) => /^\d+$/.test(v) || "whole number",
  focalLengthIn35mmFormat: (v) => /^\d+(\.\d+)?$/.test(v) || "mm, e.g. 50",
  dateTimeOriginal: (v) => !Number.isNaN(Date.parse(v)) || "ISO 8601 date",
};

export async function openGallery(galleryUri) {
  ctx.galleryUri = galleryUri;
  cardCtls = [];
  selected = new Set();
  const body = $("#editor-body");
  const phase = loadPhase("Loading gallery from your PDS…");
  body.replaceChildren(...skeletonCards(3), phase.node);
  try {
    ctx.store = await refreshStore();
    phase.set("Loading photos from your PDS…");
    ctx.detail = await getGalleryDetail(ctx.agent, ctx.did, galleryUri);
  } finally {
    phase.clear();
  }
  body.replaceChildren();
  body.append(buildGalleryHeader());
  body.append(buildDefaultsCard());
  body.append(buildBatchCard());
  body.append(buildWorkflowBuilderCard());
  const photos = ctx.detail.photos;
  const nWf = photos.filter((p) => ctx.store.photoWorkflowByPhoto.has(p.photo.uri)).length;
  const nScene = photos.filter((p) => ctx.store.sceneGraphByPhoto?.has(p.photo.uri)).length;
  const nAlt = photos.filter((p) => p.photo?.value?.alt).length;
  const summary = [
    nWf && `${nWf} workflow${nWf > 1 ? "s" : ""}`,
    nScene && `${nScene} scene graph${nScene > 1 ? "s" : ""}`,
    nAlt && `${nAlt} with alt text`,
  ].filter(Boolean).join(" · ");
  const photosWrap = el("div", { id: "photos" });
  let gridMode = false;
  try { gridMode = localStorage.getItem("hypo:photoview") === "grid"; } catch { /* ignore */ }
  if (gridMode) photosWrap.classList.add("grid-mode");
  const listSeg = el("button", { class: "small-btn", title: "List view", "aria-label": "List view" }, [icon("list")]);
  const gridSeg = el("button", { class: "small-btn", title: "Grid view", "aria-label": "Grid view" }, [icon("grid")]);
  const setMode = (g) => {
    photosWrap.classList.toggle("grid-mode", g);
    try { localStorage.setItem("hypo:photoview", g ? "grid" : "list"); } catch { /* ignore */ }
    listSeg.classList.toggle("active", !g); gridSeg.classList.toggle("active", g);
  };
  listSeg.addEventListener("click", () => setMode(false));
  gridSeg.addEventListener("click", () => setMode(true));
  setMode(gridMode);
  photosWrap.addEventListener("click", (e) => {
    if (!photosWrap.classList.contains("grid-mode")) return;
    const card = e.target.closest(".photo-card");
    if (!card) return;
    setMode(false);
    card.scrollIntoView({ block: "center" });
  });
  body.append(el("div", { class: "row between section-head" }, [
    el("h2", { class: "section" }, `Photos (${photos.length})`),
    el("div", { class: "row" }, [summary ? el("span", { class: "mono muted small" }, summary) : null, el("div", { class: "segmented" }, [listSeg, gridSeg])]),
  ]));
  photos.map((p, i) => buildPhotoCard(p, i)).forEach((c) => photosWrap.append(c));
  wireReorder(photosWrap);
  body.append(photosWrap);
  ensureSaveBar();
  ensureSelectBar();
  setEditorHero(photos[0]?.photo?.value?.photo);
}

async function setEditorHero(blobRef) {
  const hero = $("#editor-hero");
  if (!hero) return;
  if (!blobRef) { hero.classList.add("hidden"); hero.style.backgroundImage = ""; return; }
  try { const u = await blobUrl(ctx.agent, ctx.did, blobRef); if (u) { hero.style.backgroundImage = `url("${u}")`; hero.classList.remove("hidden"); } }
  catch { hero.classList.add("hidden"); }
}

function buildGalleryHeader() {
  const g = ctx.detail.gallery;
  const titleInput = el("input", { type: "text", value: g.value.title || "" });
  const descInput = el("textarea", { rows: "3" }, g.value.description || "");
  const status = el("span", { class: "status" });
  const card = el("div", { class: "card" }, [
    el("div", { class: "row between" }, [
      el("h2", {}, "Gallery"),
      el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(g) }, "{ }"),
    ]),
    field("Title", titleInput),
    field("Description", descInput),
    el("div", { class: "row" }, [el("span", { class: "muted small" }, "Autosaves when you click away."), status]),
  ]);

  let prevT = titleInput.value, prevD = descInput.value;
  const autosave = async () => {
    if (titleInput.value === prevT && descInput.value === prevD) return;
    prevT = titleInput.value; prevD = descInput.value;
    status.className = "status"; status.textContent = "Saving…";
    try {
      await saveGallery(ctx.agent, ctx.did, g, { title: titleInput.value, description: descInput.value });
      ctx.detail = await getGalleryDetail(ctx.agent, ctx.did, ctx.galleryUri);
      status.classList.add("ok"); status.textContent = "Saved ✓";
    } catch (e) { status.classList.add("err"); status.textContent = e.message || String(e); toast(e.message || String(e), "err"); }
  };
  titleInput.addEventListener("blur", autosave);
  descInput.addEventListener("blur", autosave);
  return card;
}

function buildDefaultsCard() {
  const defs = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri);
  const camSel = instanceSelect("camera", defs?.value?.camera);
  const lensSel = instanceSelect("lens", defs?.value?.lens);
  const rollSel = instanceSelect("filmRoll", defs?.value?.filmRoll);
  const shootSel = shootSelect(defs?.value?.shoot);
  const locF = locationField(defs?.value?.location);
  const status = el("span", { class: "status" });
  return collapseCard("Gallery defaults", [
    el("p", { class: "muted small" }, "Applied when a photo has no explicit capture set."),
    field("Camera", camSel),
    field("Lens", lensSel),
    field("Film roll", rollSel),
    field("Shoot", shootSel),
    field("Location", locF.node),
    el("button", {
      class: "ghost",
      onclick: async (e) => {
        await withButton(e.target, status, async () => {
          await saveGalleryDefaults(ctx.agent, ctx.did, ctx.galleryUri, {
            camera: camSel.value || undefined,
            lens: lensSel.value || undefined,
            filmRoll: rollSel.value || undefined,
            shoot: shootSel.value || undefined,
            location: locF.get(),
          }, defs);
          ctx.store = await refreshStore();
        });
      },
    }, "Save defaults"),
    status,
  ]);
}

function buildBatchCard() {
  const saved = (ctx.store.batchRules || []).map((r) => ({ id: r.uri, name: r.value.name || "(rule)", when: r.value.when, actions: r.value.actions || [] }));
  const allRules = [...RULE_PRESETS, ...saved];
  const presetSel = el("select", {}, allRules.map((r) => el("option", { value: r.id }, r.name)));
  const previewBox = el("pre", { class: "batch-preview muted" }, "Preview batch changes.");
  const status = el("span", { class: "status" });
  let rule = allRules[0];
  presetSel.onchange = () => { rule = allRules.find((r) => r.id === presetSel.value) || allRules[0]; };
  return collapseCard("Batch edit", [
    field("Rule", presetSel),
    el("div", { class: "row wrap" }, [
      el("button", {
        class: "ghost",
        onclick: () => {
          const result = previewBatch(ctx.detail, ctx.store, rule);
          previewBox.textContent = result.matched.length
            ? result.matched.map((m) => `#${m.index}: ${m.changes.map((c) => c.kind).join(", ")}`).join("\n")
            : "No matches.";
        },
      }, "Preview"),
      el("button", {
        onclick: async (e) => {
          if (!(await confirmModal("Apply this rule to all matching photos?", { confirmLabel: "Apply", danger: false }))) return;
          await withButton(e.target, status, async () => {
            await applyBatch(ctx.agent, ctx.did, ctx.detail, ctx.store, rule, (done, total) => {
              status.textContent = `Applying ${done} / ${total}…`;
            });
            ctx.store = await refreshStore();
            openGallery(ctx.galleryUri);
          });
        },
      }, "Apply"),
      el("button", {
        class: "ghost",
        onclick: () => openRuleBuilder(ctx, () => openGallery(ctx.galleryUri), null, (saved) => {
          allRules.push(saved);
          presetSel.append(el("option", { value: saved.id }, saved.name));
        }),
      }, "Custom rule…"),
      status,
    ]),
    previewBox,
  ]);
}

function openStepConfigModal(step, stepIndex, onSave) {
  const processKind = STAGE_PROCESS_KIND[step.kind];
  const processForm = processKind
    ? buildProcessSessionForm(processKind, ctx.store, step.processFields || {})
    : null;
  const extraForm = stageExtraFields(step.kind, ctx.store, step.stageFields || {});

  const nodes = [];
  if (processForm?.nodes?.length) {
    nodes.push(el("h3", { class: "modal-sub" }, "Process session"));
    nodes.push(...processForm.nodes);
  }
  if (extraForm.nodes.length) {
    nodes.push(el("h3", { class: "modal-sub" }, "Stage fields"));
    nodes.push(...extraForm.nodes);
  }
  if (!nodes.length) {
    nodes.push(el("p", { class: "muted" }, "This stage has no configurable session."));
  }

  openModal(`Configure: ${STAGE_LABELS[step.kind] || step.kind}`, nodes, async () => {
    const processFields = processForm ? processForm.read() : {};
    const stageFields = extraForm.read();
    onSave({ ...step, processFields, stageFields, configured: true }, stepIndex);
  });
}

function buildWorkflowBuilderCard() {
  const steps = [];
  const stepList = el("div", { class: "workflow-steps" });
  const mediumSel = el("select", {}, MEDIUMS.map((m) => el("option", { value: m }, m)));
  mediumSel.value = "film";
  const templateSel = el("select", {}, [
    el("option", { value: "" }, "Load a template…"),
    ...(ctx.store.workflowTemplates || []).map((t) => el("option", { value: t.uri }, t.value.name)),
  ]);
  const status = el("span", { class: "status" });

  function renderSteps() {
    stepList.replaceChildren();
    steps.forEach((s, i) => {
      const badge = s.configured
        ? el("span", { class: "step-badge ok" }, "configured")
        : el("span", { class: "step-badge muted" }, "default");
      stepList.append(el("div", { class: "workflow-step row between" }, [
        el("span", {}, [
          `${i + 1}. ${STAGE_LABELS[s.kind] || s.kind} `,
          badge,
        ]),
        el("span", { class: "row" }, [
          el("button", {
            class: "ghost small-btn",
            onclick: () => openStepConfigModal(s, i, (updated) => { steps[i] = updated; renderSteps(); }),
          }, "Configure"),
          el("button", {
            class: "ghost small-btn",
            disabled: i === 0,
            onclick: () => { steps.splice(i - 1, 0, steps.splice(i, 1)[0]); renderSteps(); },
          }, "↑"),
          el("button", {
            class: "ghost small-btn",
            disabled: i === steps.length - 1,
            onclick: () => { steps.splice(i + 1, 0, steps.splice(i, 1)[0]); renderSteps(); },
          }, "↓"),
          el("button", {
            class: "ghost small-btn",
            onclick: () => { steps.splice(i, 1); renderSteps(); },
          }, "Remove"),
        ]),
      ]));
    });
  }

  templateSel.onchange = () => {
    const t = ctx.store.workflowTemplates.find((x) => x.uri === templateSel.value);
    if (!t) return;
    steps.length = 0;
    steps.push(...applyTemplateDefaults(stepsFromTemplate(t), t));
    mediumSel.value = t.value.medium || "film";
    renderSteps();
  };

  function refreshTemplateOptions() {
    const cur = templateSel.value;
    templateSel.replaceChildren(
      el("option", { value: "" }, "Load a template…"),
      ...(ctx.store.workflowTemplates || []).map((t) => el("option", { value: t.uri }, t.value.name)),
    );
    templateSel.value = cur;
  }

  const addBar = el("div", { class: "row wrap" });
  for (const kind of ["capture", "develop", "digitize", "digital", "print", "edit", "output", "other"]) {
    addBar.append(el("button", {
      class: "ghost small-btn",
      onclick: () => { steps.push({ kind, processFields: {}, stageFields: {}, configured: false }); renderSteps(); },
    }, `+ ${STAGE_LABELS[kind]}`));
  }

  async function saveWorkflow(photos, label) {
    if (!photos.length) throw new Error("Gallery has no photos");
    if (!steps.length) throw new Error("Add at least one workflow step");
    const sharedSessions = new Map();
    for (const p of photos) {
      const photoUri = p.photo?.uri;
      if (!photoUri) continue;
      const existingLink = ctx.store.photoWorkflowByPhoto.get(photoUri);
      const runUri = await buildWorkflowForPhoto(
        ctx.agent, ctx.did, photoUri, mediumSel.value, steps,
        ctx.store, ctx.galleryUri, sharedSessions,
      );
      await linkPhotoWorkflow(ctx.agent, ctx.did, photoUri, runUri, existingLink || null);
    }
    ctx.store = await refreshStore();
    openGallery(ctx.galleryUri);
    status.textContent = label;
    status.classList.add("ok");
  }

  return collapseCard("Workflow builder", [
    el("p", { class: "muted small" }, "Add stages, configure process sessions, save to photos, or save as a reusable template."),
    field("Load template", templateSel),
    field("Medium", mediumSel),
    el("p", { class: "muted small" }, "Steps:"),
    addBar,
    stepList,
    el("div", { class: "row wrap" }, [
      el("button", {
        onclick: async (e) => {
          await withButton(e.target, status, async () => {
            await saveWorkflow([ctx.detail.photos[0]], "Saved for photo #1 ✓");
          });
        },
      }, "Save for photo #1"),
      el("button", {
        class: "ghost",
        onclick: async (e) => {
          await withButton(e.target, status, async () => {
            await saveWorkflow(ctx.detail.photos, `Applied to ${ctx.detail.photos.length} photos ✓`);
          });
        },
      }, "Apply to all photos"),
      el("button", {
        class: "ghost",
        onclick: () => {
          const { wrap, input } = inputField("Template name", "name", "");
          openModal("Save as template", [wrap], async () => {
            const name = input.value.trim();
            if (!name) throw new Error("Name required");
            const payload = templateFromSteps(name, mediumSel.value, steps);
            await saveTemplate(ctx.agent, ctx.did, payload, null);
            ctx.store = await refreshStore();
            refreshTemplateOptions();
          });
        },
      }, "Save as template"),
      status,
    ]),
  ]);
}

// A live "we think this is <gear>" hint built from the photo's EXIF, that fills
// the matching select in one tap, and copes with several copies of one model.
function gearSuggestion(kind, match, sel, markDirty) {
  if (!match || !match.exifLabel) return null;
  const wrap = el("div", { class: "gear-suggest" });
  const pick = (uri) => { sel.value = uri; sel.dispatchEvent(new Event("change")); markDirty(); render(); };
  function render() {
    wrap.replaceChildren();
    if (sel.value) return;                       // already resolved; stay quiet
    const insts = match.instances;
    if (insts.length === 1) {
      wrap.append(icon("check", 14), el("span", { class: "small" }, `Looks like ${match.exifLabel}`),
        el("button", { class: "ghost small-btn", onclick: () => pick(insts[0].uri) }, `Use ${insts[0].label}`));
    } else if (insts.length > 1) {
      wrap.append(el("span", { class: "small" }, `${match.exifLabel}: which copy?`),
        ...insts.map((it) => el("button", { class: "ghost small-btn", onclick: () => pick(it.uri) }, it.label)));
    } else {
      wrap.append(el("span", { class: "small muted" }, `${match.exifLabel} isn't in your setup`),
        el("button", { class: "ghost small-btn", onclick: () => openAddGear(kind, () => openGallery(ctx.galleryUri), { make: match.make, model: match.model }) }, "Add it"));
    }
  }
  render();
  sel.addEventListener("change", render);
  return wrap;
}

// -- gallery photo reordering (drag handle + up/down, mobile-first) -----------

// after any reorder, renumber the cards and persist changed gallery.item positions.
function persistOrder(container) {
  const cards = [...container.children].filter((c) => c._photo);
  const writes = [];
  cards.forEach((card, i) => {
    const p = card._photo;
    const num = card.querySelector(".photo-meta > div:first-child");
    if (num) num.textContent = `#${i + 1}`;
    card.setAttribute("data-frame", String(i + 1));
    if ((p.item?.value?.position ?? 0) !== i && p.item?.uri && p.item?.cid) {
      p.item.value.position = i;
      writes.push(setGalleryItemPosition(ctx.agent, ctx.did, p.item, i));
    }
  });
  if (writes.length) Promise.all(writes).then(() => toast("Order saved", "ok")).catch(() => toast("Couldn't save order", "err"));
}

function moveCard(container, card, dir) {
  if (dir < 0) {
    const prev = card.previousElementSibling;
    if (prev?.classList.contains("photo-card")) container.insertBefore(card, prev);
  } else {
    const next = card.nextElementSibling;
    if (next?.classList.contains("photo-card")) container.insertBefore(next, card);
  }
  card.scrollIntoView({ block: "nearest" });
  persistOrder(container);
}

function wireReorder(container) {
  container.addEventListener("click", (e) => {
    const card = e.target.closest(".photo-card");
    if (!card) return;
    if (e.target.closest(".move-up")) moveCard(container, card, -1);
    else if (e.target.closest(".move-down")) moveCard(container, card, 1);
  });
  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    e.preventDefault();
    const card = handle.closest(".photo-card");
    card.classList.add("dragging");
    const move = (ev) => {
      const others = [...container.querySelectorAll(".photo-card:not(.dragging)")];
      let before = null;
      for (const c of others) { const r = c.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = c; break; } }
      if (before) container.insertBefore(card, before); else container.append(card);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      card.classList.remove("dragging");
      persistOrder(container);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

// copy the gear selections from the photo card directly above this one, so
// tagging a roll of same-gear frames is one tap each.
function sameGearAsAbove(btn) {
  const card = btn.closest(".photo-card");
  const prev = card?.previousElementSibling;
  if (!prev?.classList.contains("photo-card")) { toast("No photo above", "info"); return; }
  const sel = (root, label) => [...root.querySelectorAll("label.field")].find((l) => l.querySelector("span")?.textContent === label)?.querySelector("select");
  let copied = 0;
  for (const label of ["Camera", "Lens", "Film roll", "Shoot"]) {
    const from = sel(prev, label), to = sel(card, label);
    if (from && to && from.value) { to.value = from.value; to.dispatchEvent(new Event("change")); copied++; }
  }
  toast(copied ? "Copied gear from the photo above" : "The photo above has no gear set", copied ? "ok" : "info");
}

function reorderControl() {
  return el("div", { class: "reorder" }, [
    el("button", { class: "drag-handle", type: "button", title: "Drag to reorder", "aria-label": "Drag to reorder" }, [icon("dots", 16)]),
    el("button", { class: "ghost small-btn move-up", type: "button", title: "Move up", "aria-label": "Move up" }, "↑"),
    el("button", { class: "ghost small-btn move-down", type: "button", title: "Move down", "aria-label": "Move down" }, "↓"),
  ]);
}

function buildPhotoCard(p, idx) {
  const thumb = lazyThumb(ctx.agent, ctx.did, p.photo?.value?.photo, "thumb");

  const capture = ctx.store.photoCaptureByPhoto.get(p.photo.uri);
  const defaults = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri);
  const refs = resolvePhotoCapture(capture, defaults);
  const wf = getRunForPhoto(ctx.store, p.photo.uri);

  const camSel = instanceSelect("camera", refs.camera);
  const lensSel = instanceSelect("lens", refs.lens);
  const rollSel = instanceSelect("filmRoll", refs.filmRoll);
  const shootSel = shootSelect(refs.shoot);
  const locF = locationField(capture?.value?.location);
  // frame position on the roll (photo.capture.frameIndex); optional, 1-based.
  const frameInput = el("input", { type: "number", min: "1", step: "1", placeholder: "Frame # on roll", value: capture?.value?.frameIndex ?? "" });

  const ctl = { dirty: false, save: null };
  cardCtls.push(ctl);
  const markDirty = () => { if (!ctl.dirty) { ctl.dirty = true; refreshSaveBar(); } };
  for (const sel of [camSel, lensSel, rollSel, shootSel]) sel.addEventListener("change", markDirty);
  frameInput.addEventListener("input", markDirty);
  locF.node.querySelector("button").addEventListener("click", () => setTimeout(markDirty, 0));

  let form = exifToForm(p.exif?.value);
  const gearMatch = matchGear(form, ctx.store);
  const exifInputs = {};
  const exifValidators = [];
  const exifGrid = el("div", { class: "exif-grid" });
  for (const f of EXIF_FIELDS) {
    const input = el("input", { type: "text", value: form[f.key] || "", placeholder: f.placeholder || "" });
    const hint = el("span", { class: "field-hint" });
    const validate = () => {
      const v = input.value.trim();
      const rule = EXIF_VALIDATORS[f.key];
      if (v && rule) {
        const r = rule(v);
        if (r !== true) { input.classList.add("invalid"); hint.textContent = r; return false; }
      }
      input.classList.remove("invalid"); hint.textContent = "";
      return true;
    };
    input.addEventListener("input", () => { validate(); markDirty(); });
    exifInputs[f.key] = input;
    exifValidators.push(validate);
    exifGrid.append(el("label", { class: "field" }, [el("span", {}, f.label), input, hint]));
  }

  const status = el("span", { class: "status" });
  const wfSummary = wf?.stages?.length
    ? wf.stages.map((s) => describeStage(s)).join(" → ")
    : "No workflow";
  const readoutHost = el("div");
  const refreshReadout = () => { readoutHost.replaceChildren(exifReadout(form)); };
  refreshReadout();

  const altArea = el("textarea", { rows: "2" }, p.photo?.value?.alt || "");
  altArea.addEventListener("input", markDirty);

  const fileIn = el("input", {
    type: "file", accept: "image/*", class: "hidden", "aria-hidden": "true", tabindex: "-1",
  });
  fileIn.addEventListener("change", async () => {
    const file = fileIn.files?.[0];
    fileIn.value = "";
    if (!file || !p.photo?.value) return;
    const decision = await confirmModal(
      "Replace this photo’s image? The gallery ID stays the same, and gear and workflows stay linked.",
      {
        confirmLabel: "Replace",
        danger: false,
        checks: [{
          key: "rereadExif",
          label: "Also re-read EXIF from the new file (overwrites current EXIF)",
          checked: false,
        }],
      },
    );
    if (!decision?.confirmed) return;
    const rereadExif = !!decision.checks?.rereadExif;
    status.className = "status";
    status.textContent = "Replacing…";
    try {
      const ar = await aspectRatioOf(file);
      const blob = await uploadImage(ctx.agent, file);
      const { cid, value } = await replacePhoto(ctx.agent, ctx.did, p.photo, { blob, aspectRatio: ar });
      p.photo.cid = cid;
      p.photo.value = value;
      try {
        const u = await blobUrl(ctx.agent, ctx.did, value.photo);
        thumb.replaceChildren(...(u ? [el("img", { src: u, alt: "" })] : []));
      } catch { /* thumb refresh is best-effort */ }

      if (rereadExif) {
        form = await fileToExifForm(file);
        for (const f of EXIF_FIELDS) exifInputs[f.key].value = form[f.key] || "";
        exifValidators.forEach((v) => v());
        p.exif = await saveExif(ctx.agent, ctx.did, p.photo.uri, p.exif, form);
        refreshReadout();
      }

      status.classList.add("ok");
      status.textContent = rereadExif ? "Image replaced · EXIF re-read ✓" : "Image replaced ✓";
      toast(rereadExif ? "Photo replaced and EXIF updated" : "Photo replaced", "ok");
    } catch (err) {
      const msg = err?.message || String(err);
      status.classList.add("err");
      status.textContent = `Error: ${msg}`;
      toast(msg, "err");
    }
  });

  ctl.save = async () => {
    if (!exifValidators.every((v) => v())) throw new Error("Some EXIF fields are invalid");
    if (p.photo?.value) {
      const photoCid = await savePhotoAlt(ctx.agent, ctx.did, p.photo, altArea.value);
      if (photoCid) p.photo.cid = photoCid;
    }
    const captureSaved = await savePhotoCapture(ctx.agent, ctx.did, p.photo.uri, {
      camera: camSel.value || undefined,
      lens: lensSel.value || undefined,
      filmRoll: rollSel.value || undefined,
      frameIndex: frameInput.value ? parseInt(frameInput.value, 10) : undefined,
      shoot: shootSel.value || undefined,
      location: locF.get(),
    }, capture);
    if (captureSaved) ctx.store.photoCaptureByPhoto.set(p.photo.uri, captureSaved);
    const formValues = {};
    for (const f of EXIF_FIELDS) formValues[f.key] = exifInputs[f.key].value;
    p.exif = await saveExif(ctx.agent, ctx.did, p.photo.uri, p.exif, formValues);
    ctl.dirty = false;
    refreshSaveBar();
  };

  const card = el("div", { class: "card photo-card reveal", style: `--i:${idx}`, "data-frame": String(idx + 1) }, [
    el("div", { class: "photo-head" }, [
      reorderControl(),
      el("input", {
        type: "checkbox", class: "photo-select", "aria-label": "Select photo",
        onchange: (e) => { if (e.target.checked) selected.add(p.photo.uri); else selected.delete(p.photo.uri); refreshSelectBar(); },
      }),
      thumb,
      el("div", { class: "photo-meta" }, [
        el("div", {}, `#${idx + 1}`),
        el("div", { class: "mono muted small" }, wfSummary),
        coverageBadges(p, capture, wf),
        readoutHost,
      ]),
    ]),
    el("details", { open: true }, [
      el("summary", {}, "Gear"),
      gearSuggestion("camera", gearMatch.camera, camSel, markDirty),
      gearField("Camera", "camera", camSel),
      gearSuggestion("lens", gearMatch.lens, lensSel, markDirty),
      gearField("Lens", "lens", lensSel),
      gearField("Film roll", "filmRoll", rollSel),
      field("Frame # on roll", frameInput),
      field("Shoot", shootSel),
      field("Location", locF.node),
      el("div", { class: "row wrap subtle-actions" }, [
        idx > 0 ? el("button", { class: "ghost small-btn", title: "Copy gear from the photo above", onclick: (e) => sameGearAsAbove(e.target) }, "Same as above") : null,
        el("button", { class: "ghost small-btn", onclick: () => openAddGear("camera", () => openGallery(ctx.galleryUri)) }, "+ Camera"),
        el("button", { class: "ghost small-btn", onclick: () => openAddGear("lens", () => openGallery(ctx.galleryUri)) }, "+ Lens"),
        el("button", {
          class: "ghost small-btn",
          title: "Fill blank EXIF fields from the gear selected above",
          onclick: () => {
            form = projectCaptureToExif(form, {
              camera: camSel.value, lens: lensSel.value, filmRoll: rollSel.value,
            }, ctx.store);
            for (const f of EXIF_FIELDS) exifInputs[f.key].value = form[f.key] || "";
            exifValidators.forEach((v) => v());
            refreshReadout();
            markDirty();
            status.textContent = "Filled EXIF from gear (save to persist)";
          },
        }, "Fill EXIF from gear"),
      ]),
    ]),
    el("label", { class: "field" }, [
      el("div", { class: "row between" }, [
        el("span", {}, "Alt text"),
        p.photo?.value ? el("button", {
          class: "ghost small-btn", type: "button", title: "Generate alt text from the image (no scene graph)",
          onclick: async (e) => {
            const cfg = getVisionConfig();
            if (!cfg?.apiKey) { toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000); return; }
            await withButton(e.currentTarget, status, async () => {
              const alt = await describePhoto(ctx.agent, ctx.did, p.photo.value.photo, cfg, {
                onProgress: (msg) => { status.textContent = msg; },
              });
              if (alt) { altArea.value = alt; markDirty(); }
            }, { working: "Loading photo from your PDS…", done: "Alt text ready (save to keep)" });
          },
        }, "Generate") : null,
      ]),
      altArea,
    ]),
    el("details", {}, [el("summary", {}, "EXIF"), exifGrid]),
    el("div", { class: "row wrap subtle-actions" }, [
      p.photo?.value ? el("button", {
        class: "ghost small-btn",
        title: "Swap the image file; gallery ID and linked records stay the same",
        onclick: () => fileIn.click(),
      }, "Replace image") : null,
      el("button", { class: "ghost small-btn", onclick: () => openSceneEditor(ctx, { ...p.photo, idx }, {
        // Object detection lives inside the scene-graph modal now (next to Edit).
        // It writes only the scene graph; alt text has its own Generate button.
        onAnalyze: p.photo?.value ? async (onProgress) => {
          const cfg = getVisionConfig();
          if (!cfg?.apiKey) { toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000); return null; }
          const raw = await analyzePhoto(ctx.agent, ctx.did, p.photo.value.photo, cfg, { onProgress });
          onProgress?.("Looking up types on Wikidata…");
          const result = await openGroundingModal(raw);   // confirm/pick Wikidata groundings, or keep as text
          if (!result) return null;
          onProgress?.("Saving scene graph to your PDS…");
          await writeSceneGraph(ctx.agent, ctx.did, p.photo.uri, result);
          ctx.store = await refreshStore();               // keep the card's indicators fresh, in place
          return result;
        } : null,
      }) }, "Scene graph"),
      isAdvanced() ? el("button", { class: "ghost small-btn", onclick: () => openInspector(p.photo) }, "Inspect") : null,
      fileIn,
    ]),
    el("button", {
      class: "photo-save",
      onclick: async (e) => {
        const ok = await withButton(e.target, status, ctl.save);
        if (ok) ctx.store = await refreshStore();
      },
    }, "Save photo"),
    status,
  ]);
  card._photo = p;
  return card;
}

export { getGalleries };
