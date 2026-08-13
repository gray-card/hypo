import { signal } from "@preact/signals-core";
import { describe, expect, it, vi } from "vitest";

import { createCollectionStore, createRecordStore, renderOn } from "../packages/store/src/index.ts";

describe("renderOn", () => {
  it("renders immediately, follows selector dependencies, and disposes cleanly", () => {
    const selected = signal("first");
    const render = vi.fn();
    const dispose = renderOn(() => selected.value, render);

    expect(render).toHaveBeenLastCalledWith("first");
    selected.value = "second";
    expect(render).toHaveBeenLastCalledWith("second");

    dispose();
    selected.value = "third";
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe to signals read only by the renderer", () => {
    const selected = signal(1);
    const rendererOnly = signal("a");
    const seen: Array<[number, string]> = [];
    const dispose = renderOn(
      () => selected.value,
      (value) => seen.push([value, rendererOnly.value]),
    );

    rendererOnly.value = "b";
    expect(seen).toEqual([[1, "a"]]);
    selected.value = 2;
    expect(seen).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    dispose();
  });
});

describe("createCollectionStore", () => {
  it("publishes immutable snapshots for upserts and removals", () => {
    const store = createCollectionStore<{ label: string }>();
    const snapshots: Array<ReadonlyMap<string, unknown>> = [];
    const dispose = renderOn(
      () => store.records.value,
      (records) => snapshots.push(records),
    );

    store.upsert({ uri: "at://did:plc:test/app.graycard.instance.camera/1", value: { label: "M6" } });
    store.remove("at://did:plc:test/app.graycard.instance.camera/1");

    expect(snapshots.map((snapshot) => snapshot.size)).toEqual([0, 1, 0]);
    expect(snapshots[0]).not.toBe(snapshots[1]);
    dispose();
  });
});

describe("RecordStore collection invalidation", () => {
  it("rerenders only the affected collection and batches acknowledgement changes", () => {
    const repo = "did:plc:signals";
    const cameras = "app.graycard.instance.camera";
    const lenses = "app.graycard.instance.lens";
    const cameraUri = `at://${repo}/${cameras}/one`;
    const store = createRecordStore({ repo });
    store.replaceRemote(cameras, [{ uri: cameraUri, cid: "cid-old", value: { nickname: "old" } }]);
    const render = vi.fn();
    const dispose = renderOn(() => store.collection<{ nickname: string }>(cameras).value, render);
    expect(render).toHaveBeenCalledTimes(1);

    store.upsertRemote(lenses, {
      uri: `at://${repo}/${lenses}/one`,
      cid: "cid-lens",
      value: { nickname: "lens" },
    });
    expect(render).toHaveBeenCalledTimes(1);

    const operation = {
      id: "put-camera",
      repo,
      collection: cameras,
      kind: "put" as const,
      uri: cameraUri,
      rkey: "one",
      record: { nickname: "new" },
      swapRecord: "cid-old",
      status: "pending" as const,
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0,
    };
    store.upsertOperation(operation);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls.at(-1)?.[0].get(cameraUri)?.value.nickname).toBe("new");

    store.acknowledge({ operation, uri: cameraUri, cid: "cid-new" });
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls.at(-1)?.[0].get(cameraUri)).toMatchObject({ cid: "cid-new", value: { nickname: "new" } });
    dispose();
  });

  it("preserves unrelated collection identity while a create acknowledgement rewrites references", () => {
    const repo = "did:plc:signal-rewrite";
    const cameras = "app.graycard.instance.camera";
    const lenses = "app.graycard.instance.lens";
    const tempUri = `outbox://${cameras}/create-camera`;
    const realUri = `at://${repo}/${cameras}/camera-a`;
    const store = createRecordStore({ repo });
    store.replaceRemote(cameras, [{ uri: `at://${repo}/${cameras}/camera-b`, value: { pairedWith: tempUri } }]);
    store.replaceRemote(lenses, [
      { uri: `at://${repo}/${lenses}/lens-a`, cid: "cid-lens", value: { nickname: "lens" } },
    ]);
    const render = vi.fn();
    const dispose = renderOn(() => store.collection(lenses).value, render);
    const operation = {
      id: "create-camera",
      repo,
      collection: cameras,
      kind: "create" as const,
      tempUri,
      record: { nickname: "camera" },
      status: "pending" as const,
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0,
    };

    store.upsertOperation(operation);
    store.acknowledge({ operation, tempUri, uri: realUri, cid: "cid-camera" });

    expect(render).toHaveBeenCalledTimes(1);
    dispose();
  });
});
