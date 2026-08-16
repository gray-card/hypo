import { describe, expect, it, vi } from "vitest";
import {
  isFollowingActivityCollection,
  loadFollowingFeed,
  mergeFollowSources,
  rankFollowingProfiles,
  type FollowProfile,
  type FollowingFeedSnapshot,
} from "../src/following.ts";

const profile = (did: string, handle = `${did.split(":").at(-1)}.test`): FollowProfile => ({
  did,
  handle,
  sources: ["bluesky"],
});

describe("following graph provenance", () => {
  it("unions Grain and Bluesky follows, records both sources, and removes the viewer", () => {
    expect(
      mergeFollowSources(
        [
          { did: "did:plc:alice", handle: "alice.test", displayName: "Alice" },
          { did: "did:plc:viewer", handle: "viewer.test" },
        ],
        [
          { did: "did:plc:alice", handle: "alice.test", avatar: "https://cdn.test/alice.jpg" },
          { did: "did:plc:bob", handle: "bob.test", displayName: "Bob" },
        ],
        "did:plc:viewer",
      ),
    ).toEqual([
      {
        did: "did:plc:alice",
        handle: "alice.test",
        displayName: "Alice",
        avatar: "https://cdn.test/alice.jpg",
        sources: ["grain", "bluesky"],
      },
      {
        did: "did:plc:bob",
        handle: "bob.test",
        displayName: "Bob",
        avatar: undefined,
        sources: ["bluesky"],
      },
    ]);
  });

  it("keeps public photos and semantic graycard records while dropping implementation-level records", () => {
    expect(isFollowingActivityCollection("social.grain.photo")).toBe(true);
    expect(isFollowingActivityCollection("social.grain.gallery")).toBe(true);
    expect(isFollowingActivityCollection("app.graycard.instance.camera")).toBe(true);
    expect(isFollowingActivityCollection("app.graycard.process.developSession")).toBe(true);
    expect(isFollowingActivityCollection("app.graycard.scene.node")).toBe(false);
    expect(isFollowingActivityCollection("app.graycard.scene.edge")).toBe(false);
    expect(isFollowingActivityCollection("app.bsky.feed.post")).toBe(false);
  });
});

