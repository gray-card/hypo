import { dateField, el, field, localInputToIso } from "@hypo/ui";
import { createCatalogSelect, createChemistrySelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryValue } from "./maintenance-types.ts";

const MAX_SECONDS = 604_800;

export const DEVELOPMENT_AGITATION_METHODS = [
  ["none", "None"],
  ["inversion", "Inversion"],
  ["rotary", "Rotary"],
  ["swizzle-stick", "Swizzle stick"],
  ["tray-rocking", "Tray rocking"],
  ["dip-and-dunk", "Dip and dunk"],
  ["roller-transport", "Roller transport"],
  ["nitrogen-burst", "Nitrogen burst"],
  ["manual", "Other manual agitation"],
  ["other", "Other"],
] as const;

export const DEVELOPMENT_ROLES = [
  "pre-soak",
  "film-developer",
  "first-developer",
  "color-developer",
  "reversal-bath",
  "stop",
  "bleach",
  "fixer",
  "conditioner",
  "pre-bleach",
  "stabilizer",
  "wash",
  "wash-aid",
  "clearing-agent",
  "hardener",
  "wetting-agent",
  "final-rinse",
  "other",
] as const;

interface StagePreset {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly kind: string;
  readonly roles: readonly string[];
}

export const DEVELOPMENT_STAGE_PRESETS: readonly StagePreset[] = [
  { id: "pre-soak", label: "Pre-soak", name: "Pre-soak", kind: "water-bath", roles: ["pre-soak"] },
  {
    id: "film-developer",
    label: "Film developer",
    name: "Developer",
    kind: "chemical-bath",
    roles: ["film-developer"],
  },
  {
    id: "first-developer",
    label: "First developer",
    name: "First developer",
    kind: "chemical-bath",
    roles: ["first-developer"],
  },
  {
    id: "color-developer",
    label: "Color developer",
    name: "Color developer",
    kind: "chemical-bath",
    roles: ["color-developer"],
  },
  {
    id: "reversal-bath",
    label: "Reversal bath",
    name: "Reversal bath",
    kind: "chemical-bath",
    roles: ["reversal-bath"],
  },
  { id: "re-exposure", label: "Re-exposure", name: "Re-exposure", kind: "re-exposure", roles: [] },
  { id: "stop", label: "Stop bath", name: "Stop bath", kind: "chemical-bath", roles: ["stop"] },
  { id: "rinse", label: "Rinse", name: "Rinse", kind: "rinse", roles: [] },
  { id: "bleach", label: "Bleach", name: "Bleach", kind: "chemical-bath", roles: ["bleach"] },
  { id: "fixer", label: "Fixer", name: "Fixer", kind: "chemical-bath", roles: ["fixer"] },
  {
    id: "blix",
    label: "Bleach + fixer (blix)",
    name: "Bleach + fixer",
    kind: "chemical-bath",
    roles: ["bleach", "fixer"],
  },
  {
    id: "monobath",
    label: "Developer + fixer (monobath)",
    name: "Monobath",
    kind: "chemical-bath",
    roles: ["film-developer", "fixer"],
  },
  {
    id: "pre-bleach",
    label: "Pre-bleach",
    name: "Pre-bleach",
    kind: "chemical-bath",
    roles: ["pre-bleach"],
  },
  {
    id: "conditioner",
    label: "Conditioner",
    name: "Conditioner",
    kind: "chemical-bath",
    roles: ["conditioner"],
  },
  {
    id: "wash-aid",
    label: "Wash aid / clearing bath",
    name: "Wash aid",
    kind: "chemical-bath",
    roles: ["wash-aid"],
  },
  { id: "wash", label: "Wash", name: "Wash", kind: "wash", roles: ["wash"] },
  {
    id: "stabilizer",
    label: "Stabilizer",
    name: "Stabilizer",
    kind: "chemical-bath",
    roles: ["stabilizer"],
  },
  {
    id: "final-rinse",
    label: "Final rinse",
    name: "Final rinse",
    kind: "chemical-bath",
    roles: ["final-rinse"],
  },
  {
    id: "wetting-agent",
    label: "Wetting agent",
    name: "Wetting agent",
    kind: "chemical-bath",
    roles: ["wetting-agent"],
  },
  {
    id: "rem-jet-removal",
    label: "Rem-jet removal",
    name: "Rem-jet removal",
    kind: "rem-jet-removal",
    roles: [],
  },
  { id: "dry", label: "Dry", name: "Dry", kind: "dry", roles: [] },
  {
    id: "other-chemical",
    label: "Other chemical bath",
    name: "Chemical bath",
    kind: "chemical-bath",
    roles: ["other"],
  },
  { id: "other-operation", label: "Other operation", name: "Operation", kind: "other", roles: [] },
];

