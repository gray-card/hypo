import type {
  CreateOperationRecord,
  DatabaseMutation,
  DeleteOperationRecord,
  JsonObject,
  OperationRecord,
  PutOperationRecord,
  SyncDatabase,
} from "./database.ts";
import { migrateLegacyOutbox, type LegacyMigrationResult, type StorageLike } from "./migration.ts";

export interface RepoWriteResponse {
  uri: string;
  cid: string;
}

type MaybeNestedWriteResponse =
  | RepoWriteResponse
  | { data: RepoWriteResponse }
  | { uri?: string; cid?: string; data?: { uri?: string; cid?: string } };

/** The sync package receives an authenticated client; it never owns a session. */
export interface RepoClient {
  create(input: {
    repo: string;
    collection: string;
    record: JsonObject;
    rkey?: string;
  }): Promise<MaybeNestedWriteResponse>;
  put(input: {
    repo: string;
    collection: string;
    rkey: string;
    record: JsonObject;
    swapRecord: string;
  }): Promise<MaybeNestedWriteResponse>;
  delete(input: { repo: string; collection: string; rkey: string; swapRecord?: string }): Promise<unknown>;
}

export interface LockLike {
  readonly name?: string;
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: LockLike | null) => Promise<T> | T,
  ): Promise<T>;
}

export interface CreateOperationInput {
  collection: string;
  record: JsonObject;
  rkey?: string;
  id?: string;
  createdAt?: number;
}

export interface PutOperationInput {
  uri: string;
  record: JsonObject;
  swapRecord: string;
  collection?: string;
  rkey?: string;
  id?: string;
  createdAt?: number;
}

export interface DeleteOperationInput {
  uri: string;
  swapRecord?: string;
  collection?: string;
  rkey?: string;
  id?: string;
  createdAt?: number;
}

export interface Acknowledgement {
  operation: OperationRecord;
  uri?: string;
  cid?: string;
  tempUri?: string;
}

export interface UriAcknowledgement {
  tempUri: string;
  uri: string;
  cid: string;
  acknowledgedAt: number;
}

export interface FlushResult {
  sent: number;
  failed: number;
  conflicts: number;
  deferred: number;
  left: number;
  offline?: true;
  locked?: true;
}

export type Backoff = (attempts: number, operation: OperationRecord) => number;

export interface OutboxOptions {
  database: SyncDatabase;
  client: RepoClient;
  repo: string;
  now?: () => number;
  randomId?: () => string;
  isOnline?: () => boolean;
  locks?: LockManagerLike | null;
  backoff?: Backoff;
  onAcknowledged?: (acknowledgement: Acknowledgement) => void | Promise<void>;
  onConflict?: (operation: PutOperationRecord | DeleteOperationRecord) => void | Promise<void>;
}

export const uriAcknowledgementKey = (tempUri: string): string => `ack:temp-uri:${tempUri}`;

export function defaultBackoff(attempts: number): number {
  return Math.min(300_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

function defaultRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function defaultLocks(): LockManagerLike | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks as unknown as LockManagerLike;
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function isSwapConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; kind?: unknown };
  return [candidate.name, candidate.code, candidate.kind].some(
    (value) => typeof value === "string" && /swap.?conflict/i.test(value),
  );
}

function conflictRemote(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    remote?: unknown;
    currentRecord?: unknown;
    data?: { record?: unknown };
  };
  return candidate.remote ?? candidate.currentRecord ?? candidate.data?.record;
}

export interface ParsedAtUri {
  repo: string;
  collection: string;
  rkey: string;
}

export function parseAtUri(uri: string): ParsedAtUri | undefined {
  if (!uri.startsWith("at://")) return undefined;
  const [repo, collection, ...rkeyParts] = uri.slice(5).split("/");
  if (!repo || !collection || rkeyParts.length === 0) return undefined;
  const rkey = rkeyParts.join("/");
  if (!rkey) return undefined;
  return { repo, collection, rkey };
}

function writeResponse(result: MaybeNestedWriteResponse): RepoWriteResponse {
  const direct = result as { uri?: unknown; cid?: unknown };
  const nested = (result as { data?: { uri?: unknown; cid?: unknown } }).data;
  const uri = direct.uri ?? nested?.uri;
  const cid = direct.cid ?? nested?.cid;
  if (typeof uri !== "string" || typeof cid !== "string") {
    throw new TypeError("PDS write response did not include a uri and cid");
  }
  return { uri, cid };
}

function operationLocation(input: { uri: string; collection?: string; rkey?: string }): {
  collection: string;
  rkey: string;
} {
  const parsed = parseAtUri(input.uri);
  const collection = input.collection ?? parsed?.collection;
  const rkey = input.rkey ?? parsed?.rkey;
  if (!collection || !rkey) {
    throw new TypeError("A put/delete needs an AT URI or explicit collection and rkey");
  }
  return { collection, rkey };
}

