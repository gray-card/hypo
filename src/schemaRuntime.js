import { validateRecord } from "@hypo/lexicon/validators";
import { createSchemaRuntime } from "@hypo/schema-runtime";

export const PINNED_SCHEMA_VERSION = "lexicons-v1";

let runtimePromise;

function runtime() {
  runtimePromise ??= createSchemaRuntime({
    pinnedVersion: PINNED_SCHEMA_VERSION,
    versions: [
      {
        id: PINNED_SCHEMA_VERSION,
        order: 1,
        validate: (collection, value) => {
          // Internal projections and legacy fixtures may omit $type. With no
          // on-record version signal, interpret them as the pinned app view.
          if (value && typeof value === "object" && !("$type" in value)) return true;
          return validateRecord(collection, value).success;
        },
      },
    ],
    // Released transitions are added here with their vendored schemas and
    // reviewed chain documents. Keeping the list empty is correct for v1.
    transitions: [],
  });
  return runtimePromise;
}

export async function decodeSchemaRecord(record, collection) {
  if (!collection.startsWith("app.graycard.")) return record;
  const decoded = await (
    await runtime()
  ).decode(
    {
      recordUri: record.uri,
      cid: record.cid || "unversioned",
      collection,
    },
    record.value,
  );
  return {
    ...record,
    value: decoded.value,
    schemaRuntime: {
      nativeVersion: decoded.nativeVersion,
      viewVersion: decoded.viewVersion,
      chainIds: decoded.chainIds,
    },
  };
}

// Hypo 1.5.0's generic resource form serialized one chemistry integer as a
// string. Keep this recovery deliberately narrow: only coerce known integer
// fields, and only accept the candidate when the complete current lexicon does.
// The caller may then swap-write this value with the original CID, preserving
// every unrelated field the user entered.
const KNOWN_INTEGER_WRITER_FIELDS = Object.freeze({
  "app.graycard.instance.chemistry": Object.freeze([
    "volumeMl",
    "volumeRemainingMl",
    "rollsProcessed",
    "sessionsUsed",
    "maxRollsRecommended",
  ]),
});

export function recoverKnownWriterRecord(collection, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = KNOWN_INTEGER_WRITER_FIELDS[collection];
  if (!fields) return null;
  const recovered = { ...value };
  const changed = [];
  for (const key of fields) {
    const current = recovered[key];
    if (typeof current !== "string" || !/^\s*\d+\s*$/.test(current)) continue;
    recovered[key] = Number.parseInt(current, 10);
    changed.push(key);
  }
  if (!changed.length || !validateRecord(collection, recovered).success) return null;
  return { value: recovered, changed };
}

export async function prepareSchemaWrite(collection, record, existing) {
  if (!existing?.schemaRuntime || !collection.startsWith("app.graycard.")) return record;
  try {
    return await (
      await runtime()
    ).prepareWrite({
      recordUri: existing.uri,
      cid: existing.cid || "unversioned",
      collection,
      value: existing.value,
      editedValue: record,
      ...existing.schemaRuntime,
    });
  } catch (error) {
    if (["ComplementFingerprintMismatch", "ComplementConflict"].includes(error?.name)) {
      globalThis.document?.dispatchEvent(new CustomEvent("hypo:complement-conflict", { detail: error }));
    }
    throw error;
  }
}
