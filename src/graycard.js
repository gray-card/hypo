// graycard.js: app.graycard.* data layer

import { exifToForm, flushRecordOperation, formToExifValue, listRecords, parseAtUri, recordRkey } from "./grain.js";
import * as outbox from "./outbox.js";
import { prepareSchemaWrite } from "./schemaRuntime.js";
import { NS, CATALOG_KINDS, INSTANCE_KINDS } from "../packages/lexicon/src/namespaces.ts";
import { assertConsumableLifecycle } from "@hypo/domain";
import { migrateLegacyDeveloperRecords } from "./legacyDeveloperMigration.ts";

export { NS, CATALOG_KINDS, INSTANCE_KINDS };

const TYPE_REF = {
  camera: "cameraType",
  lens: "lensType",
  filter: "filterType",
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
      rkey: recordRkey(r.uri),
      value: r.value,
      schemaRuntime: r.schemaRuntime,
    }))
    .sort((a, b) => JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
}

// build a per-kind fetcher for a namespace group (catalog/instance).
const grabWith = (agent, did, ns, options) => (kind) => listRecords(agent, did, ns[kind], options);

// A shoot's date for ordering: when it was shot (startedAt), else when the record
// was created. Shoots are shown newest-first everywhere they appear.
export const shootDateKey = (v) => v?.startedAt || v?.createdAt || "";
export const compareShootsByDate = (a, b) => shootDateKey(b.value).localeCompare(shootDateKey(a.value));

/** Assemble a store snapshot from the collection cache unless refresh is explicit. */
export async function readStoreSnapshot(agent, did, { refresh = false } = {}) {
  const migration = await migrateLegacyDeveloperRecords(agent, did);
  if (migration.migrated) refresh = true;
  const catalog = {};
  const instance = {};
  const byUri = new Map();

  // every collection is an independent read, so fetch them all concurrently
  // rather than serially — the round trips dominate the load time.
  const options = { refresh };
  const grab = (nsid) => listRecords(agent, did, nsid, options);
  const [
    catalogLists,
    instanceLists,
    photoCaptureRecs,
    photoWorkflowRecs,
    sceneGraphRecs,
    maintenanceRecs,
    galleryDefaultsRecs,
    workflowRuns,
    workflowStages,
    workflowTemplates,
    shoots,
    batchRules,
    developSessions,
    digitizeSessions,
    editSessions,
    printSessions,
    renderSessions,
  ] = await Promise.all([
    Promise.all(CATALOG_KINDS.map(grabWith(agent, did, NS.catalog, options))),
    Promise.all(INSTANCE_KINDS.map(grabWith(agent, did, NS.instance, options))),
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
    grab(NS.process.editSession).then(mapRecords),
    grab(NS.process.printSession).then(mapRecords),
    grab(NS.process.renderSession).then(mapRecords),
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
      uri: r.uri,
      cid: r.cid,
      rkey: recordRkey(r.uri),
      value: r.value,
      schemaRuntime: r.schemaRuntime,
    });
  }

  const photoWorkflowByPhoto = new Map();
  for (const r of photoWorkflowRecs) {
    photoWorkflowByPhoto.set(r.value.photo, {
      uri: r.uri,
      cid: r.cid,
      rkey: recordRkey(r.uri),
      value: r.value,
      schemaRuntime: r.schemaRuntime,
    });
  }

  const sceneGraphByPhoto = new Map();
  for (const r of sceneGraphRecs) {
    if (r.value.subject)
      sceneGraphByPhoto.set(r.value.subject, { uri: r.uri, value: r.value, schemaRuntime: r.schemaRuntime });
  }

  const maintenanceBySubject = new Map();
  for (const r of maintenanceRecs) {
    if (!r.value.subject) continue;
    const list = maintenanceBySubject.get(r.value.subject) || [];
    list.push({ uri: r.uri, value: r.value, schemaRuntime: r.schemaRuntime });
    maintenanceBySubject.set(r.value.subject, list);
  }

  const galleryDefaultsByGallery = new Map();
  for (const r of galleryDefaultsRecs) {
    galleryDefaultsByGallery.set(r.value.gallery, {
      uri: r.uri,
      cid: r.cid,
      rkey: recordRkey(r.uri),
      value: r.value,
      schemaRuntime: r.schemaRuntime,
    });
  }

  shoots.sort(compareShootsByDate); // newest-first, inherited by every consumer of store.shoots

  for (const item of [
    ...workflowRuns,
    ...workflowStages,
    ...workflowTemplates,
    ...shoots,
    ...batchRules,
    ...developSessions,
    ...digitizeSessions,
    ...editSessions,
    ...printSessions,
    ...renderSessions,
  ]) {
    byUri.set(item.uri, { layer: "other", item });
  }

  return {
    catalog,
    instance,
    byUri,
    photoCaptureByPhoto,
    photoWorkflowByPhoto,
    sceneGraphByPhoto,
    maintenanceBySubject,
    galleryDefaultsByGallery,
    workflowRuns,
    workflowStages,
    workflowTemplates,
    shoots,
    batchRules,
    developSessions,
    digitizeSessions,
    editSessions,
    printSessions,
    renderSessions,
    processSessions: [...developSessions, ...digitizeSessions, ...editSessions, ...printSessions, ...renderSessions],
  };
}

