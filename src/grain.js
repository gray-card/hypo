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

export const COLLECTIONS = {
  gallery: "social.grain.gallery",
  galleryItem: "social.grain.gallery.item",
  photo: "social.grain.photo",
  exif: "social.grain.photo.exif",
};

const SCALE = 1_000_000;

// at://did/collection/rkey -> { did, collection, rkey }
export function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);

  if (!m) {
    throw new Error(`not an at-uri: ${uri}`);
  }

  return { did: m[1], collection: m[2], rkey: m[3] };
}

// fetch every record in a collection, following pagination cursors.
export async function listRecords(agent, repo, collection) {
  const out = [];
  let cursor;

  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo,
      collection,
      limit: 100,
      cursor,
    });
    out.push(...res.data.records);
    cursor = res.data.cursor;
  } while (cursor);

  return out;
}

// list the user's photos, newest first (for linking film frames to photos by AT-URI).
export async function getPhotos(agent, did) {
  const records = await listRecords(agent, did, COLLECTIONS.photo);
  return records
    .map((r) => ({ uri: r.uri, cid: r.cid, value: r.value }))
    .sort((a, b) => (b.value.createdAt || "").localeCompare(a.value.createdAt || ""));
}

// list the user's galleries, newest first.
export async function getGalleries(agent, did) {
  const records = await listRecords(agent, did, COLLECTIONS.gallery);

  return records
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: parseAtUri(r.uri).rkey,
      value: r.value,
    }))
    .sort((a, b) => (b.value.createdAt || "").localeCompare(a.value.createdAt || ""));
}

// load one gallery plus its ordered photos and any exif records.
export async function getGalleryDetail(agent, did, galleryUri) {
  // the gallery record itself (fresh, with current cid for safe swaps).
  const { rkey } = parseAtUri(galleryUri);
  const galleryRes = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection: COLLECTIONS.gallery,
    rkey,
  });

  // all gallery.item rows, then keep only the ones pointing at this gallery.
  const items = (await listRecords(agent, did, COLLECTIONS.galleryItem))
    .filter((r) => r.value.gallery === galleryUri)
    .sort((a, b) => (a.value.position ?? 0) - (b.value.position ?? 0));

  // index exif records by the photo uri they describe.
  const exifByPhoto = new Map();
  for (const r of await listRecords(agent, did, COLLECTIONS.exif)) {
    exifByPhoto.set(r.value.photo, { uri: r.uri, cid: r.cid, value: r.value });
  }

  // resolve each item's photo record.
  const photos = [];
  for (const item of items) {
    const photoUri = item.value.item;
    let photo = null;

    try {
      const { rkey: prkey } = parseAtUri(photoUri);
      const res = await agent.com.atproto.repo.getRecord({
        repo: did,
        collection: COLLECTIONS.photo,
        rkey: prkey,
      });
      photo = { uri: res.data.uri, cid: res.data.cid, value: res.data.value };
    } catch (err) {
      // photo record might be missing/deleted. Surface a placeholder.
      photo = { uri: photoUri, cid: null, value: null, error: String(err) };
    }

    photos.push({
      item: { uri: item.uri, cid: item.cid, value: item.value },
      photo,
      exif: exifByPhoto.get(photoUri) || null,
    });
  }

  return {
    gallery: {
      uri: galleryRes.data.uri,
      cid: galleryRes.data.cid,
      rkey,
      value: galleryRes.data.value,
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

  if (ref.$link) {
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

  const res = await agent.com.atproto.sync.getBlob({ did, cid });
  const type = blob.mimeType || "image/jpeg";

  return URL.createObjectURL(new Blob([res.data], { type }));
}

// fetch a photo blob's raw bytes (for sending to an image-analysis API, etc.).
// returns { bytes: Uint8Array, type } or null when the ref has no cid.
export async function blobBytes(agent, did, blob) {
  const cid = blobCid(blob);
  if (!cid) return null;
  const res = await agent.com.atproto.sync.getBlob({ did, cid });
  return { bytes: res.data, type: blob.mimeType || "image/jpeg" };
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
      value?.focalLengthIn35mmFormat != null
        ? String(Math.round(value.focalLengthIn35mmFormat / SCALE))
        : "",
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
  const up = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: file.type || "image/jpeg" });
  return up.data.blob;
}

export async function createGallery(agent, did, { title, description }) {
  const value = { title: (title || "").trim() || "Untitled gallery", createdAt: new Date().toISOString() };
  if (description?.trim()) value.description = description.trim();
  const res = await agent.com.atproto.repo.createRecord({ repo: did, collection: COLLECTIONS.gallery, record: value, validate: false });
  return res.data.uri;
}

export async function createPhoto(agent, did, { blob, alt, aspectRatio }) {
  const value = { photo: blob, createdAt: new Date().toISOString() };
  if (alt?.trim()) value.alt = alt.trim();
  if (aspectRatio) value.aspectRatio = aspectRatio;
  const res = await agent.com.atproto.repo.createRecord({ repo: did, collection: COLLECTIONS.photo, record: value, validate: false });
  return res.data.uri;
}

export async function addGalleryItem(agent, did, { gallery, item, position = 0 }) {
  const value = { gallery, item, position, createdAt: new Date().toISOString() };
  const res = await agent.com.atproto.repo.createRecord({ repo: did, collection: COLLECTIONS.galleryItem, record: value, validate: false });
  return res.data.uri;
}

// update a gallery.item's position (for reordering), preserving everything else.
export async function setGalleryItemPosition(agent, did, item, position) {
  const value = { ...item.value, position };
  await agent.com.atproto.repo.putRecord({
    repo: did, collection: COLLECTIONS.galleryItem, rkey: parseAtUri(item.uri).rkey,
    record: value, swapRecord: item.cid, validate: false,
  });
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

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTIONS.gallery,
    rkey: gallery.rkey,
    record: value,
    swapRecord: gallery.cid, // refuse if the record changed underneath us
    validate: false, // pds doesn't know this custom lexicon
  });
}

// update a photo's alt text, preserving the image blob and everything else.
export async function savePhotoAlt(agent, did, photo, alt) {
  if (!photo.value) {
    throw new Error("photo record is missing; cannot edit alt text");
  }

  const value = { ...photo.value };

  if (alt?.trim()) {
    value.alt = alt;
  } else {
    delete value.alt;
  }

  const { rkey } = parseAtUri(photo.uri);

  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTIONS.photo,
    rkey,
    record: value,
    swapRecord: photo.cid,
    validate: false,
  });

  return res.data.cid;
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

  const value = { ...photo.value, photo: blob };

  if (aspectRatio) {
    value.aspectRatio = aspectRatio;
  } else {
    delete value.aspectRatio;
  }

  const { rkey } = parseAtUri(photo.uri);

  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTIONS.photo,
    rkey,
    record: value,
    swapRecord: photo.cid,
    validate: false,
  });

  return { cid: res.data.cid, value };
}

// update an existing exif record (same rkey) or create one if none exists.
export async function saveExif(agent, did, photoUri, existingExif, form) {
  const createdAt = existingExif?.value?.createdAt;
  const value = formToExifValue(form, photoUri, createdAt);

  if (existingExif) {
    const { rkey } = parseAtUri(existingExif.uri);

    const res = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: COLLECTIONS.exif,
      rkey,
      record: value,
      swapRecord: existingExif.cid,
      validate: false,
    });

    return { uri: existingExif.uri, cid: res.data.cid, value };
  }

  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COLLECTIONS.exif,
    record: value,
    validate: false,
  });

  return { uri: res.data.uri, cid: res.data.cid, value };
}
