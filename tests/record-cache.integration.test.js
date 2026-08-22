import { afterEach, describe, expect, it, vi } from "vitest";
import { BlobRef as AtprotoBlobRef } from "@atproto/lexicon";
import { CID } from "multiformats/cid";
import { listRecords, recordStore } from "../src/grain.js";
import { NS, deleteRecord, loadStore, readStoreSnapshot, saveRecord } from "../src/graycard.js";
import { openRepositoryRecordCache } from "@hypo/store";
import { mockAgent } from "./setup.js";

const BLOB_CID = "bafkreifqn5r4ki5vm4w55xd6qhot5gz6b3tvw7athjuwk4vkz6ppf5zo24";

afterEach(() => setOnline(true));

describe("record-cache read policy", () => {
  it("restores a Grain BlobRef after the cache structured-clones it", async () => {
    const did = "did:plc:structured-clone-cache";
    const collection = "social.grain.photo";
    const rawBlob = {
      $type: "blob",
      ref: { $link: BLOB_CID },
      mimeType: "image/jpeg",
      size: 892396,
    };
    const hydratedBlob = new AtprotoBlobRef(CID.parse(BLOB_CID), "image/jpeg", 892396, rawBlob);
    const cache = await openRepositoryRecordCache();
    await cache.replace(did, collection, [
      {
        uri: `at://${did}/${collection}/photo`,
        cid: "bafrecord",
        value: {
          $type: collection,
          photo: hydratedBlob,
          aspectRatio: { width: 3, height: 2 },
          createdAt: "2026-08-18T12:00:00.000Z",
        },
      },
    ]);
    const agent = mockAgent();
    agent.com.atproto.repo.listRecords = vi.fn(agent.com.atproto.repo.listRecords);

    const [record] = await listRecords(agent, did, collection);

    expect(record.value.photo).toEqual(rawBlob);
    expect(record.value.photo).not.toHaveProperty("original");
    expect(agent.com.atproto.repo.listRecords).not.toHaveBeenCalled();
  });

  it("uses the cached snapshot until an explicit refresh", async () => {
    const agent = mockAgent();
    const original = agent.com.atproto.repo.listRecords;
    agent.com.atproto.repo.listRecords = vi.fn(original);
    const did = "did:plc:cache-policy";
    const collection = "app.graycard.instance.camera";

    await listRecords(agent, did, collection);
    await listRecords(agent, did, collection);
    expect(agent.com.atproto.repo.listRecords).toHaveBeenCalledTimes(1);
    expect(recordStore(did).collection(collection).value).toBeInstanceOf(Map);

    await listRecords(agent, did, collection, { refresh: true });
    expect(agent.com.atproto.repo.listRecords).toHaveBeenCalledTimes(2);
  });

  it("keeps the legacy loadStore name cache-only unless refresh is explicit", async () => {
    const agent = mockAgent();
    agent.com.atproto.repo.listRecords = vi.fn(agent.com.atproto.repo.listRecords);
    const did = "did:plc:load-store-cache-only";
    expect(loadStore).toBe(readStoreSnapshot);

    await loadStore(agent, did);
    const firstLoadCollections = agent.com.atproto.repo.listRecords.mock.calls.map(([request]) => request.collection);
    const collectionsPerStore = firstLoadCollections.length;
    expect(collectionsPerStore).toBeGreaterThan(0);
    expect(new Set(firstLoadCollections).size).toBe(collectionsPerStore);
    expect(agent.com.atproto.repo.listRecords).toHaveBeenCalledTimes(collectionsPerStore);
    await loadStore(agent, did);
    expect(agent.com.atproto.repo.listRecords).toHaveBeenCalledTimes(collectionsPerStore);
    await loadStore(agent, did, { refresh: true });
    expect(agent.com.atproto.repo.listRecords).toHaveBeenCalledTimes(collectionsPerStore * 2);
  });

  it("returns remote plus pending operations without another network read", async () => {
    const did = "did:plc:remote-plus-pending";
    const collection = NS.instance.camera;
    const firstUri = `at://${did}/${collection}/first`;
    const removedUri = `at://${did}/${collection}/removed`;
    const agent = statefulAgent(did, collection, [
      { uri: firstUri, cid: "cid-first", value: { nickname: "remote first" } },
      { uri: removedUri, cid: "cid-removed", value: { nickname: "remote removed" } },
    ]);
    await listRecords(agent, did, collection);
    setOnline(false);
    await saveRecord(agent, did, collection, { nickname: "pending create" }, null);
    await saveRecord(
      agent,
      did,
      collection,
      { nickname: "pending put" },
      { uri: firstUri, cid: "cid-first", rkey: "first", value: { nickname: "remote first" } },
    );
    await deleteRecord(agent, did, removedUri);

    const records = await listRecords(agent, did, collection);
    expect(records.map((record) => record.value.nickname).sort()).toEqual(["pending create", "pending put"]);
    expect(agent.reads).toBe(1);
    expect(agent.writes).toEqual({ create: 0, put: 0, delete: 0 });
  });

  it("patches successful creates, puts, and deletes without a post-write collection refetch", async () => {
    const did = "did:plc:write-through-cache";
    const collection = NS.instance.camera;
    const existingUri = `at://${did}/${collection}/existing`;
    const agent = statefulAgent(did, collection, [{ uri: existingUri, cid: "cid-old", value: { nickname: "old" } }]);
    const [existing] = await listRecords(agent, did, collection);
    const cameraType = `at://${did}/${NS.catalog.cameraType}/test-camera`;
    const createdAt = "2026-08-12T00:00:00.000Z";

    await saveRecord(
      agent,
      did,
      collection,
      { nickname: "updated", type: cameraType, createdAt },
      { ...existing, rkey: "existing" },
    );
    expect((await listRecords(agent, did, collection))[0]).toMatchObject({
      uri: existingUri,
      cid: "cid-put-1",
      value: expect.objectContaining({ nickname: "updated" }),
    });
    const createdUri = await saveRecord(
      agent,
      did,
      collection,
      { nickname: "created", type: cameraType, createdAt },
      null,
    );
    expect((await listRecords(agent, did, collection)).map((record) => record.uri)).toContain(createdUri);
    await deleteRecord(agent, did, existingUri);
    expect((await listRecords(agent, did, collection)).map((record) => record.uri)).toEqual([createdUri]);

    expect(agent.reads).toBe(1);
    expect(agent.writes).toEqual({ create: 1, put: 1, delete: 1 });
    await listRecords(agent, did, collection, { refresh: true });
    expect(agent.reads).toBe(2);
  });

  it("does not replace a live acknowledgement with an older durable snapshot", async () => {
    const did = "did:plc:live-acknowledgement";
    const collection = NS.instance.exposure;
    const agent = statefulAgent(did, collection, []);
    await listRecords(agent, did, collection);

    const operation = {
      id: "offline-exposure",
      repo: did,
      collection,
      kind: "create",
      record: { shoot: `at://${did}/${NS.session.capture}/walk`, createdAt: "2026-08-11T00:00:00.000Z" },
      tempUri: `outbox://${collection}/offline-exposure`,
      status: "pending",
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0,
    };
    const store = recordStore(did);
    store.upsertOperation(operation);
    store.acknowledge({
      operation,
      tempUri: operation.tempUri,
      uri: `at://${did}/${collection}/frame-1`,
      cid: "cid-frame-1",
    });

    await expect(listRecords(agent, did, collection)).resolves.toEqual([
      expect.objectContaining({ uri: `at://${did}/${collection}/frame-1` }),
    ]);
    expect(agent.reads).toBe(1);
  });
});

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function statefulAgent(repo, collection, initial) {
  const records = new Map(initial.map((record) => [record.uri, structuredClone(record)]));
  let created = 0;
  let puts = 0;
  const agent = {
    reads: 0,
    writes: { create: 0, put: 0, delete: 0 },
    com: {
      atproto: {
        repo: {
          listRecords: async ({ collection: requested }) => {
            agent.reads += 1;
            return { data: { records: requested === collection ? [...records.values()] : [] } };
          },
          createRecord: async ({ collection: requested, record }) => {
            agent.writes.create += 1;
            const uri = `at://${repo}/${requested}/created-${++created}`;
            const cid = `cid-create-${created}`;
            records.set(uri, { uri, cid, value: structuredClone(record) });
            return { data: { uri, cid } };
          },
          putRecord: async ({ collection: requested, rkey, record }) => {
            agent.writes.put += 1;
            const uri = `at://${repo}/${requested}/${rkey}`;
            const cid = `cid-put-${++puts}`;
            records.set(uri, { uri, cid, value: structuredClone(record) });
            return { data: { uri, cid } };
          },
          deleteRecord: async ({ collection: requested, rkey }) => {
            agent.writes.delete += 1;
            records.delete(`at://${repo}/${requested}/${rkey}`);
            return { data: {} };
          },
        },
      },
    },
  };
  return agent;
}
