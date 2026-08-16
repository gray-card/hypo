// processForms.ts: modal forms for app.graycard.process.* sessions

import type { DevelopmentRecipe, TimeRecommendation } from "@hypo/domain";
import { NS, displayToMeasure, measureToDisplay } from "../graycard.js";
import { renderOn, type RecordStore } from "@hypo/store";
import { c10ToC, cToC10, fmtMMSS, recipeRecommendationStatus, resolveTimeRecommendation } from "../devRecipes.js";
import { STAGE_PROCESS_KIND } from "../workflow.js";
import { enumLabel } from "./labels.js";
import { el, field, inputField } from "./dom.js";
import { chemistrySelect, instanceSelect, catalogSelect, shootSelect } from "./library.js";

export { STAGE_PROCESS_KIND };

type JsonObject = Record<string, unknown>;
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type InputMap = Record<string, FormControl>;

interface AgitationScheme extends JsonObject {
  initialSec?: number;
  everySec?: number;
  forSec?: number;
  inversions?: number;
  continuous?: boolean;
  note?: string;
}

interface Measure {
  value: number;
  scale?: number;
  unit?: string;
}

interface SourceDocument extends JsonObject {
  kind?: string;
  asset?: { url?: string; [key: string]: unknown };
  publisher?: string;
  revision?: string;
}

interface SourceSpec extends JsonObject {
  document?: SourceDocument;
  fields?: string[];
  page?: string;
  table?: string;
  method?: string;
  note?: string;
}

interface ProcessRecipe extends DevelopmentRecipe {
  sourceDocument?: SourceDocument;
  source?: string;
  sourceRevision?: string;
  sourcePage?: string;
  sourceTable?: string;
  specSources?: SourceSpec[];
  derivationNotes?: string;
}

interface StoredValue<Value> {
  uri: string;
  value: Value;
}

interface ProcessFormStore {
  instance: {
    chemistry: readonly StoredValue<JsonObject>[];
    [kind: string]: readonly StoredValue<JsonObject>[];
  };
  catalog?: {
    devRecipe?: readonly StoredValue<ProcessRecipe>[];
    [kind: string]: readonly StoredValue<JsonObject>[] | readonly StoredValue<ProcessRecipe>[] | undefined;
  };
}

interface BathStepInitial {
  roles?: readonly string[];
  /** @deprecated pre-unification compatibility */
  role?: string;
  chemistry?: string;
  dilution?: string;
  temperature?: Measure | null;
  timeSeconds?: string | number;
  agitation?: string;
}

interface DevelopmentStep {
  roles: string[];
  name?: string;
  kind?: string;
  chemistries?: string[];
  dilution?: string;
  temperatureSetpoint?: Measure;
  actualTemperature?: Measure;
  publishedTimeSeconds?: number;
  actualTimeSeconds?: number;
  agitationScheme?: AgitationScheme;
}

interface ProcessFormInitial {
  chemistry?: string;
  process?: string;
  filmRolls?: readonly string[];
  dilution?: string;
  temperature?: Measure | null;
  timeSeconds?: string | number;
  agitation?: string;
  tankType?: string;
  recipe?: string;
  temperatureSetpoint?: Measure | null;
  actualTemperature?: Measure | null;
  publishedTimeSeconds?: string | number;
  actualTimeSeconds?: string | number;
  agitationScheme?: AgitationScheme;
  sourceDocument?: JsonObject;
  sourceSpec?: JsonObject;
  stopBathChemistry?: string;
  fixerChemistry?: string;
  stopBath?: string;
  fixer?: string;
  steps?: readonly BathStepInitial[];
  notes?: string;
  method?: string;
  scanner?: string;
  camera?: string;
  lens?: string;
  software?: string;
  resolution?: Measure | null;
  bitDepth?: string | number;
  inversionMethod?: string;
  preset?: string;
  enlarger?: string;
  paper?: string;
  paperType?: string;
  paperInstance?: string;
  grade?: string;
  exposureTimeSeconds?: string | number;
  pictureProfile?: string;
  filmSimulation?: string;
  rawFormat?: string;
  exportFormat?: string;
}

interface ProcessFormOptions {
  signals?: Pick<RecordStore, "collection">;
}

interface StageExtraInitial {
  scanProfile?: string;
  shoot?: string;
  kind?: string;
}

