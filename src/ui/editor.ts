// editor.ts: gallery editor, workflow builder, photo cards

import {
  getGalleries,
  getGalleryDetail,
  blobUrl,
  exifToForm,
  saveGallery,
  savePhotoAlt,
  saveExif,
  replacePhoto,
  setGalleryItemPosition,
  recordStore,
} from "../grain.js";
import { prepareAndUploadPhoto } from "./uploadUI.js";
import { fileToExifForm } from "../readExif.js";
import {
  resolvePhotoCapture,
  projectCaptureToExif,
  savePhotoCapture,
  saveGalleryDefaults,
  matchGear,
  instanceLabel,
  NS,
} from "../graycard.js";
import { previewBatch, applyBatch, RULE_PRESETS } from "../batch.js";
import { openRuleBuilder } from "./ruleBuilder.js";
import {
  STAGE_LABELS,
  MEDIUMS,
  buildWorkflowForPhoto,
  linkPhotoWorkflow,
  describeStage,
  getRunForPhoto,
  stepsFromTemplate,
  applyTemplateDefaults,
  templateFromSteps,
  saveTemplate,
  STAGE_PROCESS_KIND,
} from "../workflow.js";
import {
  el as createElement,
  field,
  $ as queryElement,
  withButton,
  openModal,
  inputField,
  toast,
  confirmModal,
  createOrderedStepEditor,
  isAdvanced,
  getVisionConfig,
  loadPhase,
} from "./dom.js";
import { distinctTerms, lookupGroundings, applyGroundings } from "../grounding.js";
import { locationField } from "./mapView.js";
import { imageAlt, lazyThumb } from "./lazy.js";
import { icon } from "./icons.js";
import { scopeGalleryRule } from "../../apps/web/src/views/galleries/batch-scope.ts";
import { createPhotoInspector } from "../../apps/web/src/views/galleries/photo-inspector.ts";
import { createFilterStackControl } from "./filterStack.js";

import { instanceSelect, shootSelect, refreshStore, openAddGear } from "./library.js";
import { buildProcessSessionForm, stageExtraFields } from "./processForms.js";
import { openInspector } from "./inspect.js";
import { gearThumb } from "../data/gearImage.js";
import type { WorkflowStageKind } from "@hypo/domain";
import { renderOn, type RecordStore } from "@hypo/store";

type GalleryDetail = Awaited<ReturnType<typeof getGalleryDetail>>;
type GalleryPhoto = GalleryDetail["photos"][number];
type EditorStore = Awaited<ReturnType<typeof refreshStore>>;
type VisionModule = typeof import("../vision.js");
type AnalysisResult = Awaited<ReturnType<VisionModule["analyzePhoto"]>>;
type ExifForm = ReturnType<typeof exifToForm>;
type ExifKey = keyof ExifForm;
type ExifValidator = (value: string) => true | string;
type WorkflowStep = {
  id?: string;
  kind: WorkflowStageKind;
  label?: string;
  description?: string;
  optional?: boolean;
  cardinality?: { min?: number; max?: number };
  sessionScope?: string;
  occurrence?: number;
  templateUri?: string;
  templateName?: string;
  templateConnections?: readonly {
    id: string;
    fromStep: string;
    toStep: string;
    label?: string;
  }[];
  inputs?: readonly { id: string; artifactKinds: readonly string[]; [key: string]: unknown }[];
  outputs?: readonly { id: string; artifactKinds: readonly string[]; [key: string]: unknown }[];
  processFields: Record<string, unknown>;
  stageFields: Record<string, unknown>;
  configured: boolean;
};
type GroundingCandidate = { id: string; label: string; description?: string };
type GroundingSelect = HTMLSelectElement & { _byId: Map<string, GroundingCandidate> };
type PhotoCard = HTMLDivElement & { _photo?: GalleryPhoto; _editor?: HTMLDivElement };
type StoredRecord = {
  uri: string;
  cid?: string | null;
  value: Record<string, any>;
  item?: { value?: Record<string, any> };
};
type CaptureRecord = NonNullable<Awaited<ReturnType<typeof savePhotoCapture>>>;
type WorkflowRun = ReturnType<typeof getRunForPhoto>;
type GearSuggestionMatch = {
  exifLabel: string;
  make: string;
  model: string;
  instances: Array<{ uri: string; label: string }>;
};

interface EditorContext {
  agent: Parameters<typeof getGalleryDetail>[0];
  did: string;
  store: EditorStore;
  detail: GalleryDetail;
  galleryUri: string;
  signals?: Pick<RecordStore, "collection" | "replaceRemote">;
  [key: string]: unknown;
}

export async function replacePhotoImage(
  agent: EditorContext["agent"],
  did: string,
  photo: GalleryPhoto["photo"],
  file: File,
): Promise<Awaited<ReturnType<typeof replacePhoto>>> {
  const { blob, aspectRatio } = await prepareAndUploadPhoto(agent, file);
  return replacePhoto(agent, did, photo, { blob, aspectRatio });
}

interface CardController {
  dirty: boolean;
  reveal?: () => void;
  save: (() => Promise<void>) | null;
}

type ElementAttributes = Record<string, unknown> & {
  onclick?: (event: MouseEvent) => unknown;
  onchange?: (event: Event) => unknown;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: ElementAttributes = {},
  children?: unknown,
): HTMLElementTagNameMap[K] {
  return createElement(tag, attributes, children as never) as HTMLElementTagNameMap[K];
}

function $<T extends Element = HTMLElement>(selector: string): T | null {
  return queryElement(selector) as T | null;
}

function eventElement(event: Event): Element {
  if (!(event.target instanceof Element)) throw new Error("Expected an element event target");
  return event.target;
}

