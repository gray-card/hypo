// grain.js
// read/write adapter for the current photo/gallery provider, grain.social,
// stored in the user's own atproto repo. This is the one concrete provider;
// the rest of the app references a linked photo generically by its AT-URI, so
// another photo source could be added here without changing the data model.
//
// record types (all in the user's own pds):
//   social.grain.gallery        -> title, description, facets, createdAt, updatedAt
//   social.grain.gallery.item   -> links a gallery to a photo (gallery uri, item uri, position)
//   social.grain.photo          -> the image blob + alt text + aspectRatio
//   social.grain.photo.exif     -> exif metadata, linked to a photo via the `photo` at-uri
//
// grain stores all numeric exif fields scaled by 1,000,000 (see lexicon note),
// so we divide on read and multiply on write.

import { repoClient } from "./pds.js";
import * as outbox from "./outbox.js";
import { normalizeBlobRef } from "@hypo/pds";
import { RecordStore, openRepositoryRecordCache } from "@hypo/store";
import { decodeSchemaRecord } from "./schemaRuntime.js";

export const COLLECTIONS = {
  gallery: "social.grain.gallery",
  galleryItem: "social.grain.gallery.item",
  photo: "social.grain.photo",
  exif: "social.grain.photo.exif",
};

const SCALE = 1_000_000;
const recordStores = new Map();
const hydratedCollections = new WeakMap();

export function recordStore(repo) {
  let store = recordStores.get(repo);
  if (!store) {
    store = new RecordStore({ repo });
    recordStores.set(repo, store);
    hydratedCollections.set(store, new Set());
    outbox.subscribeAcknowledgements(repo, async (acknowledgement) => {
      store.acknowledge(acknowledgement);
      await (await openRepositoryRecordCache()).applyAcknowledgement(acknowledgement);
    });
  }
  return store;
}

/** Keep durable cache and live selectors coherent with one queued write. */
export async function flushRecordOperation(agent, did, operation) {
  const store = recordStore(did);
  store.upsertOperation(operation);
  let settled;
  try {
    settled = await outbox.flushOperation(agent, did, operation.id);
  } catch (error) {
    store.replaceOperations(await outbox.list(did));
    throw error;
  }
  if (settled.operation) {
    store.upsertOperation(settled.operation);
  } else if (!settled.acknowledgement) {
    store.removeOperation(operation.id);
  }
  return settled;
}

// at://did/collection/rkey -> { did, collection, rkey }
export function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);

  if (!m) {
    throw new Error(`not an at-uri: ${uri}`);
  }

  return { did: m[1], collection: m[2], rkey: m[3] };
}

export function recordRkey(uri) {
  if (String(uri).startsWith("outbox://")) return String(uri).split("/").at(-1);
  return parseAtUri(uri).rkey;
}

// Read remote ⊕ pending for one collection. A missing snapshot is populated
// once; only `refresh: true` performs another network collection read.
export async function listRecords(agent, repo, collection, { refresh = false } = {}) {
  const cache = await openRepositoryRecordCache();
  const store = recordStore(repo);
  const hydrated = hydratedCollections.get(store);
  if (refresh || !hydrated.has(collection)) {
    let records = await cache.read(repo, collection);
    if (refresh || !(await cache.hasSnapshot(repo, collection))) {
      try {
        records = await repoClient(agent).listAll({ repo, collection, limit: 100 });
        await cache.replace(repo, collection, records);
      } catch (error) {
        if (!records.length && navigator.onLine !== false && error?.name !== "NetworkError") throw error;
      }
    }
    records = await Promise.all(records.map((record) => decodeSchemaRecord(record, collection)));
    store.replaceRemote(collection, records);
    hydrated.add(collection);
  }
  const operations = await outbox.list(repo);
  store.replaceOperations(operations);
  return [...store.collection(collection).value.values()];
}

