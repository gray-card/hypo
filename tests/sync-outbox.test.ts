import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryDatabase,
  Outbox,
  installFlushScheduler,
  legacyOutboxKey,
  migrateLegacyOutbox,
  type LockLike,
  type LockManagerLike,
  type RepoClient,
} from "../packages/sync/src/index.ts";

const repo = "did:plc:sync-test";
const collection = "app.graycard.instance.exposure";

class Client implements RepoClient {
  creates: Array<Record<string, unknown>> = [];
  puts: Array<Record<string, unknown>> = [];
  deletes: Array<Record<string, unknown>> = [];

  async create(input: Record<string, unknown>) {
    this.creates.push(input);
    return { uri: `at://${repo}/${collection}/real`, cid: "cid-created" };
  }

  async put(input: Record<string, unknown>) {
    this.puts.push(input);
    return { uri: (input.uri as string) || `at://${repo}/${collection}/${input.rkey}`, cid: "cid-put" };
  }

  async delete(input: Record<string, unknown>) {
    this.deletes.push(input);
    return {};
  }
}

function sequentialIds() {
  let id = 0;
  return () => `op-${String(++id).padStart(2, "0")}`;
}

beforeEach(() => localStorage.clear());

describe("outbox v2 migration", () => {
  it("count-verifies the localStorage handoff before clearing v1", async () => {
    const database = new MemoryDatabase();
    const key = legacyOutboxKey(repo);
    localStorage.setItem(
      key,
      JSON.stringify([
        {
          id: "legacy-1",
          collection,
          record: { frameNumber: 1 },
          tempUri: `outbox://${collection}/legacy-1`,
          queuedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "legacy-2",
          collection,
          record: { frameNumber: 2 },
          tempUri: `outbox://${collection}/legacy-2`,
          queuedAt: "2026-01-02T00:00:00.000Z",
        },
      ]),
    );

    const result = await migrateLegacyOutbox({ database, storage: localStorage, repo });

    expect(result).toMatchObject({ sourceCount: 2, importedCount: 2, cleared: true });
    expect(localStorage.getItem(key)).toBeNull();
    expect(await database.count("ops")).toBe(2);
    expect((await database.get("ops", "legacy-1"))?.kind).toBe("create");
  });

  it("does not clear malformed source data", async () => {
    const database = new MemoryDatabase();
    const key = legacyOutboxKey(repo);
    localStorage.setItem(key, JSON.stringify([{ id: "missing-fields" }]));
    const result = await migrateLegacyOutbox({ database, storage: localStorage, repo });
    expect(result.malformed).toBe(true);
    expect(result.cleared).toBe(false);
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it("re-verifies source data that appears after a completed migration", async () => {
    const database = new MemoryDatabase();
    const key = legacyOutboxKey(repo);
    expect(await migrateLegacyOutbox({ database, storage: localStorage, repo })).toMatchObject({ cleared: true });
    localStorage.setItem(key, JSON.stringify([{ id: "late-legacy", collection, record: { frameNumber: 3 } }]));

    const result = await migrateLegacyOutbox({ database, storage: localStorage, repo });
    expect(result).toMatchObject({ sourceCount: 1, importedCount: 1, cleared: true, alreadyMigrated: true });
    expect(await database.get("ops", "late-legacy")).toMatchObject({ repo, collection, kind: "create" });
  });
});

describe("outbox v2 operations", () => {
  it("flushes create, swap-protected put, and delete operations", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    const outbox = new Outbox({ database, client, repo, randomId: sequentialIds(), locks: null });
    const uri = `at://${repo}/${collection}/existing`;

    await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });
    await outbox.enqueuePut({ uri, record: { frameNumber: 2 }, swapRecord: "cid-old" });
    await outbox.enqueueDelete({ uri, swapRecord: "cid-put" });
    const result = await outbox.flush();

    expect(result).toMatchObject({ sent: 3, left: 0, failed: 0 });
    expect(client.creates[0].record).toMatchObject({ $type: collection, frameNumber: 1 });
    expect(client.puts[0]).toMatchObject({ swapRecord: "cid-old", rkey: "existing" });
    expect(client.deletes[0]).toMatchObject({ swapRecord: "cid-put", rkey: "existing" });
  });

  it("retains all operations without attempting writes while offline", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    const outbox = new Outbox({
      database,
      client,
      repo,
      randomId: sequentialIds(),
      isOnline: () => false,
      locks: null,
    });
    await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });

    expect(await outbox.flush()).toMatchObject({ offline: true, sent: 0, left: 1 });
    expect(client.creates).toHaveLength(0);
    expect((await outbox.list())[0].attempts).toBe(0);
  });

  it("persists acknowledgement and rewrites a dependent temp URI", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    const acknowledged = vi.fn();
    const outbox = new Outbox({
      database,
      client,
      repo,
      randomId: sequentialIds(),
      now: () => 42,
      locks: null,
      onAcknowledged: acknowledged,
    });
    const create = await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });
    await outbox.enqueuePut({
      uri: create.tempUri,
      collection,
      rkey: "temporary",
      record: { frameNumber: 2 },
      swapRecord: "cid-created",
    });

    expect((await outbox.flush()).sent).toBe(2);
    expect(client.puts[0]).toMatchObject({ rkey: "real" });
    expect(await outbox.acknowledgedUri(create.tempUri)).toEqual({
      tempUri: create.tempUri,
      uri: `at://${repo}/${collection}/real`,
      cid: "cid-created",
      acknowledgedAt: 42,
    });
    expect(await database.get("records", `at://${repo}/${collection}/real`)).toMatchObject({
      cid: "cid-put",
      repo,
      collection,
      record: expect.objectContaining({ frameNumber: 2 }),
      updatedAt: 42,
    });
    expect(acknowledged).toHaveBeenCalledTimes(2);
  });

  it("rewrites nested references in later creates and puts before an offline chain flushes", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    let online = false;
    const outbox = new Outbox({
      database,
      client,
      repo,
      randomId: sequentialIds(),
      isOnline: () => online,
      locks: null,
    });
    const parent = await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });
    await outbox.enqueueCreate({
      collection,
      record: { roll: parent.tempUri, provenance: { sources: [parent.tempUri] } },
    });
    await outbox.enqueuePut({
      uri: parent.tempUri,
      collection,
      rkey: "temporary",
      record: { roll: parent.tempUri, nested: { target: parent.tempUri } },
      swapRecord: "cid-created",
    });

    expect(await outbox.flush()).toMatchObject({ offline: true, sent: 0, left: 3 });
    online = true;
    expect(await outbox.flush()).toMatchObject({ sent: 3, left: 0 });

    const realUri = `at://${repo}/${collection}/real`;
    expect(client.creates[1].record).toMatchObject({
      roll: realUri,
      provenance: { sources: [realUri] },
    });
    expect(client.puts[0]).toMatchObject({
      rkey: "real",
      record: { roll: realUri, nested: { target: realUri } },
      swapRecord: "cid-created",
    });
    expect(JSON.stringify([...client.creates, ...client.puts])).not.toContain("outbox://");
  });

  it("parks swap conflicts instead of dropping them", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    client.put = async () => {
      const error = new Error("record changed remotely");
      error.name = "SwapConflict";
      throw error;
    };
    const outbox = new Outbox({ database, client, repo, randomId: sequentialIds(), locks: null });
    await outbox.enqueuePut({
      uri: `at://${repo}/${collection}/existing`,
      record: { frameNumber: 2 },
      swapRecord: "stale-cid",
    });

    expect(await outbox.flush()).toMatchObject({ conflicts: 1, failed: 0, left: 1 });
    expect(await outbox.pendingCount()).toBe(0);
    expect((await outbox.conflicts())[0]).toMatchObject({
      status: "conflict",
      attempts: 1,
      swapRecord: "stale-cid",
    });
  });

  it("backs off each failed operation and retries only when due", async () => {
    const database = new MemoryDatabase();
    const client = new Client();
    let now = 10_000;
    let attempts = 0;
    client.create = async (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("server unavailable");
      return Client.prototype.create.call(client, input);
    };
    const outbox = new Outbox({
      database,
      client,
      repo,
      randomId: sequentialIds(),
      now: () => now,
      backoff: () => 500,
      locks: null,
    });
    const operation = await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });

    expect(await outbox.flush()).toMatchObject({ failed: 1, left: 1 });
    expect(await database.get("ops", operation.id)).toMatchObject({ attempts: 1, nextAttemptAt: 10_500 });
    expect(await outbox.flush()).toMatchObject({ deferred: 1, sent: 0 });
    expect(attempts).toBe(1);
    now = 10_500;
    expect(await outbox.flush()).toMatchObject({ sent: 1, left: 0 });
  });
});

