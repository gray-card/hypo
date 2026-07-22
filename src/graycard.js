// graycard.js: app.graycard.* data layer

import { exifToForm, formToExifValue, listRecords, parseAtUri } from "./grain.js";

export const NS = {
  catalog: {
    cameraType: "app.graycard.catalog.cameraType",
    lensType: "app.graycard.catalog.lensType",
    filmStock: "app.graycard.catalog.filmStock",
    filterType: "app.graycard.catalog.filterType",
    developerType: "app.graycard.catalog.developerType",
    scannerType: "app.graycard.catalog.scannerType",
    chemistryType: "app.graycard.catalog.chemistryType",
    lab: "app.graycard.catalog.lab",
    scanProfile: "app.graycard.catalog.scanProfile",
    paperType: "app.graycard.catalog.paperType",
    devRecipe: "app.graycard.catalog.devRecipe",
    enlargerType: "app.graycard.catalog.enlargerType",
    printerType: "app.graycard.catalog.printerType",
    lightSourceType: "app.graycard.catalog.lightSourceType",
    enlargingLensType: "app.graycard.catalog.enlargingLensType",
  },
  instance: {
    camera: "app.graycard.instance.camera",
    lens: "app.graycard.instance.lens",
    filmRoll: "app.graycard.instance.filmRoll",
    filmStockpile: "app.graycard.instance.filmStockpile",
    exposure: "app.graycard.instance.exposure",
    filter: "app.graycard.instance.filter",
    developer: "app.graycard.instance.developer",
    scanner: "app.graycard.instance.scanner",
    chemistry: "app.graycard.instance.chemistry",
    labAccount: "app.graycard.instance.labAccount",
    storageLocation: "app.graycard.instance.storageLocation",
    enlarger: "app.graycard.instance.enlarger",
    printer: "app.graycard.instance.printer",
    lightSource: "app.graycard.instance.lightSource",
    enlargingLens: "app.graycard.instance.enlargingLens",
    intermediate: "app.graycard.instance.intermediate",
  },
  process: {
    developSession: "app.graycard.process.developSession",
    digitizeSession: "app.graycard.process.digitizeSession",
    digitalSession: "app.graycard.process.digitalSession",
    captureSession: "app.graycard.process.captureSession",
    editSession: "app.graycard.process.editSession",
    maintenanceSession: "app.graycard.process.maintenanceSession",
    printSession: "app.graycard.process.printSession",
  },
  session: { capture: "app.graycard.session.capture" },
  workflow: {
    stage: "app.graycard.workflow.stage",
    run: "app.graycard.workflow.run",
    template: "app.graycard.workflow.template",
  },
  photo: {
    capture: "app.graycard.photo.capture",
    workflow: "app.graycard.photo.workflow",
    derivative: "app.graycard.photo.derivative",
  },
  gallery: { defaults: "app.graycard.gallery.defaults" },
  rule: { batch: "app.graycard.rule.batch" },
  artifact: "app.graycard.artifact",
  // a publicly discoverable setup, opting the user into cross-network Discover
  setup: "app.graycard.setup",
  edit: { recipe: "app.graycard.edit.recipe" },
  scene: {
    ontology: "app.graycard.scene.ontology",
    graph: "app.graycard.scene.graph",
    region: "app.graycard.scene.region",
    node: "app.graycard.scene.node",
    edge: "app.graycard.scene.edge",
  },
};

export const CATALOG_KINDS = [
  "cameraType", "lensType", "filmStock", "filterType", "developerType", "scannerType",
  "chemistryType", "lab", "scanProfile", "paperType",
  "enlargerType", "printerType", "lightSourceType", "enlargingLensType",
];

export const INSTANCE_KINDS = [
  "camera", "lens", "filter", "filmRoll", "filmStockpile", "exposure", "developer", "scanner",
  "chemistry", "labAccount", "storageLocation", "enlarger", "printer", "lightSource", "enlargingLens", "intermediate",
];

const TYPE_REF = {
  camera: "cameraType",
  lens: "lensType",
  filter: "filterType",
  developer: "developerType",
  scanner: "scannerType",
  chemistry: "chemistryType",
  filmRoll: "filmStock",
  filmStockpile: "filmStock",
  enlarger: "enlargerType",
  printer: "printerType",
  lightSource: "lightSourceType",
  enlargingLens: "enlargingLensType",
};

const SCALE = 1_000_000;

