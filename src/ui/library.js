// library.js: graycard types, instances, workflows UI

import {
  NS, CATALOG_KINDS, INSTANCE_KINDS, loadStore, saveRecord, deleteRecord,
  catalogLabel, instanceLabel, displayToScaled, displayToMeasure, scaledToDisplay, measureToDisplay, chemistryRole, saveWorkflowTemplate,
  splitRollFromStockpile,
} from "../graycard.js";
import { el, field, $, openModal, inputField, withButton, confirmModal, stagger, toast, isAdvanced, autocomplete, dateField, isoToLocalInput, showView, loadPhase } from "./dom.js";
import { locationField } from "./mapView.js";
import { blobUrl, getPhotos } from "../grain.js";
import { STAGE_LABELS, MEDIUMS } from "../workflow.js";
import { PRESETS, MANUFACTURERS, FIELD_ENUMS, ENUMS } from "../data/presets.js";
import { catalogImageUrl } from "../data/catalogImage.js";
import { openInspector } from "./inspect.js";
import { instanceImageUrl } from "../data/gearImage.js";
import { kindLabel, kindLabelPlural, enumLabel, GEAR_GROUPS } from "./labels.js";
import { icon } from "./icons.js";
import { fuzzyMatches } from "./fuzzy.js";
import { lensIssueUrl } from "../data/lensSuggest.js";
import { captureGeolocation } from "../geo.js";
import * as outbox from "../outbox.js";
import { openDevTimer, activeDevRun } from "./devTimer.js";
import { computeLintFindings } from "../lint.js";
import {
  buildApertureOptions, buildShutterOptions, STOP_FRACTIONS,
  usesExactApertureSteps, usesExactShutterSteps,
  parseScaledList, formatScaledList, shutterScaledToDisplay, displayToShutterScaled,
} from "../exposureDials.js";

// The identity fields that describe a *kind of gear* (the catalog "type").
// Users never see the word "type". These are the "what is it?" questions.
const TYPE_IDENTITY = {
  cameraType: [
    ["make", "Make", true], ["model", "Model", true], ["mount", "Mount"],
    ["format", "Format"], ["category", "Category"],
    ["minShutterSpeed", "Fastest shutter (e.g. 1/8000)"], ["maxShutterSpeed", "Slowest shutter (e.g. 30s)"],
    ["shutterSpeedSteps", "Shutter steps (comma-separated)"], ["shutterStopIncrement", "Shutter stop increment"],
  ],
  lensType: [
    ["make", "Make"], ["model", "Model", true], ["mount", "Mount"],
    ["focalLengthMin", "Focal length min (mm)"], ["focalLengthMax", "Focal length max (mm)"],
    ["maxAperture", "Max aperture (f)"], ["minAperture", "Min aperture (f)"],
    ["apertureSteps", "Aperture steps (ƒ/, comma-separated)"], ["apertureStopIncrement", "Aperture stop increment"],
  ],
  filmStock: [
    // an emulsion (e.g. Kodak Gold 200) is one thing, sold in many formats — so
    // format is NOT part of the stock's identity; it lives on the roll/stockpile.
    ["brand", "Brand"], ["name", "Name", true], ["iso", "ISO"],
    ["filmType", "Film type"], ["process", "Process"],
  ],
  developerType: [
    ["brand", "Brand"], ["name", "Name", true], ["process", "Process"],
    ["form", "Form"], ["defaultDilution", "Default dilution"], ["defaultTemperature", "Default temp °C"],
  ],
  scannerType: [["make", "Make"], ["model", "Model", true], ["scannerKind", "Kind"]],
  filterType: [["make", "Make"], ["name", "Name", true], ["filterKind", "Kind"], ["threadDiameterMm", "Thread size (mm)"]],
  chemistryType: [
    ["brand", "Brand"], ["name", "Name", true], ["role", "Role"],
    ["process", "Process"], ["form", "Form"], ["defaultDilution", "Default dilution"],
  ],
  lab: [["name", "Name", true], ["website", "Website"], ["location", "Location"]],
  scanProfile: [
    ["name", "Name", true], ["method", "Method"], ["software", "Software"],
    ["resolution", "Resolution DPI"],
  ],
  paperType: [
    ["brand", "Brand"], ["name", "Name", true], ["medium", "Medium"], ["base", "Base"],
    ["surface", "Surface"], ["contrast", "Contrast"], ["grade", "Grade"], ["tone", "Tone"], ["weight", "Weight"],
  ],
  enlargerType: [
    ["make", "Make"], ["model", "Model", true], ["maxFormat", "Max negative format"],
    ["headType", "Head / light source"], ["lensMount", "Lens mount"],
  ],
  printerType: [
    ["make", "Make"], ["model", "Model", true], ["printerTechnology", "Technology"],
    ["inkType", "Ink type"], ["inkChannels", "Ink channels"], ["maxMediaWidthMm", "Max media width (mm)"],
  ],
  lightSourceType: [
    ["make", "Make"], ["model", "Model", true], ["lightTechnology", "Technology"], ["peakWavelengthNm", "Peak UV wavelength (nm)"],
  ],
  enlargingLensType: [
    ["make", "Make"], ["model", "Model", true], ["focalLengthMm", "Focal length (mm)"],
    ["maxAperture", "Max aperture (f)"], ["mount", "Mount"], ["coversFormat", "Covers format"],
  ],
};

// Which catalog type each instance kind is an instance *of* (hidden from users).
const TYPE_OF_INSTANCE = {
  camera: "cameraType", lens: "lensType", filter: "filterType", developer: "developerType",
  scanner: "scannerType", chemistry: "chemistryType", filmRoll: "filmStock",
  filmStockpile: "filmStock", labAccount: "lab",
  enlarger: "enlargerType", printer: "printerType", lightSource: "lightSourceType", enlargingLens: "enlargingLensType",
};
// The instance field that stores the type uri.
const TYPE_KEY = { camera: "type", lens: "type", filter: "type", developer: "type", scanner: "type", chemistry: "type", filmRoll: "stock", filmStockpile: "stock", labAccount: "lab", enlarger: "type", printer: "type", lightSource: "type", enlargingLens: "type" };

// The per-copy ("your copy") fields: everything on the instance that isn't the type.
const INSTANCE_FIELDS = {
  camera: [["nickname", "Nickname (e.g. “black M6”)"], ["serialNumber", "Serial number"]],
  lens: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  filter: [["nickname", "Nickname"], ["serialNumber", "Serial number"], ["threadSize", "Thread size (mm)"]],
  developer: [["nickname", "Nickname"], ["dilution", "Dilution"], ["rollsProcessed", "Rolls processed"], ["sessionsUsed", "Sessions used"]],
  chemistry: [["nickname", "Nickname"], ["dilution", "Dilution"], ["rollsProcessed", "Rolls processed"], ["sessionsUsed", "Sessions used"]],
  scanner: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  filmRoll: [["label", "Label (e.g. “Roll 12”)"], ["serialNumber", "Serial"], ["format", "Format"], ["status", "Status"], ["camera", "@camera"], ["shotAtIso", "Shot at ISO (push/pull)"], ["exposuresTotal", "Total frames"], ["emulsionBatch", "Emulsion batch"], ["expiresAt", "Expires"], ["manufacturedAt", "Manufactured"]],
  filmStockpile: [["quantity", "How many rolls in reserve"], ["format", "Format"], ["storage", "Storage"], ["storageLocation", "@storageLocation"], ["emulsionBatch", "Emulsion batch"], ["expiresAt", "Expires"]],
  labAccount: [["nickname", "Nickname"], ["accountId", "Account ID"]],
  storageLocation: [["name", "Name", true], ["storage", "Storage"]],
  enlarger: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  printer: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  lightSource: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  enlargingLens: [["nickname", "Nickname"], ["serialNumber", "Serial number"]],
  intermediate: [["label", "Label"], ["kind", "Kind"], ["frameIndex", "Frame index"], ["filmRoll", "@filmRoll"]],
};

// datetime fields that are really calendar dates (no time-of-day): rendered
// as a date-only picker, still stored as an ISO datetime.
const DATE_ONLY = new Set(["expiresAt", "manufacturedAt"]);

// Closed enums that should render as human-labelled <select> menus.
const ENUM_SELECT = new Set(["status", "format", "filmType", "process", "form", "role", "scannerKind", "surface", "base", "storage", "category", "mount", "filterKind", "meteringMode", "exposureProgram", "medium", "contrast", "tone", "maxFormat", "coversFormat", "headType", "printerTechnology", "inkType", "lightTechnology", "apertureStopIncrement", "shutterStopIncrement"]);

// gear tabs (each owns one or more instance kinds) then the activity tabs
const GEAR_TABS = {
  cameras: ["camera"],
  lenses: ["lens"],
  filters: ["filter"],
  film: ["filmRoll"],
  // labAccount appears under both Darkroom and Scanning: the lab that develops
  // your film and the lab that scans it may be different places.
  darkroom: ["developer", "chemistry", "enlarger", "enlargingLens", "lightSource", "printer", "labAccount"],
  scanning: ["scanner", "labAccount", "storageLocation"],
};

// ordered to follow the flow of photography production:
// gear (cameras -> lenses -> filters) -> film -> shoot -> develop -> scan,
// then the activity tabs.
const TAB_LABELS = {
  cameras: "Cameras",
  lenses: "Lenses",
  filters: "Filters",
  film: "Film",
  shoots: "Shoots",
  darkroom: "Darkroom",
  scanning: "Scanning",
  workflows: "Workflows",
  rules: "Rules",
  insights: "Insights",
};

let ctx = null;

export function initLibrary(context) {
  ctx = context;
}

const INT_FORM_KEYS = new Set([
  "rollsProcessed", "sessionsUsed", "exposuresTotal", "exposuresUsed", "frameIndex", "iso", "bitDepth", "quantity", "shotAtIso",
  "threadDiameterMm", "threadSize", "frameNumber", "focalLength",
]);

function readFormFields(inputs, { scaledKeys = [], shutterScaledKeys = [], scaledArrayKeys = {}, measureKeys = {} } = {}) {
  const rec = { createdAt: new Date().toISOString() };
  for (const [key, input] of Object.entries(inputs)) {
    const t = input.value?.trim();
    if (!t) continue;
    if (scaledKeys.includes(key)) rec[key] = displayToScaled(t);
    else if (shutterScaledKeys.includes(key)) rec[key] = displayToShutterScaled(t);
    else if (scaledArrayKeys[key]) {
      const arr = parseScaledList(t, scaledArrayKeys[key]);
      if (arr.length) rec[key] = arr;
    }
    else if (measureKeys[key]) rec[key] = displayToMeasure(t, measureKeys[key]);
    else if (INT_FORM_KEYS.has(key)) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n)) rec[key] = n;
    } else if (key.endsWith("At") && t) rec[key] = new Date(t).toISOString();
    else rec[key] = t;
  }
  return rec;
}

// a select over an open vocabulary: the suggested values plus "Other…", which
// reveals a text field. The returned `input` exposes a `.value` (getter) that is
// the selected value, or the typed custom string — so any value round-trips even
// when it isn't one of the suggestions (atproto knownValues is an open list).
const ENUM_CUSTOM = "__custom__";
function enumControl(opts, value = "") {
  const known = new Set(opts);
  const sel = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...opts.map((o) => el("option", { value: o }, enumLabel(o))),
    el("option", { value: ENUM_CUSTOM }, "Custom…"),
  ]);
  const text = el("input", { type: "text", class: "enum-custom hidden", placeholder: "Enter your own" });
  const showText = (on) => text.classList.toggle("hidden", !on);
  if (value && !known.has(value)) { sel.value = ENUM_CUSTOM; text.value = value; showText(true); }
  else sel.value = value || "";
  sel.addEventListener("change", () => { const custom = sel.value === ENUM_CUSTOM; showText(custom); if (custom) setTimeout(() => text.focus(), 0); });
  const input = {
    get value() { return sel.value === ENUM_CUSTOM ? text.value.trim() : sel.value; },
    set value(v) {
      if (!v) { sel.value = ""; showText(false); }
      else if (known.has(v)) { sel.value = v; showText(false); }
      else { sel.value = ENUM_CUSTOM; text.value = v; showText(true); }
    },
  };
  return { node: el("div", { class: "enum-control" }, [sel, text]), input };
}

// build a labelled input or select for one field
function fieldControl(key, label, value = "") {
  if (ENUM_SELECT.has(key)) {
    const opts = FIELD_ENUMS[key] || ENUMS[key] || [];
    const { node: control, input } = enumControl(opts, value);
    return { node: field(label, control), input };
  }
  if (key.endsWith("At")) {                       // datetime fields get a native picker
    const cleanLabel = label.replace(/\s*\(ISO 8601\)/i, "");
    // film-dating fields (expiry, manufacture) are calendar dates, not timestamps —
    // no one records film expiry to the minute, so use a date-only picker.
    const type = DATE_ONLY.has(key) ? "date" : "datetime-local";
    const { wrap, input } = dateField(cleanLabel, value, { type });
    return { node: wrap, input };
  }
  const { wrap, input } = inputField(label, key, value);
  return { node: wrap, input };
}

// How many instances (across every kind that is an instance of `typeKind`) point
// at `typeUri`, excluding `exceptUri`. Used to tell whether a catalog type is
// shared or solely owned by the instance being edited.
export function countTypeRefs(typeKind, typeUri, exceptUri) {
  let n = 0;
  for (const [k, tk] of Object.entries(TYPE_OF_INSTANCE)) {
    if (tk !== typeKind) continue;
    const field = TYPE_KEY[k];
    for (const inst of (ctx.store.instance[k] || [])) {
      if (inst.uri === exceptUri) continue;
      if (inst.value?.[field] === typeUri) n++;
    }
  }
  return n;
}

