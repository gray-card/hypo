import { describe, expect, it, vi } from "vitest";
import { enqueue, flushOperation } from "../src/outbox.js";
import { mockAgent } from "./setup.js";

vi.mock("@hypo/sync", async (importOriginal) => {
  const actual = await importOriginal();
  class FailingDatabase extends actual.MemoryDatabase {
    async put(store, value) {
      if (store === "ops") throw new DOMException("The quota has been exceeded", "QuotaExceededError");
      return super.put(store, value);
    }
  }
  return { ...actual, openSyncDatabase: async () => new FailingDatabase() };
});

describe("outbox persistence failures", () => {
  it("rejects instead of returning a temporary URI for an unqueued write", async () => {
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { value: {}, configurable: true });
    try {
      const did = "did:plc:outbox-persistence-failure";
      const agent = mockAgent();
      const operation = enqueue(did, "app.graycard.instance.exposure", {
        frameNumber: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await expect(flushOperation(agent, did, operation.id)).rejects.toThrow(/This change was not saved/);
      expect(agent.created).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { value: original, configurable: true });
    }
  });
});