describe("following activity loading", () => {
  it("reads only feed-worthy collections and sorts each person's public additions by time", async () => {
    const list = vi.fn(async ({ repo, collection }) => ({
      records:
        collection === "social.grain.photo"
          ? [
              {
                uri: `at://${repo}/${collection}/photo`,
                value: { alt: "Morning fog", createdAt: "2026-08-13T10:00:00.000Z" },
              },
            ]
          : [
              {
                uri: `at://${repo}/${collection}/camera`,
                value: { nickname: "Walkaround", createdAt: "2026-08-12T10:00:00.000Z" },
              },
            ],
    }));
    const onProgress = vi.fn();
    const feed = await loadFollowingFeed("did:plc:viewer", {
      getGrain: async () => [{ did: "did:plc:alice", handle: "alice.test", displayName: "Alice" }],
      getBluesky: async () => [],
      resolvePdsFor: async () => "https://pds.test",
      clientFor: () => ({
        describe: async () => ({
          collections: ["social.grain.photo", "app.graycard.instance.camera", "app.graycard.scene.node"],
        }),
        list,
      }),
      onProgress,
    });

    expect(list.mock.calls.map(([input]) => input.collection).sort()).toEqual([
      "app.graycard.instance.camera",
      "social.grain.photo",
    ]);
    expect(feed.events.map((event) => event.collection)).toEqual([
      "social.grain.photo",
      "app.graycard.instance.camera",
    ]);
    expect(feed.events.every((event) => event.actor.sources.includes("grain"))).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        done: 1,
        total: 1,
        profile: expect.objectContaining({ did: "did:plc:alice" }),
        feed: expect.objectContaining({ events: expect.any(Array) }),
      }),
    );
  });

  it("hydrates referenced catalog records so instance activity can name the item", async () => {
    const stockUri = "at://did:plc:alice/app.graycard.catalog.filmStock/tri-x";
    const get = vi.fn(async () => ({
      uri: stockUri,
      value: { brand: "Kodak", name: "Tri-X 400" },
    }));
    const feed = await loadFollowingFeed("did:plc:viewer", {
      getGrain: async () => [{ did: "did:plc:alice", handle: "alice.test" }],
      getBluesky: async () => [],
      resolvePdsFor: async () => "https://pds.test",
      clientFor: () => ({
        describe: async () => ({ collections: ["app.graycard.instance.filmStockpile"] }),
        list: async () => ({
          records: [
            {
              uri: "at://did:plc:alice/app.graycard.instance.filmStockpile/reserve",
              value: { stock: stockUri, createdAt: "2026-08-13T10:00:00.000Z" },
            },
          ],
        }),
        get,
      }),
    });

    expect(get).toHaveBeenCalledWith({
      repo: "did:plc:alice",
      collection: "app.graycard.catalog.filmStock",
      rkey: "tri-x",
    });
    expect(feed.events[0].references?.[stockUri]).toEqual({ brand: "Kodak", name: "Tri-X 400" });
  });

  it("keeps cached activity, merges new records by URI, and tries known PDS hosts first", async () => {
    const alice = profile("did:plc:alice");
    const cached: FollowingFeedSnapshot = {
      profiles: [alice],
      events: [
        {
          actor: alice,
          pds: "https://known-pds.test",
          uri: "at://did:plc:alice/app.graycard.instance.camera/old",
          cid: "old-cid",
          collection: "app.graycard.instance.camera",
          createdAt: "2026-08-10T10:00:00.000Z",
          value: { nickname: "F2", createdAt: "2026-08-10T10:00:00.000Z" },
        },
      ],
      actorStats: {
        [alice.did]: {
          did: alice.did,
          pds: "https://known-pds.test",
          recordCount: 1,
          latestRecordAt: "2026-08-10T10:00:00.000Z",
          lastScannedAt: "2026-08-10T11:00:00.000Z",
          consecutiveEmptyScans: 0,
        },
      },
    };
    const write = vi.fn(async () => undefined);
    const resolvePdsFor = vi.fn(async () => "https://resolved-pds.test");
    const clientFor = vi.fn(() => ({
      describe: async () => ({ collections: ["app.graycard.instance.camera"] }),
      list: async () => ({
        records: [
          {
            uri: "at://did:plc:alice/app.graycard.instance.camera/new",
            cid: "new-cid",
            value: { nickname: "F3", createdAt: "2026-08-16T10:00:00.000Z" },
          },
        ],
      }),
    }));

    const feed = await loadFollowingFeed("did:plc:viewer", {
      cached,
      cache: { read: async () => cached, write },
      getGrain: async () => [],
      getBluesky: async () => [alice],
      resolvePdsFor,
      clientFor,
      now: () => Date.parse("2026-08-16T12:00:00.000Z"),
    });

    expect(clientFor).toHaveBeenCalledWith("https://known-pds.test");
    expect(resolvePdsFor).not.toHaveBeenCalled();
    expect(feed.events.map((event) => event.uri)).toEqual([
      "at://did:plc:alice/app.graycard.instance.camera/new",
      "at://did:plc:alice/app.graycard.instance.camera/old",
    ]);
    expect(feed.actorStats[alice.did]).toMatchObject({ recordCount: 2, consecutiveEmptyScans: 0 });
    expect(write).toHaveBeenLastCalledWith(
      "did:plc:viewer",
      expect.objectContaining({
        refreshCompletedAt: "2026-08-16T12:00:00.000Z",
        events: expect.arrayContaining([expect.objectContaining({ cid: "old-cid" })]),
      }),
    );
  });

  it("keeps the cached half of the follow graph when one network is temporarily unavailable", async () => {
    const grainOnly = { ...profile("did:plc:grain"), sources: ["grain"] as const };
    const cached: FollowingFeedSnapshot = { profiles: [grainOnly], events: [], actorStats: {} };

    const feed = await loadFollowingFeed("did:plc:viewer", {
      cached,
      getGrain: async () => {
        throw new Error("Grain unavailable");
      },
      getBluesky: async () => [profile("did:plc:bluesky")],
      resolvePdsFor: async () => "https://pds.test",
      clientFor: () => ({ describe: async () => ({ collections: [] }), list: async () => ({ records: [] }) }),
      concurrency: 1,
    });

    expect(feed.profiles.map((candidate) => candidate.did).sort()).toEqual(["did:plc:bluesky", "did:plc:grain"]);
  });
});

describe("following refresh priority", () => {
  it("checks known publishers before unknown and repeatedly empty accounts", () => {
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    const prolific = profile("did:plc:prolific", "prolific.test");
    const recent = profile("did:plc:recent", "recent.test");
    const unknown = profile("did:plc:unknown", "unknown.test");
    const empty = profile("did:plc:empty", "empty.test");

    expect(
      rankFollowingProfiles(
        [empty, unknown, recent, prolific],
        {
          [prolific.did]: {
            did: prolific.did,
            recordCount: 20,
            latestRecordAt: "2026-05-01T12:00:00.000Z",
            lastScannedAt: "2026-08-15T12:00:00.000Z",
            consecutiveEmptyScans: 0,
          },
          [recent.did]: {
            did: recent.did,
            recordCount: 3,
            latestRecordAt: "2026-08-16T11:00:00.000Z",
            lastScannedAt: "2026-08-16T11:00:00.000Z",
            consecutiveEmptyScans: 0,
          },
          [empty.did]: {
            did: empty.did,
            recordCount: 0,
            lastScannedAt: "2026-08-01T12:00:00.000Z",
            consecutiveEmptyScans: 4,
          },
        },
        now,
      ).map((candidate) => candidate.did),
    ).toEqual([prolific.did, recent.did, unknown.did, empty.did]);
  });
});