// Resolve which catalog type an instance should reference on save, without ever
// orphaning a type. Behaviour:
//   • identity matches an existing type → point at it (dedup); if that leaves the
//     instance's previous type unreferenced, delete the orphan;
//   • no match, and the instance solely owned its previous type → rename that
//     type in place (stable URI, no duplicate) — this is the edit-a-name case;
//   • otherwise (fresh add, or the previous type is shared) → create a new type.
// Labs additionally carry editable fields (geo/website/location), so their
// matched/renamed record is always updated with the submitted values.
// Fields for a catalog TYPE's shared picture and datasheet — the model's, not
// your copy's. A link is the default: it points at the manufacturer's own copy of
// its own photograph, so nothing is re-hosted. An upload is offered for material
// you may lawfully host (your own photograph, a permissively licensed one).
// Leaving both blank keeps the curated manufacturer or Wikidata picture.
function typeAssetFields(typeKind, typeValue) {
  const hadImageUrl = Boolean(typeValue?.image?.url);
  const hadSheetUrl = Boolean(typeValue?.datasheet?.url);
  const imgUrl = el("input", { type: "url", placeholder: "https://…  (blank uses the stock picture)", value: typeValue?.image?.url || "" });
  const imgFile = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
  const dsUrl = el("input", { type: "url", placeholder: "https://…  datasheet PDF", value: typeValue?.datasheet?.url || typeValue?.datasheetUrl || "" });
  const dsFile = el("input", { type: "file", accept: "application/pdf,image/png,image/jpeg" });

  const preview = el("div", { class: "type-thumb", "aria-hidden": "true" });
  const paint = (url) => {
    if (url) { preview.style.backgroundImage = `url("${url}")`; preview.classList.add("has-img"); }
    else { preview.style.backgroundImage = ""; preview.classList.remove("has-img"); }
  };
  if (typeValue) {
    catalogImageUrl(typeKind, typeValue, { blobUrl: (b) => blobUrl(ctx.agent, ctx.did, b) })
      .then(paint).catch(() => {});
  }
  imgUrl.addEventListener("input", () => paint(imgUrl.value.trim()));
  imgFile.addEventListener("change", () => {
    const f = imgFile.files?.[0];
    if (f) paint(URL.createObjectURL(f));
  });

  const nodes = [
    el("h3", { class: "modal-sub" }, "Picture and datasheet"),
    el("p", { class: "muted small" }, "These describe the model itself, so everyone who uses it sees them. Leave blank to keep the manufacturer picture."),
    el("div", { class: "row type-asset-row" }, [
      preview,
      el("div", { class: "type-asset-fields" }, [field("Picture link", imgUrl), field("or upload a picture", imgFile)]),
    ]),
    field("Datasheet link", dsUrl),
    field("or upload a datasheet", dsFile),
  ];

  const upload = async (input, fallbackMime) => {
    const f = input.files?.[0];
    if (!f) return null;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const up = await ctx.agent.com.atproto.repo.uploadBlob(bytes, { encoding: f.type || fallbackMime });
    return { blob: up.data.blob, mimeType: f.type || fallbackMime };
  };

  return {
    nodes,
    // Returns the assetRef fields to merge onto the type record. Clearing a link
    // that was there removes the override; an untouched field round-trips.
    async read() {
      const out = {};
      const up = await upload(imgFile, "image/jpeg");
      const url = imgUrl.value.trim();
      if (up) out.image = { file: up.blob, mimeType: up.mimeType };
      else if (url) out.image = { url };
      else if (typeValue?.image && !hadImageUrl) out.image = typeValue.image;   // keep an upload
      else out.image = undefined;

      const dup = await upload(dsFile, "application/pdf");
      const dsu = dsUrl.value.trim();
      if (dup) out.datasheet = { file: dup.blob, mimeType: dup.mimeType };
      else if (dsu) out.datasheet = { url: dsu };
      else if (typeValue?.datasheet && !hadSheetUrl) out.datasheet = typeValue.datasheet;
      else out.datasheet = undefined;
      return out;
    },
  };
}

// the type fields that describe the model's assets rather than its identity
const ASSET_KEYS = ["image", "datasheet"];
const sameAsset = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function resolveTypeForSave(typeKind, typeRec, wikidata, kind, existing) {
  const now = new Date().toISOString();
  const all = ctx.store.catalog[typeKind] || [];
  const label = catalogLabel(typeKind, typeRec).toLowerCase().trim();
  const match = all.find((t) => catalogLabel(typeKind, t.value).toLowerCase().trim() === label);
  const oldUri = existing?.value?.[TYPE_KEY[kind]] || null;
  const oldItem = oldUri ? all.find((t) => t.uri === oldUri) : null;
  const isLab = typeKind === "lab";
  const oldSharedByOthers = oldUri ? countTypeRefs(typeKind, oldUri, existing?.uri) > 0 : false;

  if (match) {
    // an existing type already carries this identity — reference it (dedup).
    if (oldUri && oldUri !== match.uri && !oldSharedByOthers) {
      await deleteRecord(ctx.agent, ctx.did, oldUri);      // clean up the orphan we just left
    }
    if (isLab) {
      const merged = { ...match.value, ...typeRec, updatedAt: now };
      return saveRecord(ctx.agent, ctx.did, NS.catalog[typeKind], merged, match);
    }
    // Reusing an existing type must still land an explicit picture/datasheet edit,
    // or the change the user just made would silently vanish.
    if (ASSET_KEYS.some((k) => k in typeRec && !sameAsset(typeRec[k], match.value[k]))) {
      const merged = { ...match.value, updatedAt: now };
      for (const k of ASSET_KEYS) {
        if (!(k in typeRec)) continue;
        if (typeRec[k] === undefined) delete merged[k]; else merged[k] = typeRec[k];
      }
      return saveRecord(ctx.agent, ctx.did, NS.catalog[typeKind], merged, match);
    }
    return match.uri;
  }

  if (oldItem && !oldSharedByOthers) {
    // the instance solely owned its old type and the identity changed → rename it
    // in place rather than spawning a duplicate.
    const merged = { ...oldItem.value, ...typeRec, updatedAt: now };
    if (wikidata && !merged.links) merged.links = { externalIds: [{ scheme: "wikidata", value: wikidata }] };
    return saveRecord(ctx.agent, ctx.did, NS.catalog[typeKind], merged, oldItem);
  }

  // fresh create: a brand-new add, or the old type is shared so we must not mutate it.
  const rec = { ...typeRec };
  if (wikidata) rec.links = { externalIds: [{ scheme: "wikidata", value: wikidata }] };
  return saveRecord(ctx.agent, ctx.did, NS.catalog[typeKind], rec, null);
}

// The one "add gear" flow. Users describe the gear ("what is it?") and their
// copy ("your copy"). The catalog type is found-or-created behind the scenes.
export function openAddGear(kind, onDone, prefill = {}, existing = null) {
  const typeKind = TYPE_OF_INSTANCE[kind];
  const preset = typeKind ? PRESETS[typeKind] : null;
  const typeInputs = {};
  const typeNodes = {};
  const instInputs = {};
  const nodes = [];
  let labLocF = null;                       // map location control for labs

  // ----- "what is it?" (identity → auto type) -----
  let matchedPreset = null;
  let akaHint = null;
  if (typeKind) {
    nodes.push(el("h3", { class: "modal-sub" }, kind === "filmRoll" ? "Which film?" : `Which ${kindLabel(kind).toLowerCase()}?`));
    for (const [key, label, req] of TYPE_IDENTITY[typeKind]) {
      const { node, input } = fieldControl(key, label + (req ? " *" : ""));
      typeInputs[key] = input;
      typeNodes[key] = node;
      if ((key === "brand" || key === "make") && input.tagName === "INPUT") autocomplete(node, input, MANUFACTURERS);
      nodes.push(node);
    }
    for (const [k, v] of Object.entries(prefill)) {
      if (typeInputs[k] != null && v != null) typeInputs[k].value = String(v);
    }
    // "also sold as" note for rebranded films (Ektacolor Pro 400 is Portra 400),
    // filled in by applyPreset when the picked stock carries an `aka`.
    if (typeKind === "filmStock") {
      akaHint = el("p", { class: "muted small aka-hint hidden" });
      nodes.push(akaHint);
    }
    // labs get a map picker (with search) for their physical location.
    if (typeKind === "lab") {
      labLocF = locationField(prefill.geo || null);
      nodes.push(field("Map location", labLocF.node));
    }
    if (preset && typeInputs[preset.primary]) {
      const primaryKey = preset.primary;                       // "model" or "name"
      const makeKey = typeInputs.make ? "make" : (typeInputs.brand ? "brand" : null);
      const nm = (s) => String(s || "").trim().toLowerCase();
      const makeOf = (it) => nm(it.make || it.brand);

      // set a field, teaching a <select> the value if it is not already an option
      const setField = (key, v) => {
        const inp = typeInputs[key];
        if (inp == null || v == null || typeof v === "object") return;
        const sv = String(v);
        if (inp.tagName === "SELECT" && ![...inp.options].some((o) => o.value === sv)) {
          inp.append(el("option", { value: sv }, enumLabel(sv)));
        }
        inp.value = sv;
      };

      // model options are conditioned on the chosen make: pick Nikon, see Nikons
      autocomplete(typeNodes[primaryKey], typeInputs[primaryKey], () => {
        const mk = makeKey ? nm(typeInputs[makeKey].value) : "";
        const seen = new Set(), out = [];
        for (const it of preset.items) {
          if (mk && makeOf(it) !== mk && !makeOf(it).startsWith(mk)) continue;
          const label = it[primaryKey];
          if (label && !seen.has(label)) { seen.add(label); out.push(label); }
        }
        return out;
      });

      // picking a model autofills everything the model determines: make, mount,
      // format, category, focal length, aperture, iso, ... (from lensfun/presets)
      const applyPreset = () => {
        matchedPreset = null;
        const md = nm(typeInputs[primaryKey].value);
        if (!md) return;
        const mk = makeKey ? nm(typeInputs[makeKey].value) : "";
        const it = preset.items.find((x) => nm(x[primaryKey]) === md && (!mk || makeOf(x) === mk))
                || preset.items.find((x) => nm(x[primaryKey]) === md);
        if (!it) return;
        matchedPreset = it;
        for (const [k, v] of Object.entries(it)) setField(k, v);
        if (akaHint) {
          const aka = Array.isArray(it.aka) ? it.aka : [];
          akaHint.textContent = aka.length ? `Same film, also sold as ${aka.join(", ")}.` : "";
          akaHint.classList.toggle("hidden", !aka.length);
        }
      };
      typeInputs[primaryKey].addEventListener("input", applyPreset);
    }
  }

  // lens catalog can never be fully complete, so let the user suggest a missing
  // one: opens a prefilled GitHub issue against the curated database.
  if (kind === "lens") {
    const suggest = el("button", { class: "linkbtn small", type: "button" }, [icon("plus", 13), " Can't find your lens? Suggest it"]);
    suggest.addEventListener("click", () => {
      const f = {};
      for (const [k, inp] of Object.entries(typeInputs)) f[k] = inp?.value || "";
      window.open(lensIssueUrl(f), "_blank", "noopener");
    });
    nodes.push(el("p", { class: "muted small suggest-lens" }, [suggest]));
  }

  // the model's shared picture/datasheet, prefilled from the type this instance
  // currently points at, so editing your copy can also fix the model's picture.
  // Belongs with the identity fields above: it describes the model, not your copy.
  let typeAssets = null;
  if (typeKind) {
    const curTypeUri = existing?.value?.[TYPE_KEY[kind]] || null;
    const curType = curTypeUri
      ? (ctx.store.catalog[typeKind] || []).find((t) => t.uri === curTypeUri)?.value || null
      : null;
    typeAssets = typeAssetFields(typeKind, curType);
    nodes.push(...typeAssets.nodes);
  }

  // ----- "your copy" (the instance) -----
  const instFields = INSTANCE_FIELDS[kind] || [["nickname", "Nickname"]];
  if (typeKind) {
    const sub = kind === "filmRoll" ? "This roll (optional)"
      : kind === "filmStockpile" ? "In reserve"
      : "Your copy (optional)";
    nodes.push(el("h3", { class: "modal-sub" }, sub));
  }
  for (const [key, label, req] of instFields) {
    if (label.startsWith("@")) {           // reference to one of the user's own instances
      const refKind = label.slice(1);
      const sel = instanceSelect(refKind, "");
      instInputs[key] = sel;
      nodes.push(field(kindLabel(refKind), sel));
      continue;
    }
    const { node, input } = fieldControl(key, label + (req ? " *" : ""));
    instInputs[key] = input;
    nodes.push(node);
  }

  // prefill the instance fields too (used when editing an existing copy)
  for (const [k, v] of Object.entries(prefill)) {
    const inp = instInputs[k];
    if (inp == null || v == null || typeof v === "object") continue;
    if (inp.type === "datetime-local" || inp.type === "date") { inp.value = isoToLocalInput(String(v), inp.type !== "date"); continue; }
    const sv = String(v);
    if (inp.tagName === "SELECT" && ![...inp.options].some((o) => o.value === sv)) inp.append(el("option", { value: sv }, enumLabel(sv)));
    inp.value = sv;
  }

  const photoInput = el("input", { type: "file", accept: "image/*" });
  nodes.push(field("Photo (optional, a stock image is used otherwise)", photoInput));

  openModal(`${existing ? "Edit" : "Add"} ${kindLabel(kind).toLowerCase()}`, nodes, async () => {
    let typeUri = null;
    if (typeKind) {
      const typeRec = readFormFields(typeInputs, {
        scaledKeys: ["focalLengthMin", "focalLengthMax", "maxAperture", "minAperture"],
        shutterScaledKeys: ["minShutterSpeed", "maxShutterSpeed"],
        scaledArrayKeys: { apertureSteps: displayToScaled, shutterSpeedSteps: displayToShutterScaled },
        measureKeys: { defaultTemperature: "celsius" },
      });
      const req = TYPE_IDENTITY[typeKind].filter(([, , r]) => r).map(([k]) => k);
      if (req.some((k) => !typeInputs[k]?.value.trim())) throw new Error("Please fill the required fields");
      // carry the datasheet-farmed spec fields from a matched film-stock preset
      // onto the saved record, so the enriched data (formats, base, grain, source…)
      // isn't lost — the add form only has inputs for the core identity fields.
      if (matchedPreset && typeKind === "filmStock") {
        for (const k of ["formats", "base", "spectralSensitivity", "grainRms", "resolvingPowerLpMm", "exposureLatitude", "reciprocity", "dxNumber", "discontinued", "releasedYear", "datasheetUrl", "aka"]) {
          if (matchedPreset[k] != null && typeRec[k] == null) typeRec[k] = matchedPreset[k];
        }
      }
      // matchedPreset tracks the current model selection, so its QID is valid.
      const wikidata = matchedPreset?.wikidata || null;
      if (typeKind === "lab") {
        const geo = labLocF?.get();
        if (geo) typeRec.geo = geo;
      }
      // the model's own picture/datasheet, uploaded here if the user chose files
      if (typeAssets) Object.assign(typeRec, await typeAssets.read());
      // resolve (and, on rename, edit-in-place or dedup) without orphaning a type.
      typeUri = await resolveTypeForSave(typeKind, typeRec, wikidata, kind, existing);
    }
    const rec = readFormFields(instInputs, {});
    // required instance fields (e.g. storageLocation name)
    if (instFields.some(([k, , r]) => r && !instInputs[k]?.value.trim())) throw new Error("Please fill the required fields");
    if (typeUri) rec[TYPE_KEY[kind]] = typeUri;
    const file = photoInput.files?.[0];
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const up = await ctx.agent.com.atproto.repo.uploadBlob(bytes, { encoding: file.type || "image/jpeg" });
      rec.image = up.data.blob;
    } else if (existing?.value?.image) {
      rec.image = existing.value.image;                    // keep the existing photo
    }
    if (existing) {
      rec.createdAt = existing.value.createdAt || rec.createdAt;
      rec.updatedAt = new Date().toISOString();
    }
    await saveRecord(ctx.agent, ctx.did, NS.instance[kind], rec, existing);
    if (kind === "filmStockpile" && existing && reserveQuantity(rec) === 0) {
      await maybeRemoveDepletedStockpile(existing);
    }
    ctx.store = await loadStore(ctx.agent, ctx.did);
    onDone?.();
  });
}

