import { effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";

export interface StoredRecord<T = unknown> {
  readonly uri: string;
  readonly cid?: string;
  readonly value: T;
}

export interface CollectionStore<T = unknown> {
  readonly records: ReadonlySignal<ReadonlyMap<string, StoredRecord<T>>>;
  replace(records: Iterable<StoredRecord<T>>): void;
  upsert(record: StoredRecord<T>): void;
  remove(uri: string): void;
  clear(): void;
}

export type Dispose = () => void;

/**
 * Re-render one owned UI section whenever its selector's signal dependencies
 * change. Signal reads made by the renderer itself are deliberately untracked.
 */
export function renderOn<T>(selector: () => T, renderFn: (value: T) => void): Dispose {
  return effect(() => {
    const selected = selector();
    untracked(() => renderFn(selected));
  });
}

export function createCollectionStore<T = unknown>(initial: Iterable<StoredRecord<T>> = []): CollectionStore<T> {
  const state = signal<ReadonlyMap<string, StoredRecord<T>>>(toRecordMap(initial));

  return {
    records: state,
    replace(records) {
      state.value = toRecordMap(records);
    },
    upsert(record) {
      const next = new Map(state.value);
      next.set(record.uri, record);
      state.value = next;
    },
    remove(uri) {
      if (!state.value.has(uri)) return;
      const next = new Map(state.value);
      next.delete(uri);
      state.value = next;
    },
    clear() {
      if (state.value.size === 0) return;
      state.value = new Map();
    },
  };
}

function toRecordMap<T>(records: Iterable<StoredRecord<T>>): ReadonlyMap<string, StoredRecord<T>> {
  return new Map(Array.from(records, (record) => [record.uri, record]));
}