function operationFollows(candidate: OperationRecord, acknowledged: OperationRecord): boolean {
  return (
    candidate.createdAt > acknowledged.createdAt ||
    (candidate.createdAt === acknowledged.createdAt && candidate.id.localeCompare(acknowledged.id) > 0)
  );
}

function rewriteJsonReference(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const rewritten = rewriteJsonReference(item, from, to);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? result : value;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const rewritten = rewriteJsonReference(item, from, to);
    if (rewritten !== item) changed = true;
    result[key] = rewritten;
  }
  return changed ? result : value;
}

function rewriteQueuedDependency(
  operation: OperationRecord,
  from: string,
  to: string,
  location: ReturnType<typeof parseAtUri>,
): OperationRecord {
  if (operation.kind === "create") {
    const record = rewriteJsonReference(operation.record, from, to) as JsonObject;
    return record === operation.record ? operation : { ...operation, record };
  }
  if (operation.kind === "put") {
    const record = rewriteJsonReference(operation.record, from, to) as JsonObject;
    const targetChanged = operation.uri === from && Boolean(location);
    if (record === operation.record && !targetChanged) return operation;
    return {
      ...operation,
      record,
      ...(targetChanged ? { uri: to, collection: location!.collection, rkey: location!.rkey } : {}),
    };
  }
  if (operation.uri !== from || !location) return operation;
  return { ...operation, uri: to, collection: location.collection, rkey: location.rkey };
}

function pendingMetadata(
  id: string,
  repo: string,
  collection: string,
  now: number,
): Pick<OperationRecord, "id" | "repo" | "collection" | "status" | "createdAt" | "attempts" | "nextAttemptAt"> {
  return {
    id,
    repo,
    collection,
    status: "pending",
    createdAt: now,
    attempts: 0,
    nextAttemptAt: 0,
  };
}

export class Outbox {
  private readonly database: SyncDatabase;
  private readonly client: RepoClient;
  readonly repo: string;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly online: () => boolean;
  private readonly locks: LockManagerLike | null;
  private readonly backoff: Backoff;
  private readonly onAcknowledged?: OutboxOptions["onAcknowledged"];
  private readonly onConflict?: OutboxOptions["onConflict"];
  private readonly enqueueListeners = new Set<(operation: OperationRecord) => void>();
  private activeFlush?: Promise<FlushResult>;

  constructor(options: OutboxOptions) {
    this.database = options.database;
    this.client = options.client;
    this.repo = options.repo;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? defaultRandomId;
    this.online = options.isOnline ?? defaultIsOnline;
    this.locks = options.locks === undefined ? defaultLocks() : options.locks;
    this.backoff = options.backoff ?? defaultBackoff;
    this.onAcknowledged = options.onAcknowledged;
    this.onConflict = options.onConflict;
  }

  isOnline(): boolean {
    return this.online();
  }

  async migrate(storage: StorageLike): Promise<LegacyMigrationResult> {
    return migrateLegacyOutbox({
      database: this.database,
      storage,
      repo: this.repo,
      now: this.now,
    });
  }

  subscribeEnqueue(listener: (operation: OperationRecord) => void): () => void {
    this.enqueueListeners.add(listener);
    return () => this.enqueueListeners.delete(listener);
  }

  private notifyEnqueue(operation: OperationRecord): void {
    for (const listener of this.enqueueListeners) listener(operation);
  }

  async enqueueCreate(input: CreateOperationInput): Promise<CreateOperationRecord> {
    const id = input.id ?? this.randomId();
    const operation: CreateOperationRecord = {
      ...pendingMetadata(id, this.repo, input.collection, input.createdAt ?? this.now()),
      kind: "create",
      record: { ...input.record, $type: input.record.$type || input.collection },
      rkey: input.rkey,
      tempUri: `outbox://${input.collection}/${id}`,
    };
    await this.database.put("ops", operation);
    this.notifyEnqueue(operation);
    return operation;
  }

  async enqueuePut(input: PutOperationInput): Promise<PutOperationRecord> {
    const location = operationLocation(input);
    const id = input.id ?? this.randomId();
    const operation: PutOperationRecord = {
      ...pendingMetadata(id, this.repo, location.collection, input.createdAt ?? this.now()),
      kind: "put",
      uri: input.uri,
      rkey: location.rkey,
      record: { ...input.record, $type: input.record.$type || location.collection },
      swapRecord: input.swapRecord,
    };
    await this.database.put("ops", operation);
    this.notifyEnqueue(operation);
    return operation;
  }

