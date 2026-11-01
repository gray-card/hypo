import { describe, expect, it } from "vitest";

import { openComplementStore } from "../packages/schema-runtime/src/complements.ts";

describe("schema complement connection recovery", () => {
  it("reopens a closing connection before deleting custody for any record URI", async () => {
    let opens = 0;
    const factory = {
      open() {
        opens += 1;
        const connection = {
          transaction() {
            if (opens === 1) throw new DOMException("The database connection is closing", "InvalidStateError");
            const transaction = {
              oncomplete: null as null | (() => void),
              onabort: null,
              onerror: null,
              objectStore() {
                return {
                  index() {
                    return {
                      getAllKeys() {
                        const request = { result: [], onsuccess: null as null | (() => void) };
                        setTimeout(() => {
                          request.onsuccess?.();
                          setTimeout(() => transaction.oncomplete?.(), 0);
                        }, 0);
                        return request;
                      },
                    };
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

    const store = await openComplementStore({ factory: factory as unknown as IDBFactory });
    await expect(store.deleteForUri("at://did:plc:test/app.graycard.instance.filmBack/one")).resolves.toBeUndefined();
    expect(opens).toBe(2);
    store.close();
  });
});
