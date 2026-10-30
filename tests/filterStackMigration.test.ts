import { describe, expect, it, vi } from "vitest";

import {
  FILTER_STACK_COLLECTIONS,
  migrateFilterStacksWithClient,
  migrateFilterStackValue,
  migrateFilterStackValueWithPanproto,
} from "../src/filterStackMigration.ts";

const REPO = "did:plc:test";
const yellow = `at://${REPO}/app.graycard.instance.filter/yellow`;
const polarizer = `at://${REPO}/app.graycard.instance.filter/polarizer`;

function record(collection: string, rkey: string, value: Record<string, unknown>) {
  return {
    uri: `at://${REPO}/${collection}/${rkey}`,
    cid: `bafy${rkey}`,
    value: { $type: collection, ...value },
  };
}

describe("filter-stack schema migration", () => {
  it.each([
    [FILTER_STACK_COLLECTIONS.exposure, { filter: yellow, createdAt: "2026-10-30T12:00:00.000Z" }],
    [
      FILTER_STACK_COLLECTIONS.meterReading,
      { geometry: "incident", lightKind: "ambient", filter: yellow, createdAt: "2026-10-30T12:00:00.000Z" },
    ],
  ])("uses Panproto to wrap the legacy field for %s", async (collection, value) => {
    const migrated = await migrateFilterStackValueWithPanproto(collection, { $type: collection, ...value });

    expect(migrated).not.toHaveProperty("filter");
    expect(migrated.filters).toEqual([yellow]);
  });

  it("preserves an explicit prerelease stack while removing the singular field", () => {
    const migrated = migrateFilterStackValue(
      { filter: yellow, filters: [polarizer, yellow], createdAt: "2026-10-30T12:00:00.000Z" },
      [yellow],
    );

    expect(migrated).toEqual({
      filters: [polarizer, yellow],
      createdAt: "2026-10-30T12:00:00.000Z",
    });
  });

  it("is a no-op after records have the canonical shape", async () => {
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const client = {
      describe: vi.fn(async () => ({ collections: [FILTER_STACK_COLLECTIONS.exposure] })),
      listAll: vi.fn(async () => [
        record(FILTER_STACK_COLLECTIONS.exposure, "exposure-1", {
          filters: [yellow, polarizer],
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ]),
      getLatestCommit: vi.fn(async () => ({ cid: "bafycommit", rev: "1" })),
      applyWrites,
    };

    await expect(migrateFilterStacksWithClient(client, REPO)).resolves.toEqual({
      migrated: false,
      exposures: 0,
      meterReadings: 0,
    });
    expect(applyWrites).not.toHaveBeenCalled();
  });

  it("rewrites exposure and meter-reading records in one commit-guarded batch", async () => {
    const records = {
      [FILTER_STACK_COLLECTIONS.exposure]: [
        record(FILTER_STACK_COLLECTIONS.exposure, "exposure-1", {
          filter: yellow,
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
      [FILTER_STACK_COLLECTIONS.meterReading]: [
        record(FILTER_STACK_COLLECTIONS.meterReading, "reading-1", {
          geometry: "incident",
          lightKind: "ambient",
          filter: polarizer,
          createdAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
    };
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const client = {
      describe: vi.fn(async () => ({ collections: Object.values(FILTER_STACK_COLLECTIONS) })),
      listAll: vi.fn(async ({ collection }: { collection: keyof typeof records }) => records[collection]),
      getLatestCommit: vi.fn(async () => ({ cid: "bafycommit", rev: "1" })),
      applyWrites,
    };

    await expect(migrateFilterStacksWithClient(client, REPO)).resolves.toEqual({
      migrated: true,
      exposures: 1,
      meterReadings: 1,
    });
    expect(applyWrites).toHaveBeenCalledOnce();
    expect(applyWrites).toHaveBeenCalledWith({
      repo: REPO,
      validate: false,
      swapCommit: "bafycommit",
      writes: [
        expect.objectContaining({
          collection: FILTER_STACK_COLLECTIONS.exposure,
          rkey: "exposure-1",
          value: expect.objectContaining({ filters: [yellow] }),
        }),
        expect.objectContaining({
          collection: FILTER_STACK_COLLECTIONS.meterReading,
          rkey: "reading-1",
          value: expect.objectContaining({ filters: [polarizer] }),
        }),
      ],
    });
    for (const write of applyWrites.mock.calls[0][0].writes) expect(write.value).not.toHaveProperty("filter");
  });

  it("chunks large repositories at the applyWrites limit with a fresh commit guard", async () => {
    const exposures = Array.from({ length: 201 }, (_, index) =>
      record(FILTER_STACK_COLLECTIONS.exposure, `exposure-${index}`, {
        filter: yellow,
        createdAt: "2026-10-30T12:00:00.000Z",
      }),
    );
    const applyWrites = vi.fn(async () => ({ results: [] }));
    const getLatestCommit = vi
      .fn()
      .mockResolvedValueOnce({ cid: "bafycommit1", rev: "1" })
      .mockResolvedValueOnce({ cid: "bafycommit2", rev: "2" });
    const client = {
      describe: vi.fn(async () => ({ collections: [FILTER_STACK_COLLECTIONS.exposure] })),
      listAll: vi.fn(async () => exposures),
      getLatestCommit,
      applyWrites,
    };

    await expect(migrateFilterStacksWithClient(client, REPO)).resolves.toEqual({
      migrated: true,
      exposures: 201,
      meterReadings: 0,
    });
    expect(applyWrites).toHaveBeenCalledTimes(2);
    expect(applyWrites.mock.calls[0][0].writes).toHaveLength(200);
    expect(applyWrites.mock.calls[1][0].writes).toHaveLength(1);
    expect(getLatestCommit).toHaveBeenCalledTimes(2);
  });
});
