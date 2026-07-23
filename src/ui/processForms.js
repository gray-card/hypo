// processForms.js: modal forms for app.graycard.process.* sessions

import { displayToScaled, displayToMeasure, measureToDisplay } from "../graycard.js";
import { STAGE_PROCESS_KIND } from "../workflow.js";
import { enumLabel } from "./labels.js";
import { el, field, inputField } from "./dom.js";
import {
  developerOrChemistrySelect, instanceSelect, catalogSelect, shootSelect,
} from "./library.js";

export { STAGE_PROCESS_KIND };

const FILM_PROCESSES = ["c41", "e6", "ecn2", "bw", "ra4", "other"];
const DIGITIZE_METHODS = [
  "direct-digital", "tethered-capture", "file-import", "raw-export",
  "dslr-copy-stand", "flatbed-negative", "flatbed-print",
  "dedicated-film-scanner", "drum-scanner", "lab-scan", "smartphone", "other",
];
const TANK_TYPES = ["tank", "tray", "rotary", "lab-dip-and-dunk", "lab-roller", "other"];
const INVERSION_METHODS = ["none", "hardware", "software-auto", "software-manual", "preset", "other"];

// select over an open vocabulary + an "Other…" free-text escape hatch. A hidden
// input carries the effective value under data-key, so readText (which scans
// [data-key]) picks up either the selected option or the typed custom string.
const ENUM_CUSTOM = "__custom__";
function enumSelect(label, values, key, current = "") {
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
  if (current && !known.has(current)) { sel.value = ENUM_CUSTOM; text.value = current; }
  else sel.value = current || "";
  sel.addEventListener("change", apply);
  text.addEventListener("input", apply);
  apply();
  return field(label, el("div", { class: "enum-control" }, [sel, text, hidden]));
}

function textareaField(label, key, value = "") {
  const input = el("textarea", { rows: "2", "data-key": key }, value || "");
  return { wrap: field(label, input), input };
}

function readText(inputs) {
  const out = {};
  for (const [key, input] of Object.entries(inputs)) {
    const t = input.value?.trim?.() ?? input.value;
    if (!t) continue;
    out[key] = t;
  }
  return out;
}

