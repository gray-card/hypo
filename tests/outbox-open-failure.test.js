import { describe, expect, it, vi } from "vitest";
import { enqueue, flushOperation } from "../src/outbox.js";
import { mockAgent } from "./setup.js";

vi.mock("@hypo/sync", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    openSyncDatabase: async () => {
      throw new DOMException("The database connection is closing", "InvalidStateError");
    },
  };
});

describe("outbox startup failures", () => {
  it("does not silently queue a write in volatile memory when IndexedDB cannot open", async () => {
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { value: {}, configurable: true });
    try {
      const did = "did:plc:outbox-open-failure";
      const agent = mockAgent();
      const operation = enqueue(did, "app.graycard.instance.exposure", {
        frameNumber: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await expect(flushOperation(agent, did, operation.id)).rejects.toThrow(/database connection is closing/);
      expect(agent.created).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { value: original, configurable: true });
    }
  });
});
