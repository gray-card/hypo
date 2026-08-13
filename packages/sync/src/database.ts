export const SYNC_DATABASE_NAME = "hypo-sync";
export const SYNC_DATABASE_VERSION = 1;

export type JsonObject = Record<string, unknown>;

export type OperationStatus = "pending" | "conflict";

export interface OperationMetadata {
  id: string;
  repo: string;
  collection: string;
  status: OperationStatus;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastAttemptAt?: number;
  lastError?: {
    name: string;
    message: string;
  };
}

export interface CreateOperationRecord extends OperationMetadata {
  kind: "create";
  record: JsonObject;
  rkey?: string;
  tempUri: string;
}

export interface PutOperationRecord extends OperationMetadata {
  kind: "put";
  uri: string;
  rkey: string;
  record: JsonObject;
  swapRecord: string;
  conflict?: {
    message: string;
    remote?: unknown;
  };
}

export interface DeleteOperationRecord extends OperationMetadata {
  kind: "delete";
  uri: string;
  rkey: string;
  swapRecord?: string;
  conflict?: {
    message: string;
    remote?: unknown;
  };
}

export type OperationRecord = CreateOperationRecord | PutOperationRecord | DeleteOperationRecord;

export interface CachedRecord {
  uri: string;
  cid: string;
  repo: string;
  collection: string;
  record: JsonObject;
  updatedAt: number;
}

export interface CatalogShard {
  key: string;
  data: unknown;
  updatedAt: number;
  etag?: string;
}

export interface KeyValueRecord<T = unknown> {
  key: string;
  value: T;
}

export interface SyncDatabaseSchema {
  ops: OperationRecord;
  records: CachedRecord;
  "catalog-shards": CatalogShard;
  kv: KeyValueRecord;
}

export type StoreName = keyof SyncDatabaseSchema;
export type StoreValue<S extends StoreName> = SyncDatabaseSchema[S];
export type StoreKey = string;

export type DatabaseMutation = {
  [S in StoreName]: { type: "put"; store: S; value: StoreValue<S> } | { type: "delete"; store: S; key: StoreKey };
}[StoreName];

export interface SyncDatabase {
  readonly version: number;
  get<S extends StoreName>(store: S, key: StoreKey): Promise<StoreValue<S> | undefined>;
  getAll<S extends StoreName>(store: S): Promise<Array<StoreValue<S>>>;
  put<S extends StoreName>(store: S, value: StoreValue<S>): Promise<void>;
  putMany<S extends StoreName>(store: S, values: ReadonlyArray<StoreValue<S>>): Promise<void>;
  delete<S extends StoreName>(store: S, key: StoreKey): Promise<void>;
  count<S extends StoreName>(store: S): Promise<number>;
  batch(mutations: ReadonlyArray<DatabaseMutation>): Promise<void>;
  close(): void;
}

const STORE_KEYS: { [S in StoreName]: keyof StoreValue<S> } = {
  ops: "id",
  records: "uri",
  "catalog-shards": "key",
  kv: "key",
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export interface DatabaseMigration {
  readonly version: number;
  migrate(database: IDBDatabase, transaction: IDBTransaction): void;
}

/**
 * Migrations are deliberately append-only. An existing profile advances through
 * each migration between its on-disk version and SYNC_DATABASE_VERSION.
 */
export const DATABASE_MIGRATIONS: ReadonlyArray<DatabaseMigration> = [
  {
    version: 1,
    migrate(database) {
      const ops = database.createObjectStore("ops", { keyPath: "id" });
      ops.createIndex("repo", "repo");
      ops.createIndex("status", "status");
      ops.createIndex("repo-status-createdAt", ["repo", "status", "createdAt"]);

      const records = database.createObjectStore("records", { keyPath: "uri" });
      records.createIndex("collection", "collection");
      records.createIndex("repo-collection", ["repo", "collection"]);

      database.createObjectStore("catalog-shards", { keyPath: "key" });
      database.createObjectStore("kv", { keyPath: "key" });
    },
  },
];

export interface OpenSyncDatabaseOptions {
  name?: string;
  factory?: IDBFactory;
}

export async function openSyncDatabase(options: OpenSyncDatabaseOptions = {}): Promise<SyncDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) {
    throw new Error("IndexedDB is unavailable; inject a MemoryDatabase for this environment");
  }

  const request = factory.open(options.name ?? SYNC_DATABASE_NAME, SYNC_DATABASE_VERSION);
  request.onupgradeneeded = (event) => {
    const oldVersion = event.oldVersion;
    const database = request.result;
    const transaction = request.transaction;
    if (!transaction) throw new Error("IndexedDB upgrade transaction is unavailable");

    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.version > oldVersion && migration.version <= SYNC_DATABASE_VERSION) {
        migration.migrate(database, transaction);
      }
    }
  };

  const database = await requestResult(request);
  return new IndexedDatabase(database);
}