// kept name for callers that quick-add gear (editor photo cards, etc.)
export const openCreateInstanceModal = (kind, onDone) => openAddGear(kind, onDone);

// Edit an existing copy. Prefill the form from the instance and its catalog
// type, then update the same record in place (create is reused for the layout).
export function openEditGear(kind, item, onDone) {
  const typeKind = TYPE_OF_INSTANCE[kind];
  const prefill = { ...item.value };
  if (typeKind) {
    const typeUri = item.value[TYPE_KEY[kind]];
    const tv = ctx.store.catalog[typeKind]?.find((t) => t.uri === typeUri)?.value;
    if (tv) {
      const conv = { ...tv };
      for (const k of ["focalLengthMin", "focalLengthMax", "maxAperture", "minAperture"]) {
        if (conv[k] != null) conv[k] = scaledToDisplay(conv[k]);
      }
      for (const k of ["minShutterSpeed", "maxShutterSpeed"]) {
        if (conv[k] != null) conv[k] = shutterScaledToDisplay(conv[k]);
      }
      if (conv.apertureSteps?.length) conv.apertureSteps = formatScaledList(conv.apertureSteps, scaledToDisplay);
      if (conv.shutterSpeedSteps?.length) conv.shutterSpeedSteps = formatScaledList(conv.shutterSpeedSteps, shutterScaledToDisplay);
      if (conv.defaultTemperature != null) conv.defaultTemperature = measureToDisplay(conv.defaultTemperature);
      Object.assign(prefill, conv);
    }
  }
  openAddGear(kind, onDone, prefill, item);
}

function processChip(value) {
  const pr = value?.process;
  if (!pr) return null;
  const cls = { c41: "c41", ra4: "c41", e6: "e6", ecn2: "ecn2", bw: "bw", "reversal-bw": "bw" }[pr] || "bw";
  return el("span", { class: `chip ${cls}` }, enumLabel(pr));
}

// user photo of the item if present, else the catalog type's stock image.
function instanceThumb(kind, value) {
  const thumb = el("div", { class: "type-thumb", "aria-hidden": "true" });
  instanceImageUrl(ctx.agent, ctx.did, ctx.store, kind, value).then((url) => {
    if (url) { thumb.style.backgroundImage = `url("${url}")`; thumb.classList.add("has-img"); }
  }).catch(() => {});
  return thumb;
}

const MAINTAINABLE = new Set(["camera", "lens", "scanner", "enlarger"]);
const MAINTENANCE_KINDS = ["cla", "sensor-clean", "shutter-service", "fungus-clean", "calibration", "other"];

function openMaintenanceModal(subjectUri, onDone) {
  const kindSel = el("select", {}, MAINTENANCE_KINDS.map((v) => el("option", { value: v }, enumLabel(v))));
  const { wrap: pWrap, input: performedAt } = inputField("Performed at (ISO 8601)", "performedAt", "", "2026-07-01T14:30:00Z");
  const { wrap: scWrap, input: shutterCountAfter } = inputField("Shutter count after (optional)", "shutterCountAfter");
  const { wrap: nWrap, input: notes } = inputField("Notes", "notes");
  const history = ctx.store.maintenanceBySubject?.get(subjectUri) || [];
  const historyNodes = history.length
    ? [el("h3", { class: "modal-sub" }, "Service history"),
       ...history
         .slice()
         .sort((a, b) => (b.value.performedAt || b.value.createdAt).localeCompare(a.value.performedAt || a.value.createdAt))
         .map((h) => el("div", { class: "gear-row small" }, [
           el("b", {}, enumLabel(h.value.kind)),
           el("span", { class: "muted" }, `${h.value.performedAt ? ` · ${h.value.performedAt.slice(0, 10)}` : ""}${h.value.shutterCountAfter ? ` · ${h.value.shutterCountAfter} frames` : ""}${h.value.notes ? ` · ${h.value.notes}` : ""}`),
         ])),
       el("h3", { class: "modal-sub" }, "Log new")]
    : [];
  openModal("Maintenance", [...historyNodes, field("Kind *", kindSel), pWrap, scWrap, nWrap], async () => {
    const rec = { subject: subjectUri, kind: kindSel.value, createdAt: new Date().toISOString() };
    if (performedAt.value.trim()) rec.performedAt = new Date(performedAt.value.trim()).toISOString();
    const sc = parseInt(shutterCountAfter.value, 10);
    if (Number.isFinite(sc)) rec.shutterCountAfter = sc;
    if (notes.value.trim()) rec.notes = notes.value.trim();
    await saveRecord(ctx.agent, ctx.did, NS.process.maintenanceSession, rec, null);
    onDone?.();
  });
}

// Render one gear category tab. `kinds` is the instance kinds this tab owns;
// each is always shown (even empty) with its own "Add …" button.
function renderGearTab(body, kinds) {
  for (const kind of kinds) {
    const items = ctx.store.instance[kind] || [];
    const card = el("div", { class: "card gear-section" });
    card.append(el("div", { class: "row between" }, [
      el("h2", {}, kindLabelPlural(kind)),
      el("button", { class: "ghost small-btn add-gear", onclick: () => openAddGear(kind, () => renderLibrary(body)) },
        [icon("plus", 15), el("span", {}, `Add ${kindLabel(kind).toLowerCase()}`)]),
    ]));

    if (!items.length) {
      card.append(el("p", { class: "muted small gear-empty" }, `No ${kindLabelPlural(kind).toLowerCase()} yet.`));
    } else {
      const ul = el("ul", { class: "gear-list" });
      for (const item of items) {
        ul.append(el("li", { class: "gear-row row between" }, [
          el("span", { class: "row type-label" }, [
            instanceThumb(kind, item.value),
            el("span", {}, instanceLabel(kind, item.value, ctx.store)),
            processChip(item.value),
          ]),
          el("span", { class: "row" }, [
            isAdvanced()
              ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(item) }, "{ }")
              : null,
            el("button", {
              class: "ghost small-btn",
              title: "Edit", "aria-label": "Edit",
              onclick: () => openEditGear(kind, item, () => renderLibrary(body)),
            }, [icon("edit", 15)]),
            MAINTAINABLE.has(kind)
              ? el("button", { class: "ghost small-btn", onclick: () => openMaintenanceModal(item.uri, () => renderLibrary(body)) }, "Service")
              : null,
            el("button", {
              class: "ghost small-btn danger",
              title: "Remove", "aria-label": "Remove",
              onclick: async () => {
                if (!(await confirmModal(`Remove this ${kindLabel(kind).toLowerCase()}?`))) return;
                const snapshot = item.value;
                await deleteRecord(ctx.agent, ctx.did, item.uri);
                ctx.store = await loadStore(ctx.agent, ctx.did);
                renderLibrary(body);
                toast("Removed", "ok", 6000, { label: "Undo", fn: async () => { await saveRecord(ctx.agent, ctx.did, NS.instance[kind], snapshot, null); ctx.store = await loadStore(ctx.agent, ctx.did); renderLibrary(body); } });
              },
            }, [icon("trash", 15)]),
          ]),
        ]));
      }
      card.append(ul);
    }
    body.append(card);
  }
}

// -- Film: reserve stockpiles + physical rolls (+ frames <-> photos by AT-URI) --

const ROLLS_PREVIEW = 5;

function rollStatusOrder(status) {
  const i = ENUMS.rollStatus.indexOf(status || "loaded");
  return i < 0 ? ENUMS.rollStatus.length : i;
}

function compareRollsByStatus(a, b) {
  const byStatus = rollStatusOrder(a.value.status) - rollStatusOrder(b.value.status);
  if (byStatus !== 0) return byStatus;
  return (b.value.loadedAt || b.value.createdAt || "").localeCompare(a.value.loadedAt || a.value.createdAt || "");
}

function filmStockLabel(stockUri) {
  const t = (ctx.store.catalog.filmStock || []).find((x) => x.uri === stockUri)?.value;
  return t ? catalogLabel("filmStock", t) : "Unknown film";
}

// Summarise a reserve's or roll's dating (batch + expiry + storage/format) for
// display, and flag stock that is past — or near — its use-by. This is what
// distinguishes two reserve lines of the same stock but different batches.
const EXPIRY_SOON_MS = 90 * 24 * 60 * 60 * 1000;   // ~3 months out
function filmDating(v) {
  const bits = [];
  if (v.emulsionBatch) bits.push(`batch ${v.emulsionBatch}`);
  let expired = false, soon = false;
  if (v.expiresAt) {
    const t = Date.parse(v.expiresAt);
    if (Number.isFinite(t)) {
      const now = Date.now();
      expired = t < now;
      soon = !expired && t < now + EXPIRY_SOON_MS;
      const when = new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
      bits.push(expired ? `expired ${when}` : `exp ${when}`);
    }
  }
  if (v.format) bits.push(enumLabel(v.format));
  if (v.storage) bits.push(enumLabel(v.storage));
  return { text: bits.join(" · "), expired, soon };
}

function framesForRoll(rollUri) {
  return (ctx.store.instance.exposure || [])
    .filter((f) => f.value.roll === rollUri)
    .sort((a, b) => (a.value.frameNumber ?? 0) - (b.value.frameNumber ?? 0));
}

async function reloadFilm(body) {
  ctx.store = await loadStore(ctx.agent, ctx.did);
  renderLibrary(body);
}

function reserveQuantity(value) {
  return Math.max(0, Number(value?.quantity) || 0);
}

async function maybeRemoveDepletedStockpile(sp) {
  const label = filmStockLabel(sp.value.stock);
  if (!(await confirmModal(
    `${label} is out of stock. Remove this reserve entry?`,
    { confirmLabel: "Remove", cancelLabel: "Keep", danger: true },
  ))) return false;
  await deleteRecord(ctx.agent, ctx.did, sp.uri);
  return true;
}

function renderFilmTab(body) {
  const stockpiles = (ctx.store.instance.filmStockpile || []).filter((sp) => reserveQuantity(sp.value) > 0);
  const rolls = ctx.store.instance.filmRoll || [];

  // ----- reserve stockpiles -----
  const reserve = el("div", { class: "card gear-section" });
  reserve.append(el("div", { class: "row between" }, [
    el("h2", {}, "Film in reserve"),
    el("button", { class: "ghost small-btn add-gear", onclick: () => openAddGear("filmStockpile", () => renderLibrary(body)) },
      [icon("plus", 15), el("span", {}, "Add film")]),
  ]));
  if (!stockpiles.length) {
    reserve.append(el("p", { class: "muted small gear-empty" }, "No film in reserve yet. Add the stocks you keep on hand."));
  } else {
    const ul = el("ul", { class: "gear-list" });
    for (const sp of stockpiles) {
      const qty = Number(sp.value.quantity) || 0;
      const adjust = async (delta) => {
        const next = Math.max(0, qty + delta);
        await saveRecord(ctx.agent, ctx.did, NS.instance.filmStockpile, { ...sp.value, quantity: next, updatedAt: new Date().toISOString() }, sp);
        if (next === 0) await maybeRemoveDepletedStockpile(sp);
        reloadFilm(body);
      };
      const dating = filmDating(sp.value);
      ul.append(el("li", { class: "gear-row row between" + (dating.expired || dating.soon ? " warn-row" : "") }, [
        el("span", { class: "row type-label" }, [
          instanceThumb("filmStockpile", sp.value),
          el("span", { class: "reserve-id" }, [
            el("span", { class: "row", style: "gap:8px" }, [
              el("span", {}, filmStockLabel(sp.value.stock)),
              el("span", { class: "qty-badge" }, `×${qty}`),
              dating.expired ? el("span", { class: "status-chip warn" }, "expired")
                : dating.soon ? el("span", { class: "status-chip warn" }, "expiring") : null,
            ]),
            dating.text ? el("div", { class: "muted small" }, dating.text) : null,
          ]),
        ]),
        el("span", { class: "row" }, [
          el("button", { class: "ghost small-btn", title: "One fewer", "aria-label": "One fewer", onclick: () => adjust(-1) }, "−"),
          el("button", { class: "ghost small-btn", title: "One more", "aria-label": "One more", onclick: () => adjust(1) }, "+"),
          el("button", { class: "ghost small-btn", onclick: () => openLoadRoll(sp, body) }, [icon("camera", 14), el("span", {}, "Load")]),
          el("button", { class: "ghost small-btn", title: "Log another batch of this stock", "aria-label": "Duplicate reserve", onclick: () => openDuplicateReserve(sp, body) }, [icon("copy", 15)]),
          isAdvanced() ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(sp) }, "{ }") : null,
          el("button", { class: "ghost small-btn", title: "Edit", "aria-label": "Edit", onclick: () => openEditGear("filmStockpile", sp, () => renderLibrary(body)) }, [icon("edit", 15)]),
          el("button", {
            class: "ghost small-btn danger", title: "Remove", "aria-label": "Remove",
            onclick: async () => {
              if (!(await confirmModal("Remove this reserve?"))) return;
              await deleteRecord(ctx.agent, ctx.did, sp.uri); reloadFilm(body);
            },
          }, [icon("trash", 15)]),
        ]),
      ]));
    }
    reserve.append(ul);
  }
  body.append(reserve);

  // ----- physical rolls -----
  const rollCard = el("div", { class: "card gear-section" });
  rollCard.append(el("div", { class: "row between" }, [
    el("h2", {}, "Rolls"),
    el("button", { class: "ghost small-btn add-gear", onclick: () => openAddGear("filmRoll", () => renderLibrary(body)) },
      [icon("plus", 15), el("span", {}, "New roll")]),
  ]));
  if (!rolls.length) {
    rollCard.append(el("p", { class: "muted small gear-empty" }, "No rolls yet. Load one from reserve, or add a roll you've already shot."));
  } else {
    const sortedRolls = [...rolls].sort(compareRollsByStatus);
    const ul = el("ul", { class: "gear-list" });
    const rollRow = (roll) => {
      const v = roll.value;
      const cam = v.camera ? instanceLabel("camera", (ctx.store.instance.camera.find((c) => c.uri === v.camera)?.value) || {}, ctx.store) : null;
      const nFrames = framesForRoll(roll.uri).length;
      const dating = filmDating(v);
      return el("li", { class: "gear-row row between" + (dating.expired || dating.soon ? " warn-row" : "") }, [
        el("span", { class: "row type-label" }, [
          instanceThumb("filmRoll", v),
          el("span", { class: "reserve-id" }, [
            el("span", { class: "row", style: "gap:8px" }, [
              el("span", {}, v.label ? `${v.label} · ${filmStockLabel(v.stock)}` : filmStockLabel(v.stock)),
              v.status ? el("span", { class: "status-chip" }, enumLabel(v.status)) : null,
              cam ? el("span", { class: "muted small" }, `in ${cam}`) : null,
              nFrames ? el("span", { class: "muted small" }, `· ${nFrames} frame${nFrames === 1 ? "" : "s"}`) : null,
            ]),
            dating.text ? el("div", { class: "muted small" }, dating.text) : null,
          ]),
        ]),
        el("span", { class: "row" }, [
          el("button", { class: "ghost small-btn", onclick: () => openRollDetail(roll, body) }, [icon("film", 14), el("span", {}, "Open")]),
          isAdvanced() ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(roll) }, "{ }") : null,
          el("button", { class: "ghost small-btn", title: "Edit", "aria-label": "Edit", onclick: () => openEditGear("filmRoll", roll, () => renderLibrary(body)) }, [icon("edit", 15)]),
          el("button", {
            class: "ghost small-btn danger", title: "Remove", "aria-label": "Remove",
            onclick: async () => {
              if (!(await confirmModal("Remove this roll?"))) return;
              await deleteRecord(ctx.agent, ctx.did, roll.uri); reloadFilm(body);
            },
          }, [icon("trash", 15)]),
        ]),
      ]);
    };
    for (const roll of sortedRolls.slice(0, ROLLS_PREVIEW)) ul.append(rollRow(roll));
    if (sortedRolls.length > ROLLS_PREVIEW) {
      const hidden = el("ul", { class: "gear-list hidden" });
      for (const roll of sortedRolls.slice(ROLLS_PREVIEW)) hidden.append(rollRow(roll));
      const nMore = sortedRolls.length - ROLLS_PREVIEW;
      const moreBtn = el("button", {
        class: "ghost small-btn reveal-summary",
        type: "button",
        style: "margin-top:8px",
      }, [`Show ${nMore} more roll${nMore === 1 ? "" : "s"}`, el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄")]);
      moreBtn.addEventListener("click", () => {
        hidden.classList.remove("hidden");
        moreBtn.remove();
      });
      rollCard.append(ul, moreBtn, hidden);
    } else {
      rollCard.append(ul);
    }
  }
  body.append(rollCard);
}

