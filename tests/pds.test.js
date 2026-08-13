import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AtprotoAgentAdapter,
  AuthError,
  NetworkError,
  PublicRepoClient,
  RepoClient,
  SwapConflict,
  ValidationError,
} from "../packages/pds/src/index.ts";
import { createFixturePds } from "./fixture-pds/index.js";

const REPO = "did:plc:alice";
const CAMERAS = "app.graycard.instance.camera";
const LEGACY_DEVELOPERS = "app.graycard.instance.developer";
const CHEMISTRY = "app.graycard.instance.chemistry";

function camera(nickname) {
  return {
    $type: CAMERAS,
    type: "at://did:plc:catalog/app.graycard.catalog.cameraType/camera",
    nickname,
    createdAt: "2026-08-11T12:00:00.000Z",
  };
}

function fixtureAgent(origin) {
  async function jsonCall(method, input) {
    const response = await fetch(`${origin}/xrpc/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.ok) {
      return { data: response.headers.get("content-length") === "0" ? {} : await response.json() };
    }
    const body = await response.json();
    throw Object.assign(new Error(body.message), { status: response.status, error: body.error });
  }

  return {
    com: {
      atproto: {
        repo: {
          createRecord: (input) => jsonCall("com.atproto.repo.createRecord", input),
          putRecord: (input) => jsonCall("com.atproto.repo.putRecord", input),
          deleteRecord: (input) => jsonCall("com.atproto.repo.deleteRecord", input),
          applyWrites: (input) => jsonCall("com.atproto.repo.applyWrites", input),
          uploadBlob: async (bytes, options) => {
            const response = await fetch(`${origin}/xrpc/com.atproto.repo.uploadBlob`, {
              method: "POST",
              headers: { "content-type": options.encoding },
              body: bytes,
            });
            return { data: await response.json() };
          },
        },
      },
    },
  };
}

describe("PDS access core", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await createFixturePds({ seedPath: "tests/fixture-pds/seed.json" });
  });

  afterEach(async () => {
    await fixture?.close();
  });

  it("reads and paginates records through the unauthenticated client", async () => {
    const client = new PublicRepoClient(fixture.origin);
    const records = await client.listAll({ repo: REPO, collection: CAMERAS, limit: 2 });

    expect(records.map((record) => record.uri.split("/").at(-1))).toEqual(["camera-a", "camera-b", "camera-c"]);
    await expect(client.get({ repo: REPO, collection: CAMERAS, rkey: "camera-a" })).resolves.toEqual(
      expect.objectContaining({ value: expect.objectContaining({ nickname: "black body" }) }),
    );
    await expect(client.describe({ repo: REPO })).resolves.toEqual(
      expect.objectContaining({ collections: expect.arrayContaining([CAMERAS]) }),
    );
    await expect(client.getLatestCommit({ did: REPO })).resolves.toEqual({
      cid: expect.stringMatching(/^b/),
      rev: expect.any(String),
    });
  });

  it("binds the platform fetch receiver for browser public reads", async () => {
    const originalFetch = globalThis.fetch;
    const platformFetch = vi.fn(function () {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ records: [] }));
    });
    globalThis.fetch = platformFetch;
    try {
      const client = new PublicRepoClient("https://public.example");
      await expect(client.list({ repo: REPO, collection: CAMERAS })).resolves.toEqual({ records: [] });
      expect(platformFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates, swap-updates, deletes, and uploads through the authenticated adapter", async () => {
    const client = new RepoClient(new AtprotoAgentAdapter(fixtureAgent(fixture.origin)));
    const created = await client.create({ repo: REPO, collection: CAMERAS, record: camera("field") });
    const rkey = created.uri.split("/").at(-1);
    const updated = await client.put({
      repo: REPO,
      collection: CAMERAS,
      rkey,
      record: camera("updated"),
      swapRecord: created.cid,
    });

    expect(updated.cid).not.toBe(created.cid);
    await expect(client.delete({ repo: REPO, collection: CAMERAS, rkey, swapRecord: updated.cid })).resolves.toEqual(
      {},
    );
    await expect(client.uploadBlob({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" })).resolves.toEqual(
      expect.objectContaining({ mimeType: "image/jpeg", size: 3 }),
    );
  });

  it("atomically creates replacements, updates references, and deletes legacy records", async () => {
    fixture.seed({
      records: [
        {
          repo: REPO,
          collection: LEGACY_DEVELOPERS,
          rkey: "developer-a",
          value: { $type: LEGACY_DEVELOPERS, name: "HC-110" },
        },
      ],
    });
    const client = new RepoClient(new AtprotoAgentAdapter(fixtureAgent(fixture.origin)), { validator: false });

    const output = await client.applyWrites({
      repo: REPO,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: CHEMISTRY,
          rkey: "developer-a",
          value: { $type: CHEMISTRY, name: "HC-110", roles: ["film-developer"] },
        },
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: CAMERAS,
          rkey: "camera-a",
          value: camera("references migrated chemistry"),
        },
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: LEGACY_DEVELOPERS,
          rkey: "developer-a",
        },
      ],
    });

    expect(output.results?.map((result) => result.$type)).toEqual([
      "com.atproto.repo.applyWrites#createResult",
      "com.atproto.repo.applyWrites#updateResult",
      "com.atproto.repo.applyWrites#deleteResult",
    ]);
    const publicClient = new PublicRepoClient(fixture.origin);
    await expect(publicClient.get({ repo: REPO, collection: CHEMISTRY, rkey: "developer-a" })).resolves.toEqual(
      expect.objectContaining({ value: expect.objectContaining({ name: "HC-110" }) }),
    );
    await expect(publicClient.get({ repo: REPO, collection: CAMERAS, rkey: "camera-a" })).resolves.toEqual(
      expect.objectContaining({ value: expect.objectContaining({ nickname: "references migrated chemistry" }) }),
    );
    await expect(
      publicClient.get({ repo: REPO, collection: LEGACY_DEVELOPERS, rkey: "developer-a" }),
    ).rejects.toMatchObject({ code: "RecordNotFound" });
  });

  it("leaves no partial writes when any operation in applyWrites fails", async () => {
    const client = new RepoClient(new AtprotoAgentAdapter(fixtureAgent(fixture.origin)), { validator: false });

    await expect(
      client.applyWrites({
        repo: REPO,
        writes: [
          {
            $type: "com.atproto.repo.applyWrites#create",
            collection: CHEMISTRY,
            rkey: "must-not-survive",
            value: { $type: CHEMISTRY, name: "Temporary" },
          },
          {
            $type: "com.atproto.repo.applyWrites#delete",
            collection: LEGACY_DEVELOPERS,
            rkey: "missing",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "RecordNotFound", operation: "applyWrites" });

    const publicClient = new PublicRepoClient(fixture.origin);
    await expect(
      publicClient.get({ repo: REPO, collection: CHEMISTRY, rkey: "must-not-survive" }),
    ).rejects.toMatchObject({ code: "RecordNotFound" });
    await expect(publicClient.get({ repo: REPO, collection: CAMERAS, rkey: "camera-a" })).resolves.toEqual(
      expect.objectContaining({ value: expect.objectContaining({ nickname: "black body" }) }),
    );
  });

  it("validates writes locally by default and supports an injected validator", async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: "at://record", cid: "bafcid" } }));
    const adapter = new AtprotoAgentAdapter({
      com: { atproto: { repo: { createRecord } } },
    });

    const client = new RepoClient(adapter);
    await expect(client.create({ repo: REPO, collection: CAMERAS, record: { $type: CAMERAS } })).rejects.toMatchObject({
      name: "ValidationError",
      issues: expect.arrayContaining([expect.objectContaining({ path: "$.createdAt" })]),
    });
    expect(createRecord).not.toHaveBeenCalled();

    const custom = new RepoClient(adapter, { validator: () => ({ success: true }) });
    await expect(
      custom.create({ repo: REPO, collection: "social.example.record", record: { value: 1 } }),
    ).resolves.toEqual({ uri: "at://record", cid: "bafcid" });
  });

  it("validates every applyWrites create and update before sending the atomic batch", async () => {
    const applyWrites = vi.fn(async () => ({ data: { results: [] } }));
    const validator = vi.fn((collection, record) =>
      record.valid
        ? { success: true }
        : { success: false, issues: [{ path: "$.valid", message: `${collection} must be valid` }] },
    );
    const client = new RepoClient(new AtprotoAgentAdapter({ com: { atproto: { repo: { applyWrites } } } }), {
      validator,
    });
    const input = {
      repo: REPO,
      validate: false,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: CHEMISTRY,
          value: { valid: true },
        },
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: CAMERAS,
          rkey: "camera-a",
          value: { valid: false },
        },
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: LEGACY_DEVELOPERS,
          rkey: "developer-a",
        },
      ],
    };

    await expect(client.applyWrites(input)).rejects.toMatchObject({
      name: "ValidationError",
      issues: [{ path: "$.valid", message: `${CAMERAS} must be valid` }],
    });
    expect(validator).toHaveBeenCalledTimes(2);
    expect(applyWrites).not.toHaveBeenCalled();

    input.writes[1].value.valid = true;
    const controller = new AbortController();
    await expect(
      client.applyWrites({ ...input, swapCommit: "bafycommit", signal: controller.signal }),
    ).resolves.toEqual({ results: [] });
    expect(validator).toHaveBeenCalledTimes(4);
    expect(applyWrites).toHaveBeenCalledWith(
      { repo: REPO, validate: false, writes: input.writes, swapCommit: "bafycommit" },
      { signal: controller.signal },
    );
  });

  it("maps stale swaps without losing the expected CID", async () => {
    const adapter = {
      putRecord: vi.fn(async () => {
        throw Object.assign(new Error("record changed"), { status: 400, error: "InvalidSwap" });
      }),
    };
    const client = new RepoClient(adapter, { validator: false });

    await expect(
      client.put({
        repo: REPO,
        collection: CAMERAS,
        rkey: "camera-a",
        record: camera("stale"),
        swapRecord: "bafystale",
      }),
    ).rejects.toMatchObject({
      name: "SwapConflict",
      expectedCid: "bafystale",
      operation: "put",
    });
    await expect(adapter.putRecord.mock.results[0].value).rejects.not.toBeInstanceOf(SwapConflict);
  });

  it("maps stale applyWrites repo swaps with the expected commit CID", async () => {
    const adapter = {
      applyWrites: vi.fn(async () => {
        throw Object.assign(new Error("repo changed"), { status: 400, error: "InvalidSwap" });
      }),
    };
    const client = new RepoClient(adapter, { validator: false });

    await expect(client.applyWrites({ repo: REPO, writes: [], swapCommit: "bafystalecommit" })).rejects.toMatchObject({
      name: "SwapConflict",
      expectedCid: "bafystalecommit",
      operation: "applyWrites",
    });
    await expect(adapter.applyWrites.mock.results[0].value).rejects.not.toBeInstanceOf(SwapConflict);
  });

  it("normalizes authenticated-agent auth and blob response shapes", async () => {
    const getBlob = vi.fn(async () => ({ data: new Uint8Array([4, 5, 6]) }));
    const getRecord = vi.fn(async () => {
      throw Object.assign(new Error("sign in again"), { status: 401, error: "ExpiredToken" });
    });
    const client = new RepoClient(
      new AtprotoAgentAdapter({ com: { atproto: { repo: { getRecord }, sync: { getBlob } } } }),
      { validator: false },
    );

    await expect(client.get({ repo: REPO, collection: CAMERAS, rkey: "camera-a" })).rejects.toBeInstanceOf(AuthError);
    await expect(client.getBlob({ did: REPO, cid: "bafblob" })).resolves.toEqual(new Uint8Array([4, 5, 6]));
  });

  it("maps public XRPC validation responses and connection failures", async () => {
    const publicClient = new PublicRepoClient(fixture.origin);
    await expect(publicClient.list({ repo: REPO, collection: CAMERAS, limit: 101 })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const offline = new PublicRepoClient("https://pds.invalid", {
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(offline.get({ repo: REPO, collection: CAMERAS, rkey: "camera-a" })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
