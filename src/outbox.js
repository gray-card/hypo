// outbox.js: compatibility facade for the versioned @hypo/sync runtime.
//
// The shot logger historically used synchronous localStorage reads. Keep that
// surface as an immediate in-memory projection while @hypo/sync owns durable
// storage, verified legacy migration, retries, conflicts, and flush scheduling.

import {
  MemoryDatabase,
  Outbox,
  installFlushScheduler,
  legacyOutboxKey,
  openSyncDatabase,
  parseAtUri,
} from "@hypo/sync";
import { repoClient } from "./pds.js";

const runtimes = new Map();
const acknowledgementListeners = new Map();
let indexedDatabasePromise;
let browserOffline = false;

globalThis.window?.addEventListener("offline", () => {
  browserOffline = true;
});
globalThis.window?.addEventListener("online", () => {
  browserOffline = false;
});

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function storage() {
  try {
    const candidate = globalThis.localStorage || null;
    // Some privacy modes expose localStorage but throw from every operation.
    candidate?.getItem("hypo:storage-probe");
    return candidate;
  } catch {
    return null;
  }
}

function hasIndexedDatabase() {
  try {
    return Boolean(globalThis.indexedDB);
  } catch {
    return false;
  }
}

function databaseForRuntime() {
  if (!hasIndexedDatabase()) return Promise.resolve(new MemoryDatabase());
  indexedDatabasePromise ??= openSyncDatabase().catch(() => new MemoryDatabase());
  return indexedDatabasePromise;
}

