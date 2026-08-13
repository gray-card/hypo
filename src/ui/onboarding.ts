// onboarding.ts: resumable, practice-driven setup. The wizard quick-adds owned
// gear, checks the resulting system for obvious compatibility problems, and
// creates idempotent workflow templates with useful defaults.

import { el, confirmModal } from "./dom.js";
import { icon } from "./icons.js";
import { kindLabel } from "./labels.js";
import { NS, deleteRecord, instanceLabel, loadStore, saveWorkflowTemplate } from "../graycard.js";
import { recordStore } from "../grain.js";
import { renderOn, type RecordStore } from "@hypo/store";
import { allRecipes, devRecipesStatus, loadDevRecipes } from "../devRecipes.js";
import { openAddGear, openEditGear, getStore, refreshStore } from "./library.js";

type OnboardingStatus = "in-progress" | "dismissed" | "completed";
type DigitizeMethod = "own" | "lab" | "none";

interface ValueRecord {
  [key: string]: unknown;
  type?: string;
  stock?: string;
  category?: string;
  format?: string;
  mount?: string;
  brand?: string;
  name?: string;
  role?: string;
  lab?: string;
  createdAt?: string;
  medium?: string;
}

interface StoredRecord {
  uri?: string;
  cid?: string;
  value: ValueRecord;
}

type RecordGroups = Partial<Record<string, StoredRecord[]>>;

interface OnboardingStore {
  catalog?: RecordGroups;
  instance?: RecordGroups;
  workflowTemplates?: StoredRecord[];
}

export interface OnboardingState {
  version: number;
  status: OnboardingStatus;
  stepKey: string;
  practices: string[];
  digitize: DigitizeMethod;
  workflowChoices: string[];
  updatedAt?: string;
  completedAt?: string;
}

type OnboardingStateSnapshot = Partial<OnboardingState> & { version: number; updatedAt?: string };

interface BasicStep {
  key: string;
  label: string;
  type: "welcome" | "practice" | "workflow" | "review" | "done";
}

interface GearStep {
  key: string;
  label: string;
  type: "gear";
  kinds: string[];
  title: string;
  subtitle: string;
}

type OnboardingStep = BasicStep | GearStep;

interface CompatibilityFinding {
  kind: "mount" | "format" | "all";
  level: "warning" | "ok";
  text: string;
}

interface DevelopmentRecipe {
  filmMake: string;
  filmName: string;
  developerMake: string;
  developerName: string;
  dilution?: string;
  ei?: string | number;
}

interface WorkflowSpec {
  id: string;
  name: string;
  medium: string;
  desc: string;
  stages: string[];
}

interface StageDefault {
  kind: string;
  fields: Record<string, string>;
}

interface WorkflowPayload {
  name: string;
  medium: string;
  stageKinds: string[];
  stageDefaults: StageDefault[];
  defaultCamera?: string;
  defaultLens?: string;
  defaultChemistry?: string;
  defaultScanner?: string;
  defaultLab?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface RecipeLoadState {
  status: "idle" | "loading" | "ready" | "error";
  error?: unknown;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface OpenOnboardingOptions {
  agent: unknown;
  did: string;
  onDone?: (destination: string) => void;
  signals?: Pick<RecordStore, "collection">;
}

interface FooterOptions {
  nextLabel?: string;
  skip?: boolean;
  next?: () => unknown;
  disabled?: boolean;
}

export const ONBOARDING_VERSION = 2;
const stateKey = (did?: string | null) => `hypo:onboarding:v${ONBOARDING_VERSION}:${did || "anon"}`;
const norm = (s: unknown) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const canonicalFormat = (value: unknown) => {
  const key = norm(value).replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    35: "135",
    "35mm": "135",
    "13535mm": "135",
    135: "135",
  };
  return aliases[key] || key;
};

const INSTANCE_TYPE_MAPPING: Record<string, readonly [string, string]> = {
  camera: ["cameraType", "type"],
  lens: ["lensType", "type"],
  filmStockpile: ["filmStock", "stock"],
  chemistry: ["chemistryType", "type"],
  scanner: ["scannerType", "type"],
};

interface OnboardingSignalDependency {
  collection: string;
  layer: "catalog" | "instance";
  kind: string;
}

export function renderOnboardingCollectionsOn(
  signals: Pick<RecordStore, "collection">,
  collections: readonly string[],
  render: (records: readonly ReturnType<RecordStore["collection"]>["value"][]) => void,
): () => void {
  return renderOn(() => collections.map((collection) => signals.collection(collection).value), render);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isPresent = <T>(value: T | false | null | undefined): value is T => Boolean(value);

export function readOnboardingState(
  did?: string | null,
  storage: StorageLike | null | undefined = globalThis.localStorage,
): OnboardingStateSnapshot | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(stateKey(did)) || "null");
    return value && typeof value === "object" && "version" in value && value.version === ONBOARDING_VERSION
      ? (value as OnboardingStateSnapshot)
      : null;
  } catch {
    return null;
  }
}

