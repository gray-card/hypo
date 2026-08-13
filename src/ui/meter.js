// meter.js: an offline-first light meter. Manual readings are authoritative;
// camera-assisted readings are a best-effort convenience and are always stored
// with explicit approximation flags.

import {
  DEFAULT_INCIDENT_C_DOME,
  DEFAULT_INCIDENT_C_FLAT,
  DEFAULT_REFLECTED_K,
  apertureForEv100,
  ev100FromExposure,
  ev100FromLux,
  parseReciprocityModel,
  reciprocityForStock,
  shutterForEv100,
} from "@hypo/domain";
import { NS } from "@hypo/lexicon";
import { bindValueText } from "@hypo/ui";
import { APERTURE_SCALE, SHUTTER_SCALE, shutterLabelToSeconds } from "../exposureDials.js";
import * as outbox from "../outbox.js";
import { el } from "./dom.js";
import "./meter.css";

export const METER_READING_COLLECTION = NS.meter.reading;
export const METER_CALIBRATION_COLLECTION = NS.meter.calibration;

const MEASURE_SCALE = 1_000;
const SHUTTER_MEASURE_SCALE = 1_000_000;

let activeView = null;
let stopActiveCamera = () => {};

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a number`);
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero`);
  return number;
}

function measure(value, unit, scale = MEASURE_SCALE) {
  return { value: Math.round(value * scale), scale, unit };
}

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

function addIf(record, key, value) {
  if (present(value)) record[key] = value;
}

export function incidentConstantForGeometry(geometry) {
  return geometry === "incident-dome" ? DEFAULT_INCIDENT_C_DOME : DEFAULT_INCIDENT_C_FLAT;
}

/** Convert a manual meter entry to EV100 through the shared domain package. */
export function ev100FromMeterInput({ measurement = "ev100", value, geometry = "reflected-average" }) {
  const entered = finiteNumber(value, measurement === "lux" ? "Illuminance" : "EV100");
  if (measurement === "ev100") return entered;
  if (measurement !== "lux") throw new TypeError(`Unknown meter input: ${measurement}`);
  return ev100FromLux(positiveNumber(entered, "Illuminance"), incidentConstantForGeometry(geometry));
}

/**
 * Solve the two-variable exposure equation. The held values are never rounded;
 * display formatting happens separately so records retain the domain result.
 */
export function solveMeterValues({
  ev100,
  priorityMode = "aperture-priority",
  iso = 100,
  aperture = 8,
  shutterSeconds = 1 / 125,
}) {
  const ev = finiteNumber(ev100, "EV100");
  const sensitivity = positiveNumber(iso, "ISO");
  const fNumber = positiveNumber(aperture, "Aperture");
  const seconds = positiveNumber(shutterSeconds, "Shutter time");

  if (priorityMode === "aperture-priority") {
    return {
      ev100: ev,
      priorityMode,
      iso: sensitivity,
      aperture: fNumber,
      shutterSeconds: shutterForEv100(ev, fNumber, sensitivity),
    };
  }
  if (priorityMode === "shutter-priority") {
    return {
      ev100: ev,
      priorityMode,
      iso: sensitivity,
      aperture: apertureForEv100(ev, seconds, sensitivity),
      shutterSeconds: seconds,
    };
  }
  if (priorityMode === "iso-priority") {
    const evAtIso100 = ev100FromExposure(fNumber, seconds, 100);
    const solvedIso = 100 * 2 ** (evAtIso100 - ev);
    return { ev100: ev, priorityMode, iso: solvedIso, aperture: fNumber, shutterSeconds: seconds };
  }
  if (priorityMode === "ev-only") return { ev100: ev, priorityMode, iso: sensitivity };
  throw new TypeError(`Unknown priority mode: ${priorityMode}`);
}

export function formatAperture(aperture) {
  return Number(aperture.toFixed(2)).toString();
}

export function formatShutter(shutterSeconds) {
  if (shutterSeconds >= 1) return `${Number(shutterSeconds.toFixed(2))}s`;
  const reciprocal = 1 / shutterSeconds;
  if (Math.abs(reciprocal - Math.round(reciprocal)) < 0.04) return `1/${Math.round(reciprocal)}`;
  return `${Number(shutterSeconds.toPrecision(3))}s`;
}

