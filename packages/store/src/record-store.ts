import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import {
  parseAtUri,
  type Acknowledgement,
  type CachedRecord,
  type DeleteOperationRecord,
  type JsonObject,
  type OperationRecord,
  type PutOperationRecord,
} from "@hypo/sync";

import type { StoredRecord } from "./collection.ts";

export interface RemoteStoredRecord<T = unknown> extends StoredRecord<T> {
  readonly collection: string;
  readonly repo?: string;
}

export type RemoteRecordInput<T = unknown> = RemoteStoredRecord<T> | CachedRecord;

export interface RecordStoreOptions {
  /** Limit the store to operations and cached records for one repository. */
  repo?: string;
  remote?: Iterable<RemoteRecordInput>;
  operations?: Iterable<OperationRecord>;
  /**
   * The remote-cache decode boundary. Schema-version lifting can be installed
   * here without changing optimistic overlay or selector code.
   */
  decode?: (record: CachedRecord) => unknown;
}

export interface OptimisticOverlayOptions {
  /** Parked conflicts retain the user's local intent by default. */
  includeConflicts?: boolean;
}

type CollectionMap = ReadonlyMap<string, StoredRecord<unknown>>;
type CollectionIndex = ReadonlyMap<string, CollectionMap>;

const EMPTY_COLLECTION: CollectionMap = new Map();

function operationOrder(left: OperationRecord, right: OperationRecord): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function orderedOperations(operations: Iterable<OperationRecord>): OperationRecord[] {
  return [...operations].sort(operationOrder);
}

export function selectPendingOperations(
  operations: Iterable<OperationRecord>,
  collection?: string,
): readonly OperationRecord[] {
  return orderedOperations(operations).filter(
    (operation) => operation.status === "pending" && (!collection || operation.collection === collection),
  );
}

export function selectConflictOperations(
  operations: Iterable<OperationRecord>,
  collection?: string,
): readonly (PutOperationRecord | DeleteOperationRecord)[] {
  return orderedOperations(operations).filter(
    (operation): operation is PutOperationRecord | DeleteOperationRecord =>
      operation.status === "conflict" &&
      operation.kind !== "create" &&
      (!collection || operation.collection === collection),
  );
}

/** Apply queued writes in enqueue order to one remote collection snapshot. */
export function applyOptimisticOverlay(
  remote: ReadonlyMap<string, StoredRecord<unknown>>,
  operations: Iterable<OperationRecord>,
  options: OptimisticOverlayOptions = {},
): ReadonlyMap<string, StoredRecord<unknown>> {
  const next = new Map(remote);
  const includeConflicts = options.includeConflicts ?? true;

  for (const operation of orderedOperations(operations)) {
    if (operation.status === "conflict" && !includeConflicts) continue;
    switch (operation.kind) {
      case "create":
        next.set(operation.tempUri, {
          uri: operation.tempUri,
          value: operation.record,
        });
        break;
      case "put": {
        const current = next.get(operation.uri);
        next.set(operation.uri, {
          uri: operation.uri,
          cid: current?.cid ?? operation.swapRecord,
          value: operation.record,
        });
        break;
      }
      case "delete":
        next.delete(operation.uri);
        break;
    }
  }

  return next;
}

/**
 * A signal-backed record cache. Remote state is held separately from outbox
 * operations so refreshing a collection cannot erase optimistic writes.
 */
export class RecordStore {
  readonly repo?: string;
  readonly operations: ReadonlySignal<readonly OperationRecord[]>;
  readonly pending: ReadonlySignal<readonly OperationRecord[]>;
  readonly conflicts: ReadonlySignal<readonly (PutOperationRecord | DeleteOperationRecord)[]>;
  readonly pendingCount: ReadonlySignal<number>;
  readonly conflictCount: ReadonlySignal<number>;
  readonly collections: ReadonlySignal<ReadonlyMap<string, CollectionMap>>;

  private readonly decode: (record: CachedRecord) => unknown;
  private readonly remoteState: Signal<CollectionIndex>;
  private readonly operationState: Signal<readonly OperationRecord[]>;
  private readonly collectionSignals = new Map<string, ReadonlySignal<CollectionMap>>();