function readJson(input, label) {
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

function readScaled(inputs, keys) {
  const out = {};
  for (const key of keys) {
    const t = inputs[key]?.value?.trim();
    if (!t) continue;
    const n = displayToScaled(t);
    if (n != null) out[key] = n;
  }
  return out;
}

// map: { outKey: [inputKey, unit] } -> emits app.graycard.defs#measure objects.
function readMeasure(inputs, map) {
  const out = {};
  for (const [outKey, [inKey, unit]] of Object.entries(map)) {
    const t = inputs[inKey]?.value?.trim();
    if (!t) continue;
    const m = displayToMeasure(t, unit);
    if (m) out[outKey] = m;
  }
  return out;
}

function readInts(inputs, keys) {
  const out = {};
  for (const key of keys) {
    const t = inputs[key]?.value?.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** Resolve stored develop session URI into developer vs chemistry field. */
export function resolveWorkingSolutionUri(uri, store) {
  if (!uri) return {};
  if (store.instance.developer.some((d) => d.uri === uri)) return { developer: uri };
  if (store.instance.chemistry.some((c) => c.uri === uri)) return { chemistry: uri };
  return { developer: uri };
}

export function buildProcessSessionForm(processKind, store, initial = {}) {
  const inputs = {};
  const nodes = [];

  if (processKind === "developSession") {
    const workingUri = initial.developer || initial.chemistry || "";
    inputs.workingSolution = developerOrChemistrySelect(workingUri);
    nodes.push(field("Working solution *", inputs.workingSolution));
    inputs.process = el("select", { "data-key": "process" }, FILM_PROCESSES.map((p) => el("option", { value: p }, enumLabel(p))));
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
    const time = inputField("Time (seconds)", "timeSeconds", initial.timeSeconds ?? "");
    inputs.timeSeconds = time.input;
    nodes.push(time.wrap);
    const agit = inputField("Agitation", "agitation", initial.agitation || "");
    inputs.agitation = agit.input;
    nodes.push(agit.wrap);
    inputs.tankType = el("select", {}, [el("option", { value: "" }, "(none)"), ...TANK_TYPES.map((v) => el("option", { value: v }, enumLabel(v)))]);
    inputs.tankType.value = initial.tankType || "";
    nodes.push(field("Tank type", inputs.tankType));

    // Less commonly edited recipe provenance and observed-vs-published values
    // stay available without crowding the normal manual-session form.
    inputs.recipe = el("select", {}, [
      el("option", { value: "" }, "(none)"),
      ...(store.catalog?.devRecipe || []).map((item) => {
        const r = item.value || {};
        const film = [r.filmMake, r.filmName].filter(Boolean).join(" ");
        const developer = [r.developerMake, r.developerName, r.dilution].filter(Boolean).join(" ");
        return el("option", { value: item.uri }, `${film} — ${developer}${r.ei ? ` · EI ${r.ei}` : ""}`);
      }),
    ]);
    inputs.recipe.value = initial.recipe || "";
    const setpoint = inputField("Recipe setpoint °C", "temperatureSetpointC", measureToDisplay(initial.temperatureSetpoint || initial.temperature));
    inputs.temperatureSetpointC = setpoint.input;
    const actualTemp = inputField("Actual temperature °C", "actualTemperatureC", measureToDisplay(initial.actualTemperature || initial.temperature));
    inputs.actualTemperatureC = actualTemp.input;
    const publishedTime = inputField("Published time (seconds)", "publishedTimeSeconds", initial.publishedTimeSeconds ?? initial.timeSeconds ?? "");
    inputs.publishedTimeSeconds = publishedTime.input;
    const actualTime = inputField("Actual time (seconds)", "actualTimeSeconds", initial.actualTimeSeconds ?? initial.timeSeconds ?? "");
    inputs.actualTimeSeconds = actualTime.input;
    const agitationScheme = textareaField("Structured agitation (JSON)", "agitationScheme", initial.agitationScheme ? JSON.stringify(initial.agitationScheme, null, 2) : "");
    inputs.agitationScheme = agitationScheme.input;
    const sourceDocument = textareaField("Source document (JSON)", "sourceDocument", initial.sourceDocument ? JSON.stringify(initial.sourceDocument, null, 2) : "");
    inputs.sourceDocument = sourceDocument.input;
    const sourceSpec = textareaField("Exact source location (JSON)", "sourceSpec", initial.sourceSpec ? JSON.stringify(initial.sourceSpec, null, 2) : "");
    inputs.sourceSpec = sourceSpec.input;
    nodes.push(el("details", { class: "process-technical" }, [
      el("summary", {}, "Recipe, source, and observed values"),
      field("Recipe record", inputs.recipe),
      setpoint.wrap, actualTemp.wrap, publishedTime.wrap, actualTime.wrap,
      agitationScheme.wrap, sourceDocument.wrap, sourceSpec.wrap,
    ]));
    inputs.stopBathChemistry = developerOrChemistrySelect(initial.stopBathChemistry || "", { roles: ["stop"] });
    nodes.push(field("Stop bath (chemistry)", inputs.stopBathChemistry));
    inputs.fixerChemistry = developerOrChemistrySelect(initial.fixerChemistry || "", { roles: ["fixer"] });
    nodes.push(field("Fixer (chemistry)", inputs.fixerChemistry));
    const stop = inputField("Stop bath (label)", "stopBath", initial.stopBath || "");
    inputs.stopBath = stop.input;
    nodes.push(stop.wrap);
    const fix = inputField("Fixer (label)", "fixer", initial.fixer || "");
    inputs.fixer = fix.input;
    nodes.push(fix.wrap);

    // multi-bath step sequence (C-41 dev/blix/stab, E-6 first/color dev, …)
    const STEP_ROLES = ["developer", "first-developer", "color-developer", "stop", "fixer", "blix", "bleach", "stabilizer", "wetting-agent"];
    const stepsWrap = el("div", { class: "dev-steps" });
    const stepRows = [];
    function addStepRow(init = {}) {
      const role = el("select", {}, STEP_ROLES.map((r) => el("option", { value: r }, enumLabel(r))));
      role.value = init.role || "developer";
      const chem = developerOrChemistrySelect(init.chemistry || "");
      const dil = el("input", { type: "text", placeholder: "dilution", value: init.dilution || "" });
      const tempC = el("input", { type: "text", placeholder: "°C", value: init.temperature != null ? measureToDisplay(init.temperature) : "" });
      const secs = el("input", { type: "text", placeholder: "sec", value: init.timeSeconds ?? "" });
      const agit = el("input", { type: "text", placeholder: "agitation", value: init.agitation || "" });
      const rec = { role, chem, dil, tempC, secs, agit };
      const row = el("div", { class: "dev-step row wrap" }, [
        role, chem, dil, tempC, secs, agit,
        el("button", { class: "ghost small-btn danger", onclick: () => { row.remove(); const i = stepRows.indexOf(rec); if (i >= 0) stepRows.splice(i, 1); } }, "×"),
      ]);
      stepRows.push(rec);
      stepsWrap.append(row);
    }
    (initial.steps || []).forEach(addStepRow);
    nodes.push(el("div", {}, [
      el("h3", { class: "modal-sub" }, "Bath steps (multi-step chemistry)"),
      stepsWrap,
      el("button", { class: "ghost small-btn", onclick: () => addStepRow() }, "+ Step"),
    ]));

    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        const ws = inputs.workingSolution.value;
        if (!ws) throw new Error("Working solution is required");
        const summaryTemperature = inputs.temperatureC.value.trim()
          ? displayToMeasure(inputs.temperatureC.value.trim(), "celsius") : undefined;
        const setpointTemperature = inputs.temperatureSetpointC.value.trim()
          ? displayToMeasure(inputs.temperatureSetpointC.value.trim(), "celsius") : summaryTemperature;
        const observedTemperature = inputs.actualTemperatureC.value.trim()
          ? displayToMeasure(inputs.actualTemperatureC.value.trim(), "celsius") : summaryTemperature;
        const summaryTime = parseInt(inputs.timeSeconds.value, 10);
        const publishedTimeSeconds = parseInt(inputs.publishedTimeSeconds.value, 10);
        const actualTimeSeconds = parseInt(inputs.actualTimeSeconds.value, 10);
        const steps = stepRows.map((r) => {
          const s = { role: r.role.value };
          if (r.chem.value) s.chemistry = r.chem.value;
          if (r.dil.value.trim()) s.dilution = r.dil.value.trim();
          const t = r.tempC.value.trim();
          if (t) { const m = displayToMeasure(t, "celsius"); if (m) s.temperature = m; }
          const sec = parseInt(r.secs.value, 10);
          if (Number.isFinite(sec)) s.timeSeconds = sec;
          if (r.agit.value.trim()) s.agitation = r.agit.value.trim();
          return s;
        }).filter((s) => s.role);
        return {
          ...resolveWorkingSolutionUri(ws, store),
          process: inputs.process.value,
          recipe: inputs.recipe.value || undefined,
          filmRolls: inputs.filmRoll.value ? [inputs.filmRoll.value] : undefined,
          provenance: { source: "manual", assertedAt: new Date().toISOString() },
          dilution: inputs.dilution.value.trim() || undefined,
          ...readMeasure(inputs, { temperature: ["temperatureC", "celsius"] }),
          ...readInts(inputs, ["timeSeconds"]),
          temperatureSetpoint: setpointTemperature,
          actualTemperature: observedTemperature,
          publishedTimeSeconds: Number.isFinite(publishedTimeSeconds)
            ? publishedTimeSeconds : (Number.isFinite(summaryTime) ? summaryTime : undefined),
          actualTimeSeconds: Number.isFinite(actualTimeSeconds)
            ? actualTimeSeconds : (Number.isFinite(summaryTime) ? summaryTime : undefined),
          agitation: inputs.agitation.value.trim() || undefined,
          agitationScheme: readJson(inputs.agitationScheme, "Structured agitation"),
          sourceDocument: readJson(inputs.sourceDocument, "Source document"),
          sourceSpec: readJson(inputs.sourceSpec, "Exact source location"),
          tankType: inputs.tankType.value || undefined,
          stopBathChemistry: inputs.stopBathChemistry.value || undefined,
          fixerChemistry: inputs.fixerChemistry.value || undefined,
          stopBath: inputs.stopBath.value.trim() || undefined,
          fixer: inputs.fixer.value.trim() || undefined,
          steps: steps.length ? steps : undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "digitizeSession") {
    nodes.push(enumSelect("Method *", DIGITIZE_METHODS, "method", initial.method || "dedicated-film-scanner"));
    inputs.method = nodes[nodes.length - 1].querySelector("select");
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
    nodes.push(enumSelect("Inversion", INVERSION_METHODS, "inversionMethod", initial.inversionMethod || "software-auto"));
    inputs.inversionMethod = nodes[nodes.length - 1].querySelector("select");
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

  if (processKind === "captureSession") {
    const pp = inputField("Picture profile", "pictureProfile", initial.pictureProfile || "");
    inputs.pictureProfile = pp.input;
    nodes.push(pp.wrap);
    const fs = inputField("Film simulation", "filmSimulation", initial.filmSimulation || "");
    inputs.filmSimulation = fs.input;
    nodes.push(fs.wrap);
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        return {
          pictureProfile: inputs.pictureProfile.value.trim() || undefined,
          filmSimulation: inputs.filmSimulation.value.trim() || undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  if (processKind === "digitalSession") {
    const sw = inputField("Software", "software", initial.software || "");
    inputs.software = sw.input;
    nodes.push(sw.wrap);
    const preset = inputField("Preset", "preset", initial.preset || "");
    inputs.preset = preset.input;
    nodes.push(preset.wrap);
    const raw = inputField("RAW format", "rawFormat", initial.rawFormat || "");
    inputs.rawFormat = raw.input;
    nodes.push(raw.wrap);
    const exp = inputField("Export format", "exportFormat", initial.exportFormat || "");
    inputs.exportFormat = exp.input;
    nodes.push(exp.wrap);
    const notes = textareaField("Notes", "notes", initial.notes || "");
    inputs.notes = notes.input;
    nodes.push(notes.wrap);

    return {
      nodes,
      read() {
        return {
          software: inputs.software.value.trim() || undefined,
          preset: inputs.preset.value.trim() || undefined,
          rawFormat: inputs.rawFormat.value.trim() || undefined,
          exportFormat: inputs.exportFormat.value.trim() || undefined,
          notes: inputs.notes.value.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  return { nodes: [el("p", { class: "muted" }, "No session form for this stage.")], read: () => ({ createdAt: new Date().toISOString() }) };
}

export function stageExtraFields(kind, store, initial = {}) {
  const inputs = {};
  const nodes = [];
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
      const out = {};
      if (inputs.scanProfile?.value) out.scanProfile = inputs.scanProfile.value;
      if (inputs.shoot?.value) out.shoot = inputs.shoot.value;
      const k = inputs.kind?.value?.trim();
      if (k) out.kind = k;
      return out;
    },
  };
}