/** @deprecated Prefer readStoreSnapshot; retained for compatibility with feature modules. */
export const loadStore = readStoreSnapshot;

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
    case "chemistryType":
      return [value.brand, value.name, (value.roles || []).map((role) => role.replaceAll("-", " ")).join(" + ")]
        .filter(Boolean)
        .join(" ");
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
    const t =
      store.catalog[typeKey]?.find((x) => x.uri === value.type)?.value ||
      store.catalog.filmStock?.find((x) => x.uri === value.stock)?.value;
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
    return (
      [t && catalogLabel("filmStock", t), value.quantity != null ? `×${value.quantity}` : null]
        .filter(Boolean)
        .join(" · ") || "Film reserve"
    );
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
  const prepared = await prepareSchemaWrite(collection, record, existing);
  // Workflow stages are a discriminated union, so their variant $type must
  // survive the generic record writer. Other records default to the collection.
  const value = { ...prepared, $type: prepared.$type || collection };
  assertConsumableLifecycle(collection, value);
  if (existing) {
    const operation = outbox.enqueuePut(did, {
      uri: existing.uri,
      collection,
      rkey: existing.rkey,
      record: value,
      swapRecord: existing.cid,
    });
    await flushRecordOperation(agent, did, operation);
    return existing.uri;
  }
  const operation = outbox.enqueue(did, collection, value);
  const settled = await flushRecordOperation(agent, did, operation);
  return settled.acknowledgement?.uri || operation.tempUri;
}

export async function deleteRecord(agent, did, uri) {
  const operation = outbox.enqueueDelete(did, uri);
  await flushRecordOperation(agent, did, operation);
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
  await saveRecord(agent, did, NS.instance.filmStockpile, { ...sv, quantity: nextQty, updatedAt: now }, stockpile);

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
    const focal =
      lensType.focalLength35mm != null
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
  const prepared = await prepareSchemaWrite(NS.photo.capture, value, existing);
  const record = { ...prepared, $type: NS.photo.capture };

  if (existing) {
    const operation = outbox.enqueuePut(did, {
      uri: existing.uri,
      collection: NS.photo.capture,
      rkey: existing.rkey,
      record,
      swapRecord: existing.cid,
    });
    const settled = await flushRecordOperation(agent, did, operation);
    return {
      uri: existing.uri,
      cid: settled.acknowledgement?.cid || existing.cid,
      rkey: existing.rkey,
      value,
      schemaRuntime: existing.schemaRuntime,
      pending: Boolean(settled.operation),
    };
  }

  const operation = outbox.enqueue(did, NS.photo.capture, record);
  const settled = await flushRecordOperation(agent, did, operation);
  const uri = settled.acknowledgement?.uri || operation.tempUri;
  const rkey = uri.startsWith("at://") ? parseAtUri(uri).rkey : operation.id;
  return {
    uri,
    cid: settled.acknowledgement?.cid,
    rkey,
    value,
    pending: Boolean(settled.operation),
  };
}

export async function saveGalleryDefaults(agent, did, galleryUri, fields, existing) {
  const value = {
    gallery: galleryUri,
    createdAt: existing?.value?.createdAt || new Date().toISOString(),
    ...fields,
  };
  return saveRecord(agent, did, NS.gallery.defaults, value, existing);
}

export function chemistryRoles(value, store) {
  if (!value?.type) return [];
  const t = store.catalog.chemistryType.find((x) => x.uri === value.type)?.value;
  return Array.isArray(t?.roles) ? t.roles : [];
}

export function uriLayer(uri, store) {
  const entry = store.byUri.get(uri);
  return entry?.layer === "instance" ? entry.kind : entry?.layer === "catalog" ? entry.kind : null;
}

export async function saveWorkflowTemplate(agent, did, value, existing) {
  return saveRecord(agent, did, NS.workflow.template, value, existing);
}

const norm = (s) =>
  String(s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const gearTokenSignature = (s) =>
  String(s || "")
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z]+|\d+(?:\.\d+)?/g)
    ?.sort()
    .join("|") || "";

// fuzzy match one gear label against a normalized exif key
function gearMatches(typeLabel, exifLabel) {
  const a = norm(typeLabel);
  const b = norm(exifLabel);
  if (!a || !b) return false;
  if (a === b || (a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b))) return true;
  const aTokens = gearTokenSignature(typeLabel);
  const bTokens = gearTokenSignature(exifLabel);
  return aTokens.split("|").length >= 3 && aTokens === bTokens;
}

function gearTypeLabels(value) {
  const make = value.make || "";
  const aliases = [
    ...(Array.isArray(value.alternativeNames) ? value.alternativeNames : []),
    ...(value.exifModel ? [value.exifModel] : []),
  ].filter((name) => typeof name === "string" && name.trim());
  return [
    [make, value.model].filter(Boolean).join(" "),
    value.model || "",
    ...aliases.flatMap((alias) => [alias, [make, alias].filter(Boolean).join(" ")]),
  ];
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
    const keys = [exifLabel, model].filter(Boolean);
    const typeUris = (store.catalog[typeKind] || [])
      .filter((t) => keys.some((key) => gearTypeLabels(t.value).some((label) => gearMatches(label, key))))
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