// Log another batch of the same stock: opens the "Add film" form prefilled with
// the same stock, format, storage and location, but a blank batch and expiry —
// because a new batch is, by definition, dated differently. Keeps each reserve
// line one-batch-one-expiry rather than mixing lots in a single record.
function openDuplicateReserve(sp, body) {
  const v = sp.value;
  const stock = (ctx.store.catalog.filmStock || []).find((x) => x.uri === v.stock)?.value || {};
  const prefill = {
    // full stock identity so the "Which film?" section is populated (brand, name,
    // ISO, film type, process, format) and re-selects the same catalog stock.
    brand: stock.brand,
    name: stock.name,
    iso: stock.iso,
    filmType: stock.filmType,
    process: stock.process,
    format: v.format ?? stock.format,
    storage: v.storage,
    storageLocation: v.storageLocation,
    quantity: v.quantity,
    // emulsionBatch + expiresAt intentionally omitted: a new batch is dated anew.
  };
  openAddGear("filmStockpile", () => renderLibrary(body), prefill);
}

// load one roll off a reserve into a camera (auto-splits the stockpile).
function openLoadRoll(stockpile, body) {
  const camSel = instanceSelect("camera", "");
  const labelInput = el("input", { type: "text", placeholder: "e.g. Roll 12 (optional)" });
  openModal(`Load ${filmStockLabel(stockpile.value.stock)}`, [
    el("p", { class: "muted small" }, "Splits one roll off your reserve and marks it loaded. Its format, batch, expiry and storage carry over."),
    field("Into camera", camSel),
    field("Label", labelInput),
  ], async () => {
    const prevQty = reserveQuantity(stockpile.value);
    const rollUri = await splitRollFromStockpile(ctx.agent, ctx.did, stockpile, {
      camera: camSel.value || null,
      label: labelInput.value.trim() || null,
    });
    if (prevQty <= 1) await maybeRemoveDepletedStockpile(stockpile);
    ctx.store = await loadStore(ctx.agent, ctx.did);
    // jump straight into the new roll so the next tap is "Add frame" — load and shoot.
    const roll = (ctx.store.instance.filmRoll || []).find((r) => r.uri === rollUri);
    renderLibrary(body);
    if (roll) openRollDetail(roll, body);
  });
}

// roll detail: status/camera/develop fields + the frame <-> photo list.
function openRollDetail(roll, body) {
  const v = roll.value;
  const statusSel = el("select", {}, ENUMS.rollStatus.map((s) => el("option", { value: s }, enumLabel(s))));
  statusSel.value = v.status || "loaded";
  const camSel = instanceSelect("camera", v.camera || "");
  const devSel = instanceSelect("developer", v.developedWith || "");
  const labSel = instanceSelect("labAccount", v.lab || "");
  const cassetteSel = el("select", {}, [el("option", { value: "" }, "(none)"), ...ENUMS.cassetteType.map((c) => el("option", { value: c }, enumLabel(c)))]);
  cassetteSel.value = v.cassetteType || "";
  const isoInput = el("input", { type: "number", min: "1", value: v.shotAtIso || "" });

  const framesWrap = el("div", { class: "frame-list" });
  const renderFrames = () => {
    framesWrap.replaceChildren();
    const frames = framesForRoll(roll.uri);
    if (!frames.length) framesWrap.append(el("p", { class: "muted small" }, "No frames linked yet."));
    // count exposures per frame number so multiple exposures on one frame read clearly
    const perFrame = new Map();
    for (const f of frames) { const n = f.value.frameNumber; if (n != null) perFrame.set(n, (perFrame.get(n) || 0) + 1); }
    for (const f of frames) {
      const n = f.value.frameNumber;
      const multi = n != null && perFrame.get(n) > 1;
      const photoLabel = f.value.photo ? "linked photo" : "no photo";
      const settings = [f.value.aperture ? `ƒ/${f.value.aperture}` : "", f.value.shutterSpeed || ""].filter(Boolean).join(" ");
      framesWrap.append(el("div", { class: "frame-row row between" }, [
        el("span", { class: "row" }, [
          el("span", { class: "frame-num" }, n != null ? `#${n}${f.value.frameExposureIndex ? `.${f.value.frameExposureIndex}` : ""}` : "#?"),
          multi ? el("span", { class: "me-badge", title: "Multiple exposure" }, "ME") : null,
          el("span", { class: "muted small" }, settings || f.value.note || photoLabel),
        ]),
        el("button", {
          class: "ghost small-btn danger", title: "Remove frame", "aria-label": "Remove frame",
          onclick: async () => { await deleteRecord(ctx.agent, ctx.did, f.uri); ctx.store = await loadStore(ctx.agent, ctx.did); syncRollExposureCount(roll.uri).catch(() => {}); renderFrames(); },
        }, [icon("trash", 14)]),
      ]));
    }
  };
  renderFrames();

  // photos tagged to this roll via their capture (photo.capture.filmRoll) but not logged as an
  // exposure/frame. shown so a roll-tagged photo is visible on the roll — with its frame index when
  // set, and "#—" when the exact frame isn't known (associating a photo with a roll doesn't require it).
  const rollPhotosWrap = el("div", { class: "frame-list" });
  let photosByUri = null;
  const renderRollPhotos = async () => {
    const exposed = new Set(framesForRoll(roll.uri).map((e) => e.value.photo).filter(Boolean));
    const linked = [...ctx.store.photoCaptureByPhoto.entries()]
      .filter(([uri, cap]) => cap.value.filmRoll === roll.uri && !exposed.has(uri))
      .sort((a, b) => (a[1].value.frameIndex ?? Infinity) - (b[1].value.frameIndex ?? Infinity));
    if (!linked.length) {
      rollPhotosWrap.replaceChildren(el("p", { class: "muted small" }, "No photos tagged to this roll yet."));
      return;
    }
    if (!photosByUri) {
      try { photosByUri = new Map((await getPhotos(ctx.agent, ctx.did)).map((p) => [p.uri, p])); }
      catch { photosByUri = new Map(); }
    }
    rollPhotosWrap.replaceChildren();
    for (const [uri, cap] of linked) {
      const n = cap.value.frameIndex;
      const p = photosByUri.get(uri);
      const thumb = el("span", { class: "roll-photo-thumb", style: "width:34px;height:34px;border-radius:5px;background-color:var(--surface-2,#222);background-size:cover;background-position:center;flex:0 0 auto" });
      if (p) blobUrl(ctx.agent, ctx.did, p.value.photo).then((url) => { if (url) thumb.style.backgroundImage = `url(${url})`; }).catch(() => {});
      rollPhotosWrap.append(el("div", { class: "frame-row row between" }, [
        el("span", { class: "row", style: "gap:8px;align-items:center" }, [
          el("span", { class: "frame-num" }, n != null ? `#${n}` : "#—"),
          thumb,
          el("span", { class: "muted small" }, (p?.value?.alt || "linked photo").slice(0, 60)),
        ]),
      ]));
    }
  };
  renderRollPhotos();

  const addFrameBtn = el("button", { class: "ghost small-btn", type: "button", onclick: () => openAddFrame(roll, () => { renderFrames(); renderRollPhotos(); }) }, [icon("plus", 14), el("span", {}, "Add frame")]);

  openModal(`Roll · ${filmStockLabel(v.stock)}`, [
    field("Status", statusSel),
    field("Loaded in camera", camSel),
    field("Shot at ISO (push/pull)", isoInput),
    field("Developed with (home chemistry)", devSel),
    field("Developed at (lab)", labSel),
    field("Cassette", cassetteSel),
    el("h3", { class: "modal-sub" }, "Frames"),
    framesWrap,
    el("div", { class: "row" }, [addFrameBtn]),
    el("h3", { class: "modal-sub" }, "Photos on this roll"),
    rollPhotosWrap,
  ], async () => {
    const rec = { ...v, status: statusSel.value, updatedAt: new Date().toISOString() };
    if (camSel.value) { rec.camera = camSel.value; if (!rec.loadedAt) rec.loadedAt = new Date().toISOString(); }
    else delete rec.camera;
    if (devSel.value) rec.developedWith = devSel.value; else delete rec.developedWith;
    if (labSel.value) rec.lab = labSel.value; else delete rec.lab;
    if (cassetteSel.value) rec.cassetteType = cassetteSel.value; else delete rec.cassetteType;
    const iso = parseInt(isoInput.value, 10);
    if (Number.isFinite(iso)) rec.shotAtIso = iso; else delete rec.shotAtIso;
    await saveRecord(ctx.agent, ctx.did, NS.instance.filmRoll, rec, roll);
    reloadFilm(body);
  });
}

// add a frame: a number + (optionally) one of the user's photos (by AT-URI).
// keep a roll's `exposuresUsed` counter in step with how many exposures are
// actually logged against it (best-effort; the lint check also derives this).
async function syncRollExposureCount(rollUri) {
  const roll = (ctx.store.instance.filmRoll || []).find((r) => r.uri === rollUri);
  if (!roll) return;
  const used = (ctx.store.instance.exposure || []).filter((e) => e.value.roll === rollUri).length;

  // advance the roll's lifecycle as frames land: a not-yet-shot roll becomes
  // "partial" on the first frame, and "exposed" once the roll is full.
  let status = roll.value.status;
  const total = roll.value.exposuresTotal;
  if (used > 0 && ["loaded", undefined].includes(status)) status = "partial";
  if (used > 0 && total && used >= total) status = "exposed";

  if ((roll.value.exposuresUsed || 0) === used && status === roll.value.status) return;
  try { await saveRecord(ctx.agent, ctx.did, NS.instance.filmRoll, { ...roll.value, exposuresUsed: used, status, updatedAt: new Date().toISOString() }, roll); } catch { /* best effort */ }
}

async function openAddFrame(roll, onAdded) {
  const numInput = el("input", { type: "number", min: "0", placeholder: "Frame # (optional)" });
  const noteInput = el("input", { type: "text", placeholder: "Note (optional)" });
  const grid = el("div", { class: "photo-pick-grid" }, [el("p", { class: "muted small" }, "Loading your photos…")]);
  let chosenPhoto = null;

  openModal("Add frame", [
    field("Frame number", numInput),
    field("Note", noteInput),
    el("h3", { class: "modal-sub" }, "Link a photo (optional)"),
    grid,
  ], async () => {
    const rec = { roll: roll.uri, createdAt: new Date().toISOString(), provenance: { source: "manual", assertedAt: new Date().toISOString() } };
    const n = parseInt(numInput.value, 10);
    if (Number.isFinite(n)) rec.frameNumber = n;
    if (noteInput.value.trim()) rec.note = noteInput.value.trim();
    if (chosenPhoto) rec.photo = chosenPhoto;
    await saveRecord(ctx.agent, ctx.did, NS.instance.exposure, rec, null);
    ctx.store = await loadStore(ctx.agent, ctx.did);
    syncRollExposureCount(roll.uri).catch(() => {});
    onAdded?.();
  });

  // lazily fill the photo picker
  try {
    const photos = await getPhotos(ctx.agent, ctx.did);
    grid.replaceChildren();
    if (!photos.length) { grid.append(el("p", { class: "muted small" }, "No photos found.")); return; }
    for (const p of photos.slice(0, 60)) {
      const cell = el("button", { class: "photo-pick", type: "button" });
      cell.addEventListener("click", () => {
        chosenPhoto = chosenPhoto === p.uri ? null : p.uri;
        for (const c of grid.querySelectorAll(".photo-pick")) c.classList.remove("chosen");
        if (chosenPhoto) cell.classList.add("chosen");
      });
      grid.append(cell);
      blobUrl(ctx.agent, ctx.did, p.value.photo).then((url) => { if (url) cell.style.backgroundImage = `url(${url})`; }).catch(() => {});
    }
  } catch {
    grid.replaceChildren(el("p", { class: "muted small" }, "Couldn't load photos."));
  }
}