export function scaledToDisplay(n) {
  return n != null ? String(n / SCALE) : "";
}

export function displayToScaled(text) {
  const v = parseFloat(String(text).trim());
  return Number.isFinite(v) ? Math.round(v * SCALE) : null;
}

// build a self-describing app.graycard.defs#measure object from a display value.
export function displayToMeasure(text, unit, scale = SCALE) {
  const v = parseFloat(String(text).trim());
  return Number.isFinite(v) ? { value: Math.round(v * scale), unit, scale } : null;
}

export function measureToDisplay(m) {
  if (!m || m.value == null) return "";
  const scale = m.scale ?? 1;
  return String(m.value / scale);
}

// geoLocation stores lat/lon as integer degrees x 1e7 and altitude/accuracy as
// integer millimetres, so we scale the floats from the browser Geolocation API.
const GEO_SCALE = 1e7;
const ALT_SCALE = 1000;

export function geoToScaled({ latitude, longitude, altitude, accuracy } = {}) {
  const g = {};
  if (Number.isFinite(latitude)) g.latitude = Math.round(latitude * GEO_SCALE);
  if (Number.isFinite(longitude)) g.longitude = Math.round(longitude * GEO_SCALE);
  if (Number.isFinite(altitude)) g.altitude = Math.round(altitude * ALT_SCALE);
  if (Number.isFinite(accuracy)) g.accuracy = Math.round(accuracy * ALT_SCALE);
  return g;
}

export function scaledToGeo(g) {
  if (!g) return null;
  const out = {};
  if (g.latitude != null) out.latitude = g.latitude / GEO_SCALE;
  if (g.longitude != null) out.longitude = g.longitude / GEO_SCALE;
  if (g.altitude != null) out.altitude = g.altitude / ALT_SCALE;
  if (g.accuracy != null) out.accuracy = g.accuracy / ALT_SCALE;
  return out;
}

export function parseFocalLengthFromModel(model) {
  if (!model) return null;
  const m = /(\d+(?:\.\d+)?)\s*mm/i.exec(model);
  return m ? parseFloat(m[1]) : null;
}

function mapRecords(records) {
  return records
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: parseAtUri(r.uri).rkey,
      value: r.value,
    }))
    .sort((a, b) => JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
}

// build a per-kind fetcher for a namespace group (catalog/instance).
const grabWith = (agent, did, ns) => (kind) => listRecords(agent, did, ns[kind]);

// A shoot's date for ordering: when it was shot (startedAt), else when the record
// was created. Shoots are shown newest-first everywhere they appear.
export const shootDateKey = (v) => v?.startedAt || v?.createdAt || "";
export const compareShootsByDate = (a, b) => shootDateKey(b.value).localeCompare(shootDateKey(a.value));

