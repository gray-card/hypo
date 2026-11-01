import { describe, expect, it } from "vitest";

import { openSyncDatabase } from "../packages/sync/src/database.ts";

describe("IndexedDB connection recovery", () => {
  it("reopens a closing connection before starting the transaction", async () => {
    let opens = 0;
    const factory = {
      open() {
        opens += 1;
        const connection = {
          version: 1,
          transaction() {
            if (opens === 1) throw new DOMException("The database connection is closing", "InvalidStateError");
            const transaction = {
              oncomplete: null as null | (() => void),
              onabort: null,
              onerror: null,
              objectStore() {
                return {
                  get() {
                    const request = { result: { key: "test", value: 42 }, onsuccess: null as null | (() => void) };
                    setTimeout(() => {
                      request.onsuccess?.();
                      setTimeout(() => transaction.oncomplete?.(), 0);
                    }, 0);
                    return request;
                  },
                };
              },
            };
            return transaction;
          },
          close() {},
        };
        const request = { result: connection, onsuccess: null as null | (() => void) };
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
      },
    };

    const database = await openSyncDatabase({ factory: factory as unknown as IDBFactory });
    expect(await database.get("kv", "test")).toEqual({ key: "test", value: 42 });
    expect(opens).toBe(2);
    database.close();
  });
});