// -- Shoots: a session gathering the gear used + the exposures logged ---------

// standard dial scales for the shot logger's tap-to-pick controls (see exposureDials.js).
const EV_SCALE = ["-3", "-2", "-1", "-2/3", "-1/3", "0", "+1/3", "+2/3", "+1", "+2", "+3"];

const shootLabel = (v) => v.label || "Shoot";
const rollsInShoot = (v) => v.rolls || [];
const camsInShoot = (v) => v.cameras || [];
const lensesInShoot = (v) => v.lenses || [];
const explicitShootGear = (v, kind) => kind === "camera" ? camsInShoot(v) : kind === "lens" ? lensesInShoot(v) : kind === "filmRoll" ? rollsInShoot(v) : (v.filters || []);

// every exposure (logged shot) belonging to a shoot, store + offline queue.
function shootExposures(shootUri) {
  const stored = (ctx.store.instance.exposure || []).filter((e) => e.value.shoot === shootUri).map((e) => e.value);
  const queued = outbox.pending(ctx.did, NS.instance.exposure).filter((o) => o.record.shoot === shootUri).map((o) => o.record);
  return [...stored, ...queued];
}

// gear a shoot's own photos reference — this is inherited and can't be removed.
function inheritedGearSet(shootUri, kind) {
  const key = kind === "filmRoll" ? "roll" : kind;   // exposures store the roll as `roll`
  const set = new Set();
  for (const e of shootExposures(shootUri)) if (e[key]) set.add(e[key]);
  return set;
}

// the shoot's effective gear = explicitly added + inherited from its photos.
export function effectiveShootGear(shoot, kind) {
  return [...new Set([...explicitShootGear(shoot.value, kind), ...inheritedGearSet(shoot.uri, kind)])];
}

function inheritedLocations(shootUri) {
  return shootExposures(shootUri).map((e) => e.location).filter(Boolean);
}

// a labelled checklist of the user's instances of one kind (multi-select).
// `locked` items are inherited from the shoot's photos: shown checked + disabled
// so they can't be deselected, but extra gear can still be added on top.
function instanceChecklist(kind, selected = [], locked = []) {
  const chosen = new Set(selected);
  const lockedSet = new Set(locked);
  const boxes = [];
  const items = ctx.store.instance[kind] || [];
  const list = el("div", { class: "check-list" }, items.length ? items.map((it) => {
    const isLocked = lockedSet.has(it.uri);
    const cb = el("input", { type: "checkbox" });
    cb.checked = chosen.has(it.uri) || isLocked;
    cb.value = it.uri;
    cb.disabled = isLocked;
    boxes.push(cb);
    return el("label", { class: `check-row${isLocked ? " locked" : ""}` }, [
      cb, el("span", {}, instanceLabel(kind, it.value, ctx.store)),
      isLocked ? el("span", { class: "inherit-tag", title: "Used by a photo in this shoot" }, "in a photo") : null,
    ]);
  }) : [el("p", { class: "muted small" }, `No ${kindLabelPlural(kind).toLowerCase()} yet.`)]);
  // getSelected returns only the freely-added gear (not the locked/inherited set)
  return { node: list, getSelected: () => boxes.filter((b) => b.checked && !b.disabled).map((b) => b.value) };
}

// create or edit a shoot. Gear + location used by the shoot's own photos is
// inherited (shown checked + locked); the user can add more gear/locations on
// top, e.g. for photos that were never logged in the field.
function openShootEditor(existing, onDone) {
  const v = existing?.value || {};
  const shootUri = existing?.uri;
  const { wrap: labelWrap, input: labelInput } = inputField("Label", "label", v.label || "");
  const { wrap: startWrap, input: startInput } = dateField("Started", v.startedAt || new Date().toISOString());
  const { wrap: endWrap, input: endInput } = dateField("Ended (optional)", v.endedAt || "");
  const lock = (kind) => shootUri ? [...inheritedGearSet(shootUri, kind)] : [];
  const cams = instanceChecklist("camera", camsInShoot(v), lock("camera"));
  const lenses = instanceChecklist("lens", lensesInShoot(v), lock("lens"));
  const rolls = instanceChecklist("filmRoll", rollsInShoot(v), lock("filmRoll"));
  const filters = instanceChecklist("filter", v.filters || [], lock("filter"));
  const { wrap: notesWrap, input: notesInput } = inputField("Notes", "notes", v.notes || "");

  // locations: inherited from photos (read-only) + a manually-added list
  const inheritedLocs = shootUri ? inheritedLocations(shootUri) : [];
  const manualPlaces = [...(v.places || (v.place ? [v.place] : []))];
  const placesWrap = el("div", { class: "places-list" });
  const renderPlaces = () => {
    placesWrap.replaceChildren();
    if (inheritedLocs.length) placesWrap.append(el("p", { class: "muted small" }, `${inheritedLocs.length} location${inheritedLocs.length === 1 ? "" : "s"} inherited from photos in this shoot.`));
    manualPlaces.forEach((p, i) => placesWrap.append(el("div", { class: "place-row row between" }, [
      el("span", { class: "muted small" }, placeSummary(p)),
      el("button", { class: "ghost small-btn danger", type: "button", title: "Remove", "aria-label": "Remove", onclick: () => { manualPlaces.splice(i, 1); renderPlaces(); } }, [icon("trash", 14)]),
    ])));
    if (!inheritedLocs.length && !manualPlaces.length) placesWrap.append(el("p", { class: "muted small" }, "No locations yet."));
  };
  renderPlaces();
  const addPlaceBtn = el("button", { class: "ghost small-btn", type: "button" }, [icon("map-pin", 14), el("span", {}, "Add location")]);
  addPlaceBtn.addEventListener("click", async () => {
    addPlaceBtn.disabled = true;
    try { manualPlaces.push(await captureGeolocation()); renderPlaces(); }
    catch (e) { toast(e.message, "err"); }
    finally { addPlaceBtn.disabled = false; }
  });

  openModal(existing ? "Edit shoot" : "Start a shoot", [
    labelWrap, startWrap, endWrap,
    el("h3", { class: "modal-sub" }, "Cameras"), cams.node,
    el("h3", { class: "modal-sub" }, "Lenses"), lenses.node,
    el("h3", { class: "modal-sub" }, "Rolls (film)"), rolls.node,
    el("h3", { class: "modal-sub" }, "Filters"), filters.node,
    el("h3", { class: "modal-sub" }, "Locations"), placesWrap, el("div", { class: "row" }, [addPlaceBtn]),
    notesWrap,
  ], async () => {
    const rec = {
      label: labelInput.value.trim() || "Shoot",
      cameras: cams.getSelected(), lenses: lenses.getSelected(),
      rolls: rolls.getSelected(), filters: filters.getSelected(),
      createdAt: v.createdAt || new Date().toISOString(),
    };
    if (startInput.value) rec.startedAt = new Date(startInput.value).toISOString();
    if (endInput.value) rec.endedAt = new Date(endInput.value).toISOString();
    if (manualPlaces.length) rec.places = manualPlaces;
    if (notesInput.value.trim()) rec.notes = notesInput.value.trim();
    if (existing) rec.updatedAt = new Date().toISOString();
    if (!existing) rec.provenance = { source: "manual", assertedAt: new Date().toISOString() };
    const uri = await saveRecord(ctx.agent, ctx.did, NS.session.capture, rec, existing || null);
    ctx.store = await loadStore(ctx.agent, ctx.did);
    onDone?.(uri);
  });
}

function placeSummary(place) {
  if (!place) return "not set";
  const pm = place.placemark;
  if (pm?.name) return [pm.name, pm.locality, pm.administrativeArea].filter(Boolean).join(", ");
  if (place.latitude != null) return `${(place.latitude / 1e7).toFixed(5)}, ${(place.longitude / 1e7).toFixed(5)}`;
  return "location set";
}

function renderShootsTab(body) {
  const pend = outbox.pendingCount(ctx.did);
  const card = el("div", { class: "card" });
  card.append(el("div", { class: "row between" }, [
    el("h2", {}, "Shoots"),
    el("button", { class: "ghost small-btn add-gear", onclick: () => openShootEditor(null, (uri) => { renderLibrary(body); const s = ctx.store.shoots.find((x) => x.uri === uri); if (s) openShotLogger(s, body); }) },
      [icon("plus", 15), el("span", {}, "Start a shoot")]),
  ]));
  if (pend) card.append(el("p", { class: "muted small" }, `${pend} shot${pend === 1 ? "" : "s"} queued offline — will sync when you're back online.`));

  const shoots = ctx.store.shoots || [];
  if (!shoots.length) {
    card.append(el("p", { class: "muted small gear-empty" }, "No shoots yet. Start one to log frames as you shoot."));
  } else {
    const ul = el("ul", { class: "gear-list" });
    for (const s of shoots) {
      const nShots = shootExposures(s.uri).length;
      const nCams = effectiveShootGear(s, "camera").length;
      ul.append(el("li", { class: "gear-row row between" }, [
        el("span", { class: "row type-label" }, [
          el("span", {}, shootLabel(s.value)),
          nCams ? el("span", { class: "muted small" }, `· ${nCams} camera${nCams === 1 ? "" : "s"}`) : null,
          nShots ? el("span", { class: "muted small" }, `· ${nShots} shot${nShots === 1 ? "" : "s"}`) : null,
        ]),
        el("span", { class: "row" }, [
          el("button", { class: "ghost small-btn primary-btn", onclick: () => openShotLogger(s, body) }, [icon("camera", 14), el("span", {}, "Log")]),
          isAdvanced() ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(s) }, "{ }") : null,
          el("button", { class: "ghost small-btn", title: "Edit", "aria-label": "Edit", onclick: () => openShootEditor(s, () => renderLibrary(body)) }, [icon("edit", 15)]),
          el("button", {
            class: "ghost small-btn danger", title: "Remove", "aria-label": "Remove",
            onclick: async () => { if (!(await confirmModal("Remove this shoot?"))) return; await deleteRecord(ctx.agent, ctx.did, s.uri); ctx.store = await loadStore(ctx.agent, ctx.did); renderLibrary(body); },
          }, [icon("trash", 15)]),
        ]),
      ]));
    }
    card.append(ul);
  }
  body.append(card);
}

// resolve the instance records a shoot references (falling back to all owned
// gear of that kind, so an empty shoot still logs).
function shootGear(kind, uris) {
  const all = ctx.store.instance[kind] || [];
  const picked = (uris || []).map((u) => all.find((x) => x.uri === u)).filter(Boolean);
  return picked.length ? picked : all;
}

function nextFrameNumber(rollUri) {
  if (!rollUri) return null;
  const stored = framesForRoll(rollUri).map((e) => e.value.frameNumber ?? 0);
  const queued = outbox.pending(ctx.did, NS.instance.exposure)
    .filter((o) => o.record.roll === rollUri).map((o) => o.record.frameNumber ?? 0);
  return Math.max(0, ...stored, ...queued) + 1;
}