function reciprocityModelKey(model) {
  return model.kind === "power-law" ? `power:${model.exponent}` : "table";
}

function reciprocityModelLabel(model) {
  return model.kind === "power-law" ? `power ${model.exponent}` : "correction table";
}

function filmStockName(record) {
  const value = record?.value || {};
  return [value.brand, value.name].filter(Boolean).join(" ") || record?.uri?.split("/").pop() || "Film stock";
}

export function buildReadingRecord(input, now = new Date().toISOString()) {
  const geometry = input.geometry || "reflected-average";
  const measurement = input.measurement || "ev100";
  if (measurement === "lux" && !geometry.startsWith("incident-")) {
    throw new TypeError("Lux readings require incident geometry");
  }
  const ev100 = ev100FromMeterInput({ measurement, value: input.value, geometry });
  const solution = solveMeterValues({
    ev100,
    priorityMode: input.priorityMode,
    iso: input.iso,
    aperture: input.aperture,
    shutterSeconds: input.shutterSeconds,
  });
  const reciprocity =
    solution.shutterSeconds && input.filmStock && input.reciprocityStock
      ? reciprocityForStock(input.reciprocityStock, solution.shutterSeconds)
      : null;
  const exposureSeconds = reciprocity?.correctedSeconds ?? solution.shutterSeconds;
  const approximate = Boolean(input.approximate);
  const record = {
    geometry,
    lightKind: input.lightKind || "ambient",
    ev100: measure(ev100, "EV"),
    priorityMode: solution.priorityMode,
    iso: Math.max(1, Math.round(solution.iso)),
    createdAt: now,
  };

  if (measurement === "lux") {
    record.illuminance = measure(positiveNumber(input.value, "Illuminance"), "lx");
    record.calibrationConstant = measure(incidentConstantForGeometry(geometry), "lx·s/ISO");
  } else if (geometry.startsWith("reflected-")) {
    record.calibrationConstant = measure(DEFAULT_REFLECTED_K, "cd·s/(m²·ISO)");
  }
  if (solution.aperture) record.aperture = formatAperture(solution.aperture);
  if (exposureSeconds) {
    record.shutterSeconds = measure(exposureSeconds, "s", SHUTTER_MEASURE_SCALE);
  }
  if (reciprocity) {
    record.reciprocity = {
      applied: true,
      model: reciprocityModelKey(reciprocity.model),
      meteredSeconds: measure(reciprocity.meteredSeconds, "s", SHUTTER_MEASURE_SCALE),
      filmStock: input.filmStock,
    };
  }
  addIf(record, "meter", input.meter);
  addIf(record, "calibration", input.calibration);
  addIf(record, "exposure", input.exposure);
  addIf(record, "subject", input.subject?.trim());
  addIf(record, "note", input.note?.trim());
  if (input.takenAt) record.takenAt = input.takenAt;
  if (input.sensorPath) record.sensorPath = input.sensorPath;
  if (input.cameraModule) record.cameraModule = input.cameraModule;
  if (approximate) record.flags = ["approximate-camera", "uncalibrated"];
  record.provenance = {
    source: approximate ? "analysis" : "manual",
    confidence: approximate ? "guess" : "certain",
    assertedAt: now,
    ...(input.did ? { assertedBy: input.did } : {}),
  };
  return record;
}

export function buildCalibrationRecord(input, now = new Date().toISOString()) {
  const meter = String(input.meter || "").trim();
  if (!meter) throw new TypeError("A meter URI is required");
  const record = {
    meter,
    reference: input.reference || "reference-meter",
    offsetStops: measure(finiteNumber(input.offsetStops ?? 0, "Offset"), "stop"),
    constantK: measure(positiveNumber(input.constantK ?? DEFAULT_REFLECTED_K, "K constant"), "cd·s/(m²·ISO)"),
    constantCFlat: measure(
      positiveNumber(input.constantCFlat ?? DEFAULT_INCIDENT_C_FLAT, "Flat C constant"),
      "lx·s/ISO",
    ),
    constantCDome: measure(
      positiveNumber(input.constantCDome ?? DEFAULT_INCIDENT_C_DOME, "Dome C constant"),
      "lx·s/ISO",
    ),
    provenance: {
      source: "manual",
      confidence: "certain",
      assertedAt: now,
      ...(input.did ? { assertedBy: input.did } : {}),
    },
    createdAt: now,
  };
  addIf(record, "referenceDetail", input.referenceDetail?.trim());
  addIf(record, "cameraModule", input.cameraModule);
  addIf(record, "sensorPath", input.sensorPath);
  addIf(record, "note", input.note?.trim());
  return record;
}