  async enqueueDelete(input: DeleteOperationInput): Promise<DeleteOperationRecord> {
    const location = operationLocation(input);
    const id = input.id ?? this.randomId();
    const operation: DeleteOperationRecord = {
      ...pendingMetadata(id, this.repo, location.collection, input.createdAt ?? this.now()),
      kind: "delete",
      uri: input.uri,
      rkey: location.rkey,
      swapRecord: input.swapRecord,
    };
    await this.database.put("ops", operation);
    this.notifyEnqueue(operation);
    return operation;
  }

  async list(
    options: {
      collection?: string;
      status?: OperationRecord["status"];
    } = {},
  ): Promise<OperationRecord[]> {
    const operations = await this.database.getAll("ops");
    return operations
      .filter(
        (operation) =>
          operation.repo === this.repo &&
          (!options.collection || operation.collection === options.collection) &&
          (!options.status || operation.status === options.status),
      )
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  async pendingCount(): Promise<number> {
    return (await this.list({ status: "pending" })).length;
  }

  async conflicts(): Promise<Array<PutOperationRecord | DeleteOperationRecord>> {
    return (await this.list({ status: "conflict" })).filter(
      (operation): operation is PutOperationRecord | DeleteOperationRecord =>
        operation.kind === "put" || operation.kind === "delete",
    );
  }

  async discard(id: string): Promise<boolean> {
    const operation = await this.database.get("ops", id);
    if (!operation || operation.repo !== this.repo) return false;
    await this.database.delete("ops", id);
    return true;
  }

  async rebaseConflict(
    id: string,
    update: { swapRecord?: string; record?: JsonObject } = {},
  ): Promise<PutOperationRecord | DeleteOperationRecord> {
    const operation = await this.database.get("ops", id);
    if (!operation || operation.repo !== this.repo || operation.status !== "conflict" || operation.kind === "create") {
      throw new TypeError(`Operation ${id} is not a parked conflict`);
    }

    const rebased = {
      ...operation,
      ...(operation.kind === "put" && update.record
        ? { record: { ...update.record, $type: update.record.$type || operation.collection } }
        : {}),
      ...(update.swapRecord !== undefined ? { swapRecord: update.swapRecord } : {}),
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: 0,
      lastAttemptAt: undefined,
      lastError: undefined,
      conflict: undefined,
    };
    await this.database.put("ops", rebased);
    this.notifyEnqueue(rebased);
    return rebased;
  }

  async acknowledgedUri(tempUri: string): Promise<UriAcknowledgement | undefined> {
    const record = await this.database.get("kv", uriAcknowledgementKey(tempUri));
    return record?.value as UriAcknowledgement | undefined;
  }

  flush(): Promise<FlushResult> {
    if (this.activeFlush) return this.activeFlush;
    const flush = this.flushWithLock().finally(() => {
      if (this.activeFlush === flush) this.activeFlush = undefined;
    });
    this.activeFlush = flush;
    return flush;
  }

  private async emptyResult(extra: Partial<FlushResult> = {}): Promise<FlushResult> {
    return {
      sent: 0,
      failed: 0,
      conflicts: 0,
      deferred: 0,
      left: (await this.list()).length,
      ...extra,
    };
  }

  private async flushWithLock(): Promise<FlushResult> {
    if (!this.online()) return this.emptyResult({ offline: true });
    if (!this.locks) return this.flushUnlocked();

    return this.locks.request(`hypo:outbox-v2:${this.repo}`, { mode: "exclusive", ifAvailable: true }, async (lock) =>
      lock ? this.flushUnlocked() : this.emptyResult({ locked: true }),
    );
  }

  private async flushUnlocked(): Promise<FlushResult> {
    const operations = await this.list();
    let sent = 0;
    let failed = 0;
    let conflicts = 0;
    let deferred = 0;

    for (const listed of operations) {
      // A preceding create may have atomically rewritten this queued operation
      // from a temp URI while the current flush was in progress.
      const stored = await this.database.get("ops", listed.id);
      if (!stored || stored.repo !== this.repo) continue;
      if (stored.status === "conflict") continue;
      if (stored.nextAttemptAt > this.now()) {
        deferred += 1;
        continue;
      }

      const operation = await this.resolveAcknowledgedUri(stored);
      try {
        const acknowledgement = await this.send(operation);
        await this.acknowledge(operation, acknowledgement);
        sent += 1;
      } catch (error) {
        const attempted = operation.attempts + 1;
        const lastError = serializeError(error);
        const lastAttemptAt = this.now();
        if (operation.kind !== "create" && isSwapConflict(error)) {
          const parked = {
            ...operation,
            status: "conflict" as const,
            attempts: attempted,
            lastAttemptAt,
            lastError,
            conflict: {
              message: lastError.message,
              remote: conflictRemote(error),
            },
          };
          await this.database.put("ops", parked);
          await this.onConflict?.(parked);
          conflicts += 1;
        } else {
          await this.database.put("ops", {
            ...operation,
            attempts: attempted,
            lastAttemptAt,
            lastError,
            nextAttemptAt: lastAttemptAt + this.backoff(attempted, operation),
          });
          failed += 1;
          // Preserve FIFO ordering after a transport failure. In particular, a
          // dependent operation must not overtake a create whose URI it needs.
          break;
        }
      }
    }

    return {
      sent,
      failed,
      conflicts,
      deferred,
      left: (await this.list()).length,
    };
  }

  private async resolveAcknowledgedUri(operation: OperationRecord): Promise<OperationRecord> {
    if (operation.kind === "create" || !operation.uri.startsWith("outbox://")) return operation;
    const acknowledgement = await this.acknowledgedUri(operation.uri);
    if (!acknowledgement) return operation;
    const parsed = parseAtUri(acknowledgement.uri);
    if (!parsed) return operation;
    const resolved = {
      ...operation,
      uri: acknowledgement.uri,
      collection: parsed.collection,
      rkey: parsed.rkey,
    };
    await this.database.put("ops", resolved);
    return resolved;
  }

  private async send(operation: OperationRecord): Promise<RepoWriteResponse | undefined> {
    switch (operation.kind) {
      case "create":
        return writeResponse(
          await this.client.create({
            repo: operation.repo,
            collection: operation.collection,
            record: operation.record,
            rkey: operation.rkey,
          }),
        );
      case "put":
        return writeResponse(
          await this.client.put({
            repo: operation.repo,
            collection: operation.collection,
            rkey: operation.rkey,
            record: operation.record,
            swapRecord: operation.swapRecord,
          }),
        );
      case "delete":
        await this.client.delete({
          repo: operation.repo,
          collection: operation.collection,
          rkey: operation.rkey,
          swapRecord: operation.swapRecord,
        });
        return undefined;
    }
  }

  private async acknowledge(operation: OperationRecord, response: RepoWriteResponse | undefined): Promise<void> {
    if (operation.kind !== "create") {
      const acknowledgedAt = this.now();
      const mutations: DatabaseMutation[] = [{ type: "delete", store: "ops", key: operation.id }];
      if (operation.kind === "put") {
        mutations.push({
          type: "put",
          store: "records",
          value: {
            uri: operation.uri,
            cid: response?.cid ?? operation.swapRecord,
            repo: operation.repo,
            collection: operation.collection,
            record: operation.record,
            updatedAt: acknowledgedAt,
          },
        });
      } else {
        mutations.push({ type: "delete", store: "records", key: operation.uri });
      }
      await this.database.batch(mutations);
      await this.onAcknowledged?.({
        operation,
        uri: response?.uri ?? (operation.kind === "put" ? operation.uri : undefined),
        cid: response?.cid,
      });
      return;
    }

    if (!response) throw new TypeError("Create acknowledgement is missing");
    const acknowledgedAt = this.now();
    const acknowledgement: UriAcknowledgement = {
      tempUri: operation.tempUri,
      uri: response.uri,
      cid: response.cid,
      acknowledgedAt,
    };
    const mutations: DatabaseMutation[] = [
      {
        type: "put",
        store: "kv",
        value: { key: uriAcknowledgementKey(operation.tempUri), value: acknowledgement },
      },
      { type: "delete", store: "ops", key: operation.id },
    ];

    const parsed = parseAtUri(response.uri);
    const allOperations = await this.database.getAll("ops");
    for (const dependent of allOperations) {
      if (
        dependent.id === operation.id ||
        dependent.repo !== operation.repo ||
        dependent.status !== "pending" ||
        !operationFollows(dependent, operation)
      ) {
        continue;
      }
      const rewritten = rewriteQueuedDependency(dependent, operation.tempUri, response.uri, parsed);
      if (rewritten !== dependent) mutations.push({ type: "put", store: "ops", value: rewritten });
    }

    if (parsed) {
      const cached = await this.database.get("records", operation.tempUri);
      if (cached) mutations.push({ type: "delete", store: "records", key: operation.tempUri });
      mutations.push({
        type: "put",
        store: "records",
        value: {
          uri: response.uri,
          cid: response.cid,
          repo: operation.repo,
          collection: operation.collection,
          record: cached?.record ?? operation.record,
          updatedAt: acknowledgedAt,
        },
      });
    }

    await this.database.batch(mutations);
    await this.onAcknowledged?.({
      operation,
      uri: response.uri,
      cid: response.cid,
      tempUri: operation.tempUri,
    });
  }
}

export interface CreateOutboxOptions extends OutboxOptions {
  legacyStorage?: StorageLike | null;
}

/** Creates an outbox and completes the v1 handoff before returning it. */
export async function createOutbox(options: CreateOutboxOptions): Promise<Outbox> {
  const outbox = new Outbox(options);
  if (options.legacyStorage) await outbox.migrate(options.legacyStorage);
  return outbox;
}