class ExclusiveLocks implements LockManagerLike {
  private busy = false;

  async request<T>(
    name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: LockLike | null) => Promise<T> | T,
  ): Promise<T> {
    if (this.busy) return callback(null);
    this.busy = true;
    try {
      return await callback({ name });
    } finally {
      this.busy = false;
    }
  }
}

describe("outbox v2 Web Lock", () => {
  it("allows only one tab-like outbox to flush a repo at a time", async () => {
    const database = new MemoryDatabase();
    const locks = new ExclusiveLocks();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new Client();
    client.create = async (input) => {
      await gate;
      return Client.prototype.create.call(client, input);
    };
    const first = new Outbox({ database, client, repo, randomId: sequentialIds(), locks });
    const second = new Outbox({ database, client, repo, randomId: sequentialIds(), locks });
    await first.enqueueCreate({ collection, record: { frameNumber: 1 } });

    const active = first.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(await second.flush()).toMatchObject({ locked: true, sent: 0, left: 1 });
    release();
    expect(await active).toMatchObject({ sent: 1, left: 0 });
    expect(client.creates).toHaveLength(1);
  });
});

describe("outbox v2 scheduler", () => {
  it("coalesces an enqueue during a running flush into one follow-up", async () => {
    const outbox = new Outbox({
      database: new MemoryDatabase(),
      client: new Client(),
      repo,
      randomId: sequentialIds(),
      locks: null,
    });
    const result = { sent: 0, failed: 0, conflicts: 0, deferred: 0, left: 0 };
    let finishFirst = () => {};
    const firstRun = new Promise<typeof result>((resolve) => {
      finishFirst = () => resolve(result);
    });
    const flush = vi
      .spyOn(outbox, "flush")
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(result);
    const dispose = installFlushScheduler(outbox, {
      onlineTarget: null,
      visibilityTarget: null,
      setInterval: () => 1,
      clearInterval: () => {},
    });

    await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });
    expect(flush).toHaveBeenCalledOnce();
    finishFirst();
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2));

    dispose();
  });

  it("hooks enqueue, online, visibility, and interval triggers", async () => {
    const outbox = new Outbox({
      database: new MemoryDatabase(),
      client: new Client(),
      repo,
      randomId: sequentialIds(),
      locks: null,
    });
    const flush = vi.spyOn(outbox, "flush").mockResolvedValue({
      sent: 0,
      failed: 0,
      conflicts: 0,
      deferred: 0,
      left: 0,
    });
    const online = new EventTarget();
    const visible = Object.assign(new EventTarget(), { visibilityState: "visible" });
    let tick: (() => void) | undefined;
    const dispose = installFlushScheduler(outbox, {
      onlineTarget: online,
      visibilityTarget: visible,
      flushOnStart: false,
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: vi.fn(),
    });

    const trigger = async (run: () => void) => {
      run();
      await Promise.resolve();
      await Promise.resolve();
    };
    await outbox.enqueueCreate({ collection, record: { frameNumber: 1 } });
    await trigger(() => undefined);
    await trigger(() => online.dispatchEvent(new Event("online")));
    await trigger(() => visible.dispatchEvent(new Event("visibilitychange")));
    await trigger(() => tick?.());

    expect(flush).toHaveBeenCalledTimes(4);
    dispose();
  });
});