class IndexedDatabase implements SyncDatabase {
  readonly version: number;

  constructor(private readonly database: IDBDatabase) {
    this.version = database.version;
  }

  async get<S extends StoreName>(store: S, key: StoreKey): Promise<StoreValue<S> | undefined> {
    const transaction = this.database.transaction(store, "readonly");
    const value = await requestResult(transaction.objectStore(store).get(key));
    await transactionDone(transaction);
    return value as StoreValue<S> | undefined;
  }

  async getAll<S extends StoreName>(store: S): Promise<Array<StoreValue<S>>> {
    const transaction = this.database.transaction(store, "readonly");
    const values = await requestResult(transaction.objectStore(store).getAll());
    await transactionDone(transaction);
    return values as Array<StoreValue<S>>;
  }

  async put<S extends StoreName>(store: S, value: StoreValue<S>): Promise<void> {
    await this.putMany(store, [value]);
  }

  async putMany<S extends StoreName>(store: S, values: ReadonlyArray<StoreValue<S>>): Promise<void> {
    if (values.length === 0) return;
    const transaction = this.database.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    for (const value of values) objectStore.put(value);
    await transactionDone(transaction);
  }

  async delete<S extends StoreName>(store: S, key: StoreKey): Promise<void> {
    const transaction = this.database.transaction(store, "readwrite");
    transaction.objectStore(store).delete(key);
    await transactionDone(transaction);
  }

  async count<S extends StoreName>(store: S): Promise<number> {
    const transaction = this.database.transaction(store, "readonly");
    const count = await requestResult(transaction.objectStore(store).count());
    await transactionDone(transaction);
    return count;
  }

  async batch(mutations: ReadonlyArray<DatabaseMutation>): Promise<void> {
    if (mutations.length === 0) return;
    const stores = [...new Set(mutations.map((mutation) => mutation.store))];
    const transaction = this.database.transaction(stores, "readwrite");
    for (const mutation of mutations) {
      const store = transaction.objectStore(mutation.store);
      if (mutation.type === "put") store.put(mutation.value);
      else store.delete(mutation.key);
    }
    await transactionDone(transaction);
  }

  close(): void {
    this.database.close();
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A structured-clone-compatible database used by unit tests and previews. */
export class MemoryDatabase implements SyncDatabase {
  readonly version: number;
  private stores: { [S in StoreName]: Map<string, StoreValue<S>> } = {
    ops: new Map(),
    records: new Map(),
    "catalog-shards": new Map(),
    kv: new Map(),
  };

  constructor(version = SYNC_DATABASE_VERSION) {
    this.version = version;
  }

  async get<S extends StoreName>(store: S, key: StoreKey): Promise<StoreValue<S> | undefined> {
    const value = this.stores[store].get(key);
    return value === undefined ? undefined : clone(value);
  }

  async getAll<S extends StoreName>(store: S): Promise<Array<StoreValue<S>>> {
    return [...this.stores[store].values()].map((value) => clone(value));
  }

  async put<S extends StoreName>(store: S, value: StoreValue<S>): Promise<void> {
    const key = String(value[STORE_KEYS[store]]);
    this.stores[store].set(key, clone(value) as never);
  }

  async putMany<S extends StoreName>(store: S, values: ReadonlyArray<StoreValue<S>>): Promise<void> {
    for (const value of values) await this.put(store, value);
  }

  async delete<S extends StoreName>(store: S, key: StoreKey): Promise<void> {
    this.stores[store].delete(key);
  }

  async count<S extends StoreName>(store: S): Promise<number> {
    return this.stores[store].size;
  }

  async batch(mutations: ReadonlyArray<DatabaseMutation>): Promise<void> {
    const snapshot = cloneStores(this.stores);
    try {
      for (const mutation of mutations) {
        if (mutation.type === "put") await this.put(mutation.store, mutation.value as never);
        else await this.delete(mutation.store, mutation.key);
      }
    } catch (error) {
      this.stores = snapshot;
      throw error;
    }
  }

  close(): void {}
}

function cloneStores(stores: { [S in StoreName]: Map<string, StoreValue<S>> }): {
  [S in StoreName]: Map<string, StoreValue<S>>;
} {
  return {
    ops: new Map([...stores.ops].map(([key, value]) => [key, clone(value)])),
    records: new Map([...stores.records].map(([key, value]) => [key, clone(value)])),
    "catalog-shards": new Map([...stores["catalog-shards"]].map(([key, value]) => [key, clone(value)])),
    kv: new Map([...stores.kv].map(([key, value]) => [key, clone(value)])),
  };
}