export async function loadStore(agent, did) {
  const catalog = {};
  const instance = {};
  const byUri = new Map();

  // every collection is an independent read, so fetch them all concurrently
  // rather than serially — the round trips dominate the load time.
  const grab = (nsid) => listRecords(agent, did, nsid);
  const [
    catalogLists, instanceLists,
    photoCaptureRecs, photoWorkflowRecs, sceneGraphRecs, maintenanceRecs, galleryDefaultsRecs,
    workflowRuns, workflowStages, workflowTemplates, shoots, batchRules,
    developSessions, digitizeSessions,
  ] = await Promise.all([
    Promise.all(CATALOG_KINDS.map(grabWith(agent, did, NS.catalog))),
    Promise.all(INSTANCE_KINDS.map(grabWith(agent, did, NS.instance))),
    grab(NS.photo.capture),
    grab(NS.photo.workflow),
    grab(NS.scene.graph),
    grab(NS.process.maintenanceSession),
    grab(NS.gallery.defaults),
    grab(NS.workflow.run).then(mapRecords),
    grab(NS.workflow.stage).then(mapRecords),
    grab(NS.workflow.template).then(mapRecords),
    grab(NS.session.capture).then(mapRecords),
    grab(NS.rule.batch).then(mapRecords),
    grab(NS.process.developSession).then(mapRecords),
    grab(NS.process.digitizeSession).then(mapRecords),
  ]);

  CATALOG_KINDS.forEach((kind, i) => {
    catalog[kind] = mapRecords(catalogLists[i]);
    for (const item of catalog[kind]) byUri.set(item.uri, { layer: "catalog", kind, item });
  });
  INSTANCE_KINDS.forEach((kind, i) => {
    instance[kind] = mapRecords(instanceLists[i]);
    for (const item of instance[kind]) byUri.set(item.uri, { layer: "instance", kind, item });
  });

  const photoCaptureByPhoto = new Map();
  for (const r of photoCaptureRecs) {
    photoCaptureByPhoto.set(r.value.photo, {
      uri: r.uri, cid: r.cid, rkey: parseAtUri(r.uri).rkey, value: r.value,
    });
  }

  const photoWorkflowByPhoto = new Map();
  for (const r of photoWorkflowRecs) {
    photoWorkflowByPhoto.set(r.value.photo, {
      uri: r.uri, cid: r.cid, rkey: parseAtUri(r.uri).rkey, value: r.value,
    });
  }

  const sceneGraphByPhoto = new Map();
  for (const r of sceneGraphRecs) {
    if (r.value.subject) sceneGraphByPhoto.set(r.value.subject, { uri: r.uri, value: r.value });
  }

  const maintenanceBySubject = new Map();
  for (const r of maintenanceRecs) {
    if (!r.value.subject) continue;
    const list = maintenanceBySubject.get(r.value.subject) || [];
    list.push({ uri: r.uri, value: r.value });
    maintenanceBySubject.set(r.value.subject, list);
  }

  const galleryDefaultsByGallery = new Map();
  for (const r of galleryDefaultsRecs) {
    galleryDefaultsByGallery.set(r.value.gallery, {
      uri: r.uri, cid: r.cid, rkey: parseAtUri(r.uri).rkey, value: r.value,
    });
  }

  shoots.sort(compareShootsByDate);   // newest-first, inherited by every consumer of store.shoots

  for (const item of [...workflowRuns, ...workflowStages, ...workflowTemplates, ...shoots, ...batchRules, ...developSessions, ...digitizeSessions]) {
    byUri.set(item.uri, { layer: "other", item });
  }

  return {
    catalog, instance, byUri,
    photoCaptureByPhoto, photoWorkflowByPhoto, sceneGraphByPhoto, maintenanceBySubject, galleryDefaultsByGallery,
    workflowRuns, workflowStages, workflowTemplates, shoots, batchRules,
    developSessions, digitizeSessions,
  };
}

export function catalogLabel(kind, value) {
  if (!value) return "(unknown)";
  switch (kind) {
    case "cameraType":
    case "lensType":
    case "scannerType":
    case "enlargerType":
    case "printerType":
    case "lightSourceType":
    case "enlargingLensType":
      return [value.make, value.model].filter(Boolean).join(" ") || value.model || kind;
    case "filmStock":
    case "paperType":
      return [value.brand, value.name].filter(Boolean).join(" ");
    case "filterType":
      return [value.make, value.name].filter(Boolean).join(" ") || value.name || kind;
    case "developerType":
    case "chemistryType":
      return [value.brand, value.name, value.role].filter(Boolean).join(" ");
    case "lab":
    case "scanProfile":
      return value.name || kind;
    default:
      return value.name || value.model || kind;
  }
}

export function instanceLabel(kind, value, store) {
  if (!value) return "(unknown)";
  const nick = value.nickname || value.label;
  const typeKey = TYPE_REF[kind];
  if (typeKey && value.type) {
    const t = store.catalog[typeKey]?.find((x) => x.uri === value.type)?.value
      || store.catalog.filmStock?.find((x) => x.uri === value.stock)?.value;
    const base = t ? catalogLabel(typeKey === "filmStock" ? "filmStock" : typeKey, t) : value.type;
    return [nick, base, value.serialNumber].filter(Boolean).join(" · ");
  }
  if (kind === "filmRoll" && value.stock) {
    const t = store.catalog.filmStock.find((x) => x.uri === value.stock)?.value;
    const qty = value.quantity > 1 ? `${value.quantity} on hand` : null;
    return [value.label, t && catalogLabel("filmStock", t), qty].filter(Boolean).join(" · ") || "Roll";
  }
  if (kind === "filmStockpile" && value.stock) {
    const t = store.catalog.filmStock?.find((x) => x.uri === value.stock)?.value;
    return [t && catalogLabel("filmStock", t), value.quantity != null ? `×${value.quantity}` : null].filter(Boolean).join(" · ") || "Film reserve";
  }
  if (kind === "exposure") return value.frameNumber != null ? `Frame #${value.frameNumber}` : "Exposure";
  if (kind === "filter") {
    const t = store.catalog.filterType?.find((x) => x.uri === value.type)?.value;
    return [value.nickname, t && catalogLabel("filterType", t)].filter(Boolean).join(" · ") || "Filter";
  }
  if (kind === "storageLocation") return value.name;
  if (kind === "intermediate") return value.label || value.kind;
  if (kind === "labAccount") return value.nickname || value.accountId || "Lab account";
  if (kind === "enlarger") return [value.nickname, value.make, value.model].filter(Boolean).join(" · ");
  return nick || kind;
}