export function writeOnboardingState<T extends object>(
  did: string | null | undefined,
  value: T,
  storage: StorageLike | null | undefined = globalThis.localStorage,
): T & { version: number; updatedAt: string } {
  const next = { version: ONBOARDING_VERSION, updatedAt: new Date().toISOString(), ...value };
  try {
    storage?.setItem(stateKey(did), JSON.stringify(next));
  } catch {
    /* private storage */
  }
  return next;
}

export function detectMediums(store?: OnboardingStore | null) {
  let film = false,
    digital = false,
    instant = false;
  for (const cam of store?.instance?.camera || []) {
    const t = (store?.catalog?.cameraType || []).find((x) => x.uri === cam.value.type)?.value;
    const cat = t?.category;
    const fmt = t?.format || "";
    if (cat === "digital" || /-digital$/.test(fmt)) digital = true;
    else if (cat === "instant" || /^instax|^polaroid/.test(fmt)) instant = true;
    else if (cat === "film" || fmt) film = true;
  }
  return { film, digital, instant, any: film || digital || instant };
}

const PRACTICES = [
  { id: "film-home", icon: "film", title: "Film · process at home", desc: "Shoot film and develop it yourself." },
  { id: "film-lab", icon: "package", title: "Film · use a lab", desc: "A lab develops your film." },
  { id: "digital", icon: "camera", title: "Digital", desc: "Capture, edit, and export digital photographs." },
  { id: "instant", icon: "image", title: "Instant", desc: "Shoot instant film and optionally digitize it." },
  { id: "darkroom", icon: "sun", title: "Darkroom printing", desc: "Make enlargements or other physical prints." },
];

function hasPractice(state: Pick<OnboardingState, "practices">, ...ids: string[]) {
  return ids.some((id) => state.practices?.includes(id));
}

export function onboardingSteps(state: Pick<OnboardingState, "practices" | "digitize">): OnboardingStep[] {
  const capture = hasPractice(state, "film-home", "film-lab", "digital", "instant");
  const film = hasPractice(state, "film-home", "film-lab", "instant", "darkroom");
  const home = hasPractice(state, "film-home", "darkroom");
  const lab = hasPractice(state, "film-lab") || state.digitize === "lab";
  const steps: OnboardingStep[] = [
    { key: "welcome", label: "Welcome", type: "welcome" },
    { key: "practice", label: "Your practice", type: "practice" },
  ];
  if (capture)
    steps.push({
      key: "cameras",
      label: "Cameras",
      type: "gear",
      kinds: ["camera"],
      title: "Add your cameras",
      subtitle: "We use format and mount to keep later suggestions compatible.",
    });
  if (hasPractice(state, "film-home", "film-lab", "digital"))
    steps.push({
      key: "lenses",
      label: "Lenses",
      type: "gear",
      kinds: ["lens"],
      title: "Add your lenses",
      subtitle: "Fixed-lens cameras need nothing here.",
    });
  if (film)
    steps.push({
      key: "film",
      label: "Film reserve",
      type: "gear",
      kinds: ["filmStockpile"],
      title: "Add film in reserve",
      subtitle:
        "Record each stock, format, and the number of unshot rolls you have. Individual roll records are created when film is loaded.",
    });
  if (home)
    steps.push({
      key: "chemistry",
      label: "Chemistry",
      type: "gear",
      kinds: ["chemistry"],
      title: "Add processing chemistry",
      subtitle: "Add each chemical or kit and select every bath role it performs.",
    });
  if (lab)
    steps.push({
      key: "lab",
      label: "Lab",
      type: "gear",
      kinds: ["labAccount"],
      title: "Add your lab",
      subtitle: "This connects the lab to development or scanning stages without exposing account details publicly.",
    });
  if (state.digitize === "own")
    steps.push({
      key: "scanner",
      label: "Scanning",
      type: "gear",
      kinds: ["scanner"],
      title: "Add your scanner",
      subtitle: "This becomes the default for digitization stages.",
    });
  if (hasPractice(state, "darkroom"))
    steps.push({
      key: "printing",
      label: "Printing",
      type: "gear",
      kinds: ["enlarger", "enlargingLens", "lightSource", "printer"],
      title: "Add printing equipment",
      subtitle: "Add only the equipment your printing method uses.",
    });
  if (capture)
    steps.push({
      key: "extras",
      label: "Optional gear",
      type: "gear",
      kinds: ["filter", "storageLocation"],
      title: "Add useful extras",
      subtitle: "Filters and film-storage locations are optional and can be added later.",
    });
  steps.push(
    { key: "workflow", label: "Workflow", type: "workflow" },
    { key: "review", label: "Review", type: "review" },
    { key: "done", label: "Finish", type: "done" },
  );
  return steps;
}

function typeValue(store: OnboardingStore, kind: string, instance?: StoredRecord): ValueRecord | null {
  const mapping = INSTANCE_TYPE_MAPPING[kind];
  if (!mapping) return null;
  const [catalogKind, key] = mapping;
  return (store.catalog?.[catalogKind] || []).find((record) => record.uri === instance?.value[key])?.value || null;
}

