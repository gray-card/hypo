import { describe, expect, it } from "vitest";
import { MemoryDatabase, type CreateOperationRecord } from "@hypo/sync";
import { RepositoryRecordCache } from "@hypo/store";

describe("repository record cache", () => {
  it("replaces one repo collection without disturbing another", async () => {
    const database = new MemoryDatabase();
    const cache = new RepositoryRecordCache(database, () => 42);
    await cache.replace("did:plc:a", "camera", [
      { uri: "at://did:plc:a/camera/1", cid: "cid-1", value: { nickname: "one" } },
      { uri: "at://did:plc:a/camera/2", cid: "cid-2", value: { nickname: "two" } },
    ]);
    await expect(cache.hasSnapshot("did:plc:a", "camera")).resolves.toBe(true);
    await expect(cache.hasSnapshot("did:plc:a", "unread")).resolves.toBe(false);
    await cache.replace("did:plc:a", "lens", [
      { uri: "at://did:plc:a/lens/1", cid: "cid-lens", value: { nickname: "lens" } },
    ]);
    await cache.replace("did:plc:a", "camera", [
      { uri: "at://did:plc:a/camera/2", cid: "cid-new", value: { nickname: "updated" } },
    ]);

    await expect(cache.read("did:plc:a", "camera")).resolves.toEqual([
      { uri: "at://did:plc:a/camera/2", cid: "cid-new", value: { nickname: "updated" } },
    ]);
    await expect(cache.read("did:plc:a", "lens")).resolves.toHaveLength(1);
  });

  it("patches acknowledgements and rewrites cached temp-URI references without inventing a snapshot", async () => {
    const database = new MemoryDatabase();
    const cache = new RepositoryRecordCache(database, () => 84);
    const repo = "did:plc:ack-cache";
    const rolls = "app.graycard.instance.filmRoll";
    const exposures = "app.graycard.instance.exposure";
    const tempUri = `outbox://${rolls}/create-roll`;
    const realUri = `at://${repo}/${rolls}/roll-a`;
    await cache.replace(repo, exposures, [
      {
        uri: `at://${repo}/${exposures}/frame-a`,
        cid: "cid-frame",
        value: { roll: tempUri, provenance: { sources: [tempUri] } },
      },
    ]);
    const operation: CreateOperationRecord = {
      id: "create-roll",
      repo,
      collection: rolls,
      kind: "create",
      record: { status: "loaded" },
      tempUri,
      status: "pending",
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0,
    };

    await cache.applyAcknowledgement({ operation, tempUri, uri: realUri, cid: "cid-roll" });

    await expect(cache.read(repo, rolls)).resolves.toEqual([
      { uri: realUri, cid: "cid-roll", value: { status: "loaded" } },
    ]);
    await expect(cache.read(repo, exposures)).resolves.toEqual([
      {
        uri: `at://${repo}/${exposures}/frame-a`,
        cid: "cid-frame",
        value: { roll: realUri, provenance: { sources: [realUri] } },
      },
    ]);
    await expect(cache.hasSnapshot(repo, rolls)).resolves.toBe(false);
    await expect(cache.hasSnapshot(repo, exposures)).resolves.toBe(true);
  });
});