function eventButton(event: Event): HTMLButtonElement {
  const target = event.currentTarget ?? event.target;
  if (!(target instanceof HTMLButtonElement)) throw new Error("Expected a button event target");
  return target;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EXIF_FIELDS: ReadonlyArray<{ key: ExifKey; label: string; placeholder?: string }> = [
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

let ctx: EditorContext;
let disposeEditorSignals = () => {};

export function renderEditorTemplatesOn(
  signals: Pick<RecordStore, "collection">,
  render: (records: ReturnType<RecordStore["collection"]>["value"]) => void,
): () => void {
  return renderOn(() => signals.collection(NS.workflow.template).value, render);
}

export function initEditor(context: EditorContext): void {
  disposeEditorSignals();
  ctx = context;
}

// A .card that collapses to just its title. Native <details>, starts collapsed;
// the whole header row is one tap target (mobile-first). Uses the global
// .collapse-card styles.
function collapseCard(title: string, children: Array<Node | string | null>): HTMLDetailsElement {
  return el("details", { class: "card collapse-card" }, [
    el("summary", { class: "collapse-summary" }, [
      el("h2", { style: "margin:0" }, title),
      el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄"),
    ]),
    ...children,
  ]);
}

// Serialize saves per editor and lock its inputs until the write settles.
function guardControllerSave(ctl: CardController, root: HTMLElement): void {
  const save = ctl.save;
  let pending: Promise<void> | undefined;
  ctl.save = () => {
    if (pending) return pending;
    const controls = [
      ...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>(
        "input,select,button,textarea",
      ),
    ];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    root.setAttribute("aria-busy", "true");
    pending = Promise.resolve()
      .then(() => save?.())
      .finally(() => {
        controls.forEach((control, index) => {
          control.disabled = disabled[index];
        });
        root.removeAttribute("aria-busy");
        pending = undefined;
      });
    return pending;
  };
}

// ---- per-photo dirty tracking + sticky save bar ----
let cardCtls: CardController[] = [];
let saveBarEl: HTMLDivElement | null = null,
  saveBarCount: HTMLSpanElement | null = null,
  saveAllBtn: HTMLButtonElement | null = null;

// ---- bulk selection ----
let selected = new Set<string>();
let selectionChanged = () => {};
let selectBarEl: HTMLDivElement | null = null,
  selectCount: HTMLSpanElement | null = null;
function refreshSelectBar(): void {
  selectionChanged();
  if (!selectBarEl) return;
  const n = selected.size;
  if (!n) {
    selectBarEl.setAttribute("hidden", "");
    return;
  }
  selectBarEl.removeAttribute("hidden");
  if (selectCount) selectCount.textContent = `${n} selected`;
}
function ensureSelectBar(): void {
  const view = $("#gallery-batch-tools");
  if (!view) return;
  if (!view.querySelector(".select-bar")) {
    selectCount = el("span", { class: "save-count" });
    selectBarEl = el("div", { class: "select-bar", hidden: "" }, [
      el("div", { class: "save-bar-inner" }, [
        selectCount,
        el("div", { class: "row" }, [
          el(
            "button",
            {
              class: "ghost small-btn",
              onclick: () => {
                selected.clear();
                document
                  .querySelectorAll<HTMLInputElement>(".photo-select")
                  .forEach((checkbox) => (checkbox.checked = false));
                refreshSelectBar();
              },
            },
            "Clear",
          ),
          el("button", { class: "ghost small-btn", onclick: openBulkAnalyze }, "Analyze and save…"),
          el("button", { onclick: openBulkGear }, "Set gear…"),
          el(
            "button",
            {
              class: "ghost small-btn",
              onclick: () => {
                const rules = $<HTMLDetailsElement>("#gallery-batch-rules");
                if (rules) {
                  rules.open = !rules.open;
                  rules.querySelector<HTMLElement>("select")?.focus();
                }
              },
            },
            "Use a rule…",
          ),
        ]),
      ]),
    ]);
    view.prepend(selectBarEl);
  } else selectBarEl = view.querySelector(".select-bar");
  refreshSelectBar();
}
function requireSavedDrafts(action = "applying a batch operation"): boolean {
  if (!hasUnsavedChanges()) return true;
  toast(`Save your pending changes before ${action}.`, "info");
  return false;
}

function openGalleryGear(kind: string, prefill: { make?: string; model?: string } = {}): void {
  if (!requireSavedDrafts("adding gear")) return;
  openAddGear(kind, () => openGallery(ctx.galleryUri), prefill);
}

function openBulkGear(): void {
  if (!requireSavedDrafts()) return;
  const camSel = instanceSelect("camera", "");
  const backSel = instanceSelect("filmBack", "");
  const lensSel = instanceSelect("lens", "");
  const filterStack = createFilterStackControl(ctx.store.instance.filter || [], [], (item: StoredRecord) =>
    instanceLabel("filter", item.value, ctx.store),
  );
  const rollSel = instanceSelect("filmRoll", "");
  openModal(
    `Set gear on ${selected.size} photo${selected.size > 1 ? "s" : ""}`,
    [
      field("Camera", camSel),
      field("Film back", backSel),
      field("Lens", lensSel),
      field("Filter stack", filterStack.node),
      field("Film roll", rollSel),
    ],
    async () => {
      const patch: { camera?: string; filmBack?: string; lens?: string; filters?: string[]; filmRoll?: string } = {};
      if (camSel.value) patch.camera = camSel.value;
      if (backSel.value) patch.filmBack = backSel.value;
      if (lensSel.value) patch.lens = lensSel.value;
      if (filterStack.getSelected().length) patch.filters = filterStack.getSelected();
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
      selected.clear();
      refreshSelectBar();
      openGallery(ctx.galleryUri);
    },
    { saveLabel: "Apply and save" },
  );
}

// Bulk-analyze the selected photos with the connected provider. Each image is
// sent to the provider (cost-gated by a confirm), then alt text + a scene graph
// are written per photo; failures are counted, not fatal.
// After analysis, offer to link each detected type/relation to a Wikidata entity.
// Confident (unique exact) matches are pre-selected; the user can pick a better
// one or keep it as plain text, and "Keep as text" leaves everything ungrounded.
// Resolves with the (possibly grounded) analysis result either way.
function openGroundingModal(result: AnalysisResult): Promise<AnalysisResult> {
  return new Promise<AnalysisResult>((resolve) => {
    const { nodes: nodeTerms, edges: edgeTerms } = distinctTerms(result);
    if (!nodeTerms.length && !edgeTerms.length) {
      resolve(result);
      return;
    }

    const bodyEl = el("div", {}, [el("p", { class: "muted small" }, "Looking up Wikidata…")]);
    const actions = el("div", { class: "row modal-actions" });
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el(
      "div",
      { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "Link terms to Wikidata" },
      [
        el("h2", {}, "Link terms to Wikidata"),
        el(
          "p",
          { class: "muted small" },
          "Ground each detected type to a Wikidata entity so it becomes a reusable ontology node, pick a better match, or keep it as plain text. Skip to keep everything as text.",
        ),
        bodyEl,
        actions,
      ],
    );
    const settle = (resolved: AnalysisResult): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(resolved);
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(result);
      }
    }
    overlay.append(modal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) settle(result);
    });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);

    Promise.all([lookupGroundings(nodeTerms), lookupGroundings(edgeTerms)]).then(([nLook, eLook]) => {
      const selects: Record<"node" | "edge", Map<string, GroundingSelect>> = {
        node: new Map(),
        edge: new Map(),
      };
      const section = (
        title: string,
        terms: string[],
        look: Map<string, { candidates: GroundingCandidate[]; suggested: GroundingCandidate | null }>,
        bucket: "node" | "edge",
      ): HTMLDivElement | null => {
        if (!terms.length) return null;
        const rows = terms.map((text) => {
          const { candidates, suggested } = look.get(text) || { candidates: [], suggested: null };
          const sel = el("select", {}, [
            ...candidates.map((c) =>
              el("option", { value: c.id }, `${c.label}${c.description ? ` — ${c.description}` : ""} (${c.id})`),
            ),
            el("option", { value: "" }, "Keep as text"),
          ]) as GroundingSelect;
          sel.value = suggested ? suggested.id : "";
          sel._byId = new Map(candidates.map((c) => [c.id, c]));
          selects[bucket].set(text, sel);
          return el("label", { class: "field" }, [
            el("span", {}, `${text}${suggested ? "  ✓ match" : candidates.length ? "  ?" : "  (no match)"}`),
            sel,
          ]);
        });
        return el("div", {}, [el("h3", { class: "modal-sub" }, title), ...rows]);
      };
      const sections = [
        section("Objects", nodeTerms, nLook, "node"),
        section("Relations", edgeTerms, eLook, "edge"),
      ].filter((node): node is HTMLDivElement => node !== null);
      bodyEl.replaceChildren(...sections);
      const collect = (bucket: "node" | "edge"): Map<string, Pick<GroundingCandidate, "id" | "label">> => {
        const m = new Map<string, Pick<GroundingCandidate, "id" | "label">>();
        for (const [text, sel] of selects[bucket]) {
          const c = sel.value && sel._byId.get(sel.value);
          if (c) m.set(text, { id: c.id, label: c.label });
        }
        return m;
      };
      actions.replaceChildren(
        el(
          "button",
          { onclick: () => settle(applyGroundings(result, collect("node"), collect("edge"))) },
          "Apply groundings",
        ),
        el("button", { class: "ghost", onclick: () => settle(result) }, "Keep as text"),
      );
      (modal.querySelector("select") || modal).focus();
    });
  });
}

const analyzeAndSaveWithProgress = async (
  agent: EditorContext["agent"],
  did: string,
  photo: GalleryPhoto["photo"],
  config: ReturnType<typeof getVisionConfig>,
  options: { autoGround?: boolean; onProgress?: (message: string) => void },
): Promise<Awaited<ReturnType<VisionModule["analyzeAndSave"]>>> => {
  const { analyzeAndSave } = await import("../vision.js");
  return analyzeAndSave(agent, did, photo, config, options);
};