  constructor(options: RecordStoreOptions = {}) {
    this.repo = options.repo;
    this.decode = options.decode ?? ((record) => record.record);
    this.remoteState = signal<CollectionIndex>(this.buildRemoteIndex(options.remote ?? []));
    this.operationState = signal<readonly OperationRecord[]>(this.scopeOperations(options.operations ?? []));
    this.operations = this.operationState;
    this.pending = computed(() => selectPendingOperations(this.operationState.value));
    this.conflicts = computed(() => selectConflictOperations(this.operationState.value));
    this.pendingCount = computed(() => this.pending.value.length);
    this.conflictCount = computed(() => this.conflicts.value.length);
    this.collections = computed(() => {
      const remote = this.remoteState.value;
      const operations = this.operationState.value;
      const names = new Set(remote.keys());
      for (const operation of operations) names.add(operation.collection);

      const result = new Map<string, CollectionMap>();
      for (const collection of names) {
        result.set(
          collection,
          applyOptimisticOverlay(
            remote.get(collection) ?? EMPTY_COLLECTION,
            operations.filter((operation) => operation.collection === collection),
          ),
        );
      }
      return result;
    });
  }

  /** Return a stable signal for one collection's remote-plus-outbox view. */
  collection<T = unknown>(collection: string): ReadonlySignal<ReadonlyMap<string, StoredRecord<T>>> {
    let selected = this.collectionSignals.get(collection);
    if (!selected) {
      let previousRemote: CollectionMap | undefined;
      let previousOperations: readonly OperationRecord[] = [];
      let previousResult: CollectionMap = EMPTY_COLLECTION;
      selected = computed(() => {
        const remote = this.remoteState.value.get(collection) ?? EMPTY_COLLECTION;
        const operations = this.operationState.value.filter((operation) => operation.collection === collection);
        if (remote === previousRemote && sameOperations(operations, previousOperations)) return previousResult;
        previousRemote = remote;
        previousOperations = operations;
        previousResult = applyOptimisticOverlay(remote, operations);
        return previousResult;
      });
      this.collectionSignals.set(collection, selected);
    }
    return selected as ReadonlySignal<ReadonlyMap<string, StoredRecord<T>>>;
  }

  /** Alias that reads naturally at call sites: `store.records(NS.instance.exposure)`. */
  records<T = unknown>(collection: string): ReadonlySignal<ReadonlyMap<string, StoredRecord<T>>> {
    return this.collection<T>(collection);
  }

  pendingFor(collection: string): ReadonlySignal<readonly OperationRecord[]> {
    return computed(() => selectPendingOperations(this.operationState.value, collection));
  }

  conflictsFor(collection: string): ReadonlySignal<readonly (PutOperationRecord | DeleteOperationRecord)[]> {
    return computed(() => selectConflictOperations(this.operationState.value, collection));
  }

  replaceRemote(records: Iterable<RemoteRecordInput>): void;
  replaceRemote<T>(collection: string, records: Iterable<StoredRecord<T>>): void;
  replaceRemote<T>(
    collectionOrRecords: string | Iterable<RemoteRecordInput>,
    records?: Iterable<StoredRecord<T>>,
  ): void {
    if (typeof collectionOrRecords !== "string") {
      this.remoteState.value = this.buildRemoteIndex(collectionOrRecords);
      return;
    }

    const next = new Map(this.remoteState.value);
    next.set(
      collectionOrRecords,
      new Map(Array.from(records ?? [], (record) => [record.uri, record as StoredRecord<unknown>])),
    );
    this.remoteState.value = next;
  }

  replaceRemoteCollection<T>(collection: string, records: Iterable<StoredRecord<T>>): void {
    this.replaceRemote(collection, records);
  }

