import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFixturePds,
  deterministicBlobCid,
  deterministicRecordCid,
  VERSIONED_FIXTURE_HANDLE,
  VERSIONED_FIXTURE_REPO,
} from "./fixture-pds/index.js";

const REPO = "did:plc:alice";
const CAMERAS = "app.graycard.instance.camera";
const seedPath = "tests/fixture-pds/seed.json";

function query(params) {
  return new URLSearchParams(params).toString();
}

describe("fixture PDS XRPC contract", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await createFixturePds({ seedPath });
  });

  afterEach(async () => {
    await fixture?.close();
  });

  async function xrpc(method, { params, body, headers } = {}) {
    const suffix = params ? `?${query(params)}` : "";
    return fetch(`${fixture.origin}/xrpc/${method}${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("loads JSON seed data and returns AT Protocol record response shapes", async () => {
    const getResponse = await xrpc("com.atproto.repo.getRecord", {
      params: { repo: REPO, collection: CAMERAS, rkey: "camera-a" },
    });
    expect(getResponse.status).toBe(200);
    const record = await getResponse.json();
    expect(record).toEqual({
      uri: `at://${REPO}/${CAMERAS}/camera-a`,
      cid: deterministicRecordCid(record.value),
      value: expect.objectContaining({
        $type: CAMERAS,
        nickname: "black body",
      }),
    });
    expect(record.cid).toMatch(/^bafyrei[a-z2-7]+$/);

    const listResponse = await xrpc("com.atproto.repo.listRecords", {
      params: { repo: "alice.test", collection: CAMERAS },
    });
    const list = await listResponse.json();
    expect(list.records).toHaveLength(3);
    expect(list.records[0]).toEqual(
      expect.objectContaining({ uri: expect.any(String), cid: expect.any(String), value: expect.any(Object) }),
    );
    expect(list).not.toHaveProperty("cursor");
  });

  it("serves the versioned Panproto corpus without changing the alice.test seed", async () => {
    const filenames = (await readdir("fixtures/records")).filter((filename) => filename.endsWith(".json")).sort();
    const sources = await Promise.all(
      filenames.map(async (filename) => [
        filename.slice(0, -".json".length),
        JSON.parse(await readFile(`fixtures/records/${filename}`, "utf8")),
      ]),
    );

    const identityResponse = await xrpc("com.atproto.identity.resolveHandle", {
      params: { handle: VERSIONED_FIXTURE_HANDLE },
    });
    expect(await identityResponse.json()).toEqual({ did: VERSIONED_FIXTURE_REPO });

    for (const [rkey, source] of sources) {
      const response = await xrpc("com.atproto.repo.getRecord", {
        params: { repo: VERSIONED_FIXTURE_REPO, collection: source.$type, rkey },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        uri: `at://${VERSIONED_FIXTURE_REPO}/${source.$type}/${rkey}`,
        cid: deterministicRecordCid(source),
        value: source,
      });
    }

    const aliceResponse = await xrpc("com.atproto.repo.listRecords", {
      params: { repo: "alice.test", collection: CAMERAS },
    });
    expect((await aliceResponse.json()).records).toHaveLength(3);
  });

  it("creates, updates, reads, and deletes records with deterministic output", async () => {
    const initial = { $type: CAMERAS, nickname: "field camera" };
    const createResponse = await xrpc("com.atproto.repo.createRecord", {
      body: { repo: REPO, collection: CAMERAS, record: initial },
    });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created).toEqual({
      uri: `at://${REPO}/${CAMERAS}/fixture000001`,
      cid: deterministicRecordCid(initial),
    });

    const updatedValue = { ...initial, nickname: "updated field camera" };
    const putResponse = await xrpc("com.atproto.repo.putRecord", {
      body: {
        repo: REPO,
        collection: CAMERAS,
        rkey: "fixture000001",
        record: updatedValue,
        swapRecord: created.cid,
      },
    });
    const updated = await putResponse.json();
    expect(updated.cid).toBe(deterministicRecordCid(updatedValue));
    expect(updated.cid).not.toBe(created.cid);

    const deleteResponse = await xrpc("com.atproto.repo.deleteRecord", {
      body: {
        repo: REPO,
        collection: CAMERAS,
        rkey: "fixture000001",
        swapRecord: updated.cid,
      },
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.text()).toBe("");

    const missingResponse = await xrpc("com.atproto.repo.getRecord", {
      params: { repo: REPO, collection: CAMERAS, rkey: "fixture000001" },
    });
    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      error: "RecordNotFound",
      message: "Record not found",
    });
  });

  it("paginates by opaque cursor in forward and reverse rkey order", async () => {
    const firstResponse = await xrpc("com.atproto.repo.listRecords", {
      params: { repo: REPO, collection: CAMERAS, limit: "2" },
    });
    const first = await firstResponse.json();
    expect(first.records.map((record) => record.uri.split("/").at(-1))).toEqual(["camera-a", "camera-b"]);
    expect(first.cursor).toEqual(expect.any(String));

    const secondResponse = await xrpc("com.atproto.repo.listRecords", {
      params: { repo: REPO, collection: CAMERAS, limit: "2", cursor: first.cursor },
    });
    const second = await secondResponse.json();
    expect(second.records.map((record) => record.uri.split("/").at(-1))).toEqual(["camera-c"]);
    expect(second).not.toHaveProperty("cursor");

    const reverseResponse = await xrpc("com.atproto.repo.listRecords", {
      params: { repo: REPO, collection: CAMERAS, limit: "2", reverse: "true" },
    });
    const reverse = await reverseResponse.json();
    expect(reverse.records.map((record) => record.uri.split("/").at(-1))).toEqual(["camera-c", "camera-b"]);
  });

  it("resolves seeded handles and returns deterministic blob metadata", async () => {
    const identityResponse = await xrpc("com.atproto.identity.resolveHandle", {
      params: { handle: "alice.test" },
    });
    expect(await identityResponse.json()).toEqual({ did: REPO });

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const uploadResponse = await fetch(`${fixture.origin}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: bytes,
    });
    expect(await uploadResponse.json()).toEqual({
      blob: {
        $type: "blob",
        ref: { $link: deterministicBlobCid(bytes) },
        mimeType: "image/jpeg",
        size: 4,
      },
    });
  });

  it("rejects a stale swapRecord after a deterministic underneath mutation", async () => {
    const getResponse = await xrpc("com.atproto.repo.getRecord", {
      params: { repo: REPO, collection: CAMERAS, rkey: "camera-a" },
    });
    const stale = await getResponse.json();

    const underneath = fixture.mutateRecord({ repo: REPO, collection: CAMERAS, rkey: "camera-a" });
    expect(underneath.cid).not.toBe(stale.cid);
    expect(underneath.value.$fixtureMutation).toBe("mutation-000001");

    const stalePutResponse = await xrpc("com.atproto.repo.putRecord", {
      body: {
        repo: REPO,
        collection: CAMERAS,
        rkey: "camera-a",
        record: { ...stale.value, nickname: "lost update" },
        swapRecord: stale.cid,
      },
    });
    expect(stalePutResponse.status).toBe(400);
    expect(await stalePutResponse.json()).toEqual({
      error: "InvalidSwap",
      message: "swapRecord does not match the current CID",
    });

    const currentResponse = await xrpc("com.atproto.repo.getRecord", {
      params: { repo: REPO, collection: CAMERAS, rkey: "camera-a" },
    });
    expect(await currentResponse.json()).toEqual(underneath);
  });
});
