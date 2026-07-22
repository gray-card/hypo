import { describe, it, expect, beforeEach } from "vitest";
import { enqueue, pending, pendingCount, flush, loadOutbox } from "../src/outbox.js";
import { mockAgent } from "./setup.js";

const did = "did:plc:test";
const EXP = "app.graycard.instance.exposure";

beforeEach(() => localStorage.clear());

describe("outbox — offline write queue", () => {
  it("enqueues records to localStorage with a type + optimistic uri", () => {
    const op = enqueue(did, EXP, { frameNumber: 1, createdAt: "2026-01-01" });
    expect(op.tempUri).toContain("outbox://");
    expect(pendingCount(did)).toBe(1);
    expect(pending(did, EXP)[0].record.frameNumber).toBe(1);
    expect(loadOutbox(did)[0].record.$type).toBe(EXP);
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
});
