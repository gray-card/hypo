import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  conflicts,
  enqueue,
  enqueueDelete,
  enqueuePut,
  flush,
  installAutoFlush,
  list,
  loadOutbox,
  pending,
  pendingCount,
  rebaseConflict,
  subscribeAcknowledgements,
} from "../src/outbox.js";
import { mockAgent } from "./setup.js";

const did = "did:plc:test";
const EXP = "app.graycard.instance.exposure";

beforeEach(() => localStorage.clear());

describe("outbox — offline write queue", () => {
  it("keeps synchronous optimistic reads while persisting through the sync runtime", async () => {
    const op = enqueue(did, EXP, { frameNumber: 1, createdAt: "2026-01-01" });
    expect(op.tempUri).toContain("outbox://");
    expect(pendingCount(did)).toBe(1);
    expect(pending(did, EXP)[0].record.frameNumber).toBe(1);
    expect(loadOutbox(did)[0].record.$type).toBe(EXP);
    expect(await list(did)).toEqual([expect.objectContaining({ id: op.id, kind: "create" })]);
    expect(localStorage.getItem(`hypo:outbox:${did}`)).toBeNull();
  });

  it("flush creates every queued record and drains the queue", async () => {
    const agent = mockAgent();
    enqueue(did, EXP, { frameNumber: 1, createdAt: "x" });
    enqueue(did, EXP, { frameNumber: 2, createdAt: "x" });
    const res = await flush(agent, did);
    expect(res.sent).toBe(2);
    expect(pendingCount(did)).toBe(0);
    expect(agent.created.length).toBe(2);
  });

  it("keeps everything queued when offline", async () => {
    const agent = mockAgent();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    enqueue(did, EXP, { createdAt: "x" });
    const res = await flush(agent, did);
    expect(res.offline).toBe(true);
    expect(pendingCount(did)).toBe(1);
    expect(agent.created.length).toBe(0);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("honors an offline event when WebKit leaves navigator.onLine stale", async () => {
    const agent = mockAgent();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("offline"));
    enqueue(did, EXP, { createdAt: "x" });

    const res = await flush(agent, did);

    expect(res.offline).toBe(true);
    expect(pendingCount(did)).toBe(1);
    expect(agent.created).toHaveLength(0);
    window.dispatchEvent(new Event("online"));
  });

  it("stops on a network error and preserves the unsent records", async () => {
    const agent = mockAgent();
    let n = 0;
    agent.com.atproto.repo.createRecord = async ({ collection, record }) => {
      n += 1;
      if (n === 2) throw new Error("network down");
      agent.created.push({ collection, record });
      return { data: { uri: "at://x", cid: "c" } };
    };
    enqueue(did, EXP, { i: 1, createdAt: "x" });
    enqueue(did, EXP, { i: 2, createdAt: "x" });
    enqueue(did, EXP, { i: 3, createdAt: "x" });
    const res = await flush(agent, did);
    expect(res.sent).toBe(1);
    expect(pendingCount(did)).toBe(2); // the failed one + the untried third remain
  });

  it("migrates and clears a legacy localStorage queue before listing it", async () => {
    localStorage.setItem(
      `hypo:outbox:${did}`,
      JSON.stringify([
        {
          id: "legacy-create",
          collection: EXP,
          record: { frameNumber: 7 },
          queuedAt: "2026-01-07T00:00:00.000Z",
        },
      ]),
    );

    expect(pending(did)).toEqual([expect.objectContaining({ id: "legacy-create" })]);
    expect(await list(did)).toEqual([expect.objectContaining({ id: "legacy-create", kind: "create" })]);
    expect(localStorage.getItem(`hypo:outbox:${did}`)).toBeNull();
  });

  it("flushes swap-protected puts and deletes through the PDS package", async () => {
    const agent = mockAgent();
    const uri = `at://${did}/${EXP}/existing`;
    const writes = [];
    agent.com.atproto.repo.putRecord = async (input) => {
      writes.push({ kind: "put", ...input });
      return { data: { uri, cid: "cid-new" } };
    };
    agent.com.atproto.repo.deleteRecord = async (input) => {
      writes.push({ kind: "delete", ...input });
      return { data: {} };
    };
    enqueuePut(did, uri, { frameNumber: 2 }, "cid-old");
    enqueueDelete(did, uri, "cid-new");

    expect(await flush(agent, did)).toMatchObject({ sent: 2, left: 0 });
    expect(writes).toEqual([
      expect.objectContaining({ kind: "put", rkey: "existing", swapRecord: "cid-old" }),
      expect.objectContaining({ kind: "delete", rkey: "existing", swapRecord: "cid-new" }),
    ]);
  });

  it("surfaces and rebases PDS swap conflicts", async () => {
    const agent = mockAgent();
    const uri = `at://${did}/${EXP}/existing`;
    agent.com.atproto.repo.getRecord = async () => ({
      data: { uri, cid: "cid-current", value: { $type: EXP, frameNumber: 3 } },
    });
    agent.com.atproto.repo.putRecord = async () => {
      throw Object.assign(new Error("record changed remotely"), { status: 400, error: "InvalidSwap" });
    };
    const operation = enqueuePut(did, uri, { frameNumber: 2 }, "cid-stale");

    expect(await flush(agent, did)).toMatchObject({ conflicts: 1, left: 1 });
    expect(await conflicts(did)).toEqual([
      expect.objectContaining({
        id: operation.id,
        status: "conflict",
        swapRecord: "cid-stale",
        conflict: expect.objectContaining({
          remote: expect.objectContaining({ cid: "cid-current", value: expect.objectContaining({ frameNumber: 3 }) }),
        }),
      }),
    ]);

    agent.com.atproto.repo.putRecord = async () => ({ data: { uri, cid: "cid-latest" } });
    await rebaseConflict(did, operation.id, { swapRecord: "cid-current" });
    expect(await flush(agent, did)).toMatchObject({ sent: 1, left: 0 });
  });

  it("auto-flushes after connectivity returns and notifies the legacy callback", async () => {
    const agent = mockAgent();
    const onFlushed = vi.fn();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const dispose = installAutoFlush(agent, did, onFlushed);
    enqueue(did, EXP, { frameNumber: 9, createdAt: "x" });
    await list(did);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(agent.created).toHaveLength(1));
    await vi.waitFor(() => expect(onFlushed).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, left: 0 })));
    dispose();
  });

  it("propagates each acknowledgement but announces only one actual reconnect flush", async () => {
    const agent = mockAgent();
    const onFlushed = vi.fn();
    const acknowledged = vi.fn();
    const unsubscribe = subscribeAcknowledgements(did, acknowledged);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await list(did);
    const dispose = installAutoFlush(agent, did, onFlushed);
    await Promise.resolve();
    await Promise.resolve();

    enqueue(did, EXP, { frameNumber: 1, createdAt: "online" });
    await vi.waitFor(() => expect(agent.created).toHaveLength(1));
    await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    expect(onFlushed).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    enqueue(did, EXP, { frameNumber: 2, createdAt: "offline" });
    await list(did);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() => expect(agent.created).toHaveLength(2));
    await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onFlushed).toHaveBeenCalledTimes(1));
    expect(onFlushed).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, left: 0 }));
    expect(pendingCount(did)).toBe(0);

    dispose();
    unsubscribe();
  });
});
