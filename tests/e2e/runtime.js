const SESSION_KEY = "hypo:e2e-session";

async function payload(response) {
  if (response.status === 204 || response.headers.get("content-length") === "0") return {};
  return response.json();
}

async function xrpc(origin, method, { params, body, headers, signal } = {}) {
  const url = new URL(`/xrpc/${method}`, origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await payload(response);
  if (!response.ok) {
    const error = new Error(data?.message || `Fixture PDS request failed with ${response.status}`);
    Object.assign(error, data, { status: response.status });
    throw error;
  }
  return { data };
}

function sessionFor(value) {
  return {
    did: value.did,
    handle: value.handle,
    async signOut() {
      localStorage.removeItem(SESSION_KEY);
    },
  };
}

function createOAuthClient(pdsOrigin) {
  return {
    async init() {
      try {
        const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
        return stored?.did ? { session: sessionFor(stored) } : {};
      } catch {
        localStorage.removeItem(SESSION_KEY);
        return {};
      }
    },
    async signIn(handle) {
      const result = await xrpc(pdsOrigin, "com.atproto.identity.resolveHandle", {
        params: { handle },
      });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ did: result.data.did, handle }));
      location.reload();
    },
    async revoke() {
      localStorage.removeItem(SESSION_KEY);
    },
  };
}

function createAgent(pdsOrigin) {
  const query =
    (method) =>
    (input, options = {}) =>
      xrpc(pdsOrigin, method, { params: input, signal: options.signal || input.signal });
  const procedure =
    (method) =>
    (input, options = {}) =>
      xrpc(pdsOrigin, method, { body: input, signal: options.signal || input.signal });

  return {
    com: {
      atproto: {
        repo: {
          listRecords: query("com.atproto.repo.listRecords"),
          getRecord: query("com.atproto.repo.getRecord"),
          createRecord: procedure("com.atproto.repo.createRecord"),
          putRecord: procedure("com.atproto.repo.putRecord"),
          deleteRecord: procedure("com.atproto.repo.deleteRecord"),
          async uploadBlob(bytes, options = {}) {
            const response = await fetch(new URL("/xrpc/com.atproto.repo.uploadBlob", pdsOrigin), {
              method: "POST",
              headers: { "content-type": options.encoding || "application/octet-stream" },
              body: bytes,
              signal: options.signal,
            });
            const data = await payload(response);
            if (!response.ok) {
              const error = new Error(data?.message || `Fixture blob upload failed with ${response.status}`);
              Object.assign(error, data, { status: response.status });
              throw error;
            }
            return { data };
          },
        },
        sync: {
          async getBlob(input, options = {}) {
            const response = await fetch(
              `${pdsOrigin}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams(input).toString()}`,
              { signal: options.signal || input.signal },
            );
            if (!response.ok) throw new Error(`Fixture blob read failed with ${response.status}`);
            return { data: new Uint8Array(await response.arrayBuffer()) };
          },
        },
      },
    },
  };
}

export function createE2ERuntime({ pdsOrigin }) {
  return {
    agent: createAgent(pdsOrigin),
    oauthClient: createOAuthClient(pdsOrigin),
  };
}