function parseLegacy(repo) {
  const source = storage()?.getItem(legacyOutboxKey(repo));
  if (source === null || source === undefined) return [];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    const fallback = Date.now();
    return parsed.flatMap((value) => {
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.id !== "string" ||
        typeof value.collection !== "string" ||
        !value.record ||
        typeof value.record !== "object" ||
        Array.isArray(value.record)
      ) {
        return [];
      }
      const parsedTime = typeof value.queuedAt === "string" ? Date.parse(value.queuedAt) : NaN;
      const createdAt = Number.isFinite(parsedTime) ? parsedTime : fallback;
      return [
        {
          id: value.id,
          kind: "create",
          repo,
          collection: value.collection,
          record: { ...value.record, $type: value.record?.$type || value.collection },
          tempUri: typeof value.tempUri === "string" ? value.tempUri : `outbox://${value.collection}/${value.id}`,
          status: "pending",
          createdAt,
          attempts: 0,
          nextAttemptAt: 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

function compatibilityOperation(operation) {
  return {
    ...operation,
    queuedAt: new Date(operation.createdAt).toISOString(),
  };
}

function sortedOperations(runtime) {
  return [...runtime.operations.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map(compatibilityOperation);
}

function clientDelegate(runtime) {
  const client = () => {
    if (!runtime.agent) throw new TypeError("An authenticated atproto agent is required to flush the outbox");
    return repoClient(runtime.agent);
  };
  async function withConflictRecord(input, write) {
    try {
      return await write();
    } catch (error) {
      if (error?.name === "SwapConflict") {
        try {
          error.remote = await client().get({
            repo: input.repo,
            collection: input.collection,
            rkey: input.rkey,
          });
        } catch {
          // Preserve the original swap conflict when the follow-up read fails.
        }
      }
      throw error;
    }
  }

  return {
    create: (input) => client().create({ ...input, validate: false }),
    put: (input) => withConflictRecord(input, () => client().put({ ...input, validate: false })),
    delete: (input) => withConflictRecord(input, () => client().delete(input)),
  };
}

function memoryMarkerKey(repo) {
  return `hypo:sync-memory-runtime:${repo || "anon"}`;
}

function createRuntime(repo) {
  const operations = new Map(parseLegacy(repo).map((operation) => [operation.id, operation]));
  const lastCreatedAt = Math.max(0, ...[...operations.values()].map((operation) => operation.createdAt));
  const runtime = {
    repo,
    agent: null,
    operations,
    acknowledgements: new Map(),
    lastCreatedAt,
    outbox: null,
    mutationTail: Promise.resolve(),
    memoryOnly: !hasIndexedDatabase(),
    memoryToken: newId(),
    memoryMarkerInstalled: false,
  };

  if (runtime.memoryOnly) {
    try {
      const legacyStorage = storage();
      legacyStorage?.setItem(memoryMarkerKey(repo), runtime.memoryToken);
      runtime.memoryMarkerInstalled = legacyStorage?.getItem(memoryMarkerKey(repo)) === runtime.memoryToken;
    } catch {
      // The MemoryDatabase remains usable when localStorage is unavailable.
    }
  }

  runtime.ready = databaseForRuntime().then(async (database) => {
    const outbox = new Outbox({
      database,
      client: clientDelegate(runtime),
      repo,
      isOnline,
      onAcknowledged: async (acknowledgement) => {
        runtime.acknowledgements.set(acknowledgement.operation.id, acknowledgement);
        runtime.operations.delete(acknowledgement.operation.id);
        for (const listener of acknowledgementListeners.get(repo) || []) {
          try {
            await listener(acknowledgement);
          } catch (error) {
            console.warn("Acknowledged write projection could not update:", error?.message || error);
          }
        }
      },
    });
    runtime.outbox = outbox;
    const legacyStorage = storage();
    if (legacyStorage) await outbox.migrate(legacyStorage);

    const durable = await outbox.list();
    const merged = new Map(durable.map((operation) => [operation.id, operation]));
    // Synchronous facade calls may have added operations while IndexedDB was
    // opening. Their queued mutations run immediately after this handoff.
    for (const operation of runtime.operations.values()) {
      if (!merged.has(operation.id)) merged.set(operation.id, operation);
    }
    runtime.operations = merged;
    return outbox;
  });
  runtime.mutationTail = runtime.ready.then(() => undefined);
  return runtime;
}

function runtimeFor(repo) {
  let runtime = runtimes.get(repo);
  let memoryToken;
  try {
    memoryToken = storage()?.getItem(memoryMarkerKey(repo));
  } catch {
    memoryToken = runtime?.memoryToken;
  }
  if (runtime?.memoryOnly && runtime.memoryMarkerInstalled && memoryToken !== runtime.memoryToken) {
    // MemoryDatabase is the non-browser/test fallback. An explicit storage
    // clear represents a fresh page in that environment.
    runtimes.delete(repo);
    runtime = undefined;
  }
  if (!runtime) {
    runtime = createRuntime(repo);
    runtimes.set(repo, runtime);
  }
  return runtime;
}

function scheduleMutation(runtime, mutation) {
  const scheduled = runtime.mutationTail.then(() => mutation(runtime.outbox));
  runtime.mutationTail = scheduled.catch(() => undefined);
  return scheduled;
}

function operationMetadata(runtime, collection, options = {}) {
  const explicit = Number.isFinite(options.createdAt) ? options.createdAt : null;
  const createdAt = explicit ?? Math.max(Date.now(), runtime.lastCreatedAt + 1);
  runtime.lastCreatedAt = Math.max(runtime.lastCreatedAt, createdAt);
  return {
    id: typeof options.id === "string" && options.id ? options.id : newId(),
    repo: runtime.repo,
    collection,
    status: "pending",
    createdAt,
    attempts: 0,
    nextAttemptAt: 0,
  };
}

function remember(runtime, operation) {
  runtime.operations.set(operation.id, operation);
  return compatibilityOperation(operation);
}

// Queue a create and return its optimistic operation immediately.
export function enqueue(did, collection, record, options = {}) {
  const runtime = runtimeFor(did);
  const metadata = operationMetadata(runtime, collection, options);
  const operation = {
    ...metadata,
    kind: "create",
    record: { ...record, $type: record.$type || collection },
    ...(options.rkey ? { rkey: options.rkey } : {}),
    tempUri: `outbox://${collection}/${metadata.id}`,
  };
  remember(runtime, operation);
  scheduleMutation(runtime, (outbox) =>
    outbox.enqueueCreate({
      collection,
      record,
      rkey: options.rkey,
      id: metadata.id,
      createdAt: metadata.createdAt,
    }),
  ).catch(() => runtime.operations.delete(operation.id));
  return compatibilityOperation(operation);
}

function normalizePutInput(uriOrInput, record, swapRecord, options) {
  return typeof uriOrInput === "object" && uriOrInput !== null
    ? uriOrInput
    : { ...options, uri: uriOrInput, record, swapRecord };
}

// Queue a swap-protected update. The object form matches Outbox.enqueuePut;
// positional arguments keep this facade convenient for plain-JS callers.
export function enqueuePut(did, uriOrInput, record, swapRecord, options = {}) {
  const input = normalizePutInput(uriOrInput, record, swapRecord, options);
  const parsed = parseAtUri(input.uri);
  const collection = input.collection || parsed?.collection;
  const rkey = input.rkey || parsed?.rkey;
  if (!collection || !rkey || typeof input.swapRecord !== "string") {
    throw new TypeError("A put needs an AT URI (or collection/rkey) and swapRecord");
  }
  const runtime = runtimeFor(did);
  const metadata = operationMetadata(runtime, collection, input);
  const operation = {
    ...metadata,
    kind: "put",
    uri: input.uri,
    rkey,
    record: { ...input.record, $type: input.record.$type || collection },
    swapRecord: input.swapRecord,
  };
  remember(runtime, operation);
  scheduleMutation(runtime, (outbox) =>
    outbox.enqueuePut({ ...input, collection, rkey, id: metadata.id, createdAt: metadata.createdAt }),
  ).catch(() => runtime.operations.delete(operation.id));
  return compatibilityOperation(operation);
}

function normalizeDeleteInput(uriOrInput, swapRecord, options) {
  return typeof uriOrInput === "object" && uriOrInput !== null
    ? uriOrInput
    : { ...options, uri: uriOrInput, swapRecord };
}

export function enqueueDelete(did, uriOrInput, swapRecord, options = {}) {
  const input = normalizeDeleteInput(uriOrInput, swapRecord, options);
  const parsed = parseAtUri(input.uri);
  const collection = input.collection || parsed?.collection;
  const rkey = input.rkey || parsed?.rkey;
  if (!collection || !rkey) throw new TypeError("A delete needs an AT URI or explicit collection and rkey");
  const runtime = runtimeFor(did);
  const metadata = operationMetadata(runtime, collection, input);
  const operation = {
    ...metadata,
    kind: "delete",
    uri: input.uri,
    rkey,
    ...(input.swapRecord ? { swapRecord: input.swapRecord } : {}),
  };
  remember(runtime, operation);
  scheduleMutation(runtime, (outbox) =>
    outbox.enqueueDelete({ ...input, collection, rkey, id: metadata.id, createdAt: metadata.createdAt }),
  ).catch(() => runtime.operations.delete(operation.id));
  return compatibilityOperation(operation);
}

// Synchronous compatibility snapshot. New integrations can await list() below
// when they need to guarantee IndexedDB hydration has completed.
export function loadOutbox(did) {
  return sortedOperations(runtimeFor(did));
}

export function pending(did, collection) {
  return loadOutbox(did).filter(
    (operation) => operation.status === "pending" && (!collection || operation.collection === collection),
  );
}

export function pendingCount(did) {
  return pending(did).length;
}

export async function list(did, options = {}) {
  const runtime = runtimeFor(did);
  await runtime.mutationTail;
  const normalized = typeof options === "string" ? { collection: options } : options;
  const operations = await runtime.outbox.list(normalized);
  if (normalized.collection || normalized.status) {
    for (const operation of operations) runtime.operations.set(operation.id, operation);
  } else {
    runtime.operations = new Map(operations.map((operation) => [operation.id, operation]));
  }
  return operations.map(compatibilityOperation);
}

/** Subscribe to durable write acknowledgements for one repository. */
export function subscribeAcknowledgements(did, listener) {
  let listeners = acknowledgementListeners.get(did);
  if (!listeners) {
    listeners = new Set();
    acknowledgementListeners.set(did, listeners);
  }
  listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
    if (!listeners.size) acknowledgementListeners.delete(did);
  };
}

export function remove(did, id) {
  const runtime = runtimeFor(did);
  runtime.operations.delete(id);
  return scheduleMutation(runtime, (outbox) => outbox.discard(id)).catch(() => false);
}

export async function conflicts(did) {
  const runtime = runtimeFor(did);
  await runtime.mutationTail;
  return (await runtime.outbox.conflicts()).map(compatibilityOperation);
}

export async function rebaseConflict(did, id, update) {
  const runtime = runtimeFor(did);
  await runtime.mutationTail;
  const operation = await runtime.outbox.rebaseConflict(id, update);
  runtime.operations.set(operation.id, operation);
  return compatibilityOperation(operation);
}

export function isOnline() {
  return !browserOffline && (typeof navigator === "undefined" || navigator.onLine !== false);
}

async function refreshProjection(runtime) {
  const operations = await runtime.outbox.list();
  runtime.operations = new Map(operations.map((operation) => [operation.id, operation]));
}

export async function flush(agent, did) {
  const runtime = runtimeFor(did);
  runtime.agent = agent;
  await runtime.mutationTail;
  const result = await runtime.outbox.flush();
  await refreshProjection(runtime);
  if (!result.failed) return result;
  const failed = [...runtime.operations.values()].find((operation) => operation.lastError);
  return { ...result, error: failed?.lastError?.message };
}

// Flush one newly queued operation and report whether it was acknowledged or
// remains durable. Offline operations intentionally resolve without throwing;
// transport failures throw, while stale swaps remain parked for the tray.
export async function flushOperation(agent, did, id) {
  const runtime = runtimeFor(did);
  const result = await flush(agent, did);
  const operation = runtime.operations.get(id);
  const acknowledgement = runtime.acknowledgements.get(id);
  if (operation?.status === "conflict") {
    const error = new Error(operation.conflict?.message || operation.lastError?.message || "Record needs attention");
    error.name = "SwapConflict";
    error.operationId = id;
    throw error;
  }
  if (operation?.lastError && !result.offline) {
    const error = new Error(operation.lastError.message);
    error.name = operation.lastError.name || "Error";
    error.operationId = id;
    throw error;
  }
  return { result, operation: operation ? compatibilityOperation(operation) : null, acknowledgement };
}

// Register enqueue, connectivity, visibility, startup, and interval flushes.
export function installAutoFlush(agent, did, onFlushed) {
  const runtime = runtimeFor(did);
  runtime.agent = agent;
  let disposed = false;
  let disposeScheduler = () => {};
  let reconnectPending = !isOnline();
  const onOffline = () => {
    reconnectPending = true;
  };
  globalThis.window?.addEventListener("offline", onOffline);
  runtime.mutationTail.then(() => {
    if (disposed) return;
    disposeScheduler = installFlushScheduler(runtime.outbox, {
      onFlushed: async (result) => {
        await refreshProjection(runtime);
        if (result.sent && reconnectPending) {
          reconnectPending = false;
          onFlushed?.(result);
        }
      },
    });
  });
  return () => {
    disposed = true;
    globalThis.window?.removeEventListener("offline", onOffline);
    disposeScheduler();
  };
}