export async function saveRecord(agent, did, collection, record, existing) {
  const value = { ...record, $type: collection };
  if (existing) {
    await agent.com.atproto.repo.putRecord({
      repo: did, collection, rkey: existing.rkey, record: value,
      swapRecord: existing.cid, validate: false,
    });
    return existing.uri;
  }
  const res = await agent.com.atproto.repo.createRecord({
    repo: did, collection, record: value, validate: false,
  });
  return res.data.uri;
}

export async function deleteRecord(agent, did, uri) {
  const { collection, rkey } = parseAtUri(uri);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
}

// split one physical roll off a reserve stockpile: decrement its quantity and
// create a filmRoll (loaded into a camera when one is given). Returns the new
// roll's at-uri. `stockpile` is a loaded {uri, cid, rkey, value} record.
export async function splitRollFromStockpile(agent, did, stockpile, { camera, label } = {}) {
  const sv = stockpile.value;
  const now = new Date().toISOString();
  // We consider splitting a roll off the reserve to involve loading it, 
  // so the roll starts as `loaded`. The camera is
  // optional: you can load without recording which body.
  const roll = {
    stock: sv.stock,
    stockpile: stockpile.uri,
    status: "loaded",
    loadedAt: now,
    createdAt: now,
  };
  // carry the reserve's identity onto the physical roll so batch/expiry/storage
  // travel with it (the stockpile link keeps the provenance).
  if (sv.format) roll.format = sv.format;
  if (sv.expiresAt) roll.expiresAt = sv.expiresAt;
  if (sv.emulsionBatch) roll.emulsionBatch = sv.emulsionBatch;
  if (sv.storage) roll.storage = sv.storage;
  if (label) roll.label = label;
  if (camera) roll.camera = camera;

  const rollUri = await saveRecord(agent, did, NS.instance.filmRoll, roll, null);

  const nextQty = Math.max(0, (Number(sv.quantity) || 1) - 1);
  await saveRecord(agent, did, NS.instance.filmStockpile,
    { ...sv, quantity: nextQty, updatedAt: now }, stockpile);

  return rollUri;
}

function resolveTypeValue(store, kind, uri) {
  if (!uri) return null;
  const entry = store.byUri.get(uri);
  if (entry?.layer === "catalog") return entry.item.value;
  if (entry?.layer === "instance") {
    const inst = entry.item.value;
    const tk = TYPE_REF[entry.kind];
    if (tk && inst.type) {
      return store.catalog[tk]?.find((x) => x.uri === inst.type)?.value ?? null;
    }
    if (entry.kind === "filmRoll" && inst.stock) {
      return store.catalog.filmStock.find((x) => x.uri === inst.stock)?.value ?? null;
    }
  }
  return null;
}

export function resolvePhotoCapture(capture, defaults) {
  const c = capture?.value || {};
  const d = defaults?.value || {};
  return {
    camera: c.camera || d.camera || null,
    lens: c.lens || d.lens || null,
    filmRoll: c.filmRoll || d.filmRoll || null,
    shoot: c.shoot || d.shoot || null,
    medium: c.medium || null,
  };
}