let bulkAnalyzing = false;
async function openBulkAnalyze(): Promise<void> {
  if (bulkAnalyzing || !requireSavedDrafts()) return;
  const cfg = getVisionConfig();
  if (!cfg?.apiKey) {
    toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000);
    return;
  }
  const n = selected.size;
  if (!n) return;
  const { getProvider } = await import("../vision.js");
  const provider = getProvider(cfg);
  const ok = await confirmModal(
    `Analyze ${n} photo${n > 1 ? "s" : ""} with ${provider.label}? Each image is sent to the provider and may incur cost. This replaces any existing scene graph.`,
    { confirmLabel: "Analyze and save", danger: false },
  );
  if (!ok) return;

  bulkAnalyzing = true;
  const uris = [...selected];
  let done = 0,
    failed = 0,
    skipped = 0,
    processed = 0;
  const dismiss = toast(`Photo 0 / ${n} · starting…`, "info", 3_600_000);
  const label = (msg: string): void => dismiss.update?.(msg);
  try {
    for (const uri of uris) {
      const i = processed + 1;
      const p = ctx.detail.photos.find((x) => x.photo.uri === uri);
      if (!p?.photo?.value) {
        skipped++;
        processed++;
        label(`Photo ${processed} / ${n} · skipped (no image)`);
        continue;
      }
      label(`Photo ${i} / ${n} · starting…`);
      try {
        await analyzeAndSaveWithProgress(ctx.agent, ctx.did, p.photo, cfg, {
          autoGround: true,
          onProgress: (msg: string) => label(`Photo ${i} / ${n} · ${msg}`),
        });
        done++;
      } catch {
        failed++;
      }
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
  selected.clear();
  refreshSelectBar();
  openGallery(ctx.galleryUri);
}

export function hasUnsavedChanges(): boolean {
  const editorVisible = !$("#editor-view")?.classList.contains("hidden");
  return editorVisible && cardCtls.some((c) => c.dirty);
}

function refreshSaveBar(): void {
  if (!saveBarEl) return;
  const n = cardCtls.filter((c) => c.dirty).length;
  if (n === 0) {
    saveBarEl.setAttribute("hidden", "");
    return;
  }
  saveBarEl.removeAttribute("hidden");
  if (saveBarCount) saveBarCount.textContent = `${n} unsaved ${n === 1 ? "edit" : "edits"}`;
}

export async function saveAllDirty(): Promise<void> {
  await saveAll();
}

async function saveAll(): Promise<void> {
  const dirty = cardCtls.filter((c) => c.dirty);
  if (!dirty.length || saveAllBtn?.disabled) return;
  const saveButton = saveAllBtn;
  if (!saveButton) throw new Error("Save controls are unavailable");
  saveButton.disabled = true;
  const total = dirty.length;
  let done = 0,
    failed = 0;
  saveButton.textContent = `Saving 0 / ${total}…`;
  for (const c of dirty) {
    try {
      if (!c.save) throw new Error("Photo save control is unavailable");
      await c.save();
      done++;
    } catch {
      if (!failed) c.reveal?.();
      failed++;
    }
    saveButton.textContent = `Saving ${done + failed} / ${total}…`;
    refreshSaveBar();
  }
  saveButton.disabled = false;
  saveButton.textContent = "Save changes";
  ctx.store = await refreshStore();
  toast(
    failed ? `Saved ${done}, ${failed} failed` : `Saved ${done} ${done === 1 ? "edit" : "edits"}`,
    failed ? "err" : "ok",
  );
  refreshSaveBar();
}

function ensureSaveBar(): void {
  const view = $("#editor-view");
  if (!view) return;
  if (!view.querySelector(".save-bar")) {
    saveBarCount = el("span", { class: "save-count" });
    saveAllBtn = el("button", { onclick: saveAll }, "Save changes");
    saveBarEl = el("div", { class: "save-bar", hidden: "" }, [
      el("div", { class: "save-bar-inner" }, [saveBarCount, saveAllBtn]),
    ]);
    view.append(saveBarEl);
  } else {
    saveBarEl = view.querySelector(".save-bar");
  }
  refreshSaveBar();
}

function skeletonCards(n: number): HTMLDivElement[] {
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

function galleryCoverageSummary(): string {
  const photos = ctx.detail.photos;
  const nWf = photos.filter((p) => ctx.store.photoWorkflowByPhoto.has(p.photo.uri)).length;
  const nScene = photos.filter((p) => ctx.store.sceneGraphByPhoto?.has(p.photo.uri)).length;
  const nAlt = photos.filter((p) => p.photo?.value?.alt).length;
  return [
    nWf && `${nWf} workflow${nWf > 1 ? "s" : ""}`,
    nScene && `${nScene} scene graph${nScene > 1 ? "s" : ""}`,
    nAlt && `${nAlt} with alt text`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function coverageBadges(p: GalleryPhoto, capture: CaptureRecord | undefined, wf: WorkflowRun): HTMLDivElement | null {
  const items = [
    ["exif", !!p.exif],
    [
      "capture",
      !!(
        capture &&
        (capture.value.camera ||
          capture.value.filmBack ||
          capture.value.lens ||
          capture.value.filmRoll ||
          capture.value.shoot)
      ),
    ],
    ["workflow", !!wf?.run],
    ["scene", !!ctx.store.sceneGraphByPhoto?.has(p.photo.uri)],
    ["alt", !!p.photo?.value?.alt],
  ].filter(([, on]) => on);
  if (!items.length) return null;
  return el(
    "div",
    { class: "badge-row" },
    items.map(([label]) => el("span", { class: "badge" }, label)),
  );
}

function gearField(labelText: string, kind: string, sel: HTMLSelectElement): HTMLLabelElement {
  const { thumb, refresh } = gearThumb(ctx.agent, ctx.did, ctx.store, kind, () =>
    sel.value ? ctx.store.byUri.get(sel.value)?.item?.value : null,
  );
  sel.addEventListener("change", refresh);
  refresh();
  return el("label", { class: "field" }, [
    el("span", {}, labelText),
    el("div", { class: "row gear-select" }, [thumb, sel]),
  ]);
}

function exifReadout(form: ExifForm): HTMLDivElement {
  const cell = (pre: string, val: string, post = ""): HTMLSpanElement =>
    el("span", val ? {} : { class: "rd-dim" }, `${pre}${val || "-"}${val ? post : ""}`);
  return el("div", { class: "exif-readout mono" }, [
    cell("ƒ", form.fNumber),
    cell("", form.exposureTime, "s"),
    cell("ISO ", form.iSO),
    cell("", form.focalLengthIn35mmFormat, "mm"),
  ]);
}

const EXIF_VALIDATORS: Partial<Record<ExifKey, ExifValidator>> = {
  fNumber: (v: string) => /^\d+(\.\d+)?$/.test(v) || "number, e.g. 2.8",
  exposureTime: (v: string) => /^\d+(\.\d+)?$/.test(v) || /^\d+\/\d+$/.test(v) || "e.g. 1/125 or 0.5",
  iSO: (v: string) => /^\d+$/.test(v) || "whole number",
  focalLengthIn35mmFormat: (v: string) => /^\d+(\.\d+)?$/.test(v) || "mm, e.g. 50",
  dateTimeOriginal: (v: string) => !Number.isNaN(Date.parse(v)) || "ISO 8601 date",
};

export async function openGallery(galleryUri: string): Promise<void> {
  disposeEditorSignals();
  disposeEditorSignals = () => {};
  ctx.galleryUri = galleryUri;
  cardCtls = [];
  selected = new Set();
  selectionChanged = () => {};
  const body = $("#editor-body");
  if (!body) throw new Error("Editor body is unavailable");
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
  const galleryHeader = buildGalleryHeader();
  body.append(galleryHeader);
  const galleryTools = el("div", { class: "gallery-tools" }, [
    galleryHeader.querySelector("details"),
    buildDefaultsCard(),
  ]);
  galleryHeader.append(galleryTools);
  const workflowMount = el("div", { "data-editor-section": "workflow-templates" });
  galleryTools.append(workflowMount);
  const signals = ctx.signals || recordStore(ctx.did);
  signals.replaceRemote(NS.workflow.template, ctx.store.workflowTemplates || []);
  disposeEditorSignals = renderEditorTemplatesOn(signals, (records) => {
    ctx.store.workflowTemplates = [...records.values()] as typeof ctx.store.workflowTemplates;
    workflowMount.replaceChildren(buildWorkflowBuilderCard());
  });
  const photos = ctx.detail.photos;
  const photosWrap = el("div", { id: "photos" });
  let gridMode = true;
  try {
    gridMode = localStorage.getItem("hypo:photoview") !== "list";
  } catch {
    /* ignore */
  }
  if (gridMode) photosWrap.classList.add("grid-mode");
  const listSeg = el("button", { class: "small-btn", title: "List view", "aria-label": "List view" }, [icon("list")]);
  const gridSeg = el("button", { class: "small-btn", title: "Grid view", "aria-label": "Grid view" }, [icon("grid")]);
  const setMode = (g: boolean): void => {
    photosWrap.classList.toggle("grid-mode", g);
    try {
      localStorage.setItem("hypo:photoview", g ? "grid" : "list");
    } catch {
      /* ignore */
    }
    listSeg.classList.toggle("active", !g);
    gridSeg.classList.toggle("active", g);
    listSeg.setAttribute("aria-pressed", String(!g));
    gridSeg.setAttribute("aria-pressed", String(g));
  };
  listSeg.addEventListener("click", () => setMode(false));
  gridSeg.addEventListener("click", () => setMode(true));
  const reorder = el(
    "button",
    {
      class: "ghost small-btn",
      "aria-pressed": "false",
      onclick: () => {
        const enabled = photosWrap.classList.toggle("reordering");
        reorder.setAttribute("aria-pressed", String(enabled));
      },
    },
    "Reorder",
  );
  const selectAll = el(
    "button",
    {
      class: "ghost small-btn",
      onclick: () => {
        photosWrap.querySelectorAll<HTMLInputElement>(".photo-select").forEach((checkbox) => {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("change"));
        });
      },
    },
    "Select all",
  );
  body.append(
    el("div", { class: "row between section-head" }, [
      el("h2", { class: "section" }, `Photos (${photos.length})`),
      el("div", { class: "row" }, [
        el("span", { class: "mono muted small", id: "gallery-coverage-summary" }, galleryCoverageSummary()),
        selectAll,
        reorder,
        el("div", { class: "segmented", role: "group", "aria-label": "Photo layout" }, [listSeg, gridSeg]),
      ]),
    ]),
  );
  const cards = photos.map((p, i) => buildPhotoCard(p, i));
  cards.forEach((card) => photosWrap.append(card));
  const inspector = createPhotoInspector(
    photosWrap,
    cards.map((card) => ({
      card,
      fields: card._editor!,
      control: card.querySelector<HTMLElement>("[data-grid-photo-control]")!,
    })),
  );
  galleryHeader.addEventListener("reveal-gallery-settings", () => inspector.close(false));
  const rules = buildBatchCard();
  rules.id = "gallery-batch-rules";
  rules.hidden = true;
  const batchTools = el("div", { id: "gallery-batch-tools" }, [rules]);
  selectionChanged = () => {
    rules.hidden = selected.size === 0;
    rules.open = false;
    rules.querySelector(".batch-preview")!.textContent = "Preview batch changes.";
    rules.querySelector("summary h2")!.textContent = `Batch edit (${selected.size} selected)`;
  };
  body.append(batchTools);
  setMode(gridMode);
  wireReorder(photosWrap);
  body.append(el("div", { class: "gallery-workspace" }, [photosWrap, inspector.node]));
  if (!photos.length) photosWrap.append(el("p", { class: "muted" }, "This gallery has no photos."));
  ensureSaveBar();
  ensureSelectBar();
  const hero = $("#editor-hero");
  if (hero) {
    hero.classList.add("hidden");
    hero.style.backgroundImage = "";
  }
}

function buildGalleryHeader(): HTMLDivElement {
  let gallery = ctx.detail.gallery;
  const title = el("h1", { class: "view-title gallery-title" }, gallery.value.title || "Untitled gallery");
  const titleInput = el("input", { type: "text", value: gallery.value.title || "" });
  const descInput = el("textarea", { rows: "3" }, gallery.value.description || "");
  const status = el("span", { class: "status", role: "status" });
  const ctl: CardController = { dirty: false, save: null };
  cardCtls.push(ctl);
  const markDirty = () => {
    ctl.dirty = true;
    status.className = "status";
    status.textContent = "Unsaved changes";
    refreshSaveBar();
  };
  titleInput.addEventListener("input", markDirty);
  descInput.addEventListener("input", markDirty);
  const details = collapseCard("Gallery details", [
    field("Title", titleInput),
    field("Description", descInput),
    el("div", { class: "row wrap" }, [
      el(
        "button",
        {
          onclick: async (event) => {
            await withButton(eventButton(event), status, () => ctl.save?.());
          },
        },
        "Save gallery details",
      ),
      el("button", { class: "ghost small-btn", onclick: () => openInspector(gallery) }, "Inspect record"),
      status,
    ]),
  ]);
  details.classList.add("gallery-details");
  ctl.reveal = () => {
    details.dispatchEvent(new Event("reveal-gallery-settings", { bubbles: true }));
    details.open = true;
    titleInput.focus();
  };
  ctl.save = async () => {
    if (!ctl.dirty) return;
    try {
      await saveGallery(ctx.agent, ctx.did, gallery, { title: titleInput.value, description: descInput.value });
      gallery = (await getGalleryDetail(ctx.agent, ctx.did, ctx.galleryUri)).gallery;
      ctx.detail.gallery = gallery;
      title.textContent = titleInput.value || "Untitled gallery";
      ctl.dirty = false;
      status.className = "status ok";
      status.textContent = "Saved";
      refreshSaveBar();
    } catch (error) {
      status.textContent = errorMessage(error);
      status.classList.add("err");
      throw error;
    }
  };
  guardControllerSave(ctl, details);
  return el("div", { class: "gallery-header" }, [
    el("div", { class: "view-head" }, [
      title,
      el(
        "p",
        { class: "view-sub muted small" },
        "Edits stay on this page until you save. Batch actions have a separate Apply and save step.",
      ),
    ]),
    details,
  ]);
}

function buildDefaultsCard(): HTMLDetailsElement {
  let defs = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri);
  const camSel = instanceSelect("camera", defs?.value?.camera);
  const backSel = instanceSelect("filmBack", defs?.value?.filmBack);
  const lensSel = instanceSelect("lens", defs?.value?.lens);
  const filterStack = createFilterStackControl(
    ctx.store.instance.filter || [],
    defs?.value?.filters || [],
    (item: StoredRecord) => instanceLabel("filter", item.value, ctx.store),
  );
  const rollSel = instanceSelect("filmRoll", defs?.value?.filmRoll);
  const shootSel = shootSelect(defs?.value?.shoot);
  const locF = locationField(defs?.value?.location);
  const status = el("span", { class: "status" });
  const ctl: CardController = { dirty: false, save: null };
  cardCtls.push(ctl);
  const card = collapseCard("Shared gear", [
    el(
      "p",
      { class: "muted small" },
      "Used where a photo has no value of its own. Save shared gear to update those photos.",
    ),
    field("Camera", camSel),
    field("Film back", backSel),
    field("Lens", lensSel),
    field("Filter stack", filterStack.node),
    field("Film roll", rollSel),
    field("Shoot", shootSel),
    field("Location", locF.node),
    el(
      "button",
      {
        class: "ghost",
        onclick: async (e) => {
          await withButton(eventButton(e), status, () => ctl.save?.());
        },
      },
      "Save shared gear",
    ),
    status,
  ]);
  card.classList.add("shared-gear");
  card.addEventListener("change", () => {
    ctl.dirty = true;
    status.className = "status";
    status.textContent = "Unsaved changes";
    refreshSaveBar();
  });
  ctl.reveal = () => {
    card.dispatchEvent(new Event("reveal-gallery-settings", { bubbles: true }));
    card.open = true;
    camSel.focus();
  };
  ctl.save = async () => {
    if (!ctl.dirty) return;
    try {
      await saveGalleryDefaults(
        ctx.agent,
        ctx.did,
        ctx.galleryUri,
        {
          camera: camSel.value || undefined,
          filmBack: backSel.value || undefined,
          lens: lensSel.value || undefined,
          filters: filterStack.getSelected(),
          filmRoll: rollSel.value || undefined,
          shoot: shootSel.value || undefined,
          location: locF.get(),
        },
        defs,
      );
      ctx.store = await refreshStore();
      defs = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri);
      ctl.dirty = false;
      status.className = "status ok";
      status.textContent = "Saved";
      document
        .querySelectorAll(".photo-fields")
        .forEach((fields) => fields.dispatchEvent(new Event("gallery-defaults-saved")));
      refreshSaveBar();
    } catch (error) {
      status.textContent = errorMessage(error);
      status.classList.add("err");
      throw error;
    }
  };
  guardControllerSave(ctl, card);
  return card;
}

type BatchRule = { id: string; name: string; when: any; actions: readonly any[] };
const openRuleBuilderWithSave = openRuleBuilder as unknown as (
  context: EditorContext,
  onDone: () => void,
  existing: unknown,
  onSave: (rule: BatchRule) => void,
) => void;

function buildBatchCard(): HTMLDetailsElement {
  const saved: BatchRule[] = (ctx.store.batchRules || [])
    .filter((r: StoredRecord) => !r.value.scope || ["gallery", "selection", "account"].includes(r.value.scope))
    .map((r: StoredRecord) => ({
      id: r.uri,
      name: r.value.name || "(rule)",
      when: r.value.when,
      actions: r.value.actions || [],
    }));
  const allRules: BatchRule[] = [...RULE_PRESETS, ...saved] as BatchRule[];
  const presetSel = el(
    "select",
    {},
    allRules.map((r) => el("option", { value: r.id }, r.name)),
  );
  const previewBox = el("pre", { class: "batch-preview muted" }, "Preview batch changes.");
  const status = el("span", { class: "status" });
  const scopedRule = () =>
    scopeGalleryRule(
      rule,
      ctx.detail.photos.map((photo) => photo.photo.uri),
      selected,
    );
  let rule = allRules[0];
  presetSel.onchange = () => {
    rule = allRules.find((r) => r.id === presetSel.value) || allRules[0];
    previewBox.textContent = "Preview batch changes.";
  };
  return collapseCard("Batch edit", [
    field("Rule", presetSel),
    el("div", { class: "row wrap" }, [
      el(
        "button",
        {
          class: "ghost",
          onclick: () => {
            try {
              const result = previewBatch(ctx.detail, ctx.store, scopedRule());
              previewBox.textContent = result.matched.length
                ? result.matched.map((m) => `#${m.index}: ${m.changes.map((c) => c.kind).join(", ")}`).join("\n")
                : "No matches.";
              if (result.galleryDescriptionChange) previewBox.textContent += "\nAlso updates the gallery description.";
            } catch (error) {
              previewBox.textContent = errorMessage(error);
            }
          },
        },
        "Preview",
      ),
      el(
        "button",
        {
          onclick: async (e) => {
            if (!selected.size || !requireSavedDrafts()) return;
            if (
              !(await confirmModal(
                `Apply and save this rule for matching photos in the selection (${selected.size} selected)?${rule.actions.some((action) => action.op === "setGalleryDescription") ? " This also updates the gallery description." : ""}`,
                { confirmLabel: "Apply and save", danger: false },
              ))
            )
              return;
            await withButton(eventButton(e), status, async () => {
              await applyBatch(
                ctx.agent,
                ctx.did,
                ctx.detail,
                ctx.store,
                scopedRule(),
                (done: number, total: number) => {
                  status.textContent = `Applying ${done} / ${total}…`;
                },
              );
              ctx.store = await refreshStore();
              openGallery(ctx.galleryUri);
            });
          },
        },
        "Apply and save",
      ),
      el(
        "button",
        {
          class: "ghost",
          onclick: () =>
            requireSavedDrafts("creating a rule") &&
            openRuleBuilderWithSave(
              ctx,
              () => openGallery(ctx.galleryUri),
              null,
              (savedRule: BatchRule) => {
                allRules.push(savedRule);
                presetSel.append(el("option", { value: savedRule.id }, savedRule.name));
              },
            ),
        },
        "Custom rule…",
      ),
      status,
    ]),
    previewBox,
  ]);
}

function openStepConfigModal(
  step: WorkflowStep,
  stepIndex: number,
  onSave: (step: WorkflowStep, index: number) => void,
): void {
  const processKind = STAGE_PROCESS_KIND[step.kind];
  const processStore = ctx.store as unknown as Parameters<typeof buildProcessSessionForm>[1];
  const processForm = processKind
    ? buildProcessSessionForm(processKind, processStore, step.processFields || {}, {
        signals: ctx.signals || recordStore(ctx.did),
      })
    : null;
  const extraForm = stageExtraFields(step.kind, processStore, step.stageFields || {});

  const nodes: HTMLElement[] = [];
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

  openModal(
    `Configure: ${STAGE_LABELS[step.kind] || step.kind}`,
    nodes,
    async () => {
      const processFields = processForm ? processForm.read() : {};
      const stageFields = extraForm.read();
      onSave({ ...step, processFields, stageFields, configured: true }, stepIndex);
    },
    { onClose: () => processForm?.dispose?.() },
  );
}

function compatibleStepsFromTemplate(template: StoredRecord): WorkflowStep[] {
  return applyTemplateDefaults(stepsFromTemplate(template), template) as WorkflowStep[];
}

function chooseTemplateOccurrences(template: StoredRecord, onChoose: (steps: WorkflowStep[]) => void): void {
  const templateSteps = compatibleStepsFromTemplate(template);
  const variable = templateSteps.filter(
    (step) => step.optional || step.cardinality?.min !== step.cardinality?.max || (step.cardinality?.max || 1) > 1,
  );
  if (!variable.length) {
    onChoose(templateSteps);
    return;
  }
  const fields = variable.map((step) => {
    const minimum = step.optional ? 0 : (step.cardinality?.min ?? 1);
    const maximum = step.cardinality?.max;
    const input = el("input", {
      type: "number",
      min: String(minimum),
      ...(maximum === undefined ? {} : { max: String(maximum) }),
      step: "1",
      value: String(minimum),
    });
    return { step, input, minimum, maximum };
  });
  openModal(
    `Use template: ${template.value.name || "Workflow"}`,
    [
      el(
        "p",
        { class: "muted" },
        "Choose how many times to include each optional or repeatable step. You can still reorder and configure the resulting steps.",
      ),
      ...fields.map(({ step, input, minimum, maximum }) =>
        field(
          `${step.label || STAGE_LABELS[step.kind] || step.kind} (${minimum}${maximum === undefined ? "+" : `–${maximum}`})`,
          input,
        ),
      ),
    ],
    async () => {
      const selected = new Map<string, number>();
      for (const { step, input, minimum, maximum } of fields) {
        const count = Number(input.value);
        if (!Number.isInteger(count) || count < minimum || (maximum !== undefined && count > maximum)) {
          throw new Error(
            `${step.label || STAGE_LABELS[step.kind] || step.kind} must be ${maximum === undefined ? `${minimum} or more` : `between ${minimum} and ${maximum}`}`,
          );
        }
        selected.set(step.id || `${step.kind}:${templateSteps.indexOf(step)}`, count);
      }
      const expanded: WorkflowStep[] = [];
      for (const step of templateSteps) {
        const key = step.id || `${step.kind}:${templateSteps.indexOf(step)}`;
        const count = selected.get(key) ?? 1;
        for (let occurrence = 1; occurrence <= count; occurrence += 1) {
          expanded.push({
            ...step,
            occurrence,
            processFields: { ...step.processFields },
            stageFields: { ...step.stageFields },
          });
        }
      }
      onChoose(expanded);
    },
  );
}

interface WorkflowStageProgress {
  readonly stepId?: string;
  readonly label: string;
  readonly complete: boolean;
  readonly state: "done" | "current" | "planned" | "blocked" | "failed" | "cancelled";
  readonly detail?: string;
}

function workflowStageProgress(wf: NonNullable<WorkflowRun>, store: EditorStore): WorkflowStageProgress[] {
  return wf.stages.map((stage) => {
    const label = describeStage(stage);
    const kind =
      String(stage.value.$type || "")
        .split("#")[1]
        ?.replace(/Stage$/, "") || "other";
    const sessionUri = stage.value.session;
    const session = typeof sessionUri === "string" ? store.byUri.get(sessionUri)?.item : undefined;
    const finishedAt = session?.value?.finishedAt || stage.value.completedAt || stage.value.temporal?.at;
    const explicitStatus = String(stage.value.status || "");
    const complete =
      ["completed", "skipped"].includes(explicitStatus) ||
      (!explicitStatus && kind === "capture") ||
      Boolean(finishedAt) ||
      (kind === "output" && Boolean(stage.value.target || stage.value.photo));
    const state: WorkflowStageProgress["state"] = complete
      ? "done"
      : explicitStatus === "in-progress" || explicitStatus === "ready"
        ? "current"
        : explicitStatus === "blocked"
          ? "blocked"
          : explicitStatus === "failed"
            ? "failed"
            : explicitStatus === "cancelled"
              ? "cancelled"
              : "planned";
    const detail = finishedAt
      ? `Finished ${new Date(finishedAt).toLocaleDateString()}`
      : session
        ? "Session ready"
        : stage.value.notes || undefined;
    return {
      stepId: typeof stage.value.templateStepId === "string" ? stage.value.templateStepId : undefined,
      label,
      complete,
      state,
      detail,
    };
  });
}

function readyWorkflowIndexes(
  states: readonly WorkflowStageProgress[],
  wf: NonNullable<WorkflowRun>,
  store: EditorStore,
): number[] {
  const branches = wf.run?.value?.branches;
  const graphTopology = wf.run?.value?.topology === "graph";
  if ((Array.isArray(branches) && branches.length) || graphTopology) {
    const stageIndex = new Map(wf.stages.map((stage, index) => [stage.uri, index]));
    const incoming = new Map<number, number[]>();
    for (const branch of branches) {
      const from = stageIndex.get(branch.fromStage);
      const to = stageIndex.get(branch.toStage);
      if (from === undefined || to === undefined) continue;
      const dependencies = incoming.get(to) || [];
      dependencies.push(from);
      incoming.set(to, dependencies);
    }
    return states.flatMap((state, index) => {
      if (state.complete) return [];
      const dependencies = incoming.get(index);
      if (dependencies) return dependencies.every((dependency) => states[dependency]?.complete) ? [index] : [];
      return graphTopology || index === 0 || states[index - 1]?.complete ? [index] : [];
    });
  }
  const templateUri = wf.run?.value?.template;
  const template =
    typeof templateUri === "string"
      ? store.workflowTemplates?.find((record: StoredRecord) => record.uri === templateUri)
      : undefined;
  const connections = template?.value?.connections;
  if (!Array.isArray(connections) || !connections.length || !states.every((state) => state.stepId)) {
    const index = states.findIndex((state) => !state.complete);
    return index < 0 ? [] : [index];
  }
  const completeIds = new Set(states.filter((state) => state.complete).map((state) => state.stepId));
  return states.flatMap((state, index) => {
    if (state.complete || !state.stepId) return [];
    const incoming = connections.filter((connection: Record<string, unknown>) => connection.toStep === state.stepId);
    return incoming.every((connection: Record<string, unknown>) => completeIds.has(connection.fromStep as string))
      ? [index]
      : [];
  });
}

function focusWorkflowBuilder(): void {
  const builder = document.querySelector<HTMLElement>('[data-editor-section="workflow-templates"] details');
  builder?.dispatchEvent(new Event("reveal-gallery-settings", { bubbles: true }));
  if (builder instanceof HTMLDetailsElement) builder.open = true;
  builder?.scrollIntoView({ block: "center", behavior: "smooth" });
  builder?.querySelector<HTMLElement>("select,button")?.focus();
}

function photoWorkflowSummary(wf: WorkflowRun, store: EditorStore): HTMLElement {
  if (!wf?.stages?.length) {
    return el(
      "button",
      {
        type: "button",
        class: "workflow-empty-link mono small",
        onclick: focusWorkflowBuilder,
      },
      "No workflow · Add one",
    );
  }
  const states = workflowStageProgress(wf, store);
  const completed = states.filter((state) => state.complete).length;
  const readyIndexes = readyWorkflowIndexes(states, wf, store);
  const readySet = new Set(readyIndexes);
  const next = readyIndexes.map((index) => states[index]);
  const runStatus = typeof wf.run?.value?.status === "string" ? wf.run.value.status : null;
  const summaryText = next.length
    ? `${completed}/${states.length} · Next: ${next.map((state) => state.label).join(" + ")}`
    : `${completed}/${states.length} · Complete`;
  const detail = el("details", { class: "photo-workflow-summary" }, [
    el("summary", { "aria-label": `Workflow details, ${summaryText}` }, [
      el("span", { class: "workflow-summary-label" }, "Workflow"),
      el("span", { class: "mono small" }, summaryText),
    ]),
    el(
      "ol",
      { class: "photo-workflow-stages" },
      states.map((state, index) =>
        el("li", { class: state.complete ? "complete" : readySet.has(index) ? `next ${state.state}` : state.state }, [
          el(
            "span",
            { class: "workflow-stage-state", "aria-hidden": "true" },
            state.complete ? "✓" : readySet.has(index) ? "→" : "·",
          ),
          el("span", {}, [
            el("strong", {}, state.label),
            state.detail ? el("span", { class: "muted small" }, state.detail) : null,
          ]),
          el(
            "span",
            { class: "muted small" },
            state.complete
              ? "Done"
              : state.state === "current"
                ? "Current"
                : state.state === "blocked"
                  ? "Blocked"
                  : state.state === "failed"
                    ? "Failed"
                    : state.state === "cancelled"
                      ? "Cancelled"
                      : readySet.has(index)
                        ? "Next"
                        : "Planned",
          ),
        ]),
      ),
    ),
    wf.run?.value?.branches?.length
      ? el(
          "p",
          { class: "muted small workflow-branch-note" },
          `${wf.run.value.branches.length + 1} output paths in this workflow`,
        )
      : null,
    runStatus
      ? el("p", { class: "muted small workflow-run-status" }, `Run status: ${runStatus.replaceAll("-", " ")}`)
      : null,
  ]);
  return detail;
}

function buildWorkflowBuilderCard(): HTMLDetailsElement {
  const mediumSel = el(
    "select",
    {},
    MEDIUMS.map((m) => el("option", { value: m }, m)),
  );
  mediumSel.value = "film";
  const templateSel = el("select", {}, [
    el("option", { value: "" }, "Load a template…"),
    ...(ctx.store.workflowTemplates || []).map((t: StoredRecord) => el("option", { value: t.uri }, t.value.name)),
  ]);
  const status = el("span", { class: "status" });

  const stageKinds: WorkflowStageKind[] = [
    "capture",
    "develop",
    "digitize",
    "digital",
    "print",
    "edit",
    "output",
    "other",
  ];
  const stepEditor = createOrderedStepEditor<WorkflowStep>({
    label: "Gallery workflow steps",
    options: stageKinds.map((kind) => ({ kind, label: STAGE_LABELS[kind] })),
    getKind: (step) => step.kind,
    configured: (step) => step.configured,
    summary: (step) => {
      const configured = Object.keys(step.processFields).length + Object.keys(step.stageFields).length;
      return (
        [
          step.label,
          step.optional ? "optional" : null,
          step.occurrence && step.occurrence > 1 ? `occurrence ${step.occurrence}` : null,
          configured ? `${configured} saved setting${configured === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    },
    create: (kind) => ({
      kind: kind as WorkflowStageKind,
      processFields: {},
      stageFields: {},
      configured: false,
    }),
    clone: (step) => ({
      ...step,
      id: undefined,
      processFields: { ...step.processFields },
      stageFields: { ...step.stageFields },
    }),
    onConfigure: (step, index, replace) => openStepConfigModal(step, index, replace),
    emptyText: "Add a step or load one of your templates.",
  });

  templateSel.onchange = () => {
    const t = ctx.store.workflowTemplates.find((x: StoredRecord) => x.uri === templateSel.value);
    if (!t) return;
    chooseTemplateOccurrences(t, (loaded) => {
      stepEditor.replace(
        loaded.map((step) => ({
          ...step,
          templateUri: t.uri,
          templateName: t.value.name,
          templateConnections: Array.isArray(t.value.connections) ? t.value.connections : undefined,
        })),
        `Loaded ${t.value.name || "workflow template"}.`,
      );
      mediumSel.value = t.value.medium || "film";
    });
  };

  function refreshTemplateOptions() {
    const cur = templateSel.value;
    templateSel.replaceChildren(
      el("option", { value: "" }, "Load a template…"),
      ...(ctx.store.workflowTemplates || []).map((t: StoredRecord) => el("option", { value: t.uri }, t.value.name)),
    );
    templateSel.value = cur;
  }

  async function saveWorkflow(photos: GalleryPhoto[], label: string): Promise<void> {
    if (hasUnsavedChanges()) throw new Error("Save your pending changes before applying a workflow.");
    if (!photos.length) throw new Error("Gallery has no photos");
    const steps = stepEditor.getItems();
    if (!steps.length) throw new Error("Add at least one workflow step");
    const sharedSessions = new Map<string, string>();
    for (const p of photos) {
      const photoUri = p.photo?.uri;
      if (!photoUri) continue;
      const existingLink = ctx.store.photoWorkflowByPhoto.get(photoUri);
      const runUri = await buildWorkflowForPhoto(
        ctx.agent,
        ctx.did,
        photoUri,
        mediumSel.value,
        steps,
        ctx.store,
        ctx.galleryUri,
        sharedSessions,
      );
      await linkPhotoWorkflow(ctx.agent, ctx.did, photoUri, runUri, existingLink || null);
    }
    ctx.store = await refreshStore();
    openGallery(ctx.galleryUri);
    status.textContent = label;
    status.classList.add("ok");
  }

  return collapseCard("Workflow builder", [
    el(
      "p",
      { class: "muted small" },
      "Add stages, configure process sessions, save to photos, or save as a reusable template.",
    ),
    field("Load template", templateSel),
    field("Medium", mediumSel),
    el(
      "p",
      { class: "muted small" },
      "Steps run from top to bottom. Repeat a step for test strips, baths, edits, prints, or exports.",
    ),
    stepEditor.node,
    el("div", { class: "row wrap" }, [
      el(
        "button",
        {
          onclick: async (e) => {
            await withButton(eventButton(e), status, async () => {
              await saveWorkflow([ctx.detail.photos[0]], "Saved for photo #1 ✓");
            });
          },
        },
        "Save for photo #1",
      ),
      el(
        "button",
        {
          class: "ghost",
          onclick: async (e) => {
            await withButton(eventButton(e), status, async () => {
              await saveWorkflow(ctx.detail.photos, `Applied to ${ctx.detail.photos.length} photos ✓`);
            });
          },
        },
        "Apply and save for all photos",
      ),
      el(
        "button",
        {
          class: "ghost",
          onclick: () => {
            const { wrap, input } = inputField("Template name", "name", "");
            openModal("Save as template", [wrap], async () => {
              const name = input.value.trim();
              if (!name) throw new Error("Name required");
              const steps = stepEditor.getItems();
              if (!steps.length) throw new Error("Add at least one workflow step");
              // A concrete run may contain multiple occurrences of one template
              // step. A newly saved template gets fresh stable IDs for each row.
              const payload = templateFromSteps(
                name,
                mediumSel.value,
                steps.map((step) => ({ ...step, id: undefined, occurrence: undefined })),
              );
              await saveTemplate(ctx.agent, ctx.did, payload, null);
              ctx.store = await refreshStore();
              refreshTemplateOptions();
            });
          },
        },
        "Save as template",
      ),
      status,
    ]),
  ]);
}

// A live "we think this is <gear>" hint built from the photo's EXIF, that fills
// the matching select in one tap, and copes with several copies of one model.
function gearSuggestion(
  kind: "camera" | "lens",
  match: GearSuggestionMatch | null,
  sel: HTMLSelectElement,
  markDirty: () => void,
): HTMLDivElement | null {
  if (!match || !match.exifLabel) return null;
  const suggestion = match;
  const wrap = el("div", { class: "gear-suggest" });
  const pick = (uri: string): void => {
    sel.value = uri;
    sel.dispatchEvent(new Event("change"));
    markDirty();
    render();
  };
  function render(): void {
    wrap.replaceChildren();
    if (sel.value) return; // already resolved; stay quiet
    const insts = suggestion.instances;
    if (insts.length === 1) {
      wrap.append(
        icon("check", 14),
        el("span", { class: "small" }, `Looks like ${suggestion.exifLabel}`),
        el("button", { class: "ghost small-btn", onclick: () => pick(insts[0].uri) }, `Use ${insts[0].label}`),
      );
    } else if (insts.length > 1) {
      wrap.append(
        el("span", { class: "small" }, `${suggestion.exifLabel}: which copy?`),
        ...insts.map((it: { uri: string; label: string }) =>
          el("button", { class: "ghost small-btn", onclick: () => pick(it.uri) }, it.label),
        ),
      );
    } else {
      wrap.append(
        el("span", { class: "small muted" }, `${suggestion.exifLabel} isn't in your setup`),
        el(
          "button",
          {
            class: "ghost small-btn",
            onclick: () =>
              openGalleryGear(kind, {
                make: suggestion.make,
                model: suggestion.model,
              }),
          },
          "Add it",
        ),
      );
    }
  }
  render();
  sel.addEventListener("change", render);
  return wrap;
}

// -- gallery photo reordering (drag handle + up/down, mobile-first) -----------

// Renumber the contact sheet immediately; the save controller persists the order.
function stageOrder(container: HTMLDivElement): void {
  [...container.children].forEach((element, index) => {
    if (!(element instanceof HTMLDivElement) || !("_photo" in element)) return;
    const num = element.querySelector(".photo-meta > div:first-child");
    if (num) num.textContent = `#${index + 1}`;
    element.dataset.frame = String(index + 1);
  });
  container.dispatchEvent(new Event("photo-order-changed"));
}

function moveCard(container: HTMLDivElement, card: PhotoCard, dir: -1 | 1): void {
  if (dir < 0) {
    const prev = card.previousElementSibling;
    if (prev?.classList.contains("photo-card")) container.insertBefore(card, prev);
  } else {
    const next = card.nextElementSibling;
    if (next?.classList.contains("photo-card")) container.insertBefore(next, card);
  }
  card.scrollIntoView({ block: "nearest" });
  stageOrder(container);
}

function wireReorder(container: HTMLDivElement): void {
  const cards = () =>
    [...container.children].filter(
      (element): element is PhotoCard => element instanceof HTMLDivElement && "_photo" in element,
    );
  const ctl: CardController = {
    dirty: false,
    save: null,
    reveal: () => container.querySelector<HTMLElement>("[data-grid-photo-control]")?.focus(),
  };
  cardCtls.push(ctl);
  container.addEventListener("photo-order-changed", () => {
    ctl.dirty = cards().some((card, index) => card._photo?.item?.value.position !== index);
    refreshSaveBar();
  });
  ctl.save = async () => {
    for (const [index, card] of cards().entries()) {
      const item = card._photo?.item;
      if (!item || item.value.position === index) continue;
      const cid = await setGalleryItemPosition(ctx.agent, ctx.did, item, index);
      item.value.position = index;
      if (cid) item.cid = cid;
    }
    ctx.detail.photos = cards().map((card) => card._photo!);
    ctl.dirty = false;
    refreshSaveBar();
  };
  guardControllerSave(ctl, container);
  container.addEventListener("click", (e) => {
    const target = eventElement(e);
    const card = target.closest<HTMLDivElement>(".photo-card") as PhotoCard | null;
    if (!card) return;
    if (target.closest(".move-up")) moveCard(container, card, -1);
    else if (target.closest(".move-down")) moveCard(container, card, 1);
  });
  container.addEventListener("pointerdown", (e) => {
    const handle = eventElement(e).closest(".drag-handle");
    if (!handle) return;
    e.preventDefault();
    const card = handle.closest<HTMLDivElement>(".photo-card") as PhotoCard | null;
    if (!card) return;
    card.classList.add("dragging");
    const move = (ev: PointerEvent): void => {
      const others = [...container.querySelectorAll<HTMLDivElement>(".photo-card:not(.dragging)")];
      let before: HTMLDivElement | null = null;
      for (const c of others) {
        const r = c.getBoundingClientRect();
        const beforeCard = container.classList.contains("grid-mode")
          ? ev.clientY < r.top || (ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2)
          : ev.clientY < r.top + r.height / 2;
        if (beforeCard) {
          before = c;
          break;
        }
      }
      if (before) container.insertBefore(card, before);
      else container.append(card);
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      card.classList.remove("dragging");
      stageOrder(container);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

// copy the gear selections from the photo card directly above this one, so
// tagging a roll of same-gear frames is one tap each.
function sameGearAsAbove(card: PhotoCard): void {
  if (!card) {
    toast("Photo card is unavailable", "err");
    return;
  }
  const prev = card?.previousElementSibling;
  if (!(prev instanceof Element) || !prev.classList.contains("photo-card")) {
    toast("No photo above", "info");
    return;
  }
  const sel = (root: Element, label: string): HTMLSelectElement | null =>
    [...root.querySelectorAll<HTMLLabelElement>("label.field")]
      .find((l) => l.querySelector("span")?.textContent === label)
      ?.querySelector<HTMLSelectElement>("select") ?? null;
  let copied = 0;
  for (const label of ["Camera", "Film back", "Lens", "Film roll", "Shoot"]) {
    const from = sel((prev as PhotoCard)._editor || prev, label),
      to = sel(card._editor || card, label);
    if (from && to && from.value) {
      to.value = from.value;
      to.dispatchEvent(new Event("change"));
      copied++;
    }
  }
  const fromStack = ((prev as PhotoCard)._editor || prev).querySelector<HTMLElement>(".filter-stack-control");
  const toStack = (card._editor || card).querySelector<HTMLElement>(".filter-stack-control");
  if (fromStack && toStack) {
    const filters = JSON.parse(fromStack.dataset.selected || "[]");
    toStack.dispatchEvent(new CustomEvent("filter-stack-set", { detail: filters }));
    toStack.querySelector<HTMLInputElement>("input")?.dispatchEvent(new Event("change"));
    if (filters.length) copied++;
  }
  toast(copied ? "Copied gear from the photo above" : "The photo above has no gear set", copied ? "ok" : "info");
}

function reorderControl(): HTMLDivElement {
  return el("div", { class: "reorder" }, [
    el("button", { class: "drag-handle", type: "button", title: "Drag to reorder", "aria-label": "Drag to reorder" }, [
      icon("dots", 16),
    ]),
    el("button", { class: "ghost small-btn move-up", type: "button", title: "Move up", "aria-label": "Move up" }, "↑"),
    el(
      "button",
      { class: "ghost small-btn move-down", type: "button", title: "Move down", "aria-label": "Move down" },
      "↓",
    ),
  ]);
}

function buildPhotoCard(p: GalleryPhoto, idx: number): PhotoCard {
  const photoName = imageAlt(p.photo?.value?.alt, `Photo ${idx + 1}`);
  const thumb = lazyThumb(ctx.agent, ctx.did, p.photo?.value?.photo, "thumb", photoName);
  thumb.dataset.gridPhotoControl = "";
  thumb.dataset.gridPhotoLabel = photoName;

  let capture = ctx.store.photoCaptureByPhoto.get(p.photo.uri);
  const defaults = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri);
  const refs = resolvePhotoCapture(capture, defaults);
  const wf = getRunForPhoto(ctx.store, p.photo.uri);

  const camSel = instanceSelect("camera", refs.camera);
  const backSel = instanceSelect("filmBack", refs.filmBack);
  const lensSel = instanceSelect("lens", refs.lens);
  const filterStack = createFilterStackControl(ctx.store.instance.filter || [], refs.filters, (item: StoredRecord) =>
    instanceLabel("filter", item.value, ctx.store),
  );
  const rollSel = instanceSelect("filmRoll", refs.filmRoll);
  const shootSel = shootSelect(refs.shoot);
  const locF = locationField(capture?.value?.location);
  // frame position on the roll (photo.capture.frameIndex); optional, 1-based.
  const frameInput = el("input", {
    type: "number",
    min: "1",
    step: "1",
    placeholder: "Frame # on roll",
    value: capture?.value?.frameIndex ?? "",
  });

  const ctl: CardController = { dirty: false, save: null };
  const gearFieldsChanged = new Set<string>();
  const resetGearFields = new Set<string>();
  let gearDirty = false;
  let exifDirty = false;
  let altDirty = false;
  cardCtls.push(ctl);
  const markDirty = () => {
    status.className = "status";
    status.textContent = "Unsaved changes";
    if (!ctl.dirty) {
      ctl.dirty = true;
      refreshSaveBar();
    }
  };
  const markGearDirty = () => {
    gearDirty = true;
    markDirty();
  };
  const trackGear = (key: string) => {
    gearFieldsChanged.add(key);
    resetGearFields.delete(key);
    markGearDirty();
  };
  for (const [key, control] of Object.entries({
    camera: camSel,
    filmBack: backSel,
    lens: lensSel,
    filmRoll: rollSel,
    shoot: shootSel,
  })) {
    control.addEventListener("change", () => trackGear(key));
  }
  for (const input of filterStack.inputs) input.addEventListener("change", () => trackGear("filters"));
  frameInput.addEventListener("input", () => trackGear("frameIndex"));
  locF.node.addEventListener("change", () => trackGear("location"));

  let form = exifToForm(p.exif?.value);
  const gearMatch = matchGear(form, ctx.store);
  const exifInputs = {} as Record<ExifKey, HTMLInputElement>;
  const exifValidators: Array<() => boolean> = [];
  const exifGrid = el("div", { class: "exif-grid" });
  for (const f of EXIF_FIELDS) {
    const input = el("input", {
      type: "text",
      "aria-label": f.label,
      value: form[f.key] || "",
      placeholder: f.placeholder || "",
    });
    const hint = el("span", { class: "field-hint" });
    const validate = (): boolean => {
      const v = input.value.trim();
      const rule = EXIF_VALIDATORS[f.key];
      if (v && rule) {
        const r = rule(v);
        if (r !== true) {
          input.classList.add("invalid");
          input.setAttribute("aria-invalid", "true");
          hint.textContent = r;
          return false;
        }
      }
      input.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
      hint.textContent = "";
      return true;
    };
    input.addEventListener("input", () => {
      validate();
      exifDirty = true;
      markDirty();
    });
    exifInputs[f.key] = input;
    exifValidators.push(validate);
    exifGrid.append(el("label", { class: "field" }, [el("span", {}, f.label), input, hint]));
  }

  const status = el("span", { class: "status" });
  const wfSummary = photoWorkflowSummary(wf, ctx.store);
  const readoutHost = el("div", { class: "photo-readout" });
  const coverageHost = el("div", { class: "photo-coverage" }, [coverageBadges(p, capture, wf)]);
  const refreshReadout = () => {
    readoutHost.replaceChildren(exifReadout(form));
  };
  refreshReadout();

  const altArea = el(
    "textarea",
    { id: `photo-alt-${idx}`, rows: "2", "aria-label": "Alt text" },
    p.photo?.value?.alt || "",
  );
  altArea.addEventListener("input", () => {
    altDirty = true;
    markDirty();
  });

  const fileIn = el("input", {
    type: "file",
    accept: "image/*",
    class: "hidden",
    "aria-hidden": "true",
    tabindex: "-1",
  });
  fileIn.addEventListener("change", async () => {
    const file = fileIn.files?.[0];
    fileIn.value = "";
    if (!file || !p.photo?.value) return;
    if (ctl.dirty) {
      toast("Save this photo’s pending edits before replacing its image.", "info");
      return;
    }
    const decision = await confirmModal(
      "Replace this photo’s image? The gallery ID stays the same, and gear and workflows stay linked.",
      {
        confirmLabel: "Replace and save",
        danger: false,
        checks: [
          {
            key: "rereadExif",
            label: "Also re-read EXIF from the new file (overwrites current EXIF)",
            checked: false,
          },
        ],
      },
    );
    if (!decision || typeof decision === "boolean" || !decision.confirmed) return;
    const rereadExif = !!decision.checks?.rereadExif;
    status.className = "status";
    status.textContent = "Replacing…";
    try {
      const { cid, value } = await replacePhotoImage(ctx.agent, ctx.did, p.photo, file);
      p.photo.cid = cid;
      p.photo.value = value;
      try {
        const u = await blobUrl(ctx.agent, ctx.did, value.photo);
        thumb.replaceChildren(...(u ? [el("img", { src: u, alt: photoName })] : []));
        fields
          .querySelector(".inspector-preview")
          ?.replaceChildren(...(u ? [el("img", { src: u, alt: photoName })] : []));
      } catch {
        /* thumb refresh is best-effort */
      }

      if (rereadExif) {
        form = (await fileToExifForm(file)) as ExifForm;
        for (const f of EXIF_FIELDS) exifInputs[f.key].value = form[f.key] || "";
        exifValidators.forEach((v) => v());
        p.exif = await saveExif(ctx.agent, ctx.did, p.photo.uri, p.exif, form);
        refreshReadout();
      }

      status.classList.add("ok");
      status.textContent = rereadExif ? "Image replaced · EXIF re-read ✓" : "Image replaced ✓";
      toast(rereadExif ? "Photo replaced and EXIF updated" : "Photo replaced", "ok");
    } catch (err: unknown) {
      const msg = errorMessage(err);
      status.classList.add("err");
      status.textContent = `Error: ${msg}`;
      toast(msg, "err");
    }
  });

  ctl.save = async () => {
    if (!ctl.dirty) return;
    const valid = exifValidators.map((validate) => validate()).every(Boolean);
    if (exifDirty && !valid) {
      const invalid = exifGrid.querySelector<HTMLElement>(".invalid");
      invalid?.dispatchEvent(new Event("reveal-photo-field", { bubbles: true }));
      throw new Error("Some EXIF fields are invalid");
    }
    if (altDirty && p.photo?.value) {
      const photoCid = await savePhotoAlt(ctx.agent, ctx.did, p.photo, altArea.value);
      if (photoCid) p.photo.cid = photoCid;
      p.photo.value.alt = altArea.value;
    }
    const captureSaved = gearDirty
      ? await savePhotoCapture(
          ctx.agent,
          ctx.did,
          p.photo.uri,
          Object.fromEntries(
            Object.entries({
              camera: camSel.value || undefined,
              filmBack: backSel.value || undefined,
              lens: lensSel.value || undefined,
              filters: filterStack.getSelected(),
              filmRoll: rollSel.value || undefined,
              frameIndex: frameInput.value ? parseInt(frameInput.value, 10) : undefined,
              shoot: shootSel.value || undefined,
              location: locF.get(),
            })
              .filter(([key]) => gearFieldsChanged.has(key))
              .map(([key, value]) => [key, resetGearFields.has(key) ? undefined : value]),
          ),
          capture,
        )
      : null;
    if (captureSaved) {
      capture = captureSaved;
      ctx.store.photoCaptureByPhoto.set(p.photo.uri, captureSaved);
    }
    const formValues = {} as Record<ExifKey, string>;
    for (const f of EXIF_FIELDS) formValues[f.key] = exifInputs[f.key].value;
    if (exifDirty) {
      p.exif = await saveExif(ctx.agent, ctx.did, p.photo.uri, p.exif, formValues);
      form = formValues;
      refreshReadout();
    }
    gearFieldsChanged.clear();
    resetGearFields.clear();
    gearDirty = exifDirty = altDirty = false;
    ctl.dirty = false;
    status.className = "status ok";
    status.textContent = "Saved";
    const name = imageAlt(p.photo.value.alt, `Photo ${card.dataset.frame}`);
    card.querySelector(".photo-caption")!.textContent = p.photo.value.alt || "Missing alt text";
    thumb.dataset.gridPhotoLabel = name;
    thumb.setAttribute("aria-label", `Edit ${name}`);
    thumb.querySelector("img")?.setAttribute("alt", name);
    card.querySelector(".photo-select")?.setAttribute("aria-label", `Select ${name}`);
    coverageHost.replaceChildren(...[coverageBadges(p, capture, wf)].filter((node): node is HTMLDivElement => !!node));
    const galleryCoverage = document.getElementById("gallery-coverage-summary");
    if (galleryCoverage) galleryCoverage.textContent = galleryCoverageSummary();
    fields.dispatchEvent(new Event("gallery-defaults-saved"));
    refreshSaveBar();
  };

  const card = el("div", { class: "card photo-card reveal", style: `--i:${idx}`, "data-frame": String(idx + 1) }, [
    el("div", { class: "photo-head" }, [
      reorderControl(),
      el("input", {
        type: "checkbox",
        class: "photo-select",
        "aria-label": `Select ${photoName}`,
        onchange: (e) => {
          const checkbox = eventElement(e);
          if (!(checkbox instanceof HTMLInputElement)) return;
          if (checkbox.checked) selected.add(p.photo.uri);
          else selected.delete(p.photo.uri);
          refreshSelectBar();
        },
      }),
      thumb,
      el("div", { class: "photo-meta" }, [
        el("div", {}, `#${idx + 1}`),
        el("div", { class: "photo-caption muted small" }, p.photo.value.alt || "Missing alt text"),
        readoutHost,
        coverageHost,
      ]),
    ]),
    el("details", { class: "form-disclosure", "data-photo-section": "gear" }, [
      el("summary", {}, "Capture and gear"),
      el(
        "p",
        { class: "muted small gear-source" },
        capture ? "Photo values override shared gallery gear." : "Using shared gallery gear where available.",
      ),
      gearSuggestion("camera", gearMatch.camera, camSel, markGearDirty),
      gearField("Camera", "camera", camSel),
      gearField("Film back", "filmBack", backSel),
      gearSuggestion("lens", gearMatch.lens, lensSel, markGearDirty),
      gearField("Lens", "lens", lensSel),
      field("Filter stack", filterStack.node),
      gearField("Film roll", "filmRoll", rollSel),
      field("Frame # on roll", frameInput),
      field("Shoot", shootSel),
      field("Location", locF.node),
      el("div", { class: "row wrap subtle-actions" }, [
        el(
          "button",
          {
            class: "ghost small-btn",
            onclick: () => {
              const inherited = resolvePhotoCapture(null, ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri));
              for (const [key, control] of Object.entries({
                camera: camSel,
                filmBack: backSel,
                lens: lensSel,
                filmRoll: rollSel,
                shoot: shootSel,
              })) {
                control.value = (inherited[key as keyof typeof inherited] as string) || "";
                gearFieldsChanged.add(key);
                resetGearFields.add(key);
              }
              filterStack.node.dispatchEvent(new CustomEvent("filter-stack-set", { detail: inherited.filters }));
              gearFieldsChanged.add("filters");
              resetGearFields.add("filters");
              markGearDirty();
            },
          },
          "Use shared gear",
        ),
        idx > 0
          ? el(
              "button",
              {
                class: "ghost small-btn",
                title: "Copy gear from the photo above",
                onclick: () => sameGearAsAbove(card),
              },
              "Same as above",
            )
          : null,
        el("button", { class: "ghost small-btn", onclick: () => openGalleryGear("camera") }, "+ Camera"),
        el("button", { class: "ghost small-btn", onclick: () => openGalleryGear("filmBack") }, "+ Film back"),
        el("button", { class: "ghost small-btn", onclick: () => openGalleryGear("lens") }, "+ Lens"),
        el("button", { class: "ghost small-btn", onclick: () => openGalleryGear("filter") }, "+ Filter"),
        el(
          "button",
          {
            class: "ghost small-btn",
            title: "Fill blank EXIF fields from the gear selected above",
            onclick: () => {
              form = projectCaptureToExif(
                form,
                {
                  camera: camSel.value,
                  lens: lensSel.value,
                  filmRoll: rollSel.value,
                },
                ctx.store,
              ) as ExifForm;
              for (const f of EXIF_FIELDS) exifInputs[f.key].value = form[f.key] || "";
              exifValidators.forEach((v) => v());
              refreshReadout();
              exifDirty = true;
              markDirty();
              status.textContent = "Filled EXIF from gear (save to persist)";
            },
          },
          "Fill EXIF from gear",
        ),
      ]),
    ]),
    el("div", { class: "field" }, [
      el("div", { class: "row between" }, [
        el("label", { for: `photo-alt-${idx}` }, "Alt text"),
        p.photo?.value
          ? el(
              "button",
              {
                class: "ghost small-btn",
                type: "button",
                title: "Generate alt text from the image (no scene graph)",
                onclick: async (e) => {
                  const cfg = getVisionConfig();
                  if (!cfg?.apiKey) {
                    toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000);
                    return;
                  }
                  await withButton(
                    eventButton(e),
                    status,
                    async () => {
                      const { describePhoto } = await import("../vision.js");
                      const alt = await describePhoto(ctx.agent, ctx.did, p.photo.value.photo, cfg, {
                        onProgress: (msg: string) => {
                          status.textContent = msg;
                        },
                      });
                      if (alt) {
                        altArea.value = alt;
                        altDirty = true;
                        markDirty();
                      }
                    },
                    { working: "Loading photo from your PDS…", done: "Alt text ready (save to keep)" },
                  );
                },
              },
              "Generate",
            )
          : null,
      ]),
      altArea,
    ]),
    el("details", { class: "form-disclosure", "data-photo-section": "exif" }, [
      el("summary", {}, "Exposure and EXIF"),
      exifGrid,
    ]),
    el("div", { class: "row wrap subtle-actions" }, [
      p.photo?.value
        ? el(
            "button",
            {
              class: "ghost small-btn",
              title: "Swap the image file; gallery ID and linked records stay the same",
              onclick: () => fileIn.click(),
            },
            "Replace image",
          )
        : null,
      el(
        "button",
        {
          class: "ghost small-btn",
          onclick: async () => {
            const { openSceneEditor } = await import("./sceneEditor.js");
            return openSceneEditor(
              ctx,
              { ...p.photo, idx },
              {
                // Object detection lives inside the scene-graph modal now (next to Edit).
                // It writes only the scene graph; alt text has its own Generate button.
                onAnalyze: p.photo?.value
                  ? async (onProgress?: (message: string) => void) => {
                      const cfg = getVisionConfig();
                      if (!cfg?.apiKey) {
                        toast("Connect an image-analysis provider first (Settings → Image analysis).", "info", 5000);
                        return null;
                      }
                      const { analyzePhoto, writeSceneGraph } = await import("../vision.js");
                      const raw = await analyzePhoto(ctx.agent, ctx.did, p.photo.value.photo, cfg, { onProgress });
                      onProgress?.("Looking up types on Wikidata…");
                      const result = await openGroundingModal(raw); // confirm/pick Wikidata groundings, or keep as text
                      if (!result) return null;
                      onProgress?.("Saving scene graph to your PDS…");
                      await writeSceneGraph(ctx.agent, ctx.did, p.photo.uri, result);
                      ctx.store = await refreshStore(); // keep the card's indicators fresh, in place
                      return result;
                    }
                  : null,
              },
            );
          },
        },
        "Scene graph",
      ),
      isAdvanced()
        ? el("button", { class: "ghost small-btn", onclick: () => openInspector(p.photo) }, "Inspect")
        : null,
      fileIn,
    ]),
    el(
      "button",
      {
        class: "photo-save",
        onclick: async (e) => {
          if (!ctl.save) throw new Error("Photo save control is unavailable");
          const ok = await withButton(eventButton(e), status, ctl.save);
          if (ok) ctx.store = await refreshStore();
          else ctl.reveal?.();
        },
      },
      "Save photo",
    ),
    status,
  ]) as PhotoCard;
  card._photo = p;
  const fields = el("div", { class: "photo-fields" });
  const children = [...card.children].slice(1);
  fields.append(...children);
  const altField = altArea.closest(".field")!;
  fields.prepend(lazyThumb(ctx.agent, ctx.did, p.photo?.value?.photo, "inspector-preview", photoName), altField);
  const workflow = el("details", { class: "form-disclosure", "data-photo-section": "workflow" }, [
    el("summary", {}, "Workflow"),
    wfSummary,
  ]);
  const actions = [...fields.children].find((child) => child.classList.contains("subtle-actions"));
  fields.insertBefore(workflow, actions || fields.querySelector(".photo-save"));
  if (actions) {
    const more = el("details", { class: "form-disclosure", "data-photo-section": "actions" }, [
      el("summary", {}, "More photo actions"),
    ]);
    actions.before(more);
    more.append(actions);
  }
  card._editor = fields;
  const saveFields = ctl.save;
  ctl.save = async () => {
    try {
      await saveFields();
    } catch (error) {
      status.textContent = errorMessage(error);
      status.classList.add("err");
      throw error;
    }
  };
  ctl.reveal = () => {
    const target = fields.querySelector<HTMLElement>(".invalid") || altArea;
    target.dispatchEvent(new Event("reveal-photo-field", { bubbles: true }));
  };
  const gearSources = Object.entries({
    camera: camSel,
    filmBack: backSel,
    lens: lensSel,
    filmRoll: rollSel,
    shoot: shootSel,
  }).map(([key, control]) => {
    const source = el("span", { id: `photo-${idx}-${key}-source`, class: "muted small", "aria-hidden": "true" });
    control.setAttribute("aria-describedby", source.id);
    control.closest("label")?.append(source);
    return { key, control, source };
  });
  const refreshSources = () => {
    const shared = ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri)?.value || {};
    gearSources.forEach(({ key, control, source }) => {
      source.textContent = gearFieldsChanged.has(key)
        ? resetGearFields.has(key) || !control.value
          ? "Will use shared gear after saving"
          : "Unsaved photo override"
        : capture?.value?.[key]
          ? "Photo override"
          : shared[key]
            ? "From shared gear"
            : "";
    });
  };
  fields.addEventListener("change", refreshSources);
  fields.addEventListener("click", refreshSources);
  refreshSources();
  fields.addEventListener("gallery-defaults-saved", () => {
    if (gearDirty) return;
    const inherited = resolvePhotoCapture(capture, ctx.store.galleryDefaultsByGallery.get(ctx.galleryUri));
    for (const [key, control] of Object.entries({
      camera: camSel,
      filmBack: backSel,
      lens: lensSel,
      filmRoll: rollSel,
      shoot: shootSel,
    })) {
      control.value = (inherited[key as keyof typeof inherited] as string) || "";
    }
    filterStack.node.dispatchEvent(new CustomEvent("filter-stack-set", { detail: inherited.filters }));
    refreshSources();
  });
  guardControllerSave(ctl, fields);
  return card;
}

export { getGalleries };