  upsertRemote(record: RemoteRecordInput): void;
  upsertRemote<T>(collection: string, record: StoredRecord<T>): void;
  upsertRemote<T>(collectionOrRecord: string | RemoteRecordInput, record?: StoredRecord<T>): void {
    const collection = typeof collectionOrRecord === "string" ? collectionOrRecord : collectionOrRecord.collection;
    const stored =
      typeof collectionOrRecord === "string"
        ? (record as StoredRecord<unknown>)
        : this.toStoredRecord(collectionOrRecord);
    if (!stored) throw new TypeError("A remote upsert needs a record");
    if (typeof collectionOrRecord !== "string" && !this.belongsToRepo(collectionOrRecord.repo)) return;

    const next = new Map(this.remoteState.value);
    const collectionRecords = new Map(next.get(collection) ?? EMPTY_COLLECTION);
    collectionRecords.set(stored.uri, stored);
    next.set(collection, collectionRecords);
    this.remoteState.value = next;
  }

  removeRemote(collection: string, uri: string): void;
  removeRemote(uri: string): void;
  removeRemote(collectionOrUri: string, uri?: string): void {
    const targetUri = uri ?? collectionOrUri;
    const collection = uri === undefined ? collectionFromUri(targetUri) : collectionOrUri;
    if (!collection) return;
    this.removeRemoteRecord(collection, targetUri);
  }

  clearRemote(collection?: string): void {
    if (!collection) {
      if (this.remoteState.value.size > 0) this.remoteState.value = new Map();
      return;
    }
    if (!this.remoteState.value.has(collection)) return;
    const next = new Map(this.remoteState.value);
    next.delete(collection);
    this.remoteState.value = next;
  }

  replaceOperations(operations: Iterable<OperationRecord>): void {
    this.operationState.value = this.scopeOperations(operations);
  }

  setOperations(operations: Iterable<OperationRecord>): void {
    this.replaceOperations(operations);
  }

  upsertOperation(operation: OperationRecord): void {
    if (!this.belongsToRepo(operation.repo)) return;
    const next = this.operationState.value.filter((candidate) => candidate.id !== operation.id);
    this.operationState.value = orderedOperations([...next, operation]);
  }

  applyOperation(operation: OperationRecord): void {
    this.upsertOperation(operation);
  }

  removeOperation(id: string): void {
    const next = this.operationState.value.filter((operation) => operation.id !== id);
    if (next.length !== this.operationState.value.length) this.operationState.value = next;
  }

  /**
   * Commit an acknowledged operation into remote state and remove its overlay.
   * Create acknowledgements also rewrite dependent temp-URI targets and values.
   */
  acknowledge(acknowledgement: Acknowledgement): void {
    const operation = acknowledgement.operation;
    if (!this.belongsToRepo(operation.repo)) return;

    batch(() => {
      let remaining = this.operationState.value.filter((candidate) => candidate.id !== operation.id);

      if (operation.kind === "create") {
        const tempUri = acknowledgement.tempUri ?? operation.tempUri;
        const uri = acknowledgement.uri;
        const cid = acknowledgement.cid;
        if (!uri || !cid) {
          throw new TypeError("A create acknowledgement needs its real uri and cid");
        }
        this.remoteState.value = rewriteRemoteIndex(this.remoteState.value, tempUri, uri);
        remaining = remaining.map((candidate) => rewriteOperation(candidate, tempUri, uri));
        this.upsertRemote(operation.collection, { uri, cid, value: operation.record });
      } else if (operation.kind === "put") {
        const uri = acknowledgement.uri ?? operation.uri;
        const current = this.remoteState.value.get(operation.collection)?.get(uri);
        this.upsertRemote(operation.collection, {
          uri,
          cid: acknowledgement.cid ?? current?.cid ?? operation.swapRecord,
          value: operation.record,
        });
      } else {
        this.removeRemote(operation.collection, operation.uri);
      }

      this.operationState.value = orderedOperations(remaining);
    });
  }

  applyAcknowledgement(acknowledgement: Acknowledgement): void {
    this.acknowledge(acknowledgement);
  }

  private belongsToRepo(repo: string | undefined): boolean {
    return !this.repo || !repo || repo === this.repo;
  }

