import { describe, expect, it } from "vitest";
import type { OperationRecord } from "../packages/sync/src/index.ts";
import type { ExposureValue, StoredRecord } from "../packages/store/src/index.ts";
import {
  createRecordStore,
  selectExposuresByRoll,
  selectFramesWithExposures,
  selectRollsWithFrames,
  selectShootGearInheritance,
} from "../packages/store/src/index.ts";

const repo = "did:plc:store-test";
const exposureCollection = "app.graycard.instance.exposure";
const rollCollection = "app.graycard.instance.filmRoll";

const metadata = (id: string, collection = exposureCollection) => ({
  id,
  repo,
  collection,
  status: "pending" as const,
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  attempts: 0,
  nextAttemptAt: 0,
});

describe("RecordStore optimistic overlay", () => {
  it("keeps remote snapshots separate while overlaying create, put, and delete operations", () => {
    const existing = `at://${repo}/${exposureCollection}/existing`;
    const removed = `at://${repo}/${exposureCollection}/removed`;
    const operations: OperationRecord[] = [
      {
        ...metadata("op-1"),
        kind: "create",
        tempUri: `outbox://${exposureCollection}/op-1`,
        record: { $type: exposureCollection, frameNumber: 3 },
      },
      {
        ...metadata("op-2"),
        kind: "put",
        uri: existing,
        rkey: "existing",
        swapRecord: "cid-old",
        record: { $type: exposureCollection, frameNumber: 2 },
      },
      {
        ...metadata("op-3"),
        kind: "delete",
        uri: removed,
        rkey: "removed",
        swapRecord: "cid-removed",
      },
    ];
    const store = createRecordStore({ repo, operations });
    store.replaceRemote(exposureCollection, [
      { uri: existing, cid: "cid-old", value: { frameNumber: 1 } },
      { uri: removed, cid: "cid-removed", value: { frameNumber: 9 } },
    ]);

    const records = store.records<{ frameNumber: number }>(exposureCollection).value;
    expect([...records.keys()]).toEqual([existing, `outbox://${exposureCollection}/op-1`]);
    expect(records.get(existing)).toMatchObject({ cid: "cid-old", value: { frameNumber: 2 } });

    store.replaceRemote(exposureCollection, [
      { uri: existing, cid: "cid-refreshed", value: { frameNumber: 10 } },
      { uri: removed, cid: "cid-refreshed-removed", value: { frameNumber: 11 } },
    ]);
    expect(store.records<{ frameNumber: number }>(exposureCollection).value.get(existing)?.value.frameNumber).toBe(2);
    expect(store.records(exposureCollection).value.has(removed)).toBe(false);
  });

  it("rewrites temp keys, dependent targets, and record references on create acknowledgement", () => {
    const tempRoll = `outbox://${rollCollection}/roll-create`;
    const realRoll = `at://${repo}/${rollCollection}/real-roll`;
    const rollCreate: OperationRecord = {
      ...metadata("op-1", rollCollection),
      kind: "create",
      tempUri: tempRoll,
      record: { $type: rollCollection, stock: "at://catalog/film" },
    };
    const exposureCreate: OperationRecord = {
      ...metadata("op-2"),
      kind: "create",
      tempUri: `outbox://${exposureCollection}/exposure-create`,
      record: { $type: exposureCollection, roll: tempRoll, frameNumber: 1 },
    };
    const dependentPut: OperationRecord = {
      ...metadata("op-3", rollCollection),
      kind: "put",
      uri: tempRoll,
      rkey: "temporary",
      swapRecord: "cid-roll",
      record: { $type: rollCollection, stock: "at://catalog/film", label: "updated" },
    };
    const store = createRecordStore({ repo, operations: [rollCreate, exposureCreate, dependentPut] });

    store.acknowledge({
      operation: rollCreate,
      tempUri: tempRoll,
      uri: realRoll,
      cid: "cid-roll",
    });

    expect(store.records(rollCollection).value.has(tempRoll)).toBe(false);
    expect(store.records(rollCollection).value.get(realRoll)).toMatchObject({
      uri: realRoll,
      value: { label: "updated" },
    });
    expect(store.records<{ roll: string }>(exposureCollection).value.values().next().value?.value.roll).toBe(realRoll);
    expect(store.operations.value.find((operation) => operation.id === "op-3")).toMatchObject({
      uri: realRoll,
      rkey: "real-roll",
    });
  });

  it("exposes pending and conflict selectors independently", () => {
    const pending: OperationRecord = {
      ...metadata("op-1"),
      kind: "create",
      tempUri: `outbox://${exposureCollection}/op-1`,
      record: { frameNumber: 1 },
    };
    const conflict: OperationRecord = {
      ...metadata("op-2"),
      status: "conflict",
      kind: "put",
      uri: `at://${repo}/${exposureCollection}/one`,
      rkey: "one",
      swapRecord: "stale",
      record: { frameNumber: 2 },
      conflict: { message: "record changed", remote: { frameNumber: 3 } },
    };
    const store = createRecordStore({ repo, operations: [conflict, pending] });

    expect(store.pending.value.map((operation) => operation.id)).toEqual(["op-1"]);
    expect(store.conflicts.value.map((operation) => operation.id)).toEqual(["op-2"]);
    expect(store.pendingCount.value).toBe(1);
    expect(store.conflictCount.value).toBe(1);
  });
});