// list the user's photos, newest first (for linking film frames to photos by AT-URI).
export async function getPhotos(agent, did) {
  const records = await listRecords(agent, did, COLLECTIONS.photo, { refresh: true });
  return records
    .map((r) => ({ uri: r.uri, cid: r.cid, value: r.value }))
    .sort((a, b) => (b.value.createdAt || "").localeCompare(a.value.createdAt || ""));
}

// list the user's galleries, newest first.
export async function getGalleries(agent, did) {
  const records = await listRecords(agent, did, COLLECTIONS.gallery, { refresh: true });

  return records
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: recordRkey(r.uri),
      value: r.value,
    }))
    .sort((a, b) => (b.value.createdAt || "").localeCompare(a.value.createdAt || ""));
}

// load one gallery plus its ordered photos and any exif records.
export async function getGalleryDetail(agent, did, galleryUri) {
  // the gallery record itself (fresh, with current cid for safe swaps).
  const gallery = (await listRecords(agent, did, COLLECTIONS.gallery, { refresh: true })).find(
    (record) => record.uri === galleryUri,
  );
  if (!gallery) throw new Error("Gallery record is unavailable");
  const rkey = recordRkey(galleryUri);

  // all gallery.item rows, then keep only the ones pointing at this gallery.
  const items = (await listRecords(agent, did, COLLECTIONS.galleryItem, { refresh: true }))
    .filter((r) => r.value.gallery === galleryUri)
    .sort((a, b) => (a.value.position ?? 0) - (b.value.position ?? 0));

  // index exif records by the photo uri they describe.
  const exifByPhoto = new Map();
  for (const r of await listRecords(agent, did, COLLECTIONS.exif, { refresh: true })) {
    exifByPhoto.set(r.value.photo, { uri: r.uri, cid: r.cid, value: r.value });
  }

  // resolve each item's photo record.
  const photos = [];
  const photoRecords = await listRecords(agent, did, COLLECTIONS.photo, { refresh: true });
  for (const item of items) {
    const photoUri = item.value.item;
    const record = photoRecords.find((candidate) => candidate.uri === photoUri);
    // A photo record might be missing/deleted. Surface a placeholder.
    const photo = record
      ? { uri: record.uri, cid: record.cid, value: record.value }
      : { uri: photoUri, cid: null, value: null, error: "Photo record is unavailable" };

    photos.push({
      item: { uri: item.uri, cid: item.cid, value: item.value },
      photo,
      exif: exifByPhoto.get(photoUri) || null,
    });
  }

  return {
    gallery: {
      uri: gallery.uri,
      cid: gallery.cid,
      rkey,
      value: gallery.value,
    },
    photos,
  };
}

// extract a cid string from a blob ref in any shape we might encounter.
//
// records read through the @atproto/api agent hydrate blobs into `BlobRef`
// instances whose `.ref` is a `CID` object (no `$link`), while raw json blobs
// carry `{ ref: { $link } }`. handle both, plus bare string refs.
export function blobCid(blob) {
  const ref = blob?.ref;

  if (!ref) {
    return null;
  }

  if (typeof ref === "string") {
    return ref;
  }

  if (typeof ref.$link === "string" && ref.$link !== "[object Object]") {
    return ref.$link;
  }

  if (typeof ref.toString === "function") {
    const s = ref.toString();

    if (s && s !== "[object Object]") {
      return s;
    }
  }

  return null;
}

// build an object url for a photo blob so it can be shown in an <img>.
export async function blobUrl(agent, did, blob) {
  const cid = blobCid(blob);

  if (!cid) {
    return null;
  }

  const bytes = await repoClient(agent).getBlob({ did, cid });
  const type = blob.mimeType || "image/jpeg";

  return URL.createObjectURL(new Blob([bytes], { type }));
}

// fetch a photo blob's raw bytes (for sending to an image-analysis API, etc.).
// returns { bytes: Uint8Array, type } or null when the ref has no cid.
export async function blobBytes(agent, did, blob) {
  const cid = blobCid(blob);
  if (!cid) return null;
  const bytes = await repoClient(agent).getBlob({ did, cid });
  return { bytes, type: blob.mimeType || "image/jpeg" };
}