export const PROCESS_STAGE_SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  bw: ["film-developer", "stop", "fixer", "wash", "wetting-agent"],
  monobath: ["monobath", "wash", "wetting-agent"],
  c41: ["color-developer", "bleach", "fixer", "wash", "final-rinse", "dry"],
  e6: [
    "first-developer",
    "wash",
    "reversal-bath",
    "color-developer",
    "pre-bleach",
    "bleach",
    "fixer",
    "wash",
    "final-rinse",
    "dry",
  ],
  ecn2: ["rem-jet-removal", "color-developer", "stop", "wash", "bleach", "wash", "fixer", "wash", "final-rinse", "dry"],
  "reversal-bw": [
    "first-developer",
    "wash",
    "bleach",
    "wash",
    "re-exposure",
    "film-developer",
    "fixer",
    "wash",
    "wetting-agent",
  ],
  other: ["other-chemical"],
};

function nonnegativeInteger(
  input: HTMLInputElement,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (!input.value.trim()) return undefined;
  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be between 0 and ${maximum}`);
  }
  return value;
}

function durationSeconds(minutes: HTMLInputElement, seconds: HTMLInputElement, label: string): number | undefined {
  const minuteValue = nonnegativeInteger(minutes, `${label} minutes`, 10_080);
  const secondValue = nonnegativeInteger(seconds, `${label} seconds`, 59);
  if (minuteValue === undefined && secondValue === undefined) return undefined;
  const total = (minuteValue || 0) * 60 + (secondValue || 0);
  if (total > MAX_SECONDS) throw new Error(`${label} cannot exceed 7 days`);
  return total;
}

function measure(input: HTMLInputElement): LibraryValue | undefined {
  if (!input.value.trim()) return undefined;
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value) || value < 0 || value > 60) throw new Error("Temperature must be between 0 and 60 °C");
  return { unit: "celsius", value: Math.round(value * 1_000_000), scale: 1_000_000 };
}

function setDuration(seconds: unknown, minutesInput: HTMLInputElement, secondsInput: HTMLInputElement): void {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return;
  minutesInput.value = String(Math.floor(value / 60));
  secondsInput.value = String(Math.round(value % 60));
}

function measureText(value: unknown): string {
  const object = value as LibraryValue | undefined;
  if (!object || !Number.isFinite(Number(object.value))) return "";
  return String(Number(object.value) / Number(object.scale || 1));
}

function stagePreset(id: string): StagePreset {
  return DEVELOPMENT_STAGE_PRESETS.find((preset) => preset.id === id) || DEVELOPMENT_STAGE_PRESETS.at(-1)!;
}

function stagePresetForInitial(initial: LibraryValue): StagePreset {
  const roles = Array.isArray(initial.roles) ? initial.roles.map(String) : [];
  return (
    DEVELOPMENT_STAGE_PRESETS.find(
      (preset) =>
        preset.kind === String(initial.kind || "chemical-bath") &&
        preset.roles.length === roles.length &&
        preset.roles.every((role) => roles.includes(role)),
    ) || stagePreset(initial.kind === "dry" ? "dry" : "other-chemical")
  );
}

interface StageRow {
  readonly node: HTMLElement;
  read(position: number): LibraryValue;
  summary(): string;
  move(delta: number): void;
}

export interface DevelopmentStepEditor {
  readonly node: HTMLElement;
  readonly length: number;
  addPreset(id: string, initial?: LibraryValue): void;
  replaceWithProcess(process: string): void;
  read(): LibraryValue[];
}

export function chemistryUrisForDevelopment(session: LibraryValue): string[] {
  const uris = new Set<string>();
  for (const step of Array.isArray(session.steps) ? session.steps : []) {
    for (const uri of Array.isArray(step?.chemistries) ? step.chemistries : []) {
      if (typeof uri === "string" && uri) uris.add(uri);
    }
  }
  return [...uris];
}

export function primaryDeveloperForSteps(steps: readonly LibraryValue[]): string | undefined {
  for (const step of steps) {
    const roles = Array.isArray(step.roles) ? step.roles.map(String) : [];
    if (!roles.some((role) => role === "film-developer" || role === "first-developer" || role === "color-developer")) {
      continue;
    }
    const chemistry = Array.isArray(step.chemistries) ? step.chemistries[0] : undefined;
    if (typeof chemistry === "string" && chemistry) return chemistry;
  }
  return undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function validateDevelopmentChronology(
  steps: readonly LibraryValue[],
  startedAt?: string,
  finishedAt?: string,
): void {
  const sessionStart = timestamp(startedAt);
  const sessionFinish = timestamp(finishedAt);
  if (sessionStart !== undefined && sessionFinish !== undefined && sessionStart > sessionFinish) {
    throw new Error("Session start cannot be after session finish");
  }

  let previousObserved: number | undefined;
  for (const [index, step] of steps.entries()) {
    const start = timestamp(step.startedAt);
    const finish = timestamp(step.finishedAt);
    const label = String(step.name || `Stage ${index + 1}`);
    if (start !== undefined && finish !== undefined && start > finish) {
      throw new Error(`${label} cannot finish before it starts`);
    }
    if (sessionStart !== undefined && (start ?? finish) !== undefined && (start ?? finish)! < sessionStart) {
      throw new Error(`${label} cannot occur before the session starts`);
    }
    if (sessionFinish !== undefined && (finish ?? start) !== undefined && (finish ?? start)! > sessionFinish) {
      throw new Error(`${label} cannot occur after the session finishes`);
    }
    const firstObserved = start ?? finish;
    if (previousObserved !== undefined && firstObserved !== undefined && firstObserved < previousObserved) {
      throw new Error(`${label} cannot be dated before an earlier stage`);
    }
    previousObserved = finish ?? start ?? previousObserved;
  }
}

export function createDevelopmentStepEditor(
  services: ActivityServices,
  initialSteps: readonly LibraryValue[] = [],
): DevelopmentStepEditor {
  const rows: StageRow[] = [];
  const list = el("div", { class: "development-stage-list" });
  const addSelect = el(
    "select",
    { "aria-label": "Development stage to add" },
    DEVELOPMENT_STAGE_PRESETS.map((preset) => el("option", { value: preset.id }, preset.label)),
  );
  const processSelect = el(
    "select",
    { "aria-label": "Typical development sequence" },
    ["bw", "monobath", "c41", "e6", "ecn2", "reversal-bw", "other"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );

  const renderPositions = () => {
    rows.forEach((row, index) => {
      row.node.dataset.position = String(index + 1);
      const number = row.node.querySelector<HTMLElement>("[data-stage-number]");
      if (number) number.textContent = `Stage ${index + 1}`;
      const up = row.node.querySelector<HTMLButtonElement>('[data-move="up"]');
      const down = row.node.querySelector<HTMLButtonElement>('[data-move="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  };

  const addPreset = (id: string, initial: LibraryValue = {}) => {
    const preset = Object.keys(initial).length ? stagePresetForInitial(initial) : stagePreset(id);
    const name = el("input", { type: "text", value: initial.name || preset.name, maxlength: "128" });
    const kind = el(
      "select",
      {},
      ["chemical-bath", "water-bath", "rinse", "wash", "rem-jet-removal", "re-exposure", "drain", "dry", "other"].map(
        (value) => el("option", { value }, services.enumLabel(value)),
      ),
    );
    kind.value = String(initial.kind || preset.kind);
    const selectedRoles = new Set<string>(Array.isArray(initial.roles) ? initial.roles.map(String) : [...preset.roles]);
    const roleInputs = DEVELOPMENT_ROLES.map((role) => {
      const input = el("input", { type: "checkbox", value: role, checked: selectedRoles.has(role) });
      return {
        role,
        input,
        node: el("label", { class: "development-role-option" }, [input, services.enumLabel(role)]),
      };
    });
    const initialChemistries = new Set<string>(
      Array.isArray(initial.chemistries) ? initial.chemistries.map(String) : [],
    );
    const initialPrimaryChemistry = [...initialChemistries][0] || "";
    const primaryChemistry = createChemistrySelect(initialPrimaryChemistry, undefined, services);
    primaryChemistry.setAttribute("aria-label", "Primary chemistry for stage");
    const additionalChemistry = (services.getStore().instance.chemistry || []).map((record) => {
      const input = el("input", {
        type: "checkbox",
        value: record.uri,
        checked: initialChemistries.has(record.uri) && record.uri !== initialPrimaryChemistry,
      });
      return {
        uri: record.uri,
        input,
        node: el("label", { class: "development-role-option" }, [
          input,
          services.instanceLabel("chemistry", record.value),
        ]),
      };
    });
    const syncAdditional = () => {
      for (const option of additionalChemistry) {
        option.input.disabled = option.uri === primaryChemistry.value;
        if (option.input.disabled) option.input.checked = false;
      }
    };
    primaryChemistry.addEventListener("change", syncAdditional);
    syncAdditional();

    const recipe = createCatalogSelect("devRecipe", String(initial.recipe || ""), services);
    const dilution = el("input", { type: "text", value: initial.dilution || "", maxlength: "64" });
    const targetTemp = el("input", {
      type: "number",
      min: "0",
      max: "60",
      step: "0.1",
      inputmode: "decimal",
      value: measureText(initial.temperatureSetpoint || initial.temperature),
    });
    const actualTemp = el("input", {
      type: "number",
      min: "0",
      max: "60",
      step: "0.1",
      inputmode: "decimal",
      value: measureText(initial.actualTemperature || initial.temperature),
    });
    const plannedMinutes = el("input", { type: "number", min: "0", inputmode: "numeric", placeholder: "min" });
    const plannedSeconds = el("input", {
      type: "number",
      min: "0",
      max: "59",
      inputmode: "numeric",
      placeholder: "sec",
    });
    const actualMinutes = el("input", { type: "number", min: "0", inputmode: "numeric", placeholder: "min" });
    const actualSeconds = el("input", {
      type: "number",
      min: "0",
      max: "59",
      inputmode: "numeric",
      placeholder: "sec",
    });
    setDuration(initial.publishedTimeSeconds, plannedMinutes, plannedSeconds);
    setDuration(initial.actualTimeSeconds ?? initial.timeSeconds, actualMinutes, actualSeconds);
    const started = dateField("Stage started (optional)", String(initial.startedAt || ""));
    const finished = dateField("Stage finished (optional)", String(initial.finishedAt || ""));
    const agitationMethod = el(
      "select",
      {},
      DEVELOPMENT_AGITATION_METHODS.map(([value, label]) => el("option", { value }, label)),
    );
    agitationMethod.value = String(initial.agitationMethod || "none");
    const scheme = (initial.agitationScheme || {}) as LibraryValue;
    const agitationInitial = el("input", { type: "number", min: "0", value: scheme.initialSec ?? "" });
    const agitationEvery = el("input", { type: "number", min: "0", value: scheme.everySec ?? "" });
    const agitationFor = el("input", { type: "number", min: "0", value: scheme.forSec ?? "" });
    const agitationInversions = el("input", { type: "number", min: "0", max: "100", value: scheme.inversions ?? "" });
    const agitationContinuous = el("input", { type: "checkbox", checked: scheme.continuous === true });
    const agitationNote = el("input", {
      type: "text",
      value: scheme.note || initial.agitation || "",
      maxlength: "256",
      placeholder: "e.g. gentle inversions or 30 rpm",
    });
    const volume = el("input", { type: "number", min: "0", inputmode: "numeric", value: initial.volumeMl ?? "" });
    const disposition = el(
      "select",
      {},
      [
        ["", "Not recorded"],
        ["one-shot-discarded", "One-shot; discarded"],
        ["discarded", "Discarded"],
        ["returned-to-stock", "Returned to stock"],
        ["retained", "Retained for reuse"],
        ["replenished", "Replenished"],
        ["exhausted", "Exhausted"],
        ["not-applicable", "Not applicable"],
        ["unknown", "Unknown"],
      ].map(([value, label]) => el("option", { value }, label)),
    );
    disposition.value = String(initial.disposition || "");
    const notes = el("textarea", { rows: "2", maxlength: "1000" }, String(initial.notes || ""));

    const row: StageRow = {
      node: document.createElement("section"),
      read(position) {
        const roles = roleInputs.filter((option) => option.input.checked).map((option) => option.role);
        const chemistries = [
          primaryChemistry.value,
          ...additionalChemistry.filter((option) => option.input.checked).map((option) => option.uri),
        ].filter((value, index, values) => value && values.indexOf(value) === index);
        const planned = durationSeconds(
          plannedMinutes,
          plannedSeconds,
          `${name.value || `Stage ${position}`} planned time`,
        );
        const actual = durationSeconds(
          actualMinutes,
          actualSeconds,
          `${name.value || `Stage ${position}`} actual time`,
        );
        const initialSec = nonnegativeInteger(agitationInitial, "Initial agitation seconds", MAX_SECONDS);
        const everySec = nonnegativeInteger(agitationEvery, "Agitation interval", MAX_SECONDS);
        const forSec = nonnegativeInteger(agitationFor, "Agitation duration", MAX_SECONDS);
        const inversions = nonnegativeInteger(agitationInversions, "Inversions per cycle", 100);
        if (everySec !== undefined && forSec !== undefined && forSec > everySec) {
          throw new Error(`${name.value || `Stage ${position}`} agitation duration cannot exceed its cycle interval`);
        }
        const agitationScheme: LibraryValue = {
          initialSec,
          everySec,
          forSec,
          inversions,
          continuous: agitationContinuous.checked || undefined,
          note: agitationNote.value.trim() || undefined,
        };
        const hasAgitation = Object.values(agitationScheme).some((value) => value !== undefined);
        const target = measure(targetTemp);
        const observed = measure(actualTemp);
        const startedAt = localInputToIso(started.input.value) || undefined;
        const finishedAt = localInputToIso(finished.input.value) || undefined;
        const volumeMl = nonnegativeInteger(volume, `${name.value || `Stage ${position}`} volume`);
        return {
          name: name.value.trim() || preset.name,
          kind: kind.value,
          roles,
          chemistries: chemistries.length ? chemistries : undefined,
          recipe: recipe.value || undefined,
          dilution: dilution.value.trim() || undefined,
          temperatureSetpoint: target,
          actualTemperature: observed,
          publishedTimeSeconds: planned,
          actualTimeSeconds: actual,
          startedAt,
          finishedAt,
          agitationMethod: agitationMethod.value === "none" ? undefined : agitationMethod.value,
          agitationScheme: hasAgitation ? agitationScheme : undefined,
          volumeMl,
          disposition: disposition.value || undefined,
          notes: notes.value.trim() || undefined,
        };
      },
      summary() {
        return name.value.trim() || preset.name;
      },
      move(delta) {
        const index = rows.indexOf(row);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= rows.length) return;
        rows.splice(index, 1);
        rows.splice(target, 0, row);
        list.replaceChildren(...rows.map((candidate) => candidate.node));
        renderPositions();
        row.node.focus();
      },
    };
    row.node.className = "development-stage-card";
    row.node.tabIndex = -1;
    const remove = () => {
      const index = rows.indexOf(row);
      if (index < 0) return;
      rows.splice(index, 1);
      row.node.remove();
      renderPositions();
    };
    const updatePreset = () => {
      const next = stagePreset(String((presetSelect as HTMLSelectElement).value));
      name.value = next.name;
      kind.value = next.kind;
      roleInputs.forEach((option) => (option.input.checked = next.roles.includes(option.role)));
      title.textContent = next.name;
    };
    const presetSelect = el(
      "select",
      { "aria-label": "Stage type", onchange: updatePreset },
      DEVELOPMENT_STAGE_PRESETS.map((candidate) =>
        el("option", { value: candidate.id, selected: candidate.id === preset.id }, candidate.label),
      ),
    );
    const title = el("strong", { class: "development-stage-title" }, String(initial.name || preset.name));
    name.addEventListener("input", () => (title.textContent = name.value.trim() || preset.name));
    row.node.append(
      el("div", { class: "development-stage-header" }, [
        el("div", { class: "development-stage-heading" }, [
          el("span", { class: "mono muted small", "data-stage-number": "" }, "Stage"),
          title,
        ]),
        el("div", { class: "row development-stage-actions" }, [
          el(
            "button",
            {
              type: "button",
              class: "ghost icon-btn",
              "data-move": "up",
              title: "Move stage up",
              onclick: () => row.move(-1),
            },
            "↑",
          ),
          el(
            "button",
            {
              type: "button",
              class: "ghost icon-btn",
              "data-move": "down",
              title: "Move stage down",
              onclick: () => row.move(1),
            },
            "↓",
          ),
          el("button", { type: "button", class: "ghost icon-btn danger", title: "Remove stage", onclick: remove }, "×"),
        ]),
      ]),
      el("div", { class: "development-stage-core" }, [
        field("Stage type", presetSelect),
        field("Tracked chemistry", primaryChemistry),
        field("Actual minutes", actualMinutes),
        field("Actual seconds", actualSeconds),
        field("Actual temperature °C", actualTemp),
      ]),
      el("details", { class: "development-stage-details" }, [
        el("summary", {}, "Dates, targets, agitation, and bath details"),
        el("div", { class: "development-stage-detail-grid" }, [
          field("Stage name", name),
          field("Physical stage kind", kind),
          field("Development recipe", recipe),
          field("Dilution", dilution),
          field("Planned minutes", plannedMinutes),
          field("Planned seconds", plannedSeconds),
          field("Target temperature °C", targetTemp),
          started.wrap,
          finished.wrap,
          field("Working volume (ml)", volume),
          field("Bath after use", disposition),
          field("Agitation method", agitationMethod),
        ]),
        el("div", { class: "development-stage-subsection" }, [
          el("span", { class: "field-label" }, "Stage roles (select every function this bath performs)"),
          el(
            "div",
            { class: "development-role-grid" },
            roleInputs.map((option) => option.node),
          ),
        ]),
        additionalChemistry.length
          ? el("div", { class: "development-stage-subsection" }, [
              el("span", { class: "field-label" }, "Additional chemistry combined in this stage"),
              el(
                "div",
                { class: "development-role-grid" },
                additionalChemistry.map((option) => option.node),
              ),
            ])
          : null,
        el("div", { class: "development-stage-detail-grid agitation-detail-grid" }, [
          field("Initial agitation (seconds)", agitationInitial),
          field("Agitate every (seconds)", agitationEvery),
          field("Agitate for (seconds)", agitationFor),
          field("Inversions per cycle", agitationInversions),
        ]),
        el("label", { class: "check-row" }, [agitationContinuous, el("span", {}, "Continuous agitation")]),
        field("Agitation detail", agitationNote),
        field("Stage notes", notes),
      ]),
    );
    rows.push(row);
    list.append(row.node);
    renderPositions();
  };

  const replaceWithProcess = (process: string) => {
    rows.splice(0, rows.length);
    list.replaceChildren();
    for (const id of PROCESS_STAGE_SEQUENCES[process] || PROCESS_STAGE_SEQUENCES.other) addPreset(id);
  };

  const node = el("div", { class: "development-stage-editor" }, [
    el("div", { class: "development-sequence-tools" }, [
      field("Typical sequence", processSelect),
      el(
        "button",
        { type: "button", class: "ghost small-btn", onclick: () => replaceWithProcess(processSelect.value) },
        "Use sequence",
      ),
    ]),
    el(
      "p",
      { class: "muted small" },
      "The sequence is a starting point. Add, remove, or reorder stages to match what you actually did; combined baths may have more than one role.",
    ),
    list,
    el("div", { class: "development-add-stage row wrap" }, [
      addSelect,
      el(
        "button",
        { type: "button", class: "ghost small-btn", onclick: () => addPreset(addSelect.value) },
        "+ Add stage",
      ),
    ]),
  ]);

  if (initialSteps.length) {
    for (const initial of initialSteps) addPreset("other-chemical", initial);
  } else {
    addPreset("film-developer");
  }

  return {
    node,
    get length() {
      return rows.length;
    },
    addPreset,
    replaceWithProcess,
    read() {
      const steps = rows.map((row, index) => row.read(index + 1));
      if (!steps.length) throw new Error("Add at least one development stage");
      return steps;
    },
  };
}
