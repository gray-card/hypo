import type { LibraryRecordTarget } from "../../routes/library-record-history";

interface RecordValue {
  rkey?: string;
  uri?: string;
}

interface LibraryStore {
  instance?: Record<string, RecordValue[] | undefined>;
}

interface ModalHandle {
  close(): void;
}

interface RecordRouteServices {
  getStore(): LibraryStore | null;
  refreshStore(): Promise<unknown>;
  openRoll(record: RecordValue, onClose: () => void): ModalHandle;
  openGear(kind: string, record: RecordValue, onClose: () => void): ModalHandle;
  onRouteModalClosed(target: LibraryRecordTarget): void;
}

function recordKey(record: RecordValue): string | undefined {
  if (record.rkey) return record.rkey;
  const key = record.uri?.split("/").filter(Boolean).at(-1);
  if (!key) return undefined;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function recordsFor(store: LibraryStore | null, target: LibraryRecordTarget): RecordValue[] {
  const kind = target.type === "roll" ? "filmRoll" : target.kind;
  return store?.instance?.[kind] || [];
}

function findRecord(store: LibraryStore | null, target: LibraryRecordTarget): RecordValue | undefined {
  return recordsFor(store, target).find((record) => recordKey(record) === target.rkey);
}

function targetKey(target: LibraryRecordTarget): string {
  return target.type === "roll" ? `roll:${target.rkey}` : `gear:${target.kind}:${target.rkey}`;
}

export function createLibraryRecordRouteController(services: RecordRouteServices) {
  let active: { key: string; modal: ModalHandle } | null = null;
  let revision = 0;
  let suppressCloseRoute = false;

  const dismissActive = (): void => {
    if (!active) return;
    suppressCloseRoute = true;
    active.modal.close();
    active = null;
    suppressCloseRoute = false;
  };

  const close = (): void => {
    revision += 1;
    dismissActive();
  };

  const open = async (target: LibraryRecordTarget): Promise<void> => {
    const requestRevision = ++revision;
    let record = findRecord(services.getStore(), target);
    if (!record) {
      await services.refreshStore();
      record = findRecord(services.getStore(), target);
    }
    if (requestRevision !== revision) return;
    if (!record)
      throw new Error(`Could not find ${target.type === "roll" ? "film roll" : target.kind} “${target.rkey}”.`);

    dismissActive();
    const candidate: { key: string; modal?: ModalHandle } = { key: targetKey(target) };
    const onClose = (): void => {
      if (active !== candidate) return;
      active = null;
      if (!suppressCloseRoute) services.onRouteModalClosed(target);
    };
    const modal =
      target.type === "roll" ? services.openRoll(record, onClose) : services.openGear(target.kind, record, onClose);
    candidate.modal = modal;
    active = candidate as { key: string; modal: ModalHandle };
  };

  return { close, open };
}