export interface ProcessSessionForm {
  nodes: HTMLElement[];
  read(): Record<string, unknown>;
  dispose?(): void;
}

interface StepRow {
  roles: HTMLSelectElement;
  chem: HTMLSelectElement;
  dil: HTMLInputElement;
  tempC: HTMLInputElement;
  secs: HTMLInputElement;
  agit: HTMLInputElement;
}

const FILM_PROCESSES = ["c41", "e6", "ecn2", "bw", "ra4", "other"];
const DIGITIZE_METHODS = [
  "direct-digital",
  "tethered-capture",
  "file-import",
  "raw-export",
  "dslr-copy-stand",
  "flatbed-negative",
  "flatbed-print",
  "dedicated-film-scanner",
  "drum-scanner",
  "lab-scan",
  "smartphone",
  "other",
];
const TANK_TYPES = ["tank", "tray", "rotary", "lab-dip-and-dunk", "lab-roller", "other"];
const INVERSION_METHODS = ["none", "hardware", "software-auto", "software-manual", "preset", "other"];

// select over an open vocabulary + an "Other…" free-text escape hatch. A hidden
// input carries the effective value under data-key, so readText (which scans
// [data-key]) picks up either the selected option or the typed custom string.
const ENUM_CUSTOM = "__custom__";
function enumSelect(label: string, values: readonly string[], key: string, current = ""): HTMLLabelElement {
  const known = new Set(values);
  const hidden = el("input", { type: "hidden", "data-key": key });
  const sel = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...values.map((v) => el("option", { value: v }, enumLabel(v))),
    el("option", { value: ENUM_CUSTOM }, "Custom…"),
  ]);
  const text = el("input", { type: "text", class: "enum-custom hidden", placeholder: "Enter your own" });
  const apply = () => {
    const custom = sel.value === ENUM_CUSTOM;
    text.classList.toggle("hidden", !custom);
    hidden.value = custom ? text.value.trim() : sel.value;
  };
  if (current && !known.has(current)) {
    sel.value = ENUM_CUSTOM;
    text.value = current;
  } else sel.value = current || "";
  sel.addEventListener("change", apply);
  text.addEventListener("input", apply);
  apply();
  return field(label, el("div", { class: "enum-control" }, [sel, text, hidden]));
}

function textareaField(label: string, key: string, value = ""): { wrap: HTMLLabelElement; input: HTMLTextAreaElement } {
  const input = el("textarea", { rows: "2", "data-key": key }, value || "");
  return { wrap: field(label, input), input };
}

