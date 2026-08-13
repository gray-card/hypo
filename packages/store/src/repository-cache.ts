import {
  MemoryDatabase,
  openSyncDatabase,
  type Acknowledgement,
  type CachedRecord,
  type SyncDatabase,
} from "@hypo/sync";

import type { StoredRecord } from "./collection.ts";

export class RepositoryRecordCache {
  constructor(
    private readonly database: SyncDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  async read<T = unknown>(repo: string, collection: string): Promise<StoredRecord<T>[]> {
    return (await this.database.getAll("records"))
      .filter((record) => record.repo === repo && record.collection === collection)
      .sort((left, right) => left.uri.localeCompare(right.uri))
      .map((record) => ({ uri: record.uri, cid: record.cid, value: record.record as T }));
  }

  async hasSnapshot(repo: string, collection: string): Promise<boolean> {
    return Boolean(await this.database.get("kv", snapshotKey(repo, collection)));
  }

  async replace<T>(repo: string, collection: string, records: Iterable<StoredRecord<T>>): Promise<void> {
    const incoming = new Map<string, CachedRecord>();
    const updatedAt = this.now();
    for (const record of records) {
      incoming.set(record.uri, {
        uri: record.uri,
        cid: record.cid || "",
        repo,
        collection,
        record: record.value as Record<string, unknown>,
        updatedAt,
      });
    }

    const current = (await this.database.getAll("records")).filter(
      (record) => record.repo === repo && record.collection === collection,
    );
    await this.database.batch([
      ...current
        .filter((record) => !incoming.has(record.uri))
        .map((record) => ({ type: "delete" as const, store: "records" as const, key: record.uri })),
      ...[...incoming.values()].map((value) => ({ type: "put" as const, store: "records" as const, value })),
      {
        type: "put" as const,
        store: "kv" as const,
        value: { key: snapshotKey(repo, collection), value: { updatedAt } },
      },
    ]);
  }

  /** Patch one acknowledged write without claiming that the collection is a complete snapshot. */
  async applyAcknowledgement(acknowledgement: Acknowledgement): Promise<void> {
    const operation = acknowledgement.operation;
    const updatedAt = this.now();
    if (operation.kind === "delete") {
      await this.database.delete("records", operation.uri);
      return;
    }

    const uri = acknowledgement.uri ?? (operation.kind === "put" ? operation.uri : undefined);
    if (!uri) throw new TypeError("A write acknowledgement needs its record URI");
    const current = await this.database.get("records", uri);
    const cid = acknowledgement.cid ?? current?.cid ?? (operation.kind === "put" ? operation.swapRecord : undefined);
    if (!cid) throw new TypeError("A write acknowledgement needs its record CID");

    const mutations = [];
    if (operation.kind === "create") {
      const from = acknowledgement.tempUri ?? operation.tempUri;
      for (const cached of await this.database.getAll("records")) {
        if (cached.repo !== operation.repo) continue;
        const nextUri = cached.uri === from ? uri : cached.uri;
        const record = rewriteReferences(cached.record, from, uri);
        if (nextUri === cached.uri && record === cached.record) continue;
        if (nextUri !== cached.uri)
          mutations.push({ type: "delete" as const, store: "records" as const, key: cached.uri });
        mutations.push({
          type: "put" as const,
          store: "records" as const,
          value: { ...cached, uri: nextUri, record, updatedAt },
        });
      }
    }
    mutations.push({
      type: "put" as const,
      store: "records" as const,
      value: {
        uri,
        cid,
        repo: operation.repo,
        collection: operation.collection,
        record: operation.record,
        updatedAt,
      },
    });
    await this.database.batch(mutations);
  }
}

function rewriteReferences<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const rewritten = rewriteReferences(item, from, to);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return (changed ? result : value) as T;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const rewritten = rewriteReferences(item, from, to);
    if (rewritten !== item) changed = true;
    result[key] = rewritten;
  }
  return (changed ? result : value) as T;
}

function snapshotKey(repo: string, collection: string): string {
  return `record-cache:${repo}:${collection}`;
}

let cachePromise: Promise<RepositoryRecordCache> | undefined;

export function openRepositoryRecordCache(): Promise<RepositoryRecordCache> {
  cachePromise ??= Promise.resolve()
    .then(() => (globalThis.indexedDB ? openSyncDatabase() : new MemoryDatabase()))
    .catch(() => new MemoryDatabase())
    .then((database) => new RepositoryRecordCache(database));
  return cachePromise;
}