export function compatibilityFindings(store: OnboardingStore): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  const cameraMounts = new Set(
    (store.instance?.camera || []).map((x) => typeValue(store, "camera", x)?.mount).filter(Boolean),
  );
  const lensMounts = new Set(
    (store.instance?.lens || []).map((x) => typeValue(store, "lens", x)?.mount).filter(Boolean),
  );
  if (cameraMounts.size && lensMounts.size && ![...lensMounts].some((x) => cameraMounts.has(x))) {
    findings.push({
      kind: "mount",
      level: "warning",
      text: `Camera mounts (${[...cameraMounts].join(", ")}) do not match the listed lens mounts (${[...lensMounts].join(", ")}).`,
    });
  }
  const filmFormats = new Set(
    (store.instance?.camera || [])
      .map((x) => {
        const t = typeValue(store, "camera", x);
        return t?.category === "film" || (t?.format && !/-digital$/.test(t.format)) ? t.format : null;
      })
      .filter(Boolean),
  );
  const reserveFormats = new Set((store.instance?.filmStockpile || []).map((x) => x.value.format).filter(Boolean));
  const canonicalCameraFormats = new Set([...filmFormats].map(canonicalFormat));
  const canonicalReserveFormats = new Set([...reserveFormats].map(canonicalFormat));
  if (
    filmFormats.size &&
    reserveFormats.size &&
    ![...canonicalReserveFormats].some((x) => canonicalCameraFormats.has(x))
  ) {
    findings.push({
      kind: "format",
      level: "warning",
      text: `Film formats in reserve (${[...reserveFormats].join(", ")}) do not match your film cameras (${[...filmFormats].join(", ")}).`,
    });
  }
  if (!findings.length)
    findings.push({ kind: "all", level: "ok", text: "No obvious mount or film-format conflicts found." });
  return findings;
}

export function matchingDevelopmentRecipes(store: OnboardingStore): DevelopmentRecipe[] {
  const films = (store.instance?.filmStockpile || [])
    .map((x) => typeValue(store, "filmStockpile", x))
    .filter(isPresent);
  const developers = (store.instance?.chemistry || [])
    .map((x) => typeValue(store, "chemistry", x))
    .filter(isPresent)
    .filter((value) =>
      ["film-developer", "first-developer", "color-developer"].some((role) => value.roles?.includes(role)),
    );
  if (!films.length) return [];
  return (allRecipes() as DevelopmentRecipe[]).filter((r) => {
    const filmMatch = films.some((f) => norm(f.brand) === norm(r.filmMake) && norm(f.name) === norm(r.filmName));
    const developerMatch =
      !developers.length ||
      developers.some((d) => norm(d.brand) === norm(r.developerMake) && norm(d.name) === norm(r.developerName));
    return filmMatch && developerMatch;
  });
}

function workflowSpecs(state: OnboardingState): WorkflowSpec[] {
  const specs: WorkflowSpec[] = [];
  const digitize = state.digitize !== "none";
  const print = hasPractice(state, "darkroom");
  if (hasPractice(state, "film-home"))
    specs.push({
      id: "film-home",
      name: "Home-developed film",
      medium: "film",
      desc: ["Shoot", "Develop", digitize && "Digitize", print && "Print"].filter(Boolean).join(" → "),
      stages: ["capture", "develop", digitize && "digitize", digitize && "edit", print && "print"].filter(isPresent),
    });
  if (hasPractice(state, "film-lab"))
    specs.push({
      id: "film-lab",
      name: "Lab-developed film",
      medium: "film",
      desc: ["Shoot", "Lab development", digitize && "Digitize", digitize && "Edit"].filter(Boolean).join(" → "),
      stages: ["capture", "develop", digitize && "digitize", digitize && "edit"].filter(isPresent),
    });
  if (hasPractice(state, "digital"))
    specs.push({
      id: "digital",
      name: "Digital photography",
      medium: "digital",
      desc: "Shoot → Edit → Export",
      stages: ["capture", "edit", "digital", "output"],
    });
  if (hasPractice(state, "instant"))
    specs.push({
      id: "instant",
      name: "Instant photography",
      medium: "instant",
      desc: digitize ? "Shoot → Digitize" : "Shoot",
      stages: ["capture", digitize && "digitize"].filter(isPresent),
    });
  if (print && !hasPractice(state, "film-home"))
    specs.push({
      id: "darkroom",
      name: "Darkroom printing",
      medium: "film",
      desc: "Develop → Print",
      stages: ["develop", "print"],
    });
  return specs;
}

function firstInstance(
  store: OnboardingStore,
  kind: string,
  predicate: (record: StoredRecord) => boolean = () => true,
): StoredRecord | undefined {
  return (store.instance?.[kind] || []).find(predicate);
}