function readJson(input: FormControl | undefined, label: string): JsonObject | undefined {
  const text = input?.value?.trim();
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} must be a valid JSON object`);
  }
}

// map: { outKey: [inputKey, unit] } -> emits app.graycard.defs#measure objects.
function readMeasure(inputs: InputMap, map: Record<string, readonly [string, string]>): Record<string, Measure> {
  const out: Record<string, Measure> = {};
  for (const [outKey, [inKey, unit]] of Object.entries(map)) {
    const t = inputs[inKey]?.value?.trim();
    if (!t) continue;
    const m = displayToMeasure(t, unit);
    if (m) out[outKey] = m as Measure;
  }
  return out;
}

function readInts(inputs: InputMap, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const t = inputs[key]?.value?.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

const devRecipeDocument = (recipe: ProcessRecipe | null | undefined): SourceDocument | null =>
  recipe?.sourceDocument ||
  (recipe?.source
    ? {
        kind: "technical-data",
        asset: { url: recipe.source },
        publisher: recipe.developerMake || undefined,
        revision: recipe.sourceRevision || undefined,
      }
    : null);

function devRecipeSourceSpec(
  recipe: ProcessRecipe | null | undefined,
  recommendation: TimeRecommendation | null,
): SourceSpec | null {
  const document = devRecipeDocument(recipe);
  const spec = recipe?.specSources?.[0]
    ? {
        ...recipe.specSources[0],
        page: recipe.specSources[0].page || recipe.sourcePage || undefined,
        table: recipe.specSources[0].table || recipe.sourceTable || undefined,
      }
    : document
      ? {
          document,
          fields: ["temps", "agitation", "tankType", "dilution"],
          page: recipe?.sourcePage || undefined,
          table: recipe?.sourceTable || undefined,
          method: recipe?.derived ? "derived" : "manual-transcription",
        }
      : null;
  if (!spec || !recommendation) return null;
  if (recommendation.recommendationStatus !== "derived") return spec;
  const derivation =
    recommendation.kind === "interpolated"
      ? `Time at ${c10ToC(recommendation.tempC10)}°C was interpolated from the published ${recommendation.points.map((p) => `${c10ToC(p.tempC10)}°C/${fmtMMSS(p.timeSec)}`).join(" and ")} points using ${recommendation.interpolationMethod}.`
      : recipe?.derivationNotes;
  return {
    ...spec,
    method: "derived",
    note: [spec.note, derivation].filter(Boolean).join(" ") || undefined,
  };
}

/** Resolve a stored working-solution URI into the unified chemistry field. */
export function resolveWorkingSolutionUri(
  uri: string | null | undefined,
  _store: ProcessFormStore,
): { chemistry?: string } {
  if (!uri) return {};
  return { chemistry: uri };
}

export function renderProcessRecipesOn(
  signals: Pick<RecordStore, "collection">,
  render: (records: ReturnType<RecordStore["collection"]>["value"]) => void,
): () => void {
  return renderOn(() => signals.collection(NS.catalog.devRecipe).value, render);
}

export function buildProcessSessionForm(
  processKind: string,
  store: ProcessFormStore,
  initial: ProcessFormInitial = {},
  options: ProcessFormOptions = {},
): ProcessSessionForm {
  const inputs: InputMap = {};
  const nodes: HTMLElement[] = [];

  if (processKind === "developSession") {
    const workingUri = initial.chemistry || "";
    inputs.workingSolution = chemistrySelect(workingUri, {
      roles: ["film-developer", "first-developer", "color-developer"],
    });
    nodes.push(field("Working solution *", inputs.workingSolution));
    inputs.process = el(
      "select",
      { "data-key": "process" },
      FILM_PROCESSES.map((p) => el("option", { value: p }, enumLabel(p))),
    );
    inputs.process.value = initial.process || "bw";
    nodes.push(field("Process *", inputs.process));
    inputs.filmRoll = instanceSelect("filmRoll", initial.filmRolls?.[0] || "");
    nodes.push(field("Film roll", inputs.filmRoll));
    const dil = inputField("Dilution", "dilution", initial.dilution || "");
    inputs.dilution = dil.input;
    nodes.push(dil.wrap);
    const temp = inputField("Temperature °C", "temperatureC", measureToDisplay(initial.temperature));
    inputs.temperatureC = temp.input;
    nodes.push(temp.wrap);
    const time = inputField("Development time (seconds)", "timeSeconds", initial.timeSeconds ?? "");
    inputs.timeSeconds = time.input;
    nodes.push(time.wrap);
    const agit = inputField(
      "Agitation method and schedule",
      "agitation",
      initial.agitation || "",
      "e.g. inversion, 4 inversions every minute",
    );
    inputs.agitation = agit.input;
    nodes.push(agit.wrap);
    inputs.tankType = el("select", {}, [
      el("option", { value: "" }, "(none)"),
      ...TANK_TYPES.map((v) => el("option", { value: v }, enumLabel(v))),
    ]);
    inputs.tankType.value = initial.tankType || "";
    nodes.push(field("Tank type", inputs.tankType));

    // Less commonly edited recipe provenance and observed-vs-published values
    // stay available without crowding the normal manual-session form.
    const recipeOptions = (recipes: readonly StoredValue<ProcessRecipe>[]) => [
      el("option", { value: "" }, "(none)"),
      ...recipes.map((item) => {
        const r = item.value || {};
        const film = [r.filmMake, r.filmName].filter(Boolean).join(" ");
        const developer = [r.developerMake, r.developerName, r.dilution].filter(Boolean).join(" ");
        return el(
          "option",
          { value: item.uri },
          `${film} — ${developer}${r.ei ? ` · EI ${r.ei}` : ""} · ${recipeRecommendationStatus(r)}`,
        );
      }),
    ];
    inputs.recipe = el("select", {}, recipeOptions(store.catalog?.devRecipe || []));
    inputs.recipe.value = initial.recipe || "";
    const setpoint = inputField(
      "Recipe setpoint °C",
      "temperatureSetpointC",
      measureToDisplay(initial.temperatureSetpoint || initial.temperature),
    );
    inputs.temperatureSetpointC = setpoint.input;
    const actualTemp = inputField(
      "Actual temperature °C",
      "actualTemperatureC",
      measureToDisplay(initial.actualTemperature || initial.temperature),
    );
    inputs.actualTemperatureC = actualTemp.input;
    const publishedTime = inputField(
      "Published time (seconds)",
      "publishedTimeSeconds",
      initial.publishedTimeSeconds ?? initial.timeSeconds ?? "",
    );
    inputs.publishedTimeSeconds = publishedTime.input;
    const actualTime = inputField(
      "Actual time (seconds)",
      "actualTimeSeconds",
      initial.actualTimeSeconds ?? initial.timeSeconds ?? "",
    );
    inputs.actualTimeSeconds = actualTime.input;
    const agitationInitial = inputField(
      "Initial agitation (seconds)",
      "agitationInitialSec",
      initial.agitationScheme?.initialSec ?? "",
    );
    inputs.agitationInitialSec = agitationInitial.input;
    const agitationEvery = inputField(
      "Agitate every (seconds)",
      "agitationEverySec",
      initial.agitationScheme?.everySec ?? "",
    );
    inputs.agitationEverySec = agitationEvery.input;
    const agitationFor = inputField("Agitate for (seconds)", "agitationForSec", initial.agitationScheme?.forSec ?? "");
    inputs.agitationForSec = agitationFor.input;
    const agitationInversions = inputField(
      "Inversions per cycle",
      "agitationInversions",
      initial.agitationScheme?.inversions ?? "",
    );
    inputs.agitationInversions = agitationInversions.input;
    inputs.agitationContinuous = el("input", { type: "checkbox" });
    inputs.agitationContinuous.checked = initial.agitationScheme?.continuous === true;
    const agitationNote = inputField(
      "Agitation detail",
      "agitationNote",
      String(initial.agitationScheme?.note || ""),
      "e.g. gentle inversions or rotary at 30 rpm",
    );
    inputs.agitationNote = agitationNote.input;
    const sourceDocument = textareaField(
      "Source document (JSON)",
      "sourceDocument",
      initial.sourceDocument ? JSON.stringify(initial.sourceDocument, null, 2) : "",
    );
    inputs.sourceDocument = sourceDocument.input;
    const sourceSpec = textareaField(
      "Exact source location (JSON)",
      "sourceSpec",
      initial.sourceSpec ? JSON.stringify(initial.sourceSpec, null, 2) : "",
    );
    inputs.sourceSpec = sourceSpec.input;
    const recommendation = el("p", { class: "muted small process-recommendation-status", "aria-live": "polite" });
    nodes.push(
      el("details", { class: "process-technical" }, [
        el("summary", {}, "Recipe, source, and observed values"),
        field("Recipe record", inputs.recipe),
        recommendation,
        field("Selected recipe temperature °C", inputs.temperatureSetpointC),
        field("Observed actual temperature °C", inputs.actualTemperatureC),
        field("Selected recipe time (seconds)", inputs.publishedTimeSeconds),
        field("Observed actual time (seconds)", inputs.actualTimeSeconds),
        agitationInitial.wrap,
        agitationEvery.wrap,
        agitationFor.wrap,
        agitationInversions.wrap,
        field("Continuous agitation", inputs.agitationContinuous),
        agitationNote.wrap,
        sourceDocument.wrap,
        sourceSpec.wrap,
      ]),
    );

    const selectedRecipe = (): ProcessRecipe | null =>
      (store.catalog?.devRecipe || []).find((item) => item.uri === inputs.recipe.value)?.value || null;
    const selectedRecommendation = (recipe: ProcessRecipe | null = selectedRecipe()): TimeRecommendation | null => {
      const celsius = parseFloat(inputs.temperatureSetpointC.value);
      if (!recipe || !Number.isFinite(celsius)) return null;
      return resolveTimeRecommendation(recipe, cToC10(celsius));
    };
    const renderRecommendation = ({
      applyDefaults = false,
      initializeSources = false,
    }: {
      applyDefaults?: boolean;
      initializeSources?: boolean;
    } = {}): void => {
      const recipe = selectedRecipe();
      if (!recipe) {
        recommendation.textContent = "No recipe selected; selected and observed values are manual.";
        return;
      }
      let resolved = selectedRecommendation(recipe);
      if (applyDefaults) {
        inputs.publishedTimeSeconds.value = resolved ? String(resolved.timeSec) : "";
        if (resolved && !inputs.actualTimeSeconds.value.trim())
          inputs.actualTimeSeconds.value = String(resolved.timeSec);
        if (resolved && !inputs.timeSeconds.value.trim()) inputs.timeSeconds.value = String(resolved.timeSec);
      }
      const selectedTime = parseInt(inputs.publishedTimeSeconds.value, 10);
      const matchesRecipe = resolved && Number.isFinite(selectedTime) && selectedTime === resolved.timeSec;
      if (!matchesRecipe && Number.isFinite(selectedTime)) resolved = null;
      const status =
        resolved?.recommendationStatus ||
        (Number.isFinite(selectedTime) ? "observed" : recipeRecommendationStatus(recipe));
      const detail =
        resolved?.kind === "interpolated"
          ? `${resolved.interpolationMethod} interpolation`
          : resolved?.kind === "published"
            ? "exact published row"
            : "manual value";
      recommendation.textContent = `Selected recommendation: ${status} (${detail}). Observed values are recorded with manual event provenance.`;

      if (applyDefaults || initializeSources) {
        const document = devRecipeDocument(recipe);
        const spec = devRecipeSourceSpec(recipe, resolved);
        if (applyDefaults || !inputs.sourceDocument.value.trim()) {
          inputs.sourceDocument.value = document ? JSON.stringify(document, null, 2) : "";
        }
        if (applyDefaults || !inputs.sourceSpec.value.trim()) {
          inputs.sourceSpec.value = spec ? JSON.stringify(spec, null, 2) : "";
        }
      }
    };
    inputs.recipe.addEventListener("change", () => renderRecommendation({ applyDefaults: true }));
    inputs.temperatureSetpointC.addEventListener("input", () => renderRecommendation({ applyDefaults: true }));
    inputs.publishedTimeSeconds.addEventListener("input", () => renderRecommendation());
    renderRecommendation({ initializeSources: true });
    const disposeRecipes = options.signals
      ? renderProcessRecipesOn(options.signals, (records) => {
          const selected = inputs.recipe.value;
          const recipes = [...records.values()] as unknown as StoredValue<ProcessRecipe>[];
          (store.catalog ||= {}).devRecipe = recipes;
          inputs.recipe.replaceChildren(...recipeOptions(recipes));
          inputs.recipe.value = recipes.some((recipe) => recipe.uri === selected) ? selected : "";
          renderRecommendation();
        })
      : () => {};
    inputs.stopBathChemistry = chemistrySelect(initial.stopBathChemistry || "", { roles: ["stop"] });
    nodes.push(field("Stop bath (chemistry)", inputs.stopBathChemistry));
    inputs.fixerChemistry = chemistrySelect(initial.fixerChemistry || "", { roles: ["fixer"] });
    nodes.push(field("Fixer (chemistry)", inputs.fixerChemistry));
    const stop = inputField("Stop bath (label)", "stopBath", initial.stopBath || "");
    inputs.stopBath = stop.input;
    nodes.push(stop.wrap);
    const fix = inputField("Fixer (label)", "fixer", initial.fixer || "");
    inputs.fixer = fix.input;
    nodes.push(fix.wrap);

    // multi-bath step sequence (C-41 dev/blix/stab, E-6 first/color dev, …)
    const STEP_ROLES = [
      "film-developer",
      "paper-developer",
      "first-developer",
      "color-developer",
      "stop",
      "fixer",
      "bleach",
      "reversal-bath",
      "pre-bleach",
      "conditioner",
      "stabilizer",
      "final-rinse",
      "wetting-agent",
    ];
    const stepsWrap = el("div", { class: "dev-steps" });
    const stepRows: StepRow[] = [];
    function addStepRow(init: BathStepInitial = {}): void {
      const selectedRoles = new Set(init.roles?.length ? init.roles : [init.role || "film-developer"]);
      const roles = el(
        "select",
        { multiple: true, size: 4, "aria-label": "Bath roles" },
        STEP_ROLES.map((r) => el("option", { value: r, selected: selectedRoles.has(r) }, enumLabel(r))),
      );
      const chem = chemistrySelect(init.chemistry || "") as HTMLSelectElement;
      const dil = el("input", { type: "text", placeholder: "dilution", value: init.dilution || "" });
      const tempC = el("input", {
        type: "text",
        placeholder: "°C",
        value: init.temperature != null ? measureToDisplay(init.temperature) : "",
      });
      const secs = el("input", { type: "text", placeholder: "sec", value: init.timeSeconds ?? "" });
      const agit = el("input", { type: "text", placeholder: "agitation", value: init.agitation || "" });
      const rec: StepRow = { roles, chem, dil, tempC, secs, agit };
      const row = el("div", { class: "dev-step row wrap" }, [
        roles,
        chem,
        dil,
        tempC,
        secs,
        agit,
        el(
          "button",
          {
            class: "ghost small-btn danger",
            onclick: () => {
              row.remove();
              const i = stepRows.indexOf(rec);
              if (i >= 0) stepRows.splice(i, 1);
            },
          },
          "×",
        ),
      ]);
      stepRows.push(rec);
      stepsWrap.append(row);
    }
    (initial.steps || []).forEach(addStepRow);
    nodes.push(
      el("div", {}, [
        el("h3", { class: "modal-sub" }, "Bath steps (multi-step chemistry)"),
        stepsWrap,
        el("button", { class: "ghost small-btn", onclick: () => addStepRow() }, "+ Step"),
      ]),
    );

    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      dispose: disposeRecipes,
      read() {
        const ws = inputs.workingSolution.value;
        if (!ws) throw new Error("Working solution is required");
        const summaryTemperature = inputs.temperatureC.value.trim()
          ? displayToMeasure(inputs.temperatureC.value.trim(), "celsius")
          : undefined;
        const setpointTemperature = inputs.temperatureSetpointC.value.trim()
          ? displayToMeasure(inputs.temperatureSetpointC.value.trim(), "celsius")
          : summaryTemperature;
        const observedTemperature = inputs.actualTemperatureC.value.trim()
          ? displayToMeasure(inputs.actualTemperatureC.value.trim(), "celsius")
          : summaryTemperature;
        const summaryTime = parseInt(inputs.timeSeconds.value, 10);
        const publishedTimeSeconds = parseInt(inputs.publishedTimeSeconds.value, 10);
        const actualTimeSeconds = parseInt(inputs.actualTimeSeconds.value, 10);
        const agitationScheme: JsonObject = {};
        const agitationNumber = (input: FormControl): number | undefined => {
          const value = parseInt(input.value, 10);
          return Number.isFinite(value) && value >= 0 ? value : undefined;
        };
        agitationScheme.initialSec = agitationNumber(inputs.agitationInitialSec);
        agitationScheme.everySec = agitationNumber(inputs.agitationEverySec);
        agitationScheme.forSec = agitationNumber(inputs.agitationForSec);
        agitationScheme.inversions = agitationNumber(inputs.agitationInversions);
        agitationScheme.continuous = (inputs.agitationContinuous as HTMLInputElement).checked || undefined;
        agitationScheme.note = inputs.agitationNote.value.trim() || undefined;
        const hasAgitationScheme = Object.values(agitationScheme).some((value) => value !== undefined);
        const recipe = selectedRecipe();
        const resolved = selectedRecommendation(recipe);
        const selectedMatchesRecipe =
          resolved && Number.isFinite(publishedTimeSeconds) && publishedTimeSeconds === resolved.timeSec;
        let selectedSourceSpec = readJson(inputs.sourceSpec, "Exact source location");
        if (selectedMatchesRecipe && resolved.recommendationStatus === "derived" && selectedSourceSpec) {
          selectedSourceSpec = { ...selectedSourceSpec, method: "derived" };
        }
        const selectedStatus = selectedMatchesRecipe
          ? resolved.recommendationStatus
          : Number.isFinite(publishedTimeSeconds)
            ? "observed"
            : recipeRecommendationStatus(recipe);
        const steps = stepRows
          .map((r) => {
            const selectedRoles = [...r.roles.selectedOptions].map((option) => option.value);
            const s: DevelopmentStep = {
              name: selectedRoles.map(enumLabel).join(" + ") || "Process stage",
              kind: selectedRoles.includes("wash") ? "wash" : "chemical-bath",
              roles: selectedRoles,
            };
            if (r.chem.value) {
              s.chemistries = [r.chem.value];
            }
            if (r.dil.value.trim()) s.dilution = r.dil.value.trim();
            const t = r.tempC.value.trim();
            if (t) {
              const m = displayToMeasure(t, "celsius");
              if (m) s.actualTemperature = m;
            }
            const sec = parseInt(r.secs.value, 10);
            if (Number.isFinite(sec)) s.actualTimeSeconds = sec;
            if (r.agit.value.trim()) s.agitationScheme = { note: r.agit.value.trim() };
            return s;
          })
          .filter((s) => s.roles.length);
        const primaryRole =
          inputs.process.value === "e6"
            ? "first-developer"
            : ["c41", "ecn2"].includes(inputs.process.value)
              ? "color-developer"
              : "film-developer";
        const primaryStep: JsonObject = {
          name: enumLabel(primaryRole),
          kind: "chemical-bath",
          roles: [primaryRole],
          chemistries: ws ? [ws] : undefined,
          recipe: inputs.recipe.value || undefined,
          dilution: inputs.dilution.value.trim() || undefined,
          temperatureSetpoint: setpointTemperature,
          actualTemperature: observedTemperature,
          publishedTimeSeconds: Number.isFinite(publishedTimeSeconds)
            ? publishedTimeSeconds
            : Number.isFinite(summaryTime)
              ? summaryTime
              : undefined,
          actualTimeSeconds: Number.isFinite(actualTimeSeconds)
            ? actualTimeSeconds
            : Number.isFinite(summaryTime)
              ? summaryTime
              : undefined,
          agitationScheme:
            hasAgitationScheme || inputs.agitation.value.trim()
              ? {
                  ...agitationScheme,
                  note: agitationScheme.note || inputs.agitation.value.trim() || undefined,
                }
              : undefined,
          sourceDocument: readJson(inputs.sourceDocument, "Source document"),
          sourceSpec: selectedSourceSpec,
        };
        const developerIndex = steps.findIndex((step) =>
          step.roles.some((role) => ["film-developer", "first-developer", "color-developer"].includes(role)),
        );
        if (developerIndex >= 0)
          steps[developerIndex] = { ...primaryStep, ...steps[developerIndex] } as DevelopmentStep;
        else steps.unshift(primaryStep as DevelopmentStep);
        const addShortcutBath = (role: string, chemistry: string, label: string) => {
          if (!chemistry && !label) return;
          if (steps.some((step) => step.roles.includes(role))) return;
          steps.push({
            name: label || enumLabel(role),
            kind: "chemical-bath",
            roles: [role],
            chemistries: chemistry ? [chemistry] : undefined,
          });
        };
        addShortcutBath("stop", inputs.stopBathChemistry.value, inputs.stopBath.value.trim());
        addShortcutBath("fixer", inputs.fixerChemistry.value, inputs.fixer.value.trim());
        return {
          process: inputs.process.value,
          filmRolls: inputs.filmRoll.value ? [inputs.filmRoll.value] : undefined,
          provenance: {
            source: "manual",
            assertedAt: new Date().toISOString(),
            note: selectedMatchesRecipe
              ? `Selected time used ${resolved.kind === "interpolated" ? "a derived interpolation" : `an exact ${selectedStatus} recipe row`}; actual time and temperature were observed manually.`
              : "Selected time and actual processing values were entered or observed manually.",
          },
          tankType: inputs.tankType.value || undefined,
          steps,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "digitizeSession") {
    nodes.push(enumSelect("Method *", DIGITIZE_METHODS, "method", initial.method || "dedicated-film-scanner"));
    inputs.method = nodes[nodes.length - 1].querySelector("select") as HTMLSelectElement;
    inputs.scanner = instanceSelect("scanner", initial.scanner || "");
    nodes.push(field("Scanner", inputs.scanner));
    inputs.camera = instanceSelect("camera", initial.camera || "");
    nodes.push(field("Camera (copy stand)", inputs.camera));
    inputs.lens = instanceSelect("lens", initial.lens || "");
    nodes.push(field("Lens (copy stand)", inputs.lens));
    const sw = inputField("Software", "software", initial.software || "");
    inputs.software = sw.input;
    nodes.push(sw.wrap);
    const dpi = inputField("Resolution DPI", "resolutionDpi", measureToDisplay(initial.resolution));
    inputs.resolutionDpi = dpi.input;
    nodes.push(dpi.wrap);
    const bd = inputField("Bit depth", "bitDepth", initial.bitDepth ?? "");
    inputs.bitDepth = bd.input;
    nodes.push(bd.wrap);
    nodes.push(
      enumSelect("Inversion", INVERSION_METHODS, "inversionMethod", initial.inversionMethod || "software-auto"),
    );
    inputs.inversionMethod = nodes[nodes.length - 1].querySelector("select") as HTMLSelectElement;
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        if (!inputs.method.value) throw new Error("Digitize method is required");
        return {
          method: inputs.method.value,
          scanner: inputs.scanner.value || undefined,
          camera: inputs.camera.value || undefined,
          lens: inputs.lens.value || undefined,
          software: inputs.software.value.trim() || undefined,
          ...readMeasure(inputs, { resolution: ["resolutionDpi", "dpi"] }),
          ...readInts(inputs, ["bitDepth"]),
          inversionMethod: inputs.inversionMethod.value || undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "editSession") {
    const sw = inputField("Software *", "software", initial.software || "");
    inputs.software = sw.input;
    nodes.push(sw.wrap);
    const preset = inputField("Preset", "preset", initial.preset || "");
    inputs.preset = preset.input;
    nodes.push(preset.wrap);
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        if (!inputs.software.value.trim()) throw new Error("Software is required");
        return {
          software: inputs.software.value.trim(),
          preset: inputs.preset.value.trim() || undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "printSession") {
    inputs.enlarger = instanceSelect("enlarger", initial.enlarger || "");
    nodes.push(field("Enlarger", inputs.enlarger));
    inputs.paper = catalogSelect("paperType", initial.paper || initial.paperType || "");
    nodes.push(field("Paper type", inputs.paper));
    const pi = inputField("Paper batch / instance", "paperInstance", initial.paperInstance || "");
    inputs.paperInstance = pi.input;
    nodes.push(pi.wrap);
    const grade = inputField("Grade", "grade", initial.grade || "");
    inputs.grade = grade.input;
    nodes.push(grade.wrap);
    const exp = inputField("Exposure (seconds)", "exposureTimeSeconds", initial.exposureTimeSeconds ?? "");
    inputs.exposureTimeSeconds = exp.input;
    nodes.push(exp.wrap);
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        return {
          enlarger: inputs.enlarger.value || undefined,
          paper: inputs.paper.value || undefined,
          paperInstance: inputs.paperInstance.value.trim() || undefined,
          grade: inputs.grade.value.trim() || undefined,
          ...readInts(inputs, ["exposureTimeSeconds"]),
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "renderSession") {
    const sw = inputField("Software", "software", initial.software || "");
    inputs.software = sw.input;
    nodes.push(sw.wrap);
    const exp = inputField("Output format", "outputFormat", initial.outputFormat || "");
    inputs.outputFormat = exp.input;
    nodes.push(exp.wrap);
    const color = inputField("Color space", "colorSpace", initial.colorSpace || "");
    inputs.colorSpace = color.input;
    nodes.push(color.wrap);
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        return {
          software: inputs.software.value.trim() || undefined,
          outputFormat: inputs.outputFormat.value.trim() || undefined,
          colorSpace: inputs.colorSpace.value.trim() || undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  return {
    nodes: [el("p", { class: "muted" }, "No session form for this stage.")],
    read: () => ({ createdAt: new Date().toISOString() }),
  };
}

export function stageExtraFields(
  kind: string,
  _store: ProcessFormStore,
  initial: StageExtraInitial = {},
): ProcessSessionForm {
  const inputs: InputMap = {};
  const nodes: HTMLElement[] = [];
  if (kind === "digitize") {
    inputs.scanProfile = catalogSelect("scanProfile", initial.scanProfile || "");
    nodes.push(field("Scan profile", inputs.scanProfile));
  }
  if (kind === "capture") {
    inputs.shoot = shootSelect(initial.shoot || "");
    nodes.push(field("Shoot", inputs.shoot));
  }
  if (kind === "other") {
    const k = inputField("Stage kind *", "kind", initial.kind || "");
    inputs.kind = k.input;
    nodes.push(k.wrap);
  }
  return {
    nodes,
    read() {
      const out: Record<string, string> = {};
      if (inputs.scanProfile?.value) out.scanProfile = inputs.scanProfile.value;
      if (inputs.shoot?.value) out.shoot = inputs.shoot.value;
      const k = inputs.kind?.value?.trim();
      if (k) out.kind = k;
      return out;
    },
  };
}
