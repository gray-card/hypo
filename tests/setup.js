// test setup: polyfill the few browser APIs jsdom does not implement that our
// modules touch (rAF for count-up animations, matchMedia for reduced-motion).

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
  const created = [];
  const put = [];
  const deleted = [];
  return {
    created, put, deleted,
    com: {
      atproto: {
        repo: {
          createRecord: async ({ collection, record }) => {
            created.push({ collection, record });
            return { data: { uri: `at://did:plc:test/${collection}/rk${created.length}`, cid: `cid${created.length}` } };
          },
          putRecord: async ({ collection, rkey, record }) => {
            put.push({ collection, rkey, record });
            return { data: { uri: `at://did:plc:test/${collection}/${rkey}`, cid: `cid` } };
          },
          deleteRecord: async ({ collection, rkey }) => { deleted.push({ collection, rkey }); return {}; },
          listRecords: async () => ({ data: { records: [] } }),
          uploadBlob: async () => ({ data: { blob: { $type: "blob", ref: { $link: "bafblob" }, mimeType: "image/jpeg", size: 1 } } }),
        },
      },
    },
  };
}
