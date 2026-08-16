import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clusterFollowingActivity,
  followingActivityTarget,
  followingActivityText,
  renderFollowing,
} from "../src/ui/followingView.ts";
import type { FollowProfile, FollowingActivity } from "../src/following.ts";

const actor: FollowProfile = {
  did: "did:plc:alice",
  handle: "alice.test",
  displayName: "Alice",
  sources: ["grain", "bluesky"],
};

function event(collection: string, rkey: string, createdAt: string, value = {}): FollowingActivity {
  return {
    actor,
    pds: "https://pds.test",
    uri: `at://${actor.did}/${collection}/${rkey}`,
    collection,
    createdAt,
    value: { createdAt, ...value },
  };
}

describe("following activity presentation", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="following-body"></div>';
  });

  it("groups related records saved together by the same photographer", () => {
    const clusters = clusterFollowingActivity([
      event("app.graycard.catalog.cameraType", "f2", "2026-08-13T10:00:00.000Z"),
      event("app.graycard.instance.camera", "body", "2026-08-13T10:01:00.000Z"),
      event("social.grain.photo", "photo", "2026-08-12T10:00:00.000Z"),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].events).toHaveLength(2);
    expect(clusters[1].events[0].collection).toBe("social.grain.photo");
  });

  it("turns records into approachable activity rather than exposing collection identifiers", () => {
    const cameraType = event("app.graycard.catalog.cameraType", "f2", "2026-08-13T10:00:00.000Z", {
      make: "Nikon",
      model: "F2",
    });
    const camera = event("app.graycard.instance.camera", "body", "2026-08-13T10:00:30.000Z", {
      type: cameraType.uri,
    });

    expect(followingActivityText(camera, [cameraType, camera])).toBe("added Nikon F2 to their setup");
    expect(followingActivityText(event("app.graycard.process.developSession", "dev", "2026-08-13T11:00:00.000Z"))).toBe(
      "logged a development session",
    );
    expect(
      followingActivityText(event("app.graycard.process.renderSession", "render", "2026-08-13T11:30:00.000Z")),
    ).toBe("logged a render/export session");
    expect(
      followingActivityText(event("social.grain.photo", "photo", "2026-08-13T12:00:00.000Z", { alt: "Morning fog" })),
    ).toBe("added a photo: Morning fog");

    const stockUri = `at://${actor.did}/app.graycard.catalog.filmStock/tri-x`;
    const reserve = event("app.graycard.instance.filmStockpile", "reserve", "2026-08-13T12:30:00.000Z", {
      stock: stockUri,
    });
    reserve.references = { [stockUri]: { brand: "Kodak", name: "Tri-X 400" } };
    expect(followingActivityText(reserve)).toBe("added Kodak Tri-X 400 to their film reserve");
  });

  it("links gallery activity to the exact Grain gallery and Graycard activity to the public Hypo profile", () => {
    const gallery = event("social.grain.gallery", "summer-light", "2026-08-13T12:00:00.000Z", {
      title: "Summer light",
    });
    expect(followingActivityTarget(gallery)).toEqual({
      href: "https://grain.social/profile/did:plc:alice/gallery/summer-light",
      external: true,
      title: "View this gallery on Grain",
    });
    expect(followingActivityTarget(event("app.graycard.instance.camera", "f2", "2026-08-13T12:00:00.000Z"))).toEqual({
      href: "/profile/alice.test",
      external: false,
      title: "View @alice.test's public Hypo profile",
    });
  });

  it("renders activity first and keeps every followed person with explicit network provenance", () => {
    const blueskyOnly: FollowProfile = {
      did: "did:plc:bob",
      handle: "bob.test",
      displayName: "Bob",
      sources: ["bluesky"],
    };
    const navigateProfile = vi.fn();
    renderFollowing(
      document.querySelector("#following-body") as HTMLElement,
      {
        profiles: [actor, blueskyOnly],
        events: [event("app.graycard.instance.camera", "body", "2026-08-13T10:00:00.000Z", { nickname: "F2" })],
      },
      navigateProfile,
    );

    expect(document.querySelector(".following-feed")?.textContent).toContain("added F2 to their setup");
    expect(document.querySelector(".following-feed")?.textContent).not.toContain("app.graycard");
    expect(document.querySelectorAll(".following-person")).toHaveLength(2);
    expect([...document.querySelectorAll(".follow-source")].map((badge) => badge.textContent)).toContain(
      "Grain + Bluesky",
    );
    expect([...document.querySelectorAll(".follow-source")].map((badge) => badge.textContent)).toContain("Bluesky");

    (document.querySelector(".following-person-link") as HTMLAnchorElement).click();
    expect(navigateProfile).toHaveBeenCalledWith("alice.test");
  });

  it("renders useful activity lines as links", () => {
    const navigateProfile = vi.fn();
    renderFollowing(
      document.querySelector("#following-body") as HTMLElement,
      {
        profiles: [actor],
        events: [
          event("social.grain.gallery", "summer-light", "2026-08-13T11:00:00.000Z", { title: "Summer light" }),
          event("app.graycard.instance.camera", "f2", "2026-08-13T10:00:00.000Z", { nickname: "F2" }),
        ],
      },
      navigateProfile,
    );

    const links = [...document.querySelectorAll<HTMLAnchorElement>(".activity-line-link")];
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe("https://grain.social/profile/did:plc:alice/gallery/summer-light");
    expect(links[0].target).toBe("_blank");
    links[1].click();
    expect(navigateProfile).toHaveBeenCalledWith("alice.test");
  });

  it("reuses unchanged feed and roster nodes while inserting new activity", () => {
    const host = document.querySelector("#following-body") as HTMLElement;
    const navigateProfile = vi.fn();
    const oldEvent = event("app.graycard.instance.camera", "f2", "2026-08-13T10:00:00.000Z", {
      nickname: "F2",
    });
    renderFollowing(host, { profiles: [actor], events: [oldEvent] }, navigateProfile, {
      status: "Showing saved activity.",
    });
    const oldArticle = host.querySelector<HTMLElement>(".following-event");
    const oldPerson = host.querySelector<HTMLElement>(".following-person");

    renderFollowing(
      host,
      {
        profiles: [actor],
        events: [event("social.grain.gallery", "summer", "2026-08-14T10:00:00.000Z", { title: "Summer" }), oldEvent],
      },
      navigateProfile,
      { status: "Checking updates…", refreshing: true },
    );

    expect(host.querySelectorAll(".following-event")).toHaveLength(2);
    expect([...host.querySelectorAll(".following-event")]).toContain(oldArticle);
    expect(host.querySelector(".following-person")).toBe(oldPerson);
    expect(host.querySelector(".following-cache-status")?.textContent).toBe("Checking updates…");
    expect(host.querySelector(".following-cache-status")?.classList).toContain("refreshing");
  });
});
