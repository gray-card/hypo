export const COMPLEMENT_DATABASE_NAME = "hypo-schema-runtime";
export const COMPLEMENT_DATABASE_VERSION = 1;

export interface ComplementCustodyRecord {
  readonly key: string;
  readonly recordUri: string;
  readonly cid: string;
  readonly chainId: string;
  readonly nativeVersion: string;
  readonly viewVersion: string;
  readonly rootVertex: string;
  /** Order in which projections ran while decoding; writes restore in reverse. */
  readonly projectionOrder: number;
  readonly complement: Uint8Array;
  readonly createdAt: number;
}

export interface ComplementStore {
  put(record: ComplementCustodyRecord): Promise<void>;
  get(recordUri: string, cid: string, chainId: string): Promise<ComplementCustodyRecord | undefined>;
  list(recordUri: string, cid: string): Promise<readonly ComplementCustodyRecord[]>;
  deleteForUri(recordUri: string): Promise<void>;
  close(): void;
}

export function complementKey(recordUri: string, cid: string, chainId: string): string {
  return JSON.stringify([recordUri, cid, chainId]);
}

function cloneRecord(record: ComplementCustodyRecord): ComplementCustodyRecord {
  return { ...record, complement: new Uint8Array(record.complement) };
}

export class MemoryComplementStore implements ComplementStore {
  private readonly records = new Map<string, ComplementCustodyRecord>();

  async put(record: ComplementCustodyRecord): Promise<void> {
    this.records.set(record.key, cloneRecord(record));
  }

  async get(recordUri: string, cid: string, chainId: string): Promise<ComplementCustodyRecord | undefined> {
    const record = this.records.get(complementKey(recordUri, cid, chainId));
    return record ? cloneRecord(record) : undefined;
  }

  async list(recordUri: string, cid: string): Promise<readonly ComplementCustodyRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.recordUri === recordUri && record.cid === cid)
      .sort((left, right) => left.projectionOrder - right.projectionOrder)
      .map(cloneRecord);
  }

  async deleteForUri(recordUri: string): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.recordUri === recordUri) this.records.delete(key);
    }
  }

  close(): void {
    this.records.clear();
  }
}

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

class IndexedDbComplementStore implements ComplementStore {
  private closed = false;
  private reopening?: Promise<void>;

  constructor(
    private database: IDBDatabase,
    private readonly factory: IDBFactory,
    private readonly name: string,
  ) {}

  private async transaction(mode: IDBTransactionMode): Promise<IDBTransaction> {
    if (this.closed) throw new Error("Complement store has been closed");
    try {
      return this.database.transaction("complements", mode);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      // Retry only transaction creation: no read or write has begun yet.
      this.reopening ??= openComplementStore({ factory: this.factory, name: this.name })
        .then((reopened) => {
          this.database = (reopened as IndexedDbComplementStore).database;
        })
        .finally(() => {
          this.reopening = undefined;
        });
      await this.reopening;
      return this.database.transaction("complements", mode);
    }
  }

  async put(record: ComplementCustodyRecord): Promise<void> {
    const transaction = await this.transaction("readwrite");
    transaction.objectStore("complements").put(cloneRecord(record));
    await transactionDone(transaction);
  }

  async get(recordUri: string, cid: string, chainId: string): Promise<ComplementCustodyRecord | undefined> {
    const transaction = await this.transaction("readonly");
    const record = await requestResult<ComplementCustodyRecord | undefined>(
      transaction.objectStore("complements").get(complementKey(recordUri, cid, chainId)),
    );
    await transactionDone(transaction);
    return record ? cloneRecord(record) : undefined;
  }

  async list(recordUri: string, cid: string): Promise<readonly ComplementCustodyRecord[]> {
    const transaction = await this.transaction("readonly");
    const records = await requestResult<ComplementCustodyRecord[]>(
      transaction.objectStore("complements").index("record-cid").getAll([recordUri, cid]),
    );
    await transactionDone(transaction);
    return records.sort((left, right) => left.projectionOrder - right.projectionOrder).map(cloneRecord);
  }

  async deleteForUri(recordUri: string): Promise<void> {
    const transaction = await this.transaction("readwrite");
    const store = transaction.objectStore("complements");
    const keys = await requestResult<IDBValidKey[]>(store.index("record-uri").getAllKeys(recordUri));
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
  }

  close(): void {
    this.closed = true;
    this.database.close();
  }
}

export interface OpenComplementStoreOptions {
  readonly name?: string;
  readonly factory?: IDBFactory;
}

/** Open durable complement custody, falling back to memory outside browsers. */
export async function openComplementStore(options: OpenComplementStoreOptions = {}): Promise<ComplementStore> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) return new MemoryComplementStore();

  const name = options.name ?? COMPLEMENT_DATABASE_NAME;
  const request = factory.open(name, COMPLEMENT_DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore("complements", { keyPath: "key" });
    store.createIndex("record-uri", "recordUri");
    store.createIndex("record-cid", ["recordUri", "cid"]);
  };
  return new IndexedDbComplementStore(await requestResult(request), factory, name);
}
