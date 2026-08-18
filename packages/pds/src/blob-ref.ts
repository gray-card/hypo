import { CID } from "multiformats/cid";

import type { BlobRef, RepoRecord } from "./types.js";

type UnknownObject = Record<string, unknown>;

function objectValue(value: unknown): UnknownObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownObject) : undefined;
}

function cidString(ref: unknown): string | undefined {
  const object = objectValue(ref);
  const candidate = typeof ref === "string" ? ref : typeof object?.$link === "string" ? object.$link : undefined;

  if (candidate) {
    try {
      return CID.parse(candidate).toString();
    } catch {
      return undefined;
    }
  }

  try {
    return CID.asCID(ref as CID | null)?.toString();
  } catch {
    return undefined;
  }
}

function blobCandidate(value: unknown): UnknownObject | undefined {
  const object = objectValue(value);
  if (!object) return undefined;

  if (typeof object.toJSON === "function") {
    try {
      const serialized = objectValue(object.toJSON());
      if (serialized) return serialized;
    } catch {
      // Fall through to the public BlobRef fields.
    }
  }

  return object;
}

/**
 * Convert an AT Protocol BlobRef class or raw JSON blob into durable JSON.
 *
 * @atproto/api hydrates blobs as class instances containing a CID object and
 * an enumerable `original` field. IndexedDB structured cloning removes the
 * class serializer. Persisting that clone directly can consequently emit
 * `[object Object]` as the link and an out-of-schema `original` property.
 */
export function normalizeBlobRef(value: unknown): BlobRef {
  const candidate = blobCandidate(value);
  if (!candidate) throw new TypeError("Blob reference must be an object");

  const original = objectValue(candidate.original);
  const cid = cidString(candidate.ref) ?? cidString(original?.ref);
  if (!cid) throw new TypeError("Blob reference must contain a valid CID link");

  const mimeType = candidate.mimeType ?? original?.mimeType;
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    throw new TypeError("Blob reference must contain a MIME type");
  }

  const size = candidate.size ?? original?.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new TypeError("Blob reference must contain a non-negative integer size");
  }

  return {
    $type: "blob",
    ref: { $link: cid },
    mimeType,
    size,
  };
}

function looksLikeBlobRef(value: UnknownObject): boolean {
  const original = objectValue(value.original);
  return (
    value.$type === "blob" ||
    original?.$type === "blob" ||
    (value.constructor as { name?: unknown } | undefined)?.name === "BlobRef"
  );
}

/** Return a JSON-safe copy with every nested BlobRef in canonical wire form. */
export function normalizeRecordBlobRefs<T extends RepoRecord>(record: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    const object = objectValue(value);
    if (!object) return value;
    if (looksLikeBlobRef(object)) return normalizeBlobRef(object);
    return Object.fromEntries(Object.entries(object).map(([key, nested]) => [key, visit(nested)]));
  };

  return visit(record) as T;
}
