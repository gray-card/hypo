import { describe, expect, it, vi } from "vitest";
import { cachedImport, createAppBootstrap, isPublicProfileRoute, routeErrorTarget } from "../apps/web/src/bootstrap.ts";

function bootstrapHarness({
  route = { name: "home", params: {} },
  session = { agent: null, did: null },
  needsOnboarding = false,
} = {}) {
  let currentRoute = route;
  let routeListener;
  const state = { ...session };
  const installAutoFlush = vi.fn();
  const onboarding = {
    needsOnboarding: vi.fn(() => needsOnboarding),
    openOnboarding: vi.fn(),
  };
  const services = {
    router: {
      current: () => currentRoute,
      subscribe: vi.fn((listener) => {
        routeListener = listener;
      }),
    },
    session: () => state,
    setSession: vi.fn((next) => Object.assign(state, next)),
    showAuthenticated: vi.fn(),
    showLoggedOut: vi.fn(),
    loadOutbox: vi.fn(async () => ({ installAutoFlush })),
    loadOnboarding: vi.fn(async () => onboarding),
    libraryFeature: vi.fn(async () => ({ getStore: () => ({ kind: "store" }) })),
    openLibraryRecord: vi.fn(async () => undefined),
    closeLibraryRecord: vi.fn(),
    goSection: vi.fn(async () => undefined),
    navigateSection: vi.fn(),
    setLibraryTab: vi.fn(),
    setActiveSection: vi.fn(),
    showView: vi.fn(),
    openGallery: vi.fn(async () => undefined),
    openMeter: vi.fn(async () => undefined),
    showProfile: vi.fn(async () => undefined),
    showFeatureLoadError: vi.fn(),
    setLoginError: vi.fn(),
    toast: vi.fn(),
    logger: { warn: vi.fn() },
  };
  const bootstrap = createAppBootstrap(services);
  return {
    bootstrap,
    installAutoFlush,
    onboarding,
    services,
    state,
    navigate(route) {
      currentRoute = route;
      routeListener(route);
    },
  };
}