// -- exif scaling helpers -----------------------------------------------------

// convert a stored exif record value into human-friendly editable fields.
export function exifToForm(value) {
  return {
    make: value?.make ?? "",
    model: value?.model ?? "",
    lensMake: value?.lensMake ?? "",
    lensModel: value?.lensModel ?? "",
    flash: value?.flash ?? "",
    dateTimeOriginal: value?.dateTimeOriginal ?? "",
    fNumber: value?.fNumber != null ? String(value.fNumber / SCALE) : "",
    iSO: value?.iSO != null ? String(Math.round(value.iSO / SCALE)) : "",
    focalLengthIn35mmFormat:
      value?.focalLengthIn35mmFormat != null ? String(Math.round(value.focalLengthIn35mmFormat / SCALE)) : "",
    // exposure shown as a fraction ("1/125") when < 1s, else seconds.
    exposureTime: value?.exposureTime != null ? formatExposure(value.exposureTime) : "",
  };
}

export function formatExposure(scaled) {
  const seconds = scaled / SCALE;

  if (seconds >= 1) {
    return `${seconds}`;
  }

  return `1/${Math.round(1 / seconds)}`;
}

// parse an exposure field ("1/125" or "0.5") into seconds, or null if blank.
function parseExposure(text) {
  const t = String(text).trim();

  if (!t) {
    return null;
  }

  if (t.includes("/")) {
    const [num, den] = t.split("/").map((s) => parseFloat(s.trim()));
    return den ? num / den : null;
  }

  const v = parseFloat(t);

  return Number.isFinite(v) ? v : null;
}

// turn the human exif form back into a stored record value (scaled integers).
// only the `photo` and `createdAt` fields are required. Everything else is
// included only when the user supplied a value.
export function formToExifValue(form, photoUri, createdAt) {
  const value = {
    $type: COLLECTIONS.exif,
    photo: photoUri,
    createdAt: createdAt || new Date().toISOString(),
  };

  const str = (k) => {
    const v = (form[k] ?? "").trim();
    if (v) value[k] = v;
  };

  str("make");
  str("model");
  str("lensMake");
  str("lensModel");
  str("flash");

  const dto = (form.dateTimeOriginal ?? "").trim();
  if (dto) value.dateTimeOriginal = new Date(dto).toISOString();

  const fNumber = parseFloat(form.fNumber);
  if (Number.isFinite(fNumber)) value.fNumber = Math.round(fNumber * SCALE);

  const iso = parseFloat(form.iSO);
  if (Number.isFinite(iso)) value.iSO = Math.round(iso * SCALE);

  const focal = parseFloat(form.focalLengthIn35mmFormat);
  if (Number.isFinite(focal)) value.focalLengthIn35mmFormat = Math.round(focal * SCALE);

  const exp = parseExposure(form.exposureTime);
  if (exp != null) value.exposureTime = Math.round(exp * SCALE);

  return value;
}

// -- writes (preserve record keys) --------------------------------------------

// update the gallery record in place (same rkey == same gallery id).
// ---- creating grain.social galleries directly from Hypo --------------------

export async function uploadImage(agent, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return normalizeBlobRef(await repoClient(agent).uploadBlob({ bytes, mimeType: file.type || "image/jpeg" }));
}

export async function createGallery(agent, did, { title, description }) {
  const value = { title: (title || "").trim() || "Untitled gallery", createdAt: new Date().toISOString() };
  if (description?.trim()) value.description = description.trim();
  const operation = outbox.enqueue(did, COLLECTIONS.gallery, value);
  const settled = await flushRecordOperation(agent, did, operation);
  return settled.acknowledgement?.uri || operation.tempUri;
}

