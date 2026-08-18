// test setup: polyfill the few browser APIs jsdom does not implement that our
// modules touch (rAF for count-up animations, matchMedia for reduced-motion).

// Node 25+ exposes an experimental `localStorage` global that resolves to
// `undefined` unless Node is started with --localstorage-file. That accessor
// shadows jsdom's implementation inside Vitest. Install a per-environment
// in-memory Storage object so test files cannot leak browser state into one
// another and the suite does not depend on a Node CLI flag.
if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      key = String(key);
      return values.has(key) ? values.get(key) : null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => "blob:fake";
  globalThis.URL.revokeObjectURL = () => {};
}

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

// a tiny fake atproto agent that records writes and returns empty reads, so
// modules that call saveRecord / loadStore work without a network or PDS.
export function mockAgent() {
  const blobCid = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";
  const created = [];
  const put = [];
  const deleted = [];
  return {
    created,
    put,
    deleted,
    com: {
      atproto: {
        repo: {
          createRecord: async ({ collection, record }) => {
            created.push({ collection, record });
            return {
              data: { uri: `at://did:plc:test/${collection}/rk${created.length}`, cid: `cid${created.length}` },
            };
          },
          putRecord: async ({ collection, rkey, record }) => {
            put.push({ collection, rkey, record });
            return { data: { uri: `at://did:plc:test/${collection}/${rkey}`, cid: `cid` } };
          },
          deleteRecord: async ({ collection, rkey }) => {
            deleted.push({ collection, rkey });
            return {};
          },
          listRecords: async () => ({ data: { records: [] } }),
          uploadBlob: async () => ({
            data: { blob: { $type: "blob", ref: { $link: blobCid }, mimeType: "image/jpeg", size: 1 } },
          }),
        },
      },
    },
  };
}