export function workflowPayload(
  spec: Pick<WorkflowSpec, "name" | "medium" | "stages">,
  store: OnboardingStore,
  state: Pick<OnboardingState, "practices" | "digitize">,
): WorkflowPayload {
  const camera =
    firstInstance(store, "camera", (x) => {
      const m = detectMediums({ catalog: store.catalog, instance: { camera: [x] } });
      return spec.medium === "film" ? m.film : spec.medium === "digital" ? m.digital : m.instant;
    }) || firstInstance(store, "camera");
  const cameraMount = typeValue(store, "camera", camera)?.mount;
  const lens =
    firstInstance(store, "lens", (x) => !cameraMount || typeValue(store, "lens", x)?.mount === cameraMount) ||
    firstInstance(store, "lens");
  const hasRole = (record: StoredRecord, role: string) => typeValue(store, "chemistry", record)?.roles?.includes(role);
  const developer = firstInstance(store, "chemistry", (record) =>
    ["film-developer", "first-developer", "color-developer"].some((role) => hasRole(record, role)),
  );
  const stop = firstInstance(store, "chemistry", (record) => hasRole(record, "stop"));
  const fixer = firstInstance(store, "chemistry", (record) => hasRole(record, "fixer"));
  const scanner = firstInstance(store, "scanner");
  const lab = firstInstance(store, "labAccount");
  const enlarger = firstInstance(store, "enlarger");
  const enlargingLens = firstInstance(store, "enlargingLens");
  const printer = firstInstance(store, "printer");
  const stageDefaults: StageDefault[] = [];
  const add = (kind: string, fields: Record<string, string | null | undefined>) => {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value) clean[key] = value;
    }
    if (Object.keys(clean).length) stageDefaults.push({ kind, fields: clean });
  };
  add("capture", { camera: camera?.uri, lens: lens?.uri });
  add("develop", {
    chemistry: developer?.uri,
    lab: hasPractice(state, "film-lab") ? lab?.uri : null,
    stopBathChemistry: stop?.uri,
    fixerChemistry: fixer?.uri,
  });
  add("digitize", { scanner: scanner?.uri, lab: state.digitize === "lab" ? lab?.uri : null });
  add("print", { enlarger: enlarger?.uri, enlargingLens: enlargingLens?.uri, printer: printer?.uri });
  const now = new Date().toISOString();
  return {
    name: spec.name,
    medium: spec.medium,
    stageKinds: spec.stages,
    stageDefaults,
    defaultCamera: camera?.uri,
    defaultLens: lens?.uri,
    defaultChemistry: developer?.uri,
    defaultScanner: scanner?.uri,
    defaultLab: lab?.value?.lab,
    notes: "Created by guided setup.",
    createdAt: now,
    updatedAt: now,
  };
}

