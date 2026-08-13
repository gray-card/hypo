import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter, matchRoute, routePath, routeNames } from "../src/router.js";

describe("route contract", () => {
  it("matches every v1 route and decodes parameters", () => {
    expect(matchRoute("/")).toMatchObject({ name: "home", params: {} });
    expect(matchRoute("/galleries")).toMatchObject({ name: "galleries", params: {} });
    expect(matchRoute("/library/film")).toMatchObject({ name: "library", params: { tab: "film" } });
    expect(matchRoute("/gallery/abc")).toMatchObject({ name: "gallery", params: { rkey: "abc" } });
    expect(matchRoute("/roll/r1")).toMatchObject({ name: "roll", params: { rkey: "r1" } });
    expect(matchRoute("/gear/camera/body%201")).toMatchObject({
      name: "gear",
      params: { kind: "camera", rkey: "body 1" },
    });
    expect(matchRoute("/timer").name).toBe("timer");
    expect(matchRoute("/meter").name).toBe("meter");
    expect(matchRoute("/following").name).toBe("following");
    expect(matchRoute("/discover").name).toBe("discover");
    expect(matchRoute("/profile/did%3Aplc%3Aalice")).toMatchObject({
      name: "profile",
      params: { handle: "did:plc:alice" },
    });
    expect(matchRoute("/profile/alice.test/gear")).toMatchObject({
      name: "profileSection",
      params: { handle: "alice.test", section: "gear" },
    });
    expect(routeNames).toEqual([
      "home",
      "galleries",
      "library",
      "gallery",
      "roll",
      "gear",
      "timer",
      "meter",
      "following",
      "discover",
      "profileSection",
      "profile",
    ]);
  });

  it("honors a deployment base and rejects paths outside it", () => {
    expect(matchRoute("/hypo/profile/alice.test", { base: "/hypo/" }).name).toBe("profile");
    expect(matchRoute("/other/profile/alice.test", { base: "/hypo/" }).name).toBe("notFound");
    expect(routePath("library", { tab: "gear" }, { base: "/hypo/" })).toBe("/hypo/library/gear");
  });

  it("constructs encoded paths and requires named parameters", () => {
    expect(routePath("profile", { handle: "did:plc:alice" })).toBe("/profile/did%3Aplc%3Aalice");
    expect(routePath("galleries")).toBe("/galleries");
    expect(routePath("following")).toBe("/following");
    expect(routePath("gear", { kind: "camera", rkey: "body 1" })).toBe("/gear/camera/body%201");
    expect(routePath("profileSection", { handle: "a.test", section: "recent work" })).toBe(
      "/profile/a.test/recent%20work",
    );
    expect(() => routePath("roll", {})).toThrow(/rkey/);
    expect(() => routePath("missing")).toThrow(/Unknown route/);
  });

  it("notifies navigation, replacement, and popstate subscribers", () => {
    history.replaceState({}, "", "/");
    const router = createRouter();
    const listener = vi.fn();
    const unsubscribe = router.subscribe(listener, { immediate: true });
    router.navigate("timer", {}, { source: "test" });
    router.replace("meter");
    history.pushState({}, "", "/discover");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener.mock.calls.map(([route]) => route.name)).toEqual(["home", "timer", "meter", "discover"]);
    unsubscribe();
    router.destroy();
  });

  it("refreshes the current route without writing history and stops after destroy", () => {
    history.replaceState({ preserved: true }, "", "/library/scanning");
    const router = createRouter();
    const listener = vi.fn();
    router.subscribe(listener);

    expect(router.refresh()).toMatchObject({ name: "library", params: { tab: "scanning" } });
    expect(history.state).toEqual({ preserved: true });
    expect(listener).toHaveBeenCalledTimes(1);

    router.destroy();
    history.pushState({}, "", "/discover");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => history.replaceState({}, "", "/"));