// The full-screen, mobile-first, offline-capable shot logger for one shoot.
export function openShotLogger(shoot, body) {
  const v = shoot.value;
  const cameras = shootGear("camera", effectiveShootGear(shoot, "camera"));
  const lenses = shootGear("lens", effectiveShootGear(shoot, "lens"));
  const filters = shootGear("filter", effectiveShootGear(shoot, "filter"));
  const rolls = shootGear("filmRoll", effectiveShootGear(shoot, "filmRoll"));

  const st = {
    camera: cameras[0]?.uri || null,
    lens: lenses[0]?.uri || null,
    filter: null,
    roll: null,
    lastFrame: null,   // last frame number logged (for "+ same frame" multi-exposure)
    aperture: null, shutter: null, ev: "0",
    apertureStopFraction: "1/3", shutterStopFraction: "1/3",
    metering: "center-weighted", flash: false, gps: true, note: "",
  };
  const countAtFrame = (rollUri, frameNo) => {
    const stored = framesForRoll(rollUri).filter((e) => e.value.frameNumber === frameNo).length;
    const queued = outbox.pending(ctx.did, NS.instance.exposure).filter((o) => o.record.roll === rollUri && o.record.frameNumber === frameNo).length;
    return stored + queued;
  };
  const pickRollFor = (camUri) => rolls.find((r) => r.value.camera === camUri)?.uri || rolls[0]?.uri || null;
  st.roll = pickRollFor(st.camera);

  // keep a fresh GPS fix in the background so logging stays instant.
  let geo = null, watchId = null;
  const startWatch = () => {
    if (!st.gps || typeof navigator === "undefined" || !navigator.geolocation) return;
    try { watchId = navigator.geolocation.watchPosition((p) => { geo = { latitude: Math.round(p.coords.latitude * 1e7), longitude: Math.round(p.coords.longitude * 1e7), altitude: Number.isFinite(p.coords.altitude) ? Math.round(p.coords.altitude * 1000) : undefined, accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy * 1000) : undefined, capturedAt: new Date().toISOString() }; syncGpsPill(); }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 }); } catch { /* ignore */ }
  };
  const stopWatch = () => { if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; };

  const overlay = el("div", { class: "logger-overlay" });
  const gpsPill = el("span", { class: "gps-pill" }, "GPS…");
  const syncGpsPill = () => {
    gpsPill.classList.toggle("hidden", !st.gps);
    gpsPill.textContent = !st.gps ? "" : geo ? `GPS ±${Math.round((geo.accuracy || 0) / 1000)}m` : "GPS…";
    gpsPill.classList.toggle("ok", !!geo);
  };

  const frameLabel = el("span", { class: "logger-frame" });
  const recent = el("div", { class: "logger-recent" });

  const refreshFrame = () => {
    const n = nextFrameNumber(st.roll);
    const roll = rolls.find((r) => r.uri === st.roll);
    frameLabel.textContent = st.roll
      ? `${roll ? filmStockLabel(roll.value.stock) : "Roll"} · frame ${n}`
      : "Digital · no roll";
  };
  const renderRecent = () => {
    const stored = st.roll ? framesForRoll(st.roll)
      : (ctx.store.instance.exposure || []).filter((e) => e.value.shoot === shoot.uri).map((e) => e);
    const queued = outbox.pending(ctx.did, NS.instance.exposure)
      .filter((o) => (st.roll ? o.record.roll === st.roll : o.record.shoot === shoot.uri))
      .map((o) => ({ uri: o.tempUri, value: o.record, pending: true, id: o.id }));
    const all = [...stored.map((e) => ({ ...e, pending: false })), ...queued];
    // how many exposures sit on each frame number (>1 == multiple exposure)
    const perFrame = new Map();
    for (const r of all) { const f = r.value.frameNumber; if (f != null) perFrame.set(f, (perFrame.get(f) || 0) + 1); }
    const rows = all
      .sort((a, b) => (b.value.frameNumber ?? 0) - (a.value.frameNumber ?? 0) || (a.value.frameExposureIndex ?? 0) - (b.value.frameExposureIndex ?? 0) || (b.value.createdAt || "").localeCompare(a.value.createdAt || ""))
      .slice(0, 10);
    recent.replaceChildren(el("div", { class: "logger-recent-h muted small" }, `Recent (${stored.length + queued.length})`),
      ...rows.map((r) => {
        const f = r.value.frameNumber;
        const multi = f != null && perFrame.get(f) > 1;
        return el("div", { class: `logger-recent-row${r.pending ? " pending" : ""}` }, [
          el("span", { class: "frame-num" }, f != null ? `#${f}${r.value.frameExposureIndex ? `.${r.value.frameExposureIndex}` : ""}` : "•"),
          multi ? el("span", { class: "me-badge", title: "Multiple exposure" }, `ME ×${perFrame.get(f)}`) : null,
          el("span", { class: "muted small" }, [r.value.aperture ? `ƒ/${r.value.aperture}` : "", r.value.shutterSpeed || ""].filter(Boolean).join("  ")),
          r.pending ? el("span", { class: "pending-dot", title: "Queued offline" }, "○") : null,
        ]);
      }));
  };

  // a horizontal scroller of tap-to-select values.
  const dial = (values, get, set) => {
    const row = el("div", { class: "dial-row" });
    const paint = () => { for (const b of row.children) b.classList.toggle("on", b.dataset.val === String(get())); };
    for (const val of values) {
      const b = el("button", { class: "dial-btn", type: "button" }, String(val));
      b.dataset.val = String(val);
      b.addEventListener("click", () => { set(val); paint(); });
      row.append(b);
    }
    paint();
    return row;
  };

  // a chip row for picking one of a set of gear items (or none).
  const chips = (items, kind, get, set, { allowNone = false } = {}) => {
    const row = el("div", { class: "chip-row" });
    const opts = allowNone ? [{ uri: null, label: "None" }, ...items.map((it) => ({ uri: it.uri, label: instanceLabel(kind, it.value, ctx.store) }))]
      : items.map((it) => ({ uri: it.uri, label: instanceLabel(kind, it.value, ctx.store) }));
    const paint = () => { for (const b of row.children) b.classList.toggle("on", b.dataset.uri === String(get())); };
    for (const o of opts) {
      const b = el("button", { class: "gear-chip-btn", type: "button" }, o.label);
      b.dataset.uri = String(o.uri);
      b.addEventListener("click", () => { set(o.uri); paint(); });
      row.append(b);
    }
    paint();
    return { row, paint };
  };

  const camChips = chips(cameras, "camera", () => st.camera, (u) => { st.camera = u; st.roll = pickRollFor(u); st.lastFrame = null; refreshFrame(); renderRecent(); updateSameBtn(); rollChips.paint(); });
  const rollChips = chips(rolls, "filmRoll", () => st.roll, (u) => { st.roll = u; st.lastFrame = null; refreshFrame(); renderRecent(); updateSameBtn(); }, { allowNone: true });
  const lensChips = chips(lenses, "lens", () => st.lens, (u) => { st.lens = u; });
  const filterChips = chips(filters, "filter", () => st.filter, (u) => { st.filter = u; }, { allowNone: true });

  const activeLensType = () => {
    const lens = lenses.find((l) => l.uri === st.lens);
    return lens && ctx.store.catalog.lensType?.find((t) => t.uri === lens.value.type)?.value;
  };
  const activeCameraType = () => {
    const cam = cameras.find((c) => c.uri === st.camera);
    return cam && ctx.store.catalog.cameraType?.find((t) => t.uri === cam.value.type)?.value;
  };
  const clampDial = (get, set, options) => {
    const cur = get();
    if (cur && !options.includes(cur)) set(null);
  };

  const apertureOptions = () => buildApertureOptions(activeLensType(), st.apertureStopFraction);
  const shutterOptions = () => buildShutterOptions(activeCameraType(), st.shutterStopFraction);

  const apIncSel = el("select", { class: "logger-select logger-inc" }, STOP_FRACTIONS.map((f) => el("option", { value: f }, `${f} stop`)));
  apIncSel.value = st.apertureStopFraction;
  const shIncSel = el("select", { class: "logger-select logger-inc" }, STOP_FRACTIONS.map((f) => el("option", { value: f }, `${f} stop`)));
  shIncSel.value = st.shutterStopFraction;

  const apRow = el("div");
  const renderAp = () => {
    const opts = apertureOptions();
    clampDial(() => st.aperture, (v) => { st.aperture = v; }, opts);
    apRow.replaceChildren(dial(opts, () => st.aperture, (v2) => { st.aperture = v2; }));
    apIncSel.classList.toggle("hidden", usesExactApertureSteps(activeLensType()));
  };
  const shRow = el("div");
  const renderSh = () => {
    const opts = shutterOptions();
    clampDial(() => st.shutter, (v) => { st.shutter = v; }, opts);
    shRow.replaceChildren(dial(opts, () => st.shutter, (v2) => { st.shutter = v2; }));
    shIncSel.classList.toggle("hidden", usesExactShutterSteps(activeCameraType()));
  };
  apIncSel.addEventListener("change", () => { st.apertureStopFraction = apIncSel.value; renderAp(); });
  shIncSel.addEventListener("change", () => { st.shutterStopFraction = shIncSel.value; renderSh(); });
  renderAp();
  renderSh();

  const noteInput = el("input", { type: "text", class: "logger-note", placeholder: "Note (optional)" });
  noteInput.addEventListener("input", () => { st.note = noteInput.value; });

  const gpsToggle = el("button", { class: "ghost small-btn", type: "button" }, [icon("map-pin", 14), el("span", {}, "GPS")]);
  gpsToggle.classList.toggle("on", st.gps);
  gpsToggle.addEventListener("click", () => { st.gps = !st.gps; gpsToggle.classList.toggle("on", st.gps); if (st.gps) startWatch(); else stopWatch(); syncGpsPill(); });
  const flashToggle = el("button", { class: "ghost small-btn", type: "button" }, "Flash");
  flashToggle.addEventListener("click", () => { st.flash = !st.flash; flashToggle.classList.toggle("on", st.flash); });
  const meterSel = el("select", { class: "logger-select" }, ENUMS.meteringMode.map((m) => el("option", { value: m }, enumLabel(m))));
  meterSel.value = st.metering; meterSel.addEventListener("change", () => { st.metering = meterSel.value; });

  const sameBtn = el("button", { class: "log-btn secondary", type: "button" }, "+ Same frame");
  const logBtn = el("button", { class: "log-btn" }, [icon("camera", 18), el("span", {}, "Log frame")]);
  const updateSameBtn = () => { sameBtn.classList.toggle("hidden", !(st.roll && st.lastFrame != null)); };

  // sameFrame=true stacks another exposure on the frame we just logged (a
  // multiple exposure): same frameNumber, next sub-index, without advancing.
  const logExposure = (sameFrame) => {
    const now = new Date().toISOString();
    const rec = { shoot: shoot.uri, createdAt: now, takenAt: now };
    if (st.camera) rec.camera = st.camera;
    if (st.lens) rec.lens = st.lens;
    if (st.filter) rec.filter = st.filter;
    if (st.roll) {
      if (sameFrame && st.lastFrame != null) {
        rec.roll = st.roll; rec.frameNumber = st.lastFrame;
        rec.frameExposureIndex = countAtFrame(st.roll, st.lastFrame) + 1;
        rec.multipleExposure = true;
      } else {
        const n = nextFrameNumber(st.roll);
        rec.roll = st.roll; rec.frameNumber = n; rec.frameExposureIndex = 1;
        st.lastFrame = n;
      }
    } else if (sameFrame) {
      rec.multipleExposure = true;      // digital in-camera multiple exposure
    }
    if (st.aperture) rec.aperture = st.aperture;
    if (st.shutter) rec.shutterSpeed = st.shutter;
    if (st.ev && st.ev !== "0") rec.exposureCompensation = st.ev;
    if (st.metering) rec.meteringMode = st.metering;
    if (st.flash) rec.flash = true;
    if (st.gps && geo) rec.location = geo;
    if (st.note.trim()) rec.note = st.note.trim();

    outbox.enqueue(ctx.did, NS.instance.exposure, rec);      // survives offline + refresh
    st.note = ""; noteInput.value = "";
    refreshFrame(); renderRecent(); updateSameBtn();
    const btn = sameFrame ? sameBtn : logBtn;
    btn.classList.add("flash"); setTimeout(() => btn.classList.remove("flash"), 220);
    toast(outbox.isOnline() ? (sameFrame ? "Stacked on frame ✓" : "Logged ✓") : "Logged offline — will sync", outbox.isOnline() ? "ok" : "info", 1800);
    outbox.flush(ctx.agent, ctx.did).then((res) => { if (res.sent) loadStore(ctx.agent, ctx.did).then((s) => { ctx.store = s; renderRecent(); }); });
  };
  logBtn.addEventListener("click", () => logExposure(false));
  sameBtn.addEventListener("click", () => logExposure(true));

  const close = () => { stopWatch(); overlay.remove(); loadStore(ctx.agent, ctx.did).then((s) => { ctx.store = s; if (body) renderLibrary(body); }); };

  overlay.append(
    el("div", { class: "logger-top row between" }, [
      el("div", { class: "row" }, [el("strong", {}, shootLabel(v)), gpsPill]),
      el("button", { class: "ghost small-btn", onclick: close }, "Done"),
    ]),
    frameLabel,
    el("div", { class: "logger-scroll" }, [
      cameras.length > 1 ? el("div", { class: "logger-group" }, [el("span", { class: "logger-lab" }, "Camera"), camChips.row]) : null,
      rolls.length ? el("div", { class: "logger-group" }, [el("span", { class: "logger-lab" }, "Roll"), rollChips.row]) : null,
      el("div", { class: "logger-group" }, [el("span", { class: "logger-lab" }, "Lens"), lensChips.row]),
      filters.length ? el("div", { class: "logger-group" }, [el("span", { class: "logger-lab" }, "Filter"), filterChips.row]) : null,
      el("div", { class: "logger-group" }, [
        el("span", { class: "logger-lab row" }, ["Aperture ƒ/", apIncSel]),
        apRow,
      ]),
      el("div", { class: "logger-group" }, [
        el("span", { class: "logger-lab row" }, ["Shutter", shIncSel]),
        shRow,
      ]),
      el("div", { class: "logger-group" }, [el("span", { class: "logger-lab" }, "Exposure comp (EV)"), dial(EV_SCALE, () => st.ev, (v2) => { st.ev = v2; })]),
      el("div", { class: "logger-group row" }, [field("Metering", meterSel), flashToggle, gpsToggle]),
      noteInput,
      recent,
    ]),
    el("div", { class: "log-actions" }, [sameBtn, logBtn]),
  );
  // switching the active lens or camera re-bounds the exposure dials
  lensChips.row.addEventListener("click", () => renderAp());
  camChips.row.addEventListener("click", () => renderSh());
  document.body.append(overlay);
  refreshFrame(); renderRecent(); updateSameBtn(); syncGpsPill(); startWatch();
}

export function catalogSelect(catalogKind, value = "") {
  const items = ctx.store.catalog[catalogKind] || [];
  const sel = el("select", { "data-catalog-ref": catalogKind }, [
    el("option", { value: "" }, "(none)"),
    ...items.map((t) => el("option", { value: t.uri }, catalogLabel(catalogKind, t.value))),
  ]);
  sel.value = value || "";
  return sel;
}

/** Unified picker for instance.developer and instance.chemistry (by role). */
export function developerOrChemistrySelect(value = "", { roles } = {}) {
  const opts = [];
  for (const d of ctx.store.instance.developer || []) {
    opts.push({ uri: d.uri, label: instanceLabel("developer", d.value, ctx.store) });
  }
  for (const c of ctx.store.instance.chemistry || []) {
    const role = chemistryRole(c.value, ctx.store);
    if (roles?.length && role && !roles.includes(role)) continue;
    const roleTag = role ? `[${role}] ` : "";
    opts.push({ uri: c.uri, label: `${roleTag}${instanceLabel("chemistry", c.value, ctx.store)}` });
  }
  const sel = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...opts.map((o) => el("option", { value: o.uri }, o.label)),
  ]);
  sel.value = value || "";
  return sel;
}

function stageKindPicker(selected = []) {
  const box = el("div", { class: "stage-kind-picker" });
  const kinds = Object.keys(STAGE_LABELS);
  const checks = {};
  for (const kind of kinds) {
    const cb = el("input", { type: "checkbox", id: `sk-${kind}` });
    cb.checked = selected.includes(kind);
    checks[kind] = cb;
    box.append(el("label", { class: "inline-check" }, [cb, ` ${STAGE_LABELS[kind]}`]));
  }
  box.readOrder = () => kinds.filter((k) => checks[k].checked);
  return box;
}