export function projectCaptureToExif(form, refs, store, { mode = "fill" } = {}) {
  const out = { ...form };
  const canWrite = (k) => mode === "overwrite" || !(out[k] ?? "").trim();

  const camType = resolveTypeValue(store, "camera", refs.camera);
  const lensType = resolveTypeValue(store, "lens", refs.lens);
  let stock = null;
  if (refs.filmRoll) {
    const roll = store.instance.filmRoll.find((x) => x.uri === refs.filmRoll)?.value;
    if (roll?.stock) stock = store.catalog.filmStock.find((x) => x.uri === roll.stock)?.value;
  }

  if (camType) {
    if (canWrite("make") && camType.make) out.make = camType.make;
    if (canWrite("model") && camType.model) out.model = camType.model;
  }
  if (lensType) {
    if (canWrite("lensMake") && lensType.make) out.lensMake = lensType.make;
    if (canWrite("lensModel") && lensType.model) out.lensModel = lensType.model;
    const focal = lensType.focalLength35mm != null
      ? scaledToDisplay(lensType.focalLength35mm)
      : lensType.focalLengthMin != null
        ? scaledToDisplay(lensType.focalLengthMin)
        : parseFocalLengthFromModel(lensType.model);
    if (canWrite("focalLengthIn35mmFormat") && focal) {
      out.focalLengthIn35mmFormat = String(Math.round(parseFloat(focal)));
    }
    if (canWrite("fNumber") && lensType.maxAperture != null) {
      out.fNumber = scaledToDisplay(lensType.maxAperture);
    }
  }
  if (stock?.iso != null && canWrite("iSO")) {
    out.iSO = String(Math.round(stock.iso));
  }
  return out;
}

export async function savePhotoCapture(agent, did, photoUri, fields, existing) {
  const value = {
    photo: photoUri,
    createdAt: existing?.value?.createdAt || new Date().toISOString(),
    ...fields,
  };
  const record = { ...value, $type: NS.photo.capture };

  if (existing) {
    const res = await agent.com.atproto.repo.putRecord({
      repo: did, collection: NS.photo.capture, rkey: existing.rkey, record,
      swapRecord: existing.cid, validate: false,
    });
    return { uri: existing.uri, cid: res.data.cid, rkey: existing.rkey, value };
  }

  const res = await agent.com.atproto.repo.createRecord({
    repo: did, collection: NS.photo.capture, record, validate: false,
  });
  const { rkey } = parseAtUri(res.data.uri);
  return { uri: res.data.uri, cid: res.data.cid, rkey, value };
}

export async function saveGalleryDefaults(agent, did, galleryUri, fields, existing) {
  const value = {
    gallery: galleryUri,
    createdAt: existing?.value?.createdAt || new Date().toISOString(),
    ...fields,
  };
  return saveRecord(agent, did, NS.gallery.defaults, value, existing);
}

export function chemistryRole(value, store) {
  if (!value?.type) return null;
  const t = store.catalog.chemistryType.find((x) => x.uri === value.type)?.value;
  return t?.role || null;
}

export function uriLayer(uri, store) {
  const entry = store.byUri.get(uri);
  return entry?.layer === "instance" ? entry.kind : entry?.layer === "catalog" ? entry.kind : null;
}

export async function saveWorkflowTemplate(agent, did, value, existing) {
  return saveRecord(agent, did, NS.workflow.template, value, existing);
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// fuzzy match one gear label against a normalized exif key
function gearMatches(typeLabel, key) {
  const a = norm(typeLabel);
  if (!a || !key) return false;
  return a === key || (a.length >= 6 && key.includes(a)) || (key.length >= 6 && a.includes(key));
}

// Suggest which of the user's gear a photo's EXIF points at. Returns, for camera
// and lens, the matching instances (possibly several copies of the same model)
// plus the raw make/model so the UI can offer "add it to your setup".
export function matchGear(exif, store) {
  const e = exif || {};
  const out = { camera: null, lens: null };

  const build = (make, model, typeKind, instKind, typeRefKey) => {
    const exifLabel = [make, model].filter(Boolean).join(" ").trim();
    if (!exifLabel) return null;
    // match on the full "make model" and on the model alone, since EXIF makes are
    // often verbose ("NIKON CORPORATION") while the type stores a clean make.
    const keys = [norm(exifLabel), norm(model)].filter(Boolean);
    const typeUris = (store.catalog[typeKind] || [])
      .filter((t) => {
        const full = [t.value.make, t.value.model].filter(Boolean).join(" ");
        return keys.some((k) => gearMatches(full, k) || gearMatches(t.value.model || "", k));
      })
      .map((t) => t.uri);
    const instances = (store.instance[instKind] || [])
      .filter((it) => typeUris.includes(it.value[typeRefKey]))
      .map((it) => ({ uri: it.uri, label: instanceLabel(instKind, it.value, store) }));
    return { exifLabel, make: make || "", model: model || "", instances };
  };

  out.camera = build(e.make, e.model, "cameraType", "camera", "type");
  out.lens = build(e.lensMake, e.lensModel, "lensType", "lens", "type");
  return out;
}

export function exifValueToForm(value) {
  return exifToForm(value);
}

export { formToExifValue };
