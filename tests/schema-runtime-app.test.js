import { describe, expect, it, vi } from "vitest";

import {
  decodeSchemaRecord,
  decodeSchemaRecords,
  InvalidRecordInputError,
  PINNED_SCHEMA_VERSION,
  prepareSchemaWrite,
} from "../src/schemaRuntime.js";

describe("application schema boundary", () => {
  it("marks current records at the cache decode boundary and keeps writes pinned", async () => {
    const collection = "app.graycard.instance.camera";
    const input = {
      uri: `at://did:plc:test/${collection}/one`,
      cid: "cid-current",
      value: {
        $type: collection,
        type: "at://did:plc:catalog/app.graycard.catalog.cameraType/one",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
    };

    const decoded = await decodeSchemaRecord(input, collection);
    expect(decoded.schemaRuntime).toEqual({
      nativeVersion: PINNED_SCHEMA_VERSION,
      viewVersion: PINNED_SCHEMA_VERSION,
      chainIds: [],
    });
    await expect(
      prepareSchemaWrite(collection, { ...decoded.value, nickname: "edited" }, decoded),
    ).resolves.toMatchObject({ nickname: "edited" });
  });

  it("does not route third-party records through the Gray Card schema runtime", async () => {
    const record = { uri: "at://did:plc:test/social.grain.photo/one", cid: "cid", value: { createdAt: "now" } };
    await expect(decodeSchemaRecord(record, "social.grain.photo")).resolves.toBe(record);
  });

  it("repairs integer strings emitted by the legacy generic chemistry form", async () => {
    const collection = "app.graycard.instance.chemistry";
    const input = {
      uri: `at://did:plc:test/${collection}/legacy`,
      cid: "cid-legacy",
      value: {
        $type: collection,
        type: "at://did:plc:test/app.graycard.catalog.chemistryType/developer",
        maxRollsRecommended: "16",
        rollsProcessed: 5,
        sessionsUsed: 1,
        status: "active",
        createdAt: "2026-09-08T01:29:40.510Z",
      },
    };

    const decoded = await decodeSchemaRecord(input, collection);
    expect(decoded.value.maxRollsRecommended).toBe(16);
    expect(typeof decoded.value.maxRollsRecommended).toBe("number");
    expect(decoded.schemaRuntime.nativeVersion).toBe(PINNED_SCHEMA_VERSION);
  });

  it("keeps readable records when another record in the collection is malformed", async () => {
    const collection = "app.graycard.instance.camera";
    const valid = {
      uri: `at://did:plc:test/${collection}/valid`,
      cid: "cid-valid",
      value: {
        $type: collection,
        type: "at://did:plc:test/app.graycard.catalog.cameraType/one",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
    };
    const invalid = {
      uri: `at://did:plc:test/${collection}/invalid`,
      cid: "cid-invalid",
      value: { ...valid.value, createdAt: 42 },
    };
    const skipped = new Promise((resolve) =>
      document.addEventListener("hypo:schema-records-skipped", resolve, { once: true }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const decoded = await decodeSchemaRecords([valid, invalid], collection);

    expect(decoded).toHaveLength(1);
    expect(decoded[0].uri).toBe(valid.uri);
    await expect(skipped).resolves.toMatchObject({ detail: { collection, count: 1 } });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("rejects an invalid app record before it reaches the outbox", async () => {
    const collection = "app.graycard.instance.chemistry";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      prepareSchemaWrite(collection, {
        type: "at://did:plc:test/app.graycard.catalog.chemistryType/developer",
        maxRollsRecommended: "16",
        createdAt: "2026-09-08T01:29:40.510Z",
      }),
    ).rejects.toBeInstanceOf(InvalidRecordInputError);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