function openTemplateModal(existing, onDone) {
  const v = existing?.value || {};
  const { wrap: nameWrap, input: nameInput } = inputField("Name *", "name", v.name || "");
  const mediumSel = el("select", {}, MEDIUMS.map((m) => el("option", { value: m }, m)));
  mediumSel.value = v.medium || "film";
  const stagePicker = stageKindPicker(v.stageKinds || []);
  const camSel = instanceSelect("camera", v.defaultCamera || "");
  const lensSel = instanceSelect("lens", v.defaultLens || "");
  const rollSel = instanceSelect("filmRoll", v.defaultFilmRoll || "");
  const devSel = developerOrChemistrySelect(v.defaultDeveloper || "");
  const scanSel = instanceSelect("scanner", v.defaultScanner || "");
  const profileSel = catalogSelect("scanProfile", v.defaultScanProfile || "");
  const labSel = catalogSelect("lab", v.defaultLab || "");
  const notesWrap = inputField("Notes", "notes", v.notes || "");

  openModal(existing ? "Edit workflow template" : "New workflow template", [
    nameWrap,
    field("Medium *", mediumSel),
    el("p", { class: "muted small" }, "Stage sequence (order left-to-right):"),
    stagePicker,
    field("Default camera", camSel),
    field("Default lens", lensSel),
    field("Default film roll", rollSel),
    field("Default developer / chemistry", devSel),
    field("Default scanner", scanSel),
    field("Default scan profile", profileSel),
    field("Default lab", labSel),
    notesWrap.wrap,
  ], async () => {
    const name = nameInput.value.trim();
    if (!name) throw new Error("Name is required");
    const stageKinds = stagePicker.readOrder();
    if (!stageKinds.length) throw new Error("Select at least one stage");
    const payload = {
      name,
      medium: mediumSel.value,
      stageKinds,
      stageDefaults: v.stageDefaults || [],
      defaultCamera: camSel.value || undefined,
      defaultLens: lensSel.value || undefined,
      defaultFilmRoll: rollSel.value || undefined,
      defaultDeveloper: devSel.value || undefined,
      defaultScanner: scanSel.value || undefined,
      defaultScanProfile: profileSel.value || undefined,
      defaultLab: labSel.value || undefined,
      notes: notesWrap.input.value.trim() || undefined,
      createdAt: v.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveWorkflowTemplate(ctx.agent, ctx.did, payload, existing || null);
    ctx.store = await loadStore(ctx.agent, ctx.did);
    onDone?.();
  });
}

function renderWorkflowsTab(body) {
  const card = el("div", { class: "card" });
  card.append(el("div", { class: "row between" }, [
    el("h2", {}, "Workflow templates"),
    el("button", {
      class: "ghost small-btn",
      onclick: () => openTemplateModal(null, () => renderLibrary(body)),
    }, "+ Template"),
  ]));
  card.append(el("p", { class: "muted small" }, "Reusable stage sequences with default gear and process settings. Load them in the gallery workflow builder."));
  const ul = el("ul", { class: "gear-list" });
  for (const t of ctx.store.workflowTemplates || []) {
    const kinds = (t.value.stageKinds || []).map((k) => STAGE_LABELS[k] || k).join(" → ");
    ul.append(el("li", { class: "gear-row row between" }, [
      el("div", {}, [
        el("strong", {}, t.value.name),
        el("div", { class: "muted small" }, `${enumLabel(t.value.medium)} · ${kinds || "(no stages)"}`),
      ]),
      el("div", { class: "row" }, [
        isAdvanced() ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(t) }, "{ }") : null,
        el("button", {
          class: "ghost small-btn",
          onclick: () => openTemplateModal(t, () => renderLibrary(body)),
        }, "Edit"),
        el("button", {
          class: "ghost small-btn danger",
          onclick: async () => {
            if (!(await confirmModal(`Delete template "${t.value.name}"?`))) return;
            const snapshot = t.value;
            await deleteRecord(ctx.agent, ctx.did, t.uri);
            ctx.store = await loadStore(ctx.agent, ctx.did);
            renderLibrary(body);
            toast("Deleted template", "ok", 6000, { label: "Undo", fn: async () => { await saveRecord(ctx.agent, ctx.did, NS.workflow.template, snapshot, null); ctx.store = await loadStore(ctx.agent, ctx.did); renderLibrary(body); } });
          },
        }, "Delete"),
      ]),
    ]));
  }
  if (!ctx.store.workflowTemplates?.length) {
    ul.append(el("li", { class: "muted" }, "No templates yet."));
  }
  card.append(ul);
  body.append(card);

  renderRollBoard(body);
  renderDarkroomActivity(body);
}

// a timeline of recent development + scan sessions (the "actuals" that flow from
// the darkroom timer and scan logger).
function renderDarkroomActivity(body) {
  const dev = (ctx.store.developSessions || []).map((r) => ({ r, kind: "develop", at: r.value.finishedAt || r.value.createdAt }));
  const scan = (ctx.store.digitizeSessions || []).map((r) => ({ r, kind: "scan", at: r.value.finishedAt || r.value.createdAt }));
  const all = [...dev, ...scan].filter((x) => x.at).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 12);
  if (!all.length) return;
  const ul = el("ul", { class: "gear-list" });
  for (const { r, kind, at } of all) {
    const when = new Date(at).toLocaleDateString();
    const labName = r.value.lab ? instanceLabel("labAccount", ctx.store.byUri.get(r.value.lab)?.item?.value, ctx.store) : r.value.labService;
    const label = kind === "develop"
      ? (labName ? `${(r.value.process || "bw").toUpperCase()} · ${labName}` : (r.value.notes?.split(".")[0] || `${(r.value.process || "bw").toUpperCase()} development`))
      : `Scan · ${enumLabel(r.value.method || "")}${r.value.software ? ` · ${r.value.software}` : ""}`;
    ul.append(el("li", { class: "gear-row row between" }, [
      el("div", {}, [el("strong", {}, kind === "develop" ? (labName ? "Lab developed" : "Developed") : "Scanned"), el("div", { class: "muted small" }, label)]),
      el("span", { class: "muted small mono" }, when),
    ]));
  }
  body.append(el("div", { class: "card" }, [el("h3", {}, "Recent darkroom activity"), ul]));
}

function renderRulesTab(body) {
  // Checks: a read-only "lint" pass over your metadata. Preview only — it never
  // changes anything; it just surfaces gaps for you to act on.
  const findings = computeLintFindings(ctx.store);
  const checks = el("div", { class: "card" }, [
    el("div", { class: "row between" }, [
      el("h2", { style: "margin:0" }, "Checks"),
      el("span", { class: "muted small" }, findings.length ? `${findings.length} to review` : "All clear"),
    ]),
    el("p", { class: "muted small" }, "A read-only pass over your library. Nothing changes until you act on it."),
  ]);
  if (!findings.length) {
    checks.append(el("p", { class: "muted" }, "No issues found — your metadata looks complete."));
  } else {
    const ul = el("ul", { class: "gear-list" });
    for (const f of findings) {
      ul.append(el("li", { class: "gear-row row between" }, [
        el("div", {}, [
          el("strong", {}, f.title),
          el("div", { class: "muted small" }, f.detail),
        ]),
        el("span", { class: `lint-pill ${f.severity}` }, String(f.count)),
      ]));
    }
    checks.append(ul);
  }
  body.append(checks);

  // Saved batch rules (from the gallery editor) still live here.
  const rulesCard = el("div", { class: "card" }, [el("h3", {}, "Saved batch rules")]);
  const ul = el("ul", { class: "gear-list" });
  for (const r of ctx.store.batchRules) {
    ul.append(el("li", { class: "gear-row row between" }, [
      el("span", {}, r.value.name),
      isAdvanced() ? el("button", { class: "ghost small-btn", title: "Inspect record", "aria-label": "Inspect record", onclick: () => openInspector(r) }, "{ }") : null,
    ]));
  }
  if (!ctx.store.batchRules.length) ul.append(el("li", { class: "muted" }, "No batch rules yet — create them from a gallery's Batch edit panel."));
  rulesCard.append(ul);
  body.append(rulesCard);
}

function renderDarkroomHeader(body) {
  const resume = activeDevRun(ctx.did);
  body.append(el("div", { class: "card" }, [
    el("div", { class: "row between wrap" }, [
      el("div", {}, [
        el("h3", { style: "margin:0" }, "Development timer"),
        el("div", { class: "muted small" }, "Datasheet times, agitation cues, keeps running offline."),
      ]),
      el("div", { class: "row wrap", style: "gap:8px" }, [
        resume ? el("button", { class: "ghost small-btn", onclick: () => openDevTimer(ctx, { onDone: () => renderLibrary(body) }) }, `Resume (${resume.film})`) : null,
        el("button", { class: "ghost small-btn", onclick: () => openLabDevelopment(() => renderLibrary(body)) }, [icon("package", 14), el("span", {}, "Log lab development")]),
        el("button", { class: "ghost small-btn primary-btn", onclick: () => openDevTimer(ctx, { allowResume: false, onDone: () => renderLibrary(body) }) }, [icon("film", 14), el("span", {}, "Start development")]),
      ]),
    ]),
  ]));
}

// Log a roll (or several) as developed by a lab — the lab counterpart to the
// darkroom timer. No countdown: just record the event (lab, process, push/pull,
// date) as a process.developSession, link the roll(s), and flip them to
// "developed" with the lab attached.
function openLabDevelopment(onDone) {
  const labs = ctx.store.instance.labAccount || [];
  const rolls = (ctx.store.instance.filmRoll || []).filter((r) => r.value.status !== "archived");
  const labSel = instanceSelect("labAccount");
  const procSel = el("select", {}, ["c41", "e6", "bw", "ecn2", "reversal-bw"].map((p) => el("option", { value: p }, enumLabel(p))));
  const pushSel = el("select", {}, ["0", "+1", "+2", "+3", "-1", "-2"].map((s) => el("option", { value: s }, s === "0" ? "None" : `${s} stop${Math.abs(+s) === 1 ? "" : "s"}`)));
  const dateInput = el("input", { type: "date", class: "date-input", value: new Date().toISOString().slice(0, 10) });
  const notesInput = el("input", { type: "text", placeholder: "e.g. dev + scan, pushed for the concert" });

  // roll picker (checkboxes) — labs often run several rolls at once
  const rollWrap = el("div", { class: "check-list" });
  const chosen = new Set();
  for (const r of rolls) {
    const cb = el("input", { type: "checkbox" });
    cb.addEventListener("change", () => { if (cb.checked) chosen.add(r.uri); else chosen.delete(r.uri); });
    rollWrap.append(el("label", { class: "check-row" }, [cb, el("span", {}, instanceLabel("filmRoll", r.value, ctx.store))]));
  }
  if (!rolls.length) rollWrap.append(el("p", { class: "muted small" }, "No rolls yet — add one in the Film tab first."));

  openModal("Log lab development", [
    labs.length ? null : el("p", { class: "muted small" }, "Tip: add the lab (e.g. Praus) under Setup → Scanning first, then pick it here."),
    field("Lab", labSel),
    field("Process", procSel),
    field("Push / pull", pushSel),
    field("Date developed", dateInput),
    field("Notes", notesInput),
    el("h3", { class: "modal-sub" }, "Rolls developed"),
    rollWrap,
  ], async () => {
    const when = dateInput.value ? new Date(dateInput.value).toISOString() : new Date().toISOString();
    const labUri = labSel.value || undefined;
    const labName = labUri ? instanceLabel("labAccount", ctx.store.byUri.get(labUri)?.item?.value, ctx.store) : undefined;
    const push = parseInt(pushSel.value, 10) || 0;
    const rollUris = [...chosen];
    const rec = {
      process: procSel.value,
      lab: labUri, labService: labName,
      filmRolls: rollUris.length ? rollUris : undefined,
      startedAt: when, finishedAt: when,
      notes: notesInput.value.trim() || undefined,
      createdAt: new Date().toISOString(),
      provenance: { source: "manual", assertedAt: new Date().toISOString() },
    };
    if (push) rec.pushPull = { unit: "stop", value: push, scale: 1 };
    await saveRecord(ctx.agent, ctx.did, NS.process.developSession, rec, null);
    // flip each selected roll to "developed" and attach the lab
    for (const uri of rollUris) {
      const r = (ctx.store.instance.filmRoll || []).find((x) => x.uri === uri);
      if (!r) continue;
      const nv = { ...r.value, status: "developed", updatedAt: new Date().toISOString() };
      if (labUri) nv.lab = labUri;
      if (!nv.finishedAt) nv.finishedAt = when;
      await saveRecord(ctx.agent, ctx.did, NS.instance.filmRoll, nv, r);
    }
    ctx.store = await loadStore(ctx.agent, ctx.did);
    toast(`Logged lab development${labName ? ` at ${labName}` : ""}`, "ok");
    onDone?.();
  });
}

// -- Scanning: log a digitize session + link exposures to scanned photos ------

const DIGITIZE_METHODS = [
  ["dedicated-film-scanner", "Film scanner"], ["flatbed-negative", "Flatbed (negative)"],
  ["dslr-copy-stand", "DSLR copy stand"], ["mirrorless-copy-stand", "Mirrorless copy stand"],
  ["lab-scan", "Lab scan"], ["smartphone", "Smartphone"], ["file-import", "File import"], ["other", "Other"],
];

function renderScanningHeader(body) {
  body.append(el("div", { class: "card" }, [
    el("div", { class: "row between wrap" }, [
      el("div", {}, [
        el("h3", { style: "margin:0" }, "Scanning"),
        el("div", { class: "muted small" }, "Log a scan session and link each frame to its photo, so public photos inherit the frame's metadata."),
      ]),
      el("div", { class: "row", style: "gap:8px" }, [
        el("button", { class: "ghost small-btn", onclick: () => openFrameLinker(() => renderLibrary(body)) }, "Link frames → photos"),
        el("button", { class: "ghost small-btn primary-btn", onclick: () => openScanSession(() => renderLibrary(body)) }, [icon("image", 14), el("span", {}, "Log scan session")]),
      ]),
    ]),
  ]));
}

function openScanSession(onDone) {
  const rollSel = instanceSelect("filmRoll");
  const scannerSel = instanceSelect("scanner");
  const methodSel = el("select", { class: "select" }, DIGITIZE_METHODS.map(([v, l]) => el("option", { value: v }, l)));
  const softwareInput = el("input", { type: "text", placeholder: "e.g. SilverFast, VueScan, Negative Lab Pro" });
  const dpiInput = el("input", { type: "number", min: "0", placeholder: "e.g. 3200" });
  const fmtInput = el("input", { type: "text", placeholder: "e.g. TIFF, DNG, JPEG" });

  openModal("Log scan session", [
    field("Roll", rollSel),
    field("Scanner", scannerSel),
    field("Method", methodSel),
    field("Software", softwareInput),
    field("Resolution (dpi)", dpiInput),
    field("File format", fmtInput),
  ], async () => {
    const rec = { method: methodSel.value, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), provenance: { source: "manual", assertedAt: new Date().toISOString() } };
    if (scannerSel.value) rec.scanner = scannerSel.value;
    if (softwareInput.value.trim()) rec.software = softwareInput.value.trim();
    if (fmtInput.value.trim()) rec.fileFormat = fmtInput.value.trim();
    const dpi = parseInt(dpiInput.value, 10);
    if (Number.isFinite(dpi)) rec.resolution = { unit: "dpi", value: dpi, scale: 1 };
    if (rollSel.value) rec.filmRolls = [rollSel.value];
    await saveRecord(ctx.agent, ctx.did, NS.process.digitizeSession, rec, null);
    ctx.store = await loadStore(ctx.agent, ctx.did);
    onDone?.();
  });
}