  private scopeOperations(operations: Iterable<OperationRecord>): readonly OperationRecord[] {
    return orderedOperations(operations).filter((operation) => this.belongsToRepo(operation.repo));
  }

  private buildRemoteIndex(records: Iterable<RemoteRecordInput>): CollectionIndex {
    const result = new Map<string, Map<string, StoredRecord<unknown>>>();
    for (const input of records) {
      if (!this.belongsToRepo(input.repo)) continue;
      const collection = input.collection;
      const collectionRecords = result.get(collection) ?? new Map();
      const stored = this.toStoredRecord(input);
      collectionRecords.set(stored.uri, stored);
      result.set(collection, collectionRecords);
    }
    return result;
  }

  private toStoredRecord(input: RemoteRecordInput): StoredRecord<unknown> {
    if ("value" in input) return { uri: input.uri, cid: input.cid, value: input.value };
    return { uri: input.uri, cid: input.cid, value: this.decode(input) };
  }

  private removeRemoteRecord(collection: string, uri: string): void {
    const current = this.remoteState.value.get(collection);
    if (!current?.has(uri)) return;
    const next = new Map(this.remoteState.value);
    const collectionRecords = new Map(current);
    collectionRecords.delete(uri);
    if (collectionRecords.size === 0) next.delete(collection);
    else next.set(collection, collectionRecords);
    this.remoteState.value = next;
  }
}

export function createRecordStore(options: RecordStoreOptions = {}): RecordStore {
  return new RecordStore(options);
}

function collectionFromUri(uri: string): string | undefined {
  const parsed = parseAtUri(uri);
  if (parsed) return parsed.collection;
  if (!uri.startsWith("outbox://")) return undefined;
  return uri.slice("outbox://".length).split("/")[0] || undefined;
}

function rewriteOperation(operation: OperationRecord, from: string, to: string): OperationRecord {
  if (operation.kind === "create") {
    const record = rewriteJson(operation.record, from, to);
    return record === operation.record ? operation : { ...operation, record };
  }

  const location = parseAtUri(to);
  if (operation.kind === "put") {
    const record = rewriteJson(operation.record, from, to);
    if (operation.uri !== from) {
      return record === operation.record ? operation : { ...operation, record };
    }
    return {
      ...operation,
      uri: to,
      record,
      ...(location ? { collection: location.collection, rkey: location.rkey } : {}),
    };
  }

  if (operation.uri !== from) return operation;
  return {
    ...operation,
    uri: to,
    ...(location ? { collection: location.collection, rkey: location.rkey } : {}),
  };
}

function rewriteRemoteIndex(index: CollectionIndex, from: string, to: string): CollectionIndex {
  let changed = false;
  const next = new Map<string, CollectionMap>();
  for (const [collection, records] of index) {
    let collectionChanged = false;
    const rewritten = new Map<string, StoredRecord<unknown>>();
    for (const [key, record] of records) {
      const uri = record.uri === from ? to : record.uri;
      const value = rewriteJsonValue(record.value, from, to);
      const nextRecord = uri === record.uri && value === record.value ? record : { ...record, uri, value };
      rewritten.set(key === from ? to : key, nextRecord);
      if (nextRecord !== record || key === from) collectionChanged = true;
    }
    if (collectionChanged) changed = true;
    next.set(collection, collectionChanged ? rewritten : records);
  }
  return changed ? next : index;
}

function sameOperations(left: readonly OperationRecord[], right: readonly OperationRecord[]): boolean {
  return left.length === right.length && left.every((operation, index) => operation === right[index]);
}

function rewriteJson(value: JsonObject, from: string, to: string): JsonObject {
  return rewriteJsonValue(value, from, to) as JsonObject;
}

function rewriteJsonValue(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const rewritten = rewriteJsonValue(item, from, to);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? result : value;
  }
  if (!value || typeof value !== "object") return value;

  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const rewritten = rewriteJsonValue(item, from, to);
    if (rewritten !== item) changed = true;
    result[key] = rewritten;
  }
  return changed ? result : value;
}
