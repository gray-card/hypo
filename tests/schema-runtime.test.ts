import { describe, expect, it, vi } from "vitest";
import { Panproto, type BuiltSchema, type MigrationBuilder } from "@panproto/core";

import {
  ComplementConflict,
  ComplementFingerprintMismatch,
  MemoryComplementStore,
  SchemaRuntime,
  compiledMigrationTransition,
  type SchemaTransition,
} from "@hypo/schema-runtime";

const identity = {
  recordUri: "at://did:plc:test/app.graycard.example/one",
  cid: "cid-v2",
  collection: "app.graycard.example",
};

function runtime(options: { restoreError?: Error } = {}) {
  const loadEngine = vi.fn(async () => ({ marker: "engine" }) as never);
  const transition: SchemaTransition = {
    id: "v1-to-v2",
    olderVersion: "v1",
    newerVersion: "v2",
    rootVertex: () => "app.graycard.example:main",
    forward: {
      lift(value) {
        const record = value as { oldName: string };
        return { name: record.oldName, addedInV2: "default" };
      },
    },
    backward: {
      project(value) {
        const record = value as { name: string; addedInV2: string };
        return {
          view: { oldName: record.name },
          complement: new TextEncoder().encode(record.addedInV2),
        };
      },
      restore(view, complement) {
        if (options.restoreError) throw options.restoreError;
        return {
          name: (view as { oldName: string }).oldName,
          addedInV2: new TextDecoder().decode(complement),
        };
      },
    },
  };
  return {
    loadEngine,
    schemaRuntime: new SchemaRuntime({
      pinnedVersion: "v1",
      versions: [
        { id: "v1", order: 1, validate: (_collection, value) => "oldName" in (value as object) },
        { id: "v2", order: 2, validate: (_collection, value) => "addedInV2" in (value as object) },
      ],
      transitions: [
        {
          id: transition.id,
          olderVersion: transition.olderVersion,
          newerVersion: transition.newerVersion,
          load: async () => transition,
        },
      ],
      complements: new MemoryComplementStore(),
      loadEngine,
      now: () => 42,
    }),
  };
}