// batch-link a roll's logged exposures to scanned photos (sets exposure.photo).
function openFrameLinker(onDone) {
  const rollSel = instanceSelect("filmRoll");
  const listWrap = el("div", { class: "framelink-list" }, [el("p", { class: "muted small" }, "Choose a roll to see its frames.")]);
  let photos = [];
  const chosen = new Map();   // exposureUri -> photoUri

  const exposuresOfRoll = (rollUri) => (ctx.store.instance.exposure || [])
    .filter((e) => e.value.roll === rollUri)
    .sort((a, b) => (a.value.frameNumber ?? 0) - (b.value.frameNumber ?? 0));

  const renderRows = (rollUri) => {
    const exps = exposuresOfRoll(rollUri);
    chosen.clear();
    for (const e of exps) if (e.value.photo) chosen.set(e.uri, e.value.photo);
    if (!exps.length) { listWrap.replaceChildren(el("p", { class: "muted small" }, "No frames logged for this roll yet — log them in the Film tab or the shot logger.")); return; }
    const autoBtn = el("button", { class: "ghost small-btn", type: "button", onclick: () => { exps.forEach((e, i) => { if (photos[i]) chosen.set(e.uri, photos[i].uri); }); paint(); } }, "Auto-match in order");
    const rows = el("div", { class: "gear-list" });
    listWrap.replaceChildren(el("div", { class: "row between" }, [el("span", { class: "muted small" }, `${exps.length} frame${exps.length === 1 ? "" : "s"}`), autoBtn]), rows);
    const paint = () => {
      rows.replaceChildren(...exps.map((e) => {
        const cur = chosen.get(e.uri);
        const thumb = el("div", { class: "framelink-thumb" });
        if (cur) { const p = photos.find((x) => x.uri === cur); if (p) blobUrl(ctx.agent, ctx.did, p.value.photo).then((u) => { if (u) thumb.style.backgroundImage = `url(${u})`; }).catch(() => {}); }
        return el("div", { class: "gear-row row between" }, [
          el("div", { class: "row", style: "gap:10px;align-items:center" }, [thumb, el("span", {}, `Frame ${e.value.frameNumber ?? "—"}`)]),
          el("button", { class: "ghost small-btn", onclick: () => pickPhoto(e.uri, paint) }, cur ? "Change" : "Link photo"),
        ]);
      }));
    };
    paint();
  };

  const pickPhoto = (expUri, after) => {
    const grid = el("div", { class: "photo-pick-grid" });
    const m = openModal("Pick the scanned photo", [grid], async () => { after?.(); }, { saveLabel: "Done" });
    for (const p of photos.slice(0, 80)) {
      const cell = el("button", { class: "photo-pick" + (chosen.get(expUri) === p.uri ? " chosen" : ""), type: "button" });
      cell.addEventListener("click", () => { chosen.set(expUri, chosen.get(expUri) === p.uri ? undefined : p.uri); for (const c of grid.querySelectorAll(".photo-pick")) c.classList.remove("chosen"); if (chosen.get(expUri)) cell.classList.add("chosen"); });
      grid.append(cell);
      blobUrl(ctx.agent, ctx.did, p.value.photo).then((u) => { if (u) cell.style.backgroundImage = `url(${u})`; }).catch(() => {});
    }
  };

  rollSel.addEventListener("change", () => { if (rollSel.value) renderRows(rollSel.value); });

  openModal("Link frames → photos", [
    field("Roll", rollSel),
    listWrap,
  ], async () => {
    let n = 0;
    for (const [expUri, photoUri] of chosen) {
      if (!photoUri) continue;
      const e = ctx.store.instance.exposure.find((x) => x.uri === expUri);
      if (!e || e.value.photo === photoUri) continue;
      await saveRecord(ctx.agent, ctx.did, NS.instance.exposure, { ...e.value, photo: photoUri, updatedAt: new Date().toISOString() }, e);
      n += 1;
    }
    ctx.store = await loadStore(ctx.agent, ctx.did);
    toast(n ? `Linked ${n} frame${n === 1 ? "" : "s"}` : "No changes", "ok");
    onDone?.();
  }, { saveLabel: "Save links" });

  getPhotos(ctx.agent, ctx.did).then((ps) => { photos = ps || []; if (rollSel.value) renderRows(rollSel.value); }).catch(() => {});
}

// -- Workflows: a board of rolls by production stage --------------------------

const ROLL_STAGES = [
  ["loaded", "Loaded"], ["partial", "Partly shot"],
  ["exposed", "Shot"], ["at-lab", "At lab"], ["developing", "Developing"],
  ["developed", "Developed"], ["scanned", "Scanned"], ["archived", "Archived"],
];

function renderRollBoard(body) {
  const rolls = ctx.store.instance.filmRoll || [];
  // Reserve (filmStockpile) is film you own but have not loaded yet — the start
  // of the flow. It is counted by total quantity, not by number of stockpile
  // entries. It is the film the user thinks of as "in stock".
  const reserve = (ctx.store.instance.filmStockpile || []).filter((sp) => reserveQuantity(sp.value) > 0);
  if (!rolls.length && !reserve.length) return;
  const reserveTotal = reserve.reduce((n, sp) => n + reserveQuantity(sp.value), 0);

  const byStatus = new Map(ROLL_STAGES.map(([k]) => [k, []]));
  for (const r of rolls) { const s = r.value.status || "loaded"; (byStatus.get(s) || byStatus.get("loaded")).push(r); }
  const board = el("div", { class: "roll-board" });

  board.append(el("div", { class: "roll-col" }, [
    el("div", { class: "roll-col-head" }, [el("span", {}, "In reserve"), el("b", { class: "mono small" }, String(reserveTotal))]),
    ...reserve.map((sp) => {
      const txt = `${filmStockLabel(sp.value.stock)} ×${reserveQuantity(sp.value)}`;
      return el("div", { class: "roll-chip", title: txt }, txt);
    }),
  ]));

  for (const [k, label] of ROLL_STAGES) {
    const col = byStatus.get(k) || [];
    board.append(el("div", { class: "roll-col" }, [
      el("div", { class: "roll-col-head" }, [el("span", {}, label), el("b", { class: "mono small" }, String(col.length))]),
      ...col.map((r) => el("div", { class: "roll-chip", title: instanceLabel("filmRoll", r.value, ctx.store) }, instanceLabel("filmRoll", r.value, ctx.store))),
    ]));
  }
  body.append(el("div", { class: "card" }, [
    el("div", { class: "row between" }, [el("h3", { style: "margin:0" }, "Roll board"), el("span", { class: "muted small" }, `${rolls.length} roll${rolls.length === 1 ? "" : "s"}${reserveTotal ? ` · ${reserveTotal} in reserve` : ""}`)]),
    el("p", { class: "muted small" }, "Where every roll is in the shoot → develop → scan flow. Reserve is film you own but haven't loaded yet. Load one from the Film tab to start a roll."),
    board,
  ]));
}

export async function renderLibrary(bodyEl) {
  const body = bodyEl || $("#library-body");
  if (!ctx?.store) {
    const phase = loadPhase("Loading your setup from your PDS…");
    body.replaceChildren(...librarySkeleton(), phase.node);
    try { ctx.store = await loadStore(ctx.agent, ctx.did); }
    finally { phase.clear(); }
  }
  body.replaceChildren();

  let tab = body.dataset.tab || "cameras";
  if (!TAB_LABELS[tab]) tab = "cameras";
  const tabs = el("div", { class: "tab-bar" });
  for (const [id, label] of Object.entries(TAB_LABELS)) {
    tabs.append(el("button", {
      class: "ghost tab-btn" + (tab === id ? " active" : ""),
      onclick: () => { body.dataset.tab = id; renderLibrary(body); },
    }, label));
  }
  body.append(tabs);

  const search = el("input", { type: "search", class: "search-input", placeholder: "Filter…", "aria-label": "Filter setup" });
  search.addEventListener("input", () => {
    const q = search.value.trim();
    for (const row of body.querySelectorAll(".gear-row")) row.classList.toggle("hidden", !!q && !fuzzyMatches(q, row.textContent));
  });
  body.append(search);

  if (tab === "film") renderFilmTab(body);
  else if (tab === "darkroom") { renderDarkroomHeader(body); renderGearTab(body, GEAR_TABS.darkroom); }
  else if (tab === "scanning") { renderScanningHeader(body); renderGearTab(body, GEAR_TABS.scanning); }
  else if (GEAR_TABS[tab]) renderGearTab(body, GEAR_TABS[tab]);
  else if (tab === "shoots") renderShootsTab(body);
  else if (tab === "workflows") renderWorkflowsTab(body);
  else if (tab === "rules") renderRulesTab(body);
  else if (tab === "insights") renderInsightsTab(body);

  stagger([...body.querySelectorAll(":scope > .card")]);
}

function countUp(node, target) {
  if (target <= 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { node.textContent = String(target); return; }
  const start = performance.now(), dur = 620;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    node.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function metric(label, value) {
  const num = el("div", { class: "metric-num" }, "0");
  requestAnimationFrame(() => countUp(num, value));
  return el("div", { class: "metric" }, [num, el("div", { class: "metric-label muted small" }, label)]);
}

// chemistry lifecycle at a glance: remaining capacity + age + expiry warnings.
function renderChemistryStatus(body) {
  const chem = ctx.store.instance.chemistry || [];
  if (!chem.length) return;
  const now = Date.now();
  const rows = el("div", { class: "gear-list" });
  for (const c of chem) {
    const v = c.value;
    const cap = v.volumeMl, left = v.volumeRemainingMl;
    const pct = cap != null && left != null && cap > 0 ? Math.max(0, Math.min(100, Math.round((left / cap) * 100))) : null;
    const expired = v.expiresAt && Date.parse(v.expiresAt) < now;
    const ageDays = v.mixedAt ? Math.floor((now - Date.parse(v.mixedAt)) / 864e5) : null;
    const bits = [];
    if (v.rollsProcessed != null) bits.push(`${v.rollsProcessed} roll${v.rollsProcessed === 1 ? "" : "s"}`);
    if (ageDays != null) bits.push(`${ageDays}d old`);
    if (expired) bits.push("past use-by");
    const fill = el("div", { class: "bar-fill", style: "width:0%" });
    if (pct != null) requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
    rows.append(el("div", { class: "gear-row" + (expired ? " warn-row" : "") }, [
      el("div", { class: "row between", style: "width:100%" }, [
        el("strong", {}, instanceLabel("chemistry", v, ctx.store)),
        el("span", { class: "muted small" }, bits.join(" · ")),
      ]),
      pct != null ? el("div", { class: "bar-track", style: "width:100%;margin-top:6px" }, [fill]) : null,
    ]));
  }
  body.append(el("div", { class: "card" }, [el("h3", {}, "Chemistry status"), el("p", { class: "muted small" }, "Remaining capacity, age, and rolls processed. Linking a chemistry in the development timer bumps its rolls-processed count as you develop."), rows]));
}

function renderInsightsTab(body) {
  const st = ctx.store;
  const nInst = (k) => (st.instance[k] || []).length;
  const nType = (k) => (st.catalog[k] || []).length;
  body.append(el("div", { class: "card" }, [
    el("h2", {}, "Your gear at a glance"),
    el("div", { class: "metric-grid" }, [
      metric("Cameras", nInst("camera")), metric("Lenses", nInst("lens")), metric("Film rolls", nInst("filmRoll")),
      metric("Developments", (st.developSessions || []).length), metric("Scans", (st.digitizeSessions || []).length), metric("Scanners", nInst("scanner")),
      metric("Film stocks", nType("filmStock")), metric("Chemistry", nInst("chemistry")),
    ]),
  ]));

  renderChemistryStatus(body);

  const rolls = st.instance.filmRoll || [];
  if (rolls.length) {
    const byStatus = {};
    for (const r of rolls) { const s = r.value.status || "unknown"; byStatus[s] = (byStatus[s] || 0) + 1; }
    const rowsData = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...rowsData.map(([, n]) => n));
    const chart = el("div", { class: "bar-chart" });
    for (const [label, n] of rowsData) {
      const fill = el("div", { class: "bar-fill", style: "width:0%" });
      requestAnimationFrame(() => { fill.style.width = `${Math.round((n / max) * 100)}%`; });
      chart.append(el("div", { class: "bar-row" }, [
        el("span", { class: "bar-label mono small" }, label),
        el("div", { class: "bar-track" }, [fill]),
        el("b", { class: "bar-val mono small" }, String(n)),
      ]));
    }
    body.append(el("div", { class: "card" }, [el("h3", {}, "Film rolls by status"), chart]));
  }

  const tally = new Map();
  for (const cap of st.photoCaptureByPhoto.values()) for (const key of ["camera", "lens", "filmRoll"]) { const uri = cap.value[key]; if (uri) tally.set(uri, (tally.get(uri) || 0) + 1); }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) {
    const ul = el("ul", { class: "gear-list" });
    for (const [uri, n] of top) {
      const e = st.byUri.get(uri);
      const lbl = e ? (e.layer === "instance" ? instanceLabel(e.kind, e.item.value, st) : catalogLabel(e.kind, e.item.value)) : uri;
      ul.append(el("li", { class: "gear-row row between" }, [el("span", {}, lbl), el("b", {}, `${n}×`)]));
    }
    body.append(el("div", { class: "card" }, [el("h3", {}, "Most used"), ul]));
  }
}

export async function openLibrary() {
  // if the session was lost (or Setup is opened before login), bounce to login
  // instead of throwing on a null context.
  if (!ctx?.agent || !ctx?.did) { showView("login-view"); return; }
  ctx.store = null;          // force a fresh load; renderLibrary shows the skeleton meanwhile
  await renderLibrary();
}

// placeholder shown while the setup is being pulled from the PDS.
function librarySkeleton() {
  return [
    el("div", { class: "tab-bar skeleton-tabs" }, Array.from({ length: 5 }, () => el("div", { class: "skeleton skeleton-tab" }))),
    ...Array.from({ length: 3 }, () => el("div", { class: "card" }, [
      el("div", { class: "skeleton skeleton-title" }),
      el("div", { class: "skeleton skeleton-line" }),
      el("div", { class: "skeleton skeleton-line" }),
    ])),
  ];
}

export function instanceSelect(kind, value = "", onChange = () => {}) {
  const items = ctx.store.instance[kind] || [];
  const sel = el("select", { onchange: (e) => onChange(e.target.value || null) }, [
    el("option", { value: "" }, `(none)`),
    ...items.map((item) => el("option", { value: item.uri }, instanceLabel(kind, item.value, ctx.store))),
  ]);
  sel.value = value || "";
  return sel;
}

export function shootSelect(value = "", onChange = () => {}) {
  const items = ctx.store.shoots || [];
  const sel = el("select", { onchange: (e) => onChange(e.target.value || null) }, [
    el("option", { value: "" }, `(none)`),
    ...items.map((item) => el("option", { value: item.uri }, item.value.label || item.uri)),
  ]);
  sel.value = value || "";
  return sel;
}

export function getStore() {
  return ctx?.store;
}

export function refreshStore() {
  return loadStore(ctx.agent, ctx.did).then((s) => { ctx.store = s; return s; });
}