export async function createPhoto(agent, did, { blob, alt, aspectRatio }) {
  const value = { photo: normalizeBlobRef(blob), createdAt: new Date().toISOString() };
  if (alt?.trim()) value.alt = alt.trim();
  if (aspectRatio) value.aspectRatio = aspectRatio;
  const operation = outbox.enqueue(did, COLLECTIONS.photo, value);
  const settled = await flushRecordOperation(agent, did, operation);
  return settled.acknowledgement?.uri || operation.tempUri;
}

export async function addGalleryItem(agent, did, { gallery, item, position = 0 }) {
  const value = { gallery, item, position, createdAt: new Date().toISOString() };
  const operation = outbox.enqueue(did, COLLECTIONS.galleryItem, value);
  const settled = await flushRecordOperation(agent, did, operation);
  return settled.acknowledgement?.uri || operation.tempUri;
}

// update a gallery.item's position (for reordering), preserving everything else.
export async function setGalleryItemPosition(agent, did, item, position) {
  const value = { ...item.value, position };
  const operation = outbox.enqueuePut(did, {
    uri: item.uri,
    record: value,
    swapRecord: item.cid,
  });
  await flushRecordOperation(agent, did, operation);
}

export async function saveGallery(agent, did, gallery, { title, description }) {
  const value = {
    ...gallery.value,
    title,
    description: description?.trim() ? description : undefined,
    updatedAt: new Date().toISOString(),
  };

  if (value.description === undefined) {
    delete value.description;
  }

  const operation = outbox.enqueuePut(did, {
    uri: gallery.uri,
    record: value,
    swapRecord: gallery.cid,
  });
  await flushRecordOperation(agent, did, operation);
}

// update a photo's alt text, preserving the image blob and everything else.
export async function savePhotoAlt(agent, did, photo, alt) {
  if (!photo.value) {
    throw new Error("photo record is missing; cannot edit alt text");
  }

  const value = { ...photo.value, photo: normalizeBlobRef(photo.value.photo) };

  if (alt?.trim()) {
    value.alt = alt;
  } else {
    delete value.alt;
  }

  const operation = outbox.enqueuePut(did, {
    uri: photo.uri,
    record: value,
    swapRecord: photo.cid,
  });
  const settled = await flushRecordOperation(agent, did, operation);
  return settled.acknowledgement?.cid || photo.cid;
}

// replace the image blob on an existing photo record (same AT-URI / rkey).
// keeps gallery.item, EXIF, capture, workflow, and scene links intact.
export async function replacePhoto(agent, did, photo, { blob, aspectRatio }) {
  if (!photo?.value) {
    throw new Error("photo record is missing; cannot replace image");
  }
  if (!blob) {
    throw new Error("blob is required to replace a photo");
  }

  const value = { ...photo.value, photo: normalizeBlobRef(blob) };

  if (aspectRatio) {
    value.aspectRatio = aspectRatio;
  } else {
    delete value.aspectRatio;
  }

  const operation = outbox.enqueuePut(did, {
    uri: photo.uri,
    record: value,
    swapRecord: photo.cid,
  });
  const settled = await flushRecordOperation(agent, did, operation);
  return { cid: settled.acknowledgement?.cid || photo.cid, value };
}

// update an existing exif record (same rkey) or create one if none exists.
export async function saveExif(agent, did, photoUri, existingExif, form) {
  const createdAt = existingExif?.value?.createdAt;
  const value = formToExifValue(form, photoUri, createdAt);

  if (existingExif) {
    const operation = outbox.enqueuePut(did, {
      uri: existingExif.uri,
      record: value,
      swapRecord: existingExif.cid,
    });
    const settled = await flushRecordOperation(agent, did, operation);
    return {
      uri: existingExif.uri,
      cid: settled.acknowledgement?.cid || existingExif.cid,
      value,
      pending: Boolean(settled.operation),
    };
  }

  const operation = outbox.enqueue(did, COLLECTIONS.exif, value);
  const settled = await flushRecordOperation(agent, did, operation);
  return {
    uri: settled.acknowledgement?.uri || operation.tempUri,
    cid: settled.acknowledgement?.cid,
    value,
    pending: Boolean(settled.operation),
  };
}
