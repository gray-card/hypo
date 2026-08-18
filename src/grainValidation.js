import { normalizeRecordBlobRefs } from "@hypo/pds";

export const GRAIN_PHOTO_MAX_BYTES = 1_000_000;

const GRAIN_COLLECTIONS = new Set([
  "social.grain.gallery",
  "social.grain.gallery.item",
  "social.grain.photo",
  "social.grain.photo.exif",
]);

const EXIF_INTEGER_FIELDS = ["exposureTime", "fNumber", "focalLengthIn35mmFormat", "iSO"];
const EXIF_STRING_FIELDS = ["flash", "lensMake", "lensModel", "make", "model"];

function fail(collection, detail) {
  throw new TypeError(`${collection} is not a valid Grain record: ${detail}`);
}

function objectRecord(collection, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(collection, "record must be an object");
  return value;
}

function stringField(collection, value, field, { required = false, maxLength } = {}) {
  if (value === undefined && !required) return;
  if (typeof value !== "string") fail(collection, `${field} must be a string`);
  if (maxLength !== undefined && Array.from(value).length > maxLength) {
    fail(collection, `${field} must be at most ${maxLength} characters`);
  }
}

function arrayField(collection, value, field, { maxLength } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(collection, `${field} must be an array`);
  if (maxLength !== undefined && value.length > maxLength) {
    fail(collection, `${field} must contain at most ${maxLength} items`);
  }
  return value;
}

function integerField(collection, value, field, { minimum } = {}) {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    fail(collection, `${field} must be${minimum !== undefined ? ` an integer of at least ${minimum}` : " an integer"}`);
  }
}

function datetimeField(collection, value, field, { required = false } = {}) {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(collection, `${field} must be an RFC 3339 datetime`);
  }
}

function atUriField(collection, value, field) {
  if (typeof value !== "string" || !/^at:\/\/[^/]+\/[^/]+\/[^/]+$/.test(value)) {
    fail(collection, `${field} must be an AT URI`);
  }
}

function recordType(collection, value) {
  if (value.$type !== collection) fail(collection, `$type must be ${collection}`);
}

function graphemeLength(value) {
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
  }
  return Array.from(value).length;
}

function validateFacets(collection, facets) {
  for (const [index, facetValue] of (arrayField(collection, facets, "facets") || []).entries()) {
    const facet = objectRecord(collection, facetValue);
    const slice = objectRecord(collection, facet.index);
    integerField(collection, slice.byteStart, `facets[${index}].index.byteStart`, { minimum: 0 });
    integerField(collection, slice.byteEnd, `facets[${index}].index.byteEnd`, { minimum: 0 });
    const features = arrayField(collection, facet.features, `facets[${index}].features`) || [];
    for (const [featureIndex, featureValue] of features.entries()) {
      const feature = objectRecord(collection, featureValue);
      const path = `facets[${index}].features[${featureIndex}]`;
      if (feature.$type === "app.bsky.richtext.facet#mention") {
        if (typeof feature.did !== "string" || !/^did:[a-z0-9]+:[^\s]+$/i.test(feature.did)) {
          fail(collection, `${path}.did must be a DID`);
        }
      } else if (feature.$type === "app.bsky.richtext.facet#link") {
        if (typeof feature.uri !== "string" || !/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(feature.uri)) {
          fail(collection, `${path}.uri must be a URI`);
        }
      } else if (feature.$type === "app.bsky.richtext.facet#tag") {
        stringField(collection, feature.tag, `${path}.tag`, { required: true, maxLength: 640 });
        if (graphemeLength(feature.tag) > 64) fail(collection, `${path}.tag must contain at most 64 graphemes`);
      } else {
        fail(collection, `${path} must be a mention, link, or tag`);
      }
    }
  }
}

function validateLabels(collection, labelsValue) {
  if (labelsValue === undefined) return;
  const labels = objectRecord(collection, labelsValue);
  if (labels.$type !== "com.atproto.label.defs#selfLabels") {
    fail(collection, "labels must be com.atproto.label.defs#selfLabels");
  }
  for (const [index, labelValue] of (
    arrayField(collection, labels.values, "labels.values", { maxLength: 10 }) || []
  ).entries()) {
    const label = objectRecord(collection, labelValue);
    stringField(collection, label.val, `labels.values[${index}].val`, { required: true, maxLength: 128 });
  }
}