describe("record selectors", () => {
  const rollA = `at://${repo}/${rollCollection}/a`;
  const rollB = `at://${repo}/${rollCollection}/b`;
  const shoot = `at://${repo}/app.graycard.session.capture/shoot`;
  const cameraA = `at://${repo}/app.graycard.instance.camera/a`;
  const cameraB = `at://${repo}/app.graycard.instance.camera/b`;
  const lens = `at://${repo}/app.graycard.instance.lens/a`;
  const exposures: StoredRecord<ExposureValue>[] = [
    { uri: "at://exposure/2b", value: { roll: rollA, shoot, frameNumber: 2, frameExposureIndex: 2, camera: cameraB } },
    { uri: "at://exposure/1", value: { roll: rollA, shoot, frameNumber: 1, camera: cameraA, lens } },
    { uri: "at://exposure/2a", value: { roll: rollA, shoot, frameNumber: 2, frameExposureIndex: 1, camera: cameraB } },
    { uri: "at://exposure/b", value: { roll: rollB, frameNumber: 1 } },
  ];

  it("indexes exposures by roll and groups multiple exposures on one frame", () => {
    expect(
      selectExposuresByRoll(exposures)
        .get(rollA)
        ?.map((record) => record.uri),
    ).toEqual(["at://exposure/1", "at://exposure/2a", "at://exposure/2b"]);
    const frames = selectFramesWithExposures(exposures, rollA);
    expect(frames.map((frame) => [frame.frameNumber, frame.exposures.length])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(
      selectRollsWithFrames(
        [
          { uri: rollA, value: { label: "A" } },
          { uri: rollB, value: { label: "B" } },
        ],
        exposures,
      ).map((record) => [record.uri, record.frames.length]),
    ).toEqual([
      [rollA, 2],
      [rollB, 1],
    ]);
  });

  it("combines explicit shoot gear with deduplicated exposure inheritance", () => {
    const result = selectShootGearInheritance({ uri: shoot, value: { cameras: [cameraA], rolls: [rollA] } }, exposures);
    expect(result.camera).toEqual({
      explicit: [cameraA],
      inherited: [cameraB, cameraA],
      effective: [cameraA, cameraB],
    });
    expect(result.lens.effective).toEqual([lens]);
    expect(result.filmRoll.effective).toEqual([rollA]);
    expect(result.filter).toEqual({ explicit: [], inherited: [], effective: [] });
  });
});