export async function openOnboarding({ agent, did, onDone, signals = recordStore(did) }: OpenOnboardingOptions) {
  let store = (getStore() || (await loadStore(agent, did))) as OnboardingStore;
  const saved = readOnboardingState(did);
  const initialState: OnboardingState = {
    version: ONBOARDING_VERSION,
    status: "in-progress",
    stepKey: "welcome",
    practices: [],
    digitize: "own",
    workflowChoices: [],
  };
  let state: OnboardingState =
    saved?.status === "in-progress"
      ? {
          ...initialState,
          ...saved,
          status: "in-progress",
          practices: saved.practices || [],
          digitize: saved.digitize || "own",
          workflowChoices: saved.workflowChoices || [],
        }
      : initialState;
  let steps = onboardingSteps(state);
  let i = Math.max(
    0,
    steps.findIndex((s) => s.key === state.stepKey),
  );
  let busy = false;
  let workflowError = "";
  let recipeLoad = devRecipesStatus() as RecipeLoadState;
  let disposeStoreSignals = () => {};
  let signalKey = "";

  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = el("div", {
    class: "wizard-overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "wizard-title",
  });
  const card = el("div", { class: "wizard card", tabindex: "-1" });
  overlay.append(card);
  document.body.append(overlay);

  const persist = (patch: Partial<OnboardingState> = {}) => {
    state = writeOnboardingState(did, { ...state, ...patch, status: patch.status || state.status });
  };
  const close = (destination = "setup", status: OnboardingStatus | null = null) => {
    if (status) persist({ status, stepKey: steps[i]?.key });
    disposeStoreSignals();
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    previousFocus?.focus?.();
    onDone?.(destination);
  };
  const focusables = () => [
    ...card.querySelectorAll<HTMLElement>(
      "button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])",
    ),
  ];
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close("setup", "dismissed");
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables();
    if (!nodes.length) return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onKey);

  function rebuild(keepKey = steps[i]?.key) {
    steps = onboardingSteps(state);
    const nextIndex = steps.findIndex((s) => s.key === keepKey);
    i = nextIndex >= 0 ? nextIndex : Math.min(i, steps.length - 1);
  }
  function go(delta: number) {
    i = Math.max(0, Math.min(steps.length - 1, i + delta));
    persist({ stepKey: steps[i].key });
    render();
  }
  function progress() {
    const current = i + 1;
    return el(
      "div",
      {
        class: "wizard-progress",
        role: "progressbar",
        "aria-label": "Setup progress",
        "aria-valuemin": "1",
        "aria-valuemax": String(steps.length),
        "aria-valuenow": String(current),
      },
      [
        el("div", { class: "row between wizard-progress-copy" }, [
          el("span", {}, `Step ${current} of ${steps.length}`),
          el("strong", {}, steps[i].label),
        ]),
        el("div", { class: "wizard-track" }, [
          el("span", { style: `width:${Math.round((current / steps.length) * 100)}%` }),
        ]),
      ],
    );
  }
  function footer({ nextLabel = "Next", skip = false, next, disabled = false }: FooterOptions = {}) {
    return el("div", { class: "wizard-foot" }, [
      i > 0 ? el("button", { class: "ghost", type: "button", onclick: () => go(-1) }, "Back") : el("span"),
      el("div", { class: "row" }, [
        skip ? el("button", { class: "ghost", type: "button", onclick: () => go(1) }, "Skip for now") : null,
        el("button", { type: "button", disabled, onclick: next || (() => go(1)) }, nextLabel),
      ]),
    ]);
  }
  function heading(title: string, subtitle: string) {
    return [
      el("h2", { id: "wizard-title", class: "wizard-title" }, title),
      el("p", { class: "wizard-sub muted" }, subtitle),
    ];
  }
  async function refresh() {
    store = (await refreshStore()) as OnboardingStore;
  }
  function pauseForModal() {
    overlay.inert = true;
    overlay.setAttribute("aria-hidden", "true");
  }
  function resumeFromModal() {
    overlay.inert = false;
    overlay.removeAttribute("aria-hidden");
    render();
  }
  function launchGear(kind: string, existing: StoredRecord | null = null) {
    pauseForModal();
    const done = async () => {
      await refresh();
    };
    const opts = { guided: true, onClose: resumeFromModal };
    if (existing) openEditGear(kind, existing, done, opts);
    else openAddGear(kind, done, kind === "filmStockpile" ? { quantity: 1 } : {}, null, opts);
  }
  async function removeGear(kind: string, item: StoredRecord) {
    const ok = await confirmModal(`Remove ${instanceLabel(kind, item.value, store)} from your setup?`, {
      confirmLabel: "Remove",
    });
    if (!ok) return;
    if (!item.uri) return;
    await deleteRecord(agent, did, item.uri);
    await refresh();
    render();
  }
  function gearList(kinds: string[]) {
    const rows: HTMLElement[] = [];
    for (const kind of kinds)
      for (const item of store.instance?.[kind] || []) {
        rows.push(
          el("li", {}, [
            icon("check", 15),
            el("span", { class: "wizard-added-name" }, instanceLabel(kind, item.value, store)),
            el(
              "button",
              {
                class: "ghost icon-btn",
                type: "button",
                title: "Edit",
                "aria-label": `Edit ${instanceLabel(kind, item.value, store)}`,
                onclick: () => launchGear(kind, item),
              },
              [icon("edit", 14)],
            ),
            el(
              "button",
              {
                class: "ghost icon-btn danger",
                type: "button",
                title: "Remove",
                "aria-label": `Remove ${instanceLabel(kind, item.value, store)}`,
                onclick: () => removeGear(kind, item),
              },
              [icon("trash", 14)],
            ),
          ]),
        );
      }
    return rows.length
      ? el("ul", { class: "wizard-added" }, rows)
      : el("p", { class: "wizard-empty muted small" }, "Nothing added in this step yet.");
  }
  function addButtons(kinds: string[]) {
    return el(
      "div",
      { class: "wizard-add-grid" },
      kinds.map((kind) =>
        el("button", { class: "wizard-add", type: "button", onclick: () => launchGear(kind) }, [
          icon("plus", 16),
          el("span", {}, `Add ${kindLabel(kind).toLowerCase()}`),
        ]),
      ),
    );
  }
  function recipePanel() {
    const filmCount = store.instance?.filmStockpile?.length || 0;
    if (!filmCount) return null;
    if (recipeLoad.status === "loading" || recipeLoad.status === "idle")
      return el("div", { class: "wizard-callout", role: "status", "aria-live": "polite" }, [
        el("strong", {}, "Loading manufacturer development recipes…"),
        el("p", { class: "muted small" }, "You can continue adding gear while the catalog loads."),
      ]);
    if (recipeLoad.status === "error") {
      const retry = el("button", { class: "ghost small-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => refreshRecipeCatalog());
      return el("div", { class: "wizard-callout warning", role: "alert" }, [
        el("strong", {}, "Development recipes are unavailable"),
        el("p", { class: "muted small" }, `The setup can continue without them (${errorMessage(recipeLoad.error)}).`),
        retry,
      ]);
    }
    const recipes = matchingDevelopmentRecipes(store);
    if (!recipes.length)
      return el("div", { class: "wizard-callout" }, [
        el("strong", {}, "No exact datasheet recipe found yet"),
        el("p", { class: "muted small" }, "You can still add the gear. Hypo will not invent a development time."),
      ]);
    const unique: DevelopmentRecipe[] = [];
    const seen = new Set<string>();
    for (const recipe of recipes) {
      const key = `${recipe.developerMake}|${recipe.developerName}|${recipe.dilution}|${recipe.ei}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(recipe);
      }
      if (unique.length === 3) break;
    }
    return el("details", { class: "wizard-callout" }, [
      el("summary", {}, `${recipes.length} film-specific datasheet recipe${recipes.length === 1 ? "" : "s"} available`),
      el(
        "ul",
        { class: "wizard-recipe-list" },
        unique.map((r) =>
          el(
            "li",
            {},
            `${r.filmMake} ${r.filmName} · ${r.developerMake} ${r.developerName}${r.dilution ? ` ${r.dilution}` : ""}${r.ei ? ` · EI ${r.ei}` : ""}`,
          ),
        ),
      ),
      el(
        "p",
        { class: "muted small" },
        "Times, temperatures, agitation, push/pull, and source details remain attached to the recipe and appear when you start development.",
      ),
    ]);
  }

  function renderWelcome() {
    card.replaceChildren(
      progress(),
      el("div", { class: "wizard-hero" }, [icon("camera", 40)]),
      ...heading(
        "Build the setup you actually use",
        "Choose how you work, add the essentials, and Hypo will connect compatible gear to reusable workflows. Shared model facts stay separate from details about your own copy.",
      ),
      el("div", { class: "wizard-foot" }, [
        el("button", { class: "ghost", type: "button", onclick: () => close("setup", "dismissed") }, "Do this later"),
        el(
          "button",
          { type: "button", onclick: () => go(1) },
          saved?.status === "in-progress" ? "Resume setup" : "Get started",
        ),
      ]),
    );
  }
  function renderPractice() {
    const choices = el("div", { class: "wizard-practices" });
    for (const practice of PRACTICES) {
      const checked = state.practices.includes(practice.id);
      const input = el("input", { type: "checkbox", value: practice.id, checked });
      input.addEventListener("change", () => {
        const selected = new Set(state.practices);
        if (input.checked) selected.add(practice.id);
        else selected.delete(practice.id);
        state.practices = [...selected];
        if (!hasPractice(state, "film-home", "film-lab", "instant", "darkroom")) state.digitize = "none";
        else if (state.digitize === "none") state.digitize = "own";
        persist({ practices: state.practices, digitize: state.digitize, workflowChoices: [] });
        rebuild("practice");
        render();
      });
      choices.append(
        el("label", { class: `wizard-practice${checked ? " selected" : ""}` }, [
          input,
          el("span", { class: "wizard-practice-icon" }, [icon(practice.icon, 20)]),
          el("span", {}, [el("strong", {}, practice.title), el("small", { class: "muted" }, practice.desc)]),
        ]),
      );
    }
    const filmSelected = hasPractice(state, "film-home", "film-lab", "instant", "darkroom");
    const digitize = filmSelected
      ? el("fieldset", { class: "wizard-radio-group" }, [
          el("legend", {}, "How are film or prints digitized?"),
          ...[
            ["own", "With my scanner"],
            ["lab", "By a lab"],
            ["none", "I do not digitize them"],
          ].map(([value, label]) => {
            const input = el("input", { type: "radio", name: "digitize", value, checked: state.digitize === value });
            input.addEventListener("change", () => {
              state.digitize = value as DigitizeMethod;
              persist({ digitize: value as DigitizeMethod, workflowChoices: [] });
              rebuild("practice");
              render();
            });
            return el("label", { class: "inline-check" }, [input, ` ${label}`]);
          }),
        ])
      : null;
    card.replaceChildren(
      progress(),
      ...heading(
        "What belongs in your setup?",
        "Choose every practice that applies. The remaining steps adapt to this selection.",
      ),
      choices,
      ...(digitize ? [digitize] : []),
      footer({
        disabled: !state.practices.length,
        next: () => {
          rebuild("practice");
          go(1);
        },
      }),
    );
  }
  function renderGear(step: GearStep) {
    const callouts: HTMLElement[] = [];
    if (step.key === "lenses" || step.key === "film") {
      for (const finding of compatibilityFindings(store)) {
        const relevant = step.key === "lenses" ? finding.kind === "mount" : finding.kind === "format";
        if (finding.level === "warning" && relevant)
          callouts.push(
            el("div", { class: "wizard-callout warning" }, [icon("info", 16), el("span", {}, finding.text)]),
          );
      }
    }
    if (step.key === "chemistry") {
      const recipes = recipePanel();
      if (recipes) callouts.push(recipes);
    }
    card.replaceChildren(
      progress(),
      ...heading(step.title, step.subtitle),
      gearList(step.kinds),
      addButtons(step.kinds),
      ...callouts,
      footer({ skip: true }),
    );
  }
  function renderWorkflow() {
    const specs = workflowSpecs(state);
    if (!state.workflowChoices.length && specs.length) {
      state.workflowChoices = specs.map((x) => x.id);
      persist({ workflowChoices: state.workflowChoices });
    }
    const choices = el("div", { class: "wizard-choices" });
    for (const spec of specs) {
      const checked = state.workflowChoices.includes(spec.id);
      const input = el("input", { type: "checkbox", checked });
      input.addEventListener("change", () => {
        const selected = new Set(state.workflowChoices);
        if (input.checked) selected.add(spec.id);
        else selected.delete(spec.id);
        state.workflowChoices = [...selected];
        persist({ workflowChoices: state.workflowChoices });
        render();
      });
      choices.append(
        el("label", { class: `wizard-choice${checked ? " chosen" : ""}` }, [
          input,
          el("span", {}, [el("strong", {}, spec.name), el("small", { class: "muted" }, spec.desc)]),
        ]),
      );
    }
    card.replaceChildren(
      progress(),
      ...heading(
        "Choose reusable workflows",
        "The selected gear will be saved as stage defaults. You can change every default later.",
      ),
      choices,
      footer({ nextLabel: "Review setup", skip: true }),
    );
  }
  function summaryGroup(title: string, kinds: string[]) {
    const items: HTMLLIElement[] = [];
    for (const kind of kinds)
      for (const item of store.instance?.[kind] || []) {
        items.push(el("li", {}, instanceLabel(kind, item.value, store)));
      }
    return items.length
      ? el("section", { class: "wizard-summary-group" }, [el("h3", {}, title), el("ul", {}, items)])
      : null;
  }
  async function createWorkflows() {
    if (busy) return;
    busy = true;
    workflowError = "";
    render();
    try {
      const specs = workflowSpecs(state).filter((x) => state.workflowChoices.includes(x.id));
      for (const spec of specs) {
        const payload = workflowPayload(spec, store, state);
        const existing = (store.workflowTemplates || []).find(
          (x) => x.value.name === payload.name && x.value.medium === payload.medium,
        );
        if (existing) payload.createdAt = existing.value.createdAt || payload.createdAt;
        await saveWorkflowTemplate(agent, did, payload, existing || null);
        await refresh();
      }
      persist({ status: "completed", stepKey: "done", completedAt: new Date().toISOString() });
      rebuild("done");
      render();
    } catch (error) {
      busy = false;
      workflowError = `Could not finish setup: ${errorMessage(error)}. Your saved gear and choices are still here; try again.`;
      render();
    }
  }
  function renderReview() {
    const status = el(
      "p",
      {
        class: `status${workflowError ? " err" : ""}`,
        role: "status",
        "aria-live": "polite",
      },
      workflowError || (busy ? "Creating workflows…" : ""),
    );
    const selected = workflowSpecs(state).filter((x) => state.workflowChoices.includes(x.id));
    const findings = compatibilityFindings(store);
    const recipes = recipePanel();
    const sections = [
      summaryGroup("Capture", ["camera", "lens", "filter"]),
      summaryGroup("Film", ["filmStockpile", "storageLocation"]),
      summaryGroup("Processing", ["chemistry", "labAccount"]),
      summaryGroup("Scanning and printing", ["scanner", "enlarger", "enlargingLens", "lightSource", "printer"]),
    ].filter((section): section is HTMLElement => Boolean(section));
    card.replaceChildren(
      progress(),
      ...heading(
        "Review your setup",
        "Gear is saved when you add it. Finish creates or updates the selected workflows, so retrying cannot create duplicates.",
      ),
      el(
        "div",
        { class: "wizard-summary" },
        sections.length
          ? sections
          : [
              el(
                "p",
                { class: "muted small" },
                "No gear added. You can still create an empty workflow and fill it later.",
              ),
            ],
      ),
      el("section", { class: "wizard-summary-group" }, [
        el("h3", {}, "Workflows"),
        selected.length
          ? el(
              "ul",
              {},
              selected.map((x) => el("li", {}, `${x.name}: ${x.desc}`)),
            )
          : el("p", { class: "muted small" }, "No workflow selected."),
      ]),
      el(
        "div",
        { class: `wizard-callout ${findings.some((x) => x.level === "warning") ? "warning" : "ok"}` },
        findings.map((x) => el("p", {}, x.text)),
      ),
      ...(recipes ? [recipes] : []),
      status,
      footer({
        nextLabel: busy ? "Finishing…" : workflowError ? "Try again" : "Finish setup",
        disabled: busy,
        next: createWorkflows,
      }),
    );
  }
  function renderDone() {
    const film = hasPractice(state, "film-home", "film-lab", "instant", "darkroom");
    const primary: [string, string] =
      hasPractice(state, "darkroom") && !hasPractice(state, "film-home", "film-lab", "instant")
        ? ["Open the darkroom", "setup-darkroom"]
        : film
          ? ["Open film reserve", "setup-film"]
          : ["Import or create a gallery", "galleries"];
    card.replaceChildren(
      progress(),
      el("div", { class: "wizard-hero" }, [icon("check", 40)]),
      ...heading(
        "Your working setup is ready",
        film
          ? "Your reserve, processing choices, and workflow defaults are ready. Load a roll or open a workflow when you begin."
          : "Your capture defaults are ready to connect to a gallery.",
      ),
      el("div", { class: "wizard-next-actions" }, [
        el("button", { type: "button", onclick: () => close(primary[1], "completed") }, primary[0]),
        el(
          "button",
          {
            class: "ghost",
            type: "button",
            onclick: () => close(state.workflowChoices.length ? "setup-workflows" : "setup", "completed"),
          },
          state.workflowChoices.length ? "Review workflows" : "Review all setup",
        ),
      ]),
    );
  }
  const dependency = (layer: "catalog" | "instance", kind: string): OnboardingSignalDependency | null => {
    const collection = (NS[layer] as Record<string, string>)[kind];
    return collection ? { collection, layer, kind } : null;
  };
  const dependenciesFor = (step: OnboardingStep): OnboardingSignalDependency[] => {
    const pairs: Array<readonly ["catalog" | "instance", string]> = [];
    if (step.type === "gear") {
      for (const kind of step.kinds) {
        pairs.push(["instance", kind]);
        const catalogKind = INSTANCE_TYPE_MAPPING[kind]?.[0];
        if (catalogKind) pairs.push(["catalog", catalogKind]);
      }
      if (step.key === "lenses" || step.key === "film") {
        pairs.push(["instance", "camera"], ["catalog", "cameraType"]);
      }
      if (step.key === "lenses") pairs.push(["instance", "lens"], ["catalog", "lensType"]);
      if (step.key === "film") pairs.push(["instance", "filmStockpile"], ["catalog", "filmStock"]);
      if (step.key === "chemistry") {
        pairs.push(["instance", "filmStockpile"], ["catalog", "filmStock"]);
      }
    } else if (step.type === "review") {
      for (const kind of [
        "camera",
        "lens",
        "filter",
        "filmStockpile",
        "storageLocation",
        "chemistry",
        "labAccount",
        "scanner",
        "enlarger",
        "enlargingLens",
        "lightSource",
        "printer",
      ]) {
        pairs.push(["instance", kind]);
        const catalogKind = INSTANCE_TYPE_MAPPING[kind]?.[0];
        if (catalogKind) pairs.push(["catalog", catalogKind]);
      }
    }
    const unique = new Map<string, OnboardingSignalDependency>();
    for (const [layer, kind] of pairs) {
      const selected = dependency(layer, kind);
      if (selected) unique.set(selected.collection, selected);
    }
    return [...unique.values()];
  };
  const bindStoreSignals = (step: OnboardingStep) => {
    const dependencies = dependenciesFor(step);
    const nextKey = dependencies.map(({ collection }) => collection).join("|");
    if (nextKey === signalKey) return;
    disposeStoreSignals();
    signalKey = nextKey;
    if (!dependencies.length) {
      disposeStoreSignals = () => {};
      return;
    }
    let initial = true;
    disposeStoreSignals = renderOnboardingCollectionsOn(
      signals,
      dependencies.map(({ collection }) => collection),
      (snapshots) => {
        snapshots.forEach((records, index) => {
          const { layer, kind } = dependencies[index];
          (store[layer] ||= {})[kind] = [...records.values()] as unknown as StoredRecord[];
        });
        if (initial) {
          initial = false;
          return;
        }
        render();
      },
    );
  };
  function render() {
    const step = steps[Math.min(i, steps.length - 1)];
    persist({ stepKey: step.key });
    if (step.type === "welcome") renderWelcome();
    else if (step.type === "practice") renderPractice();
    else if (step.type === "gear") renderGear(step);
    else if (step.type === "workflow") renderWorkflow();
    else if (step.type === "review") renderReview();
    else renderDone();
    bindStoreSignals(step);
    requestAnimationFrame(() => {
      const target = (card.querySelector("h2") || card) as HTMLElement;
      target.setAttribute("tabindex", "-1");
      target.focus();
    });
  }

  async function refreshRecipeCatalog() {
    recipeLoad = { status: "loading", error: null };
    render();
    try {
      await loadDevRecipes();
      recipeLoad = devRecipesStatus() as RecipeLoadState;
    } catch (error) {
      recipeLoad = { status: "error", error };
    }
    if (overlay.isConnected) render();
  }

  render();
  if (recipeLoad.status !== "ready") void refreshRecipeCatalog();
  return { close };
}

// Automatic onboarding is status-aware. A durable dismissal/completion wins;
// otherwise any collection without a reusable workflow still needs guidance.
// A camera alone no longer suppresses setup: the user may still need film,
// processing, scanning, compatibility checks, and connected stage defaults.
export function needsOnboarding(store: OnboardingStore | null | undefined, did?: string | null) {
  if (!store) return false;
  const state = readOnboardingState(did);
  if (state?.status === "completed" || state?.status === "dismissed") return false;
  if (state?.status === "in-progress") return true;
  const hasWorkflow = Boolean(store.workflowTemplates?.length);
  return !hasWorkflow;
}