describe("web bootstrap boundary", () => {
  it("deduplicates lazy imports and evicts a rejected request for retry", async () => {
    let resolveImport;
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveImport = resolve;
          }),
      );
    const load = cachedImport(importer);

    await expect(load()).rejects.toThrow("chunk unavailable");
    const first = load();
    const second = load();
    expect(importer).toHaveBeenCalledTimes(2);
    resolveImport({ feature: "ready" });

    await expect(first).resolves.toEqual({ feature: "ready" });
    await expect(second).resolves.toEqual({ feature: "ready" });
    expect(load.peek()).toEqual({ feature: "ready" });
  });

  it("cold-loads an authenticated gallery and schedules outbox flushing", async () => {
    const harness = bootstrapHarness({ route: { name: "gallery", params: { rkey: "summer" } } });
    const controller = {
      bootstrap: vi.fn(async () => {
        harness.bootstrap.onAuthenticated({ agent: { kind: "agent" }, did: "did:plc:alice" });
      }),
      clearOAuthCallbackParams: vi.fn(),
    };

    await harness.bootstrap.start(controller);
    await vi.waitFor(() => expect(harness.installAutoFlush).toHaveBeenCalledOnce());

    expect(harness.services.setSession).toHaveBeenCalledWith({
      agent: { kind: "agent" },
      did: "did:plc:alice",
    });
    expect(harness.services.showAuthenticated).toHaveBeenCalledWith("did:plc:alice");
    expect(harness.services.setActiveSection).toHaveBeenCalledWith("galleries");
    expect(harness.services.showView).toHaveBeenCalledWith("editor-view");
    expect(harness.services.openGallery).toHaveBeenCalledWith("at://did:plc:alice/social.grain.gallery/summer");

    const onFlushed = harness.installAutoFlush.mock.calls[0][2];
    onFlushed({ sent: 2 });
    expect(harness.services.toast).toHaveBeenCalledWith("Synced 2 offline shots", "ok");
  });

  it("disposes the active auto-flush scheduler across re-authentication and logout", async () => {
    const harness = bootstrapHarness();
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    harness.installAutoFlush.mockReturnValueOnce(disposeFirst).mockReturnValueOnce(disposeSecond);

    harness.bootstrap.onAuthenticated({ agent: { id: 1 }, did: "did:plc:first" });
    await vi.waitFor(() => expect(harness.installAutoFlush).toHaveBeenCalledTimes(1));
    harness.bootstrap.onAuthenticated({ agent: { id: 2 }, did: "did:plc:second" });
    await vi.waitFor(() => expect(harness.installAutoFlush).toHaveBeenCalledTimes(2));

    expect(disposeFirst).toHaveBeenCalledOnce();
    harness.bootstrap.onLoggedOut();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(harness.services.showLoggedOut).toHaveBeenCalledOnce();
  });

  it("runs onboarding after the initial setup route and preserves destination tabs", async () => {
    const harness = bootstrapHarness({
      route: { name: "library", params: { tab: "scanning" } },
      session: { agent: { kind: "agent" }, did: "did:plc:alice" },
      needsOnboarding: true,
    });
    await harness.bootstrap.start({
      bootstrap: vi.fn(async () => undefined),
      clearOAuthCallbackParams: vi.fn(),
    });

    expect(harness.services.setLibraryTab).toHaveBeenCalledWith("scanning");
    expect(harness.services.goSection).toHaveBeenCalledWith("setup");
    expect(harness.onboarding.needsOnboarding).toHaveBeenCalledWith({ kind: "store" }, "did:plc:alice");
    expect(harness.onboarding.openOnboarding).toHaveBeenCalledOnce();

    const { onDone } = harness.onboarding.openOnboarding.mock.calls[0][0];
    onDone("setup-film");
    expect(harness.services.setLibraryTab).toHaveBeenLastCalledWith("film");
    expect(harness.services.navigateSection).toHaveBeenCalledWith("setup");
  });

  it("keeps the authenticated session and auto-flush scheduler when onboarding cannot load", async () => {
    const harness = bootstrapHarness();
    const disposeAutoFlush = vi.fn();
    harness.installAutoFlush.mockReturnValue(disposeAutoFlush);
    harness.services.loadOnboarding.mockRejectedValue(new Error("offline chunk request"));
    const controller = {
      bootstrap: vi.fn(async () => {
        harness.bootstrap.onAuthenticated({ agent: { kind: "agent" }, did: "did:plc:alice" });
      }),
      clearOAuthCallbackParams: vi.fn(),
    };

    await harness.bootstrap.start(controller);
    await vi.waitFor(() => expect(harness.installAutoFlush).toHaveBeenCalledOnce());

    expect(harness.services.showLoggedOut).not.toHaveBeenCalled();
    expect(disposeAutoFlush).not.toHaveBeenCalled();
    expect(controller.clearOAuthCallbackParams).not.toHaveBeenCalled();
    expect(harness.services.setLoginError).not.toHaveBeenCalled();
    expect(harness.services.logger.warn).toHaveBeenCalledWith("Onboarding could not start:", "offline chunk request");
  });

  it.each([
    ["galleries", {}, "goSection", "galleries"],
    ["timer", {}, "setLibraryTab", "darkroom"],
    ["meter", {}, "openMeter", undefined],
    ["following", {}, "goSection", "following"],
    ["discover", {}, "goSection", "discover"],
    ["notFound", {}, "goSection", "setup"],
  ])("dispatches the %s route through its injected app service", async (name, params, service, value) => {
    const harness = bootstrapHarness({ session: { agent: { kind: "agent" }, did: "did:plc:alice" } });

    await harness.bootstrap.renderRoute({ name, params });

    if (value === undefined) expect(harness.services[service]).toHaveBeenCalledOnce();
    else expect(harness.services[service]).toHaveBeenCalledWith(value);
    if (name === "timer") {
      expect(harness.services.goSection).toHaveBeenCalledWith("setup");
    }
  });

  it.each([
    [{ name: "roll", params: { rkey: "roll-1" } }, "film", { type: "roll", rkey: "roll-1" }],
    [
      { name: "gear", params: { kind: "scanner", rkey: "scan-1" } },
      "scanning",
      { type: "gear", kind: "scanner", rkey: "scan-1" },
    ],
  ])("cold-loads the $route.name record modal after its Library context", async (route, tab, target) => {
    const harness = bootstrapHarness({ route, session: { agent: { kind: "agent" }, did: "did:plc:alice" } });

    await harness.bootstrap.renderRoute(route);

    expect(harness.services.closeLibraryRecord).toHaveBeenCalledOnce();
    expect(harness.services.setLibraryTab).toHaveBeenCalledWith(tab);
    expect(harness.services.goSection).toHaveBeenCalledWith("setup");
    expect(harness.services.openLibraryRecord).toHaveBeenCalledWith(target);
  });

  it("suppresses a stale route failure after a newer route finishes", async () => {
    let rejectProfile;
    const harness = bootstrapHarness({ session: { agent: { kind: "agent" }, did: "did:plc:alice" } });
    harness.services.showProfile.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectProfile = reject;
        }),
    );

    const stale = harness.bootstrap.renderRoute({ name: "profile", params: { handle: "alice.test" } });
    const current = harness.bootstrap.renderRoute({ name: "home", params: {} });
    rejectProfile(new Error("old profile failed"));
    await Promise.all([stale, current]);

    expect(harness.services.showFeatureLoadError).not.toHaveBeenCalled();
    expect(harness.services.toast).not.toHaveBeenCalled();
  });

  it("still renders a public-profile deep link when session startup fails", async () => {
    const route = { name: "profile", params: { handle: "alice.test" } };
    const harness = bootstrapHarness({ route });
    const controller = {
      bootstrap: vi.fn(async () => {
        throw new Error("expired callback");
      }),
      clearOAuthCallbackParams: vi.fn(),
    };

    await harness.bootstrap.start(controller);

    expect(controller.clearOAuthCallbackParams).toHaveBeenCalledOnce();
    expect(harness.services.showLoggedOut).toHaveBeenCalledOnce();
    expect(harness.services.showProfile).toHaveBeenCalledWith("alice.test");
    expect(harness.services.setLoginError).not.toHaveBeenCalled();
    expect(isPublicProfileRoute(route)).toBe(true);
    expect(routeErrorTarget(route)).toBe("#profile-body");
  });
});
