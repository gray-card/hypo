import type { CreateOperationRecord, JsonObject, SyncDatabase } from "./database.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

interface LegacyCreateOperation {
  id?: unknown;
  collection?: unknown;
  record?: unknown;
  tempUri?: unknown;
  queuedAt?: unknown;
}

export interface LegacyMigrationResult {
  sourceCount: number;
  importedCount: number;
  cleared: boolean;
  alreadyMigrated: boolean;
  malformed?: boolean;
}

export const legacyOutboxKey = (repo: string): string => `hypo:outbox:${repo || "anon"}`;

export const legacyMigrationKey = (repo: string): string => `migration:localstorage-outbox-v1:${repo || "anon"}`;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQueuedAt(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function convertLegacyOperation(
  value: LegacyCreateOperation,
  repo: string,
  now: number,
): CreateOperationRecord | undefined {
  if (typeof value.id !== "string" || typeof value.collection !== "string" || !isObject(value.record)) {
    return undefined;
  }

  const record: JsonObject = {
    ...value.record,
    $type: value.collection,
  };
  return {
    id: value.id,
    kind: "create",
    repo,
    collection: value.collection,
    record,
    tempUri: typeof value.tempUri === "string" ? value.tempUri : `outbox://${value.collection}/${value.id}`,
    status: "pending",
    createdAt: parseQueuedAt(value.queuedAt, now),
    attempts: 0,
    nextAttemptAt: 0,
  };
}

/**
 * Copies the localStorage v1 queue into IndexedDB, reads every copied id back,
 * and clears the source only after that count-verified handoff succeeds.
 */
export async function migrateLegacyOutbox(options: {
  database: SyncDatabase;
  storage: StorageLike;
  repo: string;
  now?: () => number;
}): Promise<LegacyMigrationResult> {
  const { database, storage, repo } = options;
  const sourceKey = legacyOutboxKey(repo);
  const markerKey = legacyMigrationKey(repo);
  const source = storage.getItem(sourceKey);
  const marker = await database.get("kv", markerKey);

  if (marker && source === null) {
    return {
      sourceCount: 0,
      importedCount: 0,
      cleared: true,
      alreadyMigrated: true,
    };
  }

  if (source === null) {
    await database.put("kv", {
      key: markerKey,
      value: { migratedAt: options.now?.() ?? Date.now(), count: 0 },
    });
    return {
      sourceCount: 0,
      importedCount: 0,
      cleared: true,
      alreadyMigrated: Boolean(marker),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {
      sourceCount: 0,
      importedCount: 0,
      cleared: false,
      alreadyMigrated: Boolean(marker),
      malformed: true,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      sourceCount: 0,
      importedCount: 0,
      cleared: false,
      alreadyMigrated: Boolean(marker),
      malformed: true,
    };
  }

  const now = options.now?.() ?? Date.now();
  const operations = parsed.map((value) => (isObject(value) ? convertLegacyOperation(value, repo, now) : undefined));
  if (operations.some((operation) => operation === undefined)) {
    return {
      sourceCount: parsed.length,
      importedCount: 0,
      cleared: false,
      alreadyMigrated: Boolean(marker),
      malformed: true,
    };
  }

  const converted = operations as CreateOperationRecord[];
  await database.putMany("ops", converted);
  const verified = await Promise.all(converted.map((operation) => database.get("ops", operation.id)));
  const verifiedIds = new Set(
    verified.flatMap((stored, index) => {
      const sourceOperation = converted[index];
      return stored?.id === sourceOperation.id &&
        stored.repo === sourceOperation.repo &&
        stored.collection === sourceOperation.collection &&
        stored.kind === "create"
        ? [stored.id]
        : [];
    }),
  );
  const importedCount = verifiedIds.size;
  if (importedCount !== parsed.length) {
    return {
      sourceCount: parsed.length,
      importedCount,
      cleared: false,
      alreadyMigrated: Boolean(marker),
    };
  }

  await database.put("kv", {
    key: markerKey,
    value: { migratedAt: now, count: importedCount },
  });
  let cleared = false;
  try {
    storage.removeItem(sourceKey);
    cleared = storage.getItem(sourceKey) === null;
  } catch {
    // The verified destination remains intact. A later migration attempt can
    // retry source cleanup without duplicating or losing operations.
  }
  return {
    sourceCount: parsed.length,
    importedCount,
    cleared,
    alreadyMigrated: Boolean(marker),
  };
}
