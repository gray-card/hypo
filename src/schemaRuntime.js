import { GEAR_CATALOG_FORM_META, GEAR_INSTANCE_FORM_META } from "@hypo/lexicon";
import { validateRecord } from "@hypo/lexicon/validators";
import { createSchemaRuntime } from "@hypo/schema-runtime";

export const PINNED_SCHEMA_VERSION = "lexicons-v1";

let runtimePromise;

const integerFieldsByCollection = new Map(
  [...Object.values(GEAR_CATALOG_FORM_META), ...Object.values(GEAR_INSTANCE_FORM_META)].map((metadata) => [
    metadata.nsid,
    new Set(metadata.fields.filter((field) => field.control === "integer").map((field) => field.key)),
  ]),
);

/**
 * Repair the string encoding emitted by Hypo's pre-1.3.4 generic gear form.
 * This is an encoding correction within the current schema, not a version
 * transition, so it intentionally happens before Panproto version decoding.
 */
export function normalizeLegacyFormEncoding(collection, value) {
  const integerFields = integerFieldsByCollection.get(collection);
  if (!integerFields || !value || typeof value !== "object" || Array.isArray(value)) return value;

  let normalized = value;
  for (const field of integerFields) {
    const current = value[field];
    if (typeof current !== "string" || !/^\d+$/.test(current.trim())) continue;
    const integer = Number(current);
    if (!Number.isSafeInteger(integer)) continue;
    if (normalized === value) normalized = { ...value };
    normalized[field] = integer;
  }
  return normalized;
}

export class InvalidRecordInputError extends Error {
  constructor(collection, issues) {
    super(
      "This record could not be saved because one or more fields has an invalid value. Review the form and try again.",
    );
    this.name = "InvalidRecordInputError";
    this.collection = collection;
    this.issues = issues;
  }
}

export function validateSchemaRecordForWrite(collection, record) {
  if (!collection.startsWith("app.graycard.")) return record;
  const candidate = record?.$type ? record : { ...record, $type: collection };
  const validation = validateRecord(collection, candidate);
  if (!validation.success) {
    console.error("Hypo refused an invalid record write", { collection, issues: validation.issues });
    throw new InvalidRecordInputError(collection, validation.issues);
  }
  return candidate;
}

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
  const value = normalizeLegacyFormEncoding(collection, record.value);
  const decoded = await (
    await runtime()
  ).decode(
    {
      recordUri: record.uri,
      cid: record.cid || "unversioned",
      collection,
    },
    value,
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

export async function decodeSchemaRecords(records, collection) {
  const results = await Promise.all(
    records.map(async (record) => {
      try {
        return { decoded: await decodeSchemaRecord(record, collection) };
      } catch (error) {
        console.error("Hypo skipped an unreadable record", { collection, uri: record.uri, error });
        return { error };
      }
    }),
  );
  const failures = results.filter((result) => result.error).length;
  if (failures) {
    globalThis.document?.dispatchEvent(
      new CustomEvent("hypo:schema-records-skipped", { detail: { collection, count: failures } }),
    );
  }
  return results.flatMap((result) => (result.decoded ? [result.decoded] : []));
}

export async function prepareSchemaWrite(collection, record, existing) {
  if (!collection.startsWith("app.graycard.")) return record;
  validateSchemaRecordForWrite(collection, record);
  if (!existing?.schemaRuntime) return record;
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
