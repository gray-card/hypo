import { describe, expect, it } from "vitest";

import { decodeSchemaRecord, PINNED_SCHEMA_VERSION, prepareSchemaWrite } from "../src/schemaRuntime.js";

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
});