function validateLocation(collection, locationValue) {
  if (locationValue === undefined) return;
  const location = objectRecord(collection, locationValue);
  stringField(collection, location.value, "location.value", { required: true });
  stringField(collection, location.name, "location.name");
}

function validateAddress(collection, addressValue) {
  if (addressValue === undefined) return;
  const address = objectRecord(collection, addressValue);
  stringField(collection, address.country, "address.country", { required: true, maxLength: 10 });
  if (Array.from(address.country).length < 2) fail(collection, "address.country must contain at least 2 characters");
  for (const field of ["postalCode", "region", "locality", "street", "name"]) {
    stringField(collection, address[field], `address.${field}`);
  }
}

function validateGallery(record) {
  const collection = "social.grain.gallery";
  recordType(collection, record);
  stringField(collection, record.title, "title", { required: true, maxLength: 100 });
  stringField(collection, record.description, "description", { maxLength: 1000 });
  datetimeField(collection, record.createdAt, "createdAt", { required: true });
  datetimeField(collection, record.updatedAt, "updatedAt");
  validateFacets(collection, record.facets);
  validateLabels(collection, record.labels);
  validateLocation(collection, record.location);
  validateAddress(collection, record.address);
}

function validateGalleryItem(record) {
  const collection = "social.grain.gallery.item";
  recordType(collection, record);
  atUriField(collection, record.gallery, "gallery");
  atUriField(collection, record.item, "item");
  datetimeField(collection, record.createdAt, "createdAt", { required: true });
  if (record.position !== undefined) integerField(collection, record.position, "position");
}

function validatePhoto(record) {
  const collection = "social.grain.photo";
  recordType(collection, record);
  const blob = objectRecord(collection, record.photo);
  if (blob.$type !== "blob") fail(collection, "photo.$type must be blob");
  if (typeof blob.ref?.$link !== "string") fail(collection, "photo.ref must contain a CID link");
  if (typeof blob.mimeType !== "string" || !blob.mimeType.toLowerCase().startsWith("image/")) {
    fail(collection, "photo.mimeType must match image/*");
  }
  if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > GRAIN_PHOTO_MAX_BYTES) {
    fail(collection, `photo.size must be an integer from 0 through ${GRAIN_PHOTO_MAX_BYTES}`);
  }
  const aspectRatio = objectRecord(collection, record.aspectRatio);
  for (const field of ["width", "height"]) {
    integerField(collection, aspectRatio[field], `aspectRatio.${field}`, { minimum: 1 });
  }
  stringField(collection, record.alt, "alt");
  datetimeField(collection, record.createdAt, "createdAt", { required: true });
}

function validateExif(record) {
  const collection = "social.grain.photo.exif";
  recordType(collection, record);
  atUriField(collection, record.photo, "photo");
  datetimeField(collection, record.createdAt, "createdAt", { required: true });
  datetimeField(collection, record.dateTimeOriginal, "dateTimeOriginal");
  for (const field of EXIF_INTEGER_FIELDS) {
    if (record[field] !== undefined) integerField(collection, record[field], field);
  }
  for (const field of EXIF_STRING_FIELDS) stringField(collection, record[field], field);
}

/**
 * Canonicalize BlobRefs and enforce the Grain record contracts Hypo writes.
 *
 * Grain's lexicons are not installed on every PDS, so Hypo submits these
 * records with server-side validation disabled. This is the mandatory local
 * gate used both before enqueue and again when a durable operation is flushed.
 */
export function canonicalizeAndValidateGrainRecord(collection, value) {
  if (!GRAIN_COLLECTIONS.has(collection)) return value;
  const source = objectRecord(collection, value);
  if (source.$type !== undefined && source.$type !== collection) recordType(collection, source);
  const record = normalizeRecordBlobRefs({ ...source, $type: collection });

  if (collection === "social.grain.gallery") validateGallery(record);
  else if (collection === "social.grain.gallery.item") validateGalleryItem(record);
  else if (collection === "social.grain.photo") validatePhoto(record);
  else validateExif(record);

  return record;
}

export function isGrainCollection(collection) {
  return GRAIN_COLLECTIONS.has(collection);
}