describe("schema runtime", () => {
  it("keeps current-version reads on the no-WASM fast path", async () => {
    const { schemaRuntime, loadEngine } = runtime();
    const decoded = await schemaRuntime.decode(identity, { oldName: "current" });

    expect(decoded).toMatchObject({ value: { oldName: "current" }, nativeVersion: "v1", viewVersion: "v1" });
    expect(loadEngine).not.toHaveBeenCalled();
  });

  it("lifts an older native record to the pinned version", async () => {
    const transition: SchemaTransition = {
      id: "v0-to-v1",
      olderVersion: "v0",
      newerVersion: "v1",
      rootVertex: () => "app.graycard.example:main",
      forward: { lift: (value) => ({ oldName: (value as { label: string }).label }) },
      backward: {
        project: () => ({ view: {}, complement: new Uint8Array() }),
        restore: (view) => view,
      },
    };
    const loadEngine = vi.fn(async () => ({}) as never);
    const schemaRuntime = new SchemaRuntime({
      pinnedVersion: "v1",
      versions: [
        { id: "v0", order: 0, validate: (_collection, value) => "label" in (value as object) },
        { id: "v1", order: 1, validate: (_collection, value) => "oldName" in (value as object) },
      ],
      transitions: [{ id: transition.id, olderVersion: "v0", newerVersion: "v1", load: async () => transition }],
      complements: new MemoryComplementStore(),
      loadEngine,
    });

    const decoded = await schemaRuntime.decode(identity, { label: "legacy" });
    expect(decoded.value).toEqual({ oldName: "legacy" });
    expect(await schemaRuntime.prepareWrite({ ...decoded, editedValue: { oldName: "updated" } })).toEqual({
      oldName: "updated",
    });
    expect(loadEngine).toHaveBeenCalledOnce();
  });

  it("round-trips a newer record through the pinned view with complement custody", async () => {
    const { schemaRuntime, loadEngine } = runtime();
    const native = { name: "foreign", addedInV2: "preserve exactly" };

    const decoded = await schemaRuntime.decode(identity, native);
    expect(decoded).toMatchObject({
      value: { oldName: "foreign" },
      nativeVersion: "v2",
      viewVersion: "v1",
      chainIds: ["v1-to-v2"],
    });
    const restored = await schemaRuntime.prepareWrite({ ...decoded, editedValue: { oldName: "edited" } });
    const expected = { name: "edited", addedInV2: "preserve exactly" };
    expect(restored).toEqual(expected);
    expect(new TextEncoder().encode(JSON.stringify(restored))).toEqual(
      new TextEncoder().encode(JSON.stringify(expected)),
    );
    expect(loadEngine).toHaveBeenCalledOnce();
  });

  it("round-trips a hypothetical v2 record byte-for-byte through a real Panproto 0.70.1 lens", async () => {
    const panproto = await Panproto.init();
    const protocol = panproto.protocol("atproto");
    const schema = (withV2Field: boolean) => {
      let builder = protocol
        .schema()
        .vertex("record", "record", { nsid: identity.collection })
        .vertex("body", "object")
        .vertex("name", "string")
        .edge("record", "body", "record-schema")
        .edge("body", "name", "prop", { name: "name" });
      if (withV2Field) {
        builder = builder.vertex("v2-field", "string").edge("body", "v2-field", "prop", { name: "v2Field" });
      }
      return builder.build();
    };
    const v1 = schema(false);
    const v2 = schema(true);
    const mapSharedShape = (builder: MigrationBuilder, source: BuiltSchema, target: BuiltSchema) => {
      let mapped = builder.map("record", "record").map("body", "body").map("name", "name");
      for (const targetEdge of target.edges) {
        const sourceEdge = source.edges.find(
          (edge) =>
            edge.src === targetEdge.src &&
            edge.tgt === targetEdge.tgt &&
            edge.kind === targetEdge.kind &&
            edge.name === targetEdge.name,
        );
        if (!sourceEdge) throw new Error(`Missing shared edge ${targetEdge.src} -> ${targetEdge.tgt}`);
        mapped = mapped.mapEdge(sourceEdge, targetEdge);
      }
      return mapped;
    };
    const forward = mapSharedShape(panproto.migration(v1, v2), v1, v1).compile();
    const backward = mapSharedShape(panproto.migration(v2, v1), v2, v1).compile();
    const transition = compiledMigrationTransition({
      id: "v1-to-v2-panproto",
      olderVersion: "v1",
      newerVersion: "v2",
      rootVertex: () => "body",
      forward,
      backward,
    });
    const schemaRuntime = new SchemaRuntime({
      pinnedVersion: "v1",
      versions: [
        { id: "v1", order: 1, validate: (_collection, value) => !("v2Field" in (value as object)) },
        { id: "v2", order: 2, validate: (_collection, value) => "v2Field" in (value as object) },
      ],
      transitions: [
        {
          id: transition.id,
          olderVersion: transition.olderVersion,
          newerVersion: transition.newerVersion,
          load: async () => transition,
        },
      ],
      complements: new MemoryComplementStore(),
      loadEngine: async () => panproto,
    });

    try {
      const decoded = await schemaRuntime.decode(identity, { name: "before", v2Field: "preserve exactly" });
      const restored = await schemaRuntime.prepareWrite({ ...decoded, editedValue: { name: "after" } });
      const expected = { name: "after", v2Field: "preserve exactly" };
      expect(new TextEncoder().encode(JSON.stringify(restored))).toEqual(
        new TextEncoder().encode(JSON.stringify(expected)),
      );
    } finally {
      forward[Symbol.dispose]();
      backward[Symbol.dispose]();
      v1[Symbol.dispose]();
      v2[Symbol.dispose]();
    }
  });

  it("fails loudly when foreign-version complement custody is missing", async () => {
    const { schemaRuntime } = runtime();
    await expect(
      schemaRuntime.prepareWrite({
        ...identity,
        value: { oldName: "foreign" },
        editedValue: { oldName: "edited" },
        nativeVersion: "v2",
        viewVersion: "v1",
        chainIds: ["v1-to-v2"],
      }),
    ).rejects.toBeInstanceOf(ComplementConflict);
  });

  it("surfaces Panproto complement fingerprint failures as a typed conflict", async () => {
    const { schemaRuntime } = runtime({ restoreError: new Error("complement fingerprint mismatch") });
    const decoded = await schemaRuntime.decode(identity, { name: "foreign", addedInV2: "preserve" });

    await expect(schemaRuntime.prepareWrite({ ...decoded, editedValue: { oldName: "edited" } })).rejects.toBeInstanceOf(
      ComplementFingerprintMismatch,
    );
  });
});
