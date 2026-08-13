import { describe, expect, it, vi } from "vitest";
import { isFollowingActivityCollection, loadFollowingFeed, mergeFollowSources } from "../src/following.ts";

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
    expect(onProgress).toHaveBeenCalledWith({
      done: 1,
      total: 1,
      profile: expect.objectContaining({ did: "did:plc:alice" }),
    });
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
});
