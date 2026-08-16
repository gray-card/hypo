import { MemoryDatabase } from "@hypo/sync";
import { describe, expect, it } from "vitest";
import { FollowingFeedCache } from "../src/followingCache.ts";
import type { FollowingFeedSnapshot } from "../src/following.ts";

describe("following feed cache", () => {
  it("persists a versioned device snapshot across cache instances", async () => {
    const database = new MemoryDatabase();
    const first = new FollowingFeedCache(database);
    const actor = { did: "did:plc:alice", handle: "alice.test", sources: ["grain"] as const };
    const snapshot: FollowingFeedSnapshot = {
      profiles: [actor],
      events: [
        {
          actor,
          pds: "https://pds.test",
          uri: "at://did:plc:alice/social.grain.photo/photo",
          cid: "photo-cid",
          collection: "social.grain.photo",
          value: { createdAt: "2026-08-16T10:00:00.000Z" },
          createdAt: "2026-08-16T10:00:00.000Z",
        },
      ],
      actorStats: {
        [actor.did]: {
          did: actor.did,
          pds: "https://pds.test",
          recordCount: 1,
          latestRecordAt: "2026-08-16T10:00:00.000Z",
          lastScannedAt: "2026-08-16T11:00:00.000Z",
          consecutiveEmptyScans: 0,
        },
      },
      cachedAt: "2026-08-16T11:00:00.000Z",
      refreshCompletedAt: "2026-08-16T11:00:00.000Z",
    };

    await first.write("did:plc:viewer", snapshot);
    const restored = await new FollowingFeedCache(database).read("did:plc:viewer");

    expect(restored).toEqual(snapshot);
    expect(restored).not.toBe(snapshot);
  });
});