/** Check all three browser contracts before offering camera-assisted metering. */
export function cameraMeterCapability(environment = globalThis) {
  if (typeof environment.navigator?.mediaDevices?.getUserMedia !== "function") {
    return { supported: false, reason: "This browser does not expose camera access." };
  }
  if (typeof environment.ImageCapture !== "function") {
    return { supported: false, reason: "This browser does not expose camera capture metadata." };
  }
  if (typeof environment.MediaStreamTrack?.prototype?.getSettings !== "function") {
    return { supported: false, reason: "This browser does not expose camera track settings." };
  }
  return { supported: true, reason: "" };
}

export function cameraSettingsToReading(settings) {
  const aperture = positiveNumber(settings?.aperture ?? settings?.fNumber, "Camera aperture");
  const shutterSeconds = positiveNumber(settings?.exposureTime, "Camera exposure time");
  const iso = positiveNumber(settings?.iso, "Camera ISO");
  return {
    aperture,
    shutterSeconds,
    iso,
    ev100: ev100FromExposure(aperture, shutterSeconds, iso),
    cameraModule: settings?.facingMode === "user" ? "front" : "wide",
  };
}

function labelledControl(label, control, hint = null) {
  const id = control.id || `meter-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  return el("label", { class: "meter-field", for: id }, [
    el("span", { class: "meter-label" }, label),
    control,
    hint ? el("span", { class: "meter-hint" }, hint) : null,
  ]);
}

function selectControl(id, options, value) {
  const select = el(
    "select",
    { id },
    options.map(([optionValue, label]) => el("option", { value: optionValue }, label)),
  );
  select.value = String(value);
  return select;
}

function selectExactOption(select, value, label) {
  const serialized = String(value);
  if (![...select.options].some((option) => option.value === serialized)) {
    select.append(el("option", { value: serialized }, label));
  }
  select.value = serialized;
}

function setStatus(node, message, kind = "") {
  node.textContent = message;
  node.className = `meter-status${kind ? ` ${kind}` : ""}`;
}

function exposureLabel(item) {
  const value = item.value || item.record || {};
  const frame = value.frameNumber != null ? `Frame ${value.frameNumber}` : "Exposure";
  const when = value.takenAt ? new Date(value.takenAt).toLocaleString() : "";
  return [frame, when].filter(Boolean).join(" · ");
}

function mountView(root) {
  const libraryBody = document.querySelector("#library-body");
  const host = libraryBody || document.querySelector("#app") || document.body;
  if (libraryBody) {
    const libraryView = document.querySelector("#library-view");
    document
      .querySelectorAll("#app > section")
      .forEach((view) => view.classList.toggle("hidden", view !== libraryView));
    libraryView?.classList.add("meter-mounted");
    libraryBody.replaceChildren(root);
  } else {
    host.append(root);
  }
}

export function closeMeter() {
  stopActiveCamera();
  stopActiveCamera = () => {};
  if (activeView) {
    activeView.closest("#library-view")?.classList.remove("meter-mounted");
    activeView.remove();
    activeView = null;
  }
}

export function openMeter({ agent, did, store = null } = {}) {
  if (!did) throw new TypeError("A signed-in DID is required to open the meter");
  void agent;
  closeMeter();

  const measurement = selectControl(
    "meter-measurement",
    [
      ["ev100", "EV100"],
      ["lux", "Illuminance (lux)"],
    ],
    "ev100",
  );
  const geometry = selectControl(
    "meter-geometry",
    [
      ["reflected-average", "Reflected · average"],
      ["reflected-spot", "Reflected · spot"],
      ["incident-flat", "Incident · flat receptor"],
      ["incident-dome", "Incident · dome"],
    ],
    "reflected-average",
  );
  const value = el("input", {
    id: "meter-value",
    type: "number",
    inputmode: "decimal",
    step: "0.1",
    value: "12",
    required: true,
  });
  const evDial = el("input", {
    id: "meter-ev-dial",
    class: "meter-dial",
    type: "range",
    min: "-8",
    max: "24",
    step: "0.1",
    value: "12",
    "aria-label": "EV100 dial",
  });
  const syncEvValueText = bindValueText(evDial, (dialValue) => `EV ${Number(dialValue).toFixed(1)}`);
  const evTicks = el("div", { class: "meter-dial-ticks", "aria-hidden": "true" }, ["−8", "0", "8", "16", "24"]);
  const dialWrap = el("div", { class: "meter-dial-wrap" }, [evDial, evTicks]);
  const priority = selectControl(
    "meter-priority",
    [
      ["aperture-priority", "Aperture priority"],
      ["shutter-priority", "Shutter priority"],
      ["iso-priority", "ISO priority"],
      ["ev-only", "EV only"],
    ],
    "aperture-priority",
  );
  const iso = el("input", { id: "meter-iso", type: "number", min: "1", step: "1", value: "100", required: true });
  const aperture = selectControl(
    "meter-aperture",
    APERTURE_SCALE.map((entry) => [entry, `f/${entry}`]),
    "8",
  );
  const shutter = selectControl(
    "meter-shutter",
    SHUTTER_SCALE.filter((entry) => entry !== "B").map((entry) => [entry, entry]),
    "1/125",
  );
  const reciprocityModels = (store?.catalog?.filmStock || [])
    .map((record) => ({ record, model: parseReciprocityModel(record.value || {}) }))
    .filter((entry) => entry.model);
  const reciprocityStock = selectControl(
    "meter-film-stock",
    [
      ["", "No reciprocity correction"],
      ...reciprocityModels.map(({ record, model }) => [
        record.uri,
        `${filmStockName(record)} · ${reciprocityModelLabel(model)}`,
      ]),
    ],
    "",
  );
  const resultEv = el("strong", { id: "meter-result-ev", class: "meter-result-number" }, "EV 12.0");
  const resultPair = el("span", { id: "meter-result-pair", class: "meter-result-pair" }, "f/8 · 1/125 · ISO 100");
  const resultReciprocity = el("span", {
    id: "meter-result-reciprocity",
    class: "meter-result-pair muted",
    hidden: true,
  });
  const result = el(
    "output",
    {
      class: "meter-result",
      for: "meter-value meter-priority meter-iso meter-aperture meter-shutter meter-film-stock",
      "aria-live": "polite",
    },
    [resultEv, resultPair, resultReciprocity],
  );
  const exposure = selectControl(
    "meter-exposure",
    [
      ["", "No exposure attachment"],
      ...(store?.instance?.exposure || []).map((item) => [item.uri, exposureLabel(item)]),
    ],
    "",
  );
  const meterUri = el("input", {
    id: "meter-reading-meter",
    type: "text",
    inputmode: "url",
    placeholder: "at://…/app.graycard.instance.meter/…",
  });
  const subject = el("input", {
    id: "meter-subject",
    type: "text",
    maxlength: "256",
    placeholder: "Shadow under the overhang",
  });
  const note = el("textarea", { id: "meter-note", rows: "2", maxlength: "1000", placeholder: "Optional field note" });
  const readingStatus = el("p", { class: "meter-status", role: "status", "aria-live": "polite" });
  const saveReading = el("button", { id: "meter-save-reading", type: "submit" }, "Save reading");
  let approximateCamera = false;
  let cameraMetadata = null;

  function readSolution() {
    const ev100 = ev100FromMeterInput({ measurement: measurement.value, value: value.value, geometry: geometry.value });
    return solveMeterValues({
      ev100,
      priorityMode: priority.value,
      iso: iso.value,
      aperture: aperture.value,
      shutterSeconds: shutterLabelToSeconds(shutter.value),
    });
  }

  function selectedReciprocity(solved) {
    if (!solved?.shutterSeconds || !reciprocityStock.value) return null;
    const stock = reciprocityModels.find(({ record }) => record.uri === reciprocityStock.value)?.record;
    if (!stock) return null;
    const correction = reciprocityForStock(stock.value || {}, solved.shutterSeconds);
    return correction ? { correction, stock } : null;
  }

  function updateSolution({ user = false } = {}) {
    if (user) {
      approximateCamera = false;
      cameraMetadata = null;
    }
    try {
      if (measurement.value === "lux" && !geometry.value.startsWith("incident-")) geometry.value = "incident-flat";
      value.min = measurement.value === "lux" ? "0.001" : "-32";
      value.step = measurement.value === "lux" ? "1" : "0.1";
      dialWrap.hidden = measurement.value !== "ev100";
      if (!dialWrap.hidden) evDial.value = value.value;
      syncEvValueText();
      const solved = readSolution();
      resultEv.textContent = `EV ${solved.ev100.toFixed(1)}`;
      resultPair.textContent =
        solved.priorityMode === "ev-only"
          ? `ISO ${Math.round(solved.iso)}`
          : `f/${formatAperture(solved.aperture)} · ${formatShutter(solved.shutterSeconds)} · ISO ${Math.round(solved.iso)}`;
      const reciprocal = selectedReciprocity(solved);
      resultReciprocity.hidden = !reciprocal;
      resultReciprocity.textContent = reciprocal
        ? `Metered ${formatShutter(reciprocal.correction.meteredSeconds)} → corrected ${formatShutter(reciprocal.correction.correctedSeconds)} · +${Number(reciprocal.correction.correctionStops.toFixed(2))} stops`
        : "";
      iso.disabled = priority.value === "iso-priority";
      aperture.disabled = priority.value === "shutter-priority";
      shutter.disabled = priority.value === "aperture-priority";
      const evOnly = priority.value === "ev-only";
      aperture.closest("label").hidden = evOnly;
      shutter.closest("label").hidden = evOnly;
      result.removeAttribute("data-error");
      return solved;
    } catch (error) {
      resultEv.textContent = "No solution";
      resultPair.textContent = error?.message || String(error);
      resultReciprocity.hidden = true;
      resultReciprocity.textContent = "";
      result.setAttribute("data-error", "true");
      return null;
    }
  }

  const readingForm = el("form", { id: "meter-reading-form", class: "meter-card" }, [
    el("div", { class: "meter-card-head" }, [
      el("div", {}, [el("p", { class: "meter-kicker" }, "Manual reading"), el("h2", {}, "Set the light")]),
      el("span", { class: "meter-badge" }, "ISO 2720"),
    ]),
    el("div", { class: "meter-grid meter-grid-reading" }, [
      labelledControl("Input", measurement),
      labelledControl("Geometry", geometry),
      labelledControl("Reading", value, "Enter EV100 or incident illuminance."),
      labelledControl("Priority", priority),
    ]),
    dialWrap,
    el("fieldset", { class: "meter-fieldset" }, [
      el("legend", {}, "Exposure dials"),
      el("div", { class: "meter-grid meter-grid-dials" }, [
        labelledControl("ISO", iso),
        labelledControl("Aperture", aperture),
        labelledControl("Shutter", shutter),
        reciprocityModels.length
          ? labelledControl("Film curve", reciprocityStock, "Optional reciprocity correction.")
          : null,
      ]),
    ]),
    result,
    el("details", { class: "meter-details" }, [
      el("summary", {}, "Reading details"),
      el("div", { class: "meter-grid" }, [
        labelledControl("Attach to exposure", exposure),
        labelledControl("Meter URI", meterUri, "Optional owned meter record."),
        labelledControl("Subject", subject),
        labelledControl("Note", note),
      ]),
    ]),
    el("div", { class: "meter-actions" }, [saveReading, readingStatus]),
  ]);

  readingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const solved = updateSolution();
      if (!solved) return;
      const record = buildReadingRecord({
        did,
        measurement: measurement.value,
        value: value.value,
        geometry: geometry.value,
        priorityMode: priority.value,
        iso: iso.value,
        aperture: aperture.value,
        shutterSeconds: shutterLabelToSeconds(shutter.value),
        filmStock: reciprocityStock.value,
        reciprocityStock: reciprocityModels.find(({ record: stock }) => stock.uri === reciprocityStock.value)?.record
          .value,
        exposure: exposure.value,
        meter: meterUri.value.trim(),
        subject: subject.value,
        note: note.value,
        approximate: approximateCamera,
        sensorPath: cameraMetadata?.sensorPath,
        cameraModule: cameraMetadata?.cameraModule,
      });
      const operation = outbox.enqueue(did, METER_READING_COLLECTION, record);
      setStatus(readingStatus, `Reading queued offline · ${operation.tempUri}`, "ok");
    } catch (error) {
      setStatus(readingStatus, error?.message || String(error), "err");
    }
  });

  measurement.addEventListener("change", () => updateSolution({ user: true }));
  geometry.addEventListener("change", () => updateSolution({ user: true }));
  priority.addEventListener("change", () => updateSolution({ user: true }));
  for (const control of [value, iso, aperture, shutter, reciprocityStock]) {
    control.addEventListener("input", () => updateSolution({ user: true }));
  }
  evDial.addEventListener("input", () => {
    value.value = evDial.value;
    updateSolution({ user: true });
  });

  const cameraCapability = cameraMeterCapability();
  const cameraStatus = el("p", { class: "meter-status", role: "status", "aria-live": "polite" });
  const cameraStart = el(
    "button",
    { id: "meter-camera-start", class: "ghost", type: "button", disabled: !cameraCapability.supported },
    "Read camera metadata",
  );
  const preview = el("video", {
    class: "meter-preview",
    autoplay: true,
    muted: true,
    playsinline: true,
    hidden: true,
    "aria-label": "Camera meter preview",
  });
  const cameraCard = el("section", { class: "meter-card meter-camera", "aria-labelledby": "meter-camera-heading" }, [
    el("p", { class: "meter-kicker" }, "Camera-assisted · approximate"),
    el("h2", { id: "meter-camera-heading" }, "Use auto-exposure metadata"),
    el(
      "p",
      { class: "meter-copy" },
      "When the browser exposes aperture, exposure time, and ISO, Hypo can copy them into the manual meter. Phone image pipelines are not calibrated light meters, so the saved reading remains explicitly approximate.",
    ),
    !cameraCapability.supported
      ? el("p", { class: "meter-capability-note" }, `${cameraCapability.reason} Manual metering remains available.`)
      : null,
    preview,
    el("div", { class: "meter-actions" }, [cameraStart, cameraStatus]),
  ]);

  cameraStart.addEventListener("click", async () => {
    cameraStart.disabled = true;
    setStatus(cameraStatus, "Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const track = stream.getVideoTracks?.()[0];
      if (!track || typeof track.getSettings !== "function") throw new Error("Camera track settings are unavailable");
      stopActiveCamera();
      stopActiveCamera = () => stream.getTracks?.().forEach((item) => item.stop());
      const capture = new globalThis.ImageCapture(track);
      await capture.getPhotoCapabilities?.().catch(() => null);
      const metadata = cameraSettingsToReading(track.getSettings());
      preview.srcObject = stream;
      preview.hidden = false;
      await preview.play?.().catch(() => {});
      measurement.value = "ev100";
      geometry.value = "reflected-average";
      value.value = metadata.ev100.toFixed(2);
      iso.value = String(Math.round(metadata.iso));
      selectExactOption(aperture, metadata.aperture, `f/${formatAperture(metadata.aperture)} · camera`);
      const cameraShutter = formatShutter(metadata.shutterSeconds);
      selectExactOption(shutter, cameraShutter, `${cameraShutter} · camera`);
      approximateCamera = true;
      cameraMetadata = { sensorPath: "ae-metadata", cameraModule: metadata.cameraModule };
      updateSolution();
      setStatus(cameraStatus, "Approximate camera reading loaded. Review it before saving.", "ok");
    } catch (error) {
      stopActiveCamera();
      setStatus(
        cameraStatus,
        `${error?.message || "Camera metadata unavailable"}. Use the manual EV or lux entry instead.`,
        "err",
      );
    } finally {
      cameraStart.disabled = !cameraCapability.supported;
    }
  });

  const meterList = el(
    "datalist",
    { id: "meter-instance-options" },
    (store?.instance?.meter || []).map((item) => el("option", { value: item.uri }, item.value?.label || item.uri)),
  );
  const calibrationMeter = el("input", {
    id: "meter-calibration-meter",
    type: "text",
    inputmode: "url",
    list: "meter-instance-options",
    placeholder: "at://…/app.graycard.instance.meter/…",
    required: true,
  });
  const reference = selectControl(
    "meter-calibration-reference",
    [
      ["reference-meter", "Reference meter"],
      ["sunny-16", "Sunny 16"],
      ["known-illuminant", "Known illuminant"],
      ["factory", "Factory reference"],
      ["manufacturer-spec", "Manufacturer specification"],
    ],
    "reference-meter",
  );
  const referenceDetail = el("input", { id: "meter-calibration-detail", type: "text", maxlength: "256" });
  const offset = el("input", {
    id: "meter-calibration-offset",
    type: "number",
    step: "0.1",
    value: "0",
    required: true,
  });
  const constantK = el("input", {
    id: "meter-calibration-k",
    type: "number",
    min: "0.01",
    step: "any",
    value: "12.5",
    required: true,
  });
  const constantCFlat = el("input", {
    id: "meter-calibration-c-flat",
    type: "number",
    min: "0.01",
    step: "any",
    value: "250",
    required: true,
  });
  const constantCDome = el("input", {
    id: "meter-calibration-c-dome",
    type: "number",
    min: "0.01",
    step: "any",
    value: "330",
    required: true,
  });
  const calibrationStatus = el("p", { class: "meter-status", role: "status", "aria-live": "polite" });
  const calibrationForm = el("form", { id: "meter-calibration-form", class: "meter-card meter-calibration" }, [
    el("p", { class: "meter-kicker" }, "Calibration profile"),
    el("h2", {}, "Record the reference"),
    el(
      "p",
      { class: "meter-copy" },
      "Calibration is stored separately from the meter, so future corrections do not rewrite the instrument’s identity.",
    ),
    meterList,
    el("div", { class: "meter-grid" }, [
      labelledControl("Meter URI", calibrationMeter),
      labelledControl("Reference", reference),
      labelledControl("Reference detail", referenceDetail),
      labelledControl("Offset (stops)", offset),
      labelledControl("Reflected K", constantK),
      labelledControl("Incident C · flat", constantCFlat),
      labelledControl("Incident C · dome", constantCDome),
    ]),
    el("div", { class: "meter-actions" }, [el("button", { type: "submit" }, "Save calibration"), calibrationStatus]),
  ]);
  calibrationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const record = buildCalibrationRecord({
        did,
        meter: calibrationMeter.value,
        reference: reference.value,
        referenceDetail: referenceDetail.value,
        offsetStops: offset.value,
        constantK: constantK.value,
        constantCFlat: constantCFlat.value,
        constantCDome: constantCDome.value,
      });
      const operation = outbox.enqueue(did, METER_CALIBRATION_COLLECTION, record);
      setStatus(calibrationStatus, `Calibration queued offline · ${operation.tempUri}`, "ok");
    } catch (error) {
      setStatus(calibrationStatus, error?.message || String(error), "err");
    }
  });

  const root = el("section", { id: "meter-view", class: "meter-view", "aria-labelledby": "meter-heading" }, [
    el("header", { class: "meter-hero" }, [
      el("div", {}, [
        el("p", { class: "meter-kicker" }, "Field instrument"),
        el("h1", { id: "meter-heading" }, "Light meter"),
        el("p", { class: "meter-lede" }, "Measure the light, solve an exposure, and keep the reading with the frame."),
      ]),
      el("div", { class: "meter-zero", "aria-hidden": "true" }, [
        el("span", {}, "−"),
        el("i"),
        el("b", {}, "0"),
        el("i"),
        el("span", {}, "+"),
      ]),
    ]),
    el("div", { class: "meter-layout" }, [
      readingForm,
      el("div", { class: "meter-side" }, [cameraCard, calibrationForm]),
    ]),
  ]);
  activeView = root;
  mountView(root);
  updateSolution();

  // Setup re-renders replace #library-body. Release camera hardware when that
  // happens, even though the route owner did not need a bespoke teardown hook.
  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => {
      if (!root.isConnected) {
        stopActiveCamera();
        observer.disconnect();
        if (activeView === root) activeView = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return root;
}
