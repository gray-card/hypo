import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionController, stripOAuthCallbackParams } from "../apps/web/src/pds/session.ts";
import { createGalleryListView, deriveGalleryPresentation } from "../apps/web/src/views/galleries/index.ts";
import { createShell } from "../apps/web/src/shell.ts";

const icon = (name) => {
  const node = document.createElement("span");
  node.dataset.icon = name;
  return node;
};

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  localStorage.clear();
});

describe("session app boundary", () => {
  it("strips only OAuth callback parameters while retaining the route", () => {
    expect(
      stripOAuthCallbackParams("https://hypo.graycard.app/profile/alice.test?code=abc&view=gear&state=xyz#cameras"),
    ).toBe("/profile/alice.test?view=gear#cameras");
    expect(stripOAuthCallbackParams("https://hypo.graycard.app/?view=gear")).toBeNull();
  });

  it("restores a loopback session and exposes the authenticated app context", async () => {
    const session = { did: "did:plc:alice" };
    const oauthClient = {
      init: vi.fn(async () => ({ session })),
      signIn: vi.fn(async () => undefined),
    };
    const loadBrowserClient = vi.fn(async () => oauthClient);
    const onAuthenticated = vi.fn();
    const controller = createSessionController({
      location: {
        hostname: "127.0.0.1",
        href: "http://127.0.0.1:5173/",
        origin: "http://127.0.0.1:5173",
        reload: vi.fn(),
      },
      history: { replaceState: vi.fn() },
      loadScope: async () => "repo:one blob:*/*",
      loadBrowserClient,
      createAgent: async () => ({ kind: "agent" }),
      onAuthenticated,
      onLoggedOut: vi.fn(),
    });

    await controller.bootstrap();

    expect(loadBrowserClient).toHaveBeenCalledWith({
      clientId: "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2F&scope=repo%3Aone%20blob%3A*%2F*",
      handleResolver: "https://bsky.social",
    });
    expect(onAuthenticated).toHaveBeenCalledWith({
      agent: { kind: "agent" },
      did: "did:plc:alice",
      session,
    });
  });

  it("cleans an abandoned callback and returns to the logged-out shell", async () => {
    const replaceState = vi.fn();
    const onLoggedOut = vi.fn();
    const controller = createSessionController({
      location: {
        hostname: "hypo.graycard.app",
        href: "https://hypo.graycard.app/?code=stale&state=gone&next=setup",
        origin: "https://hypo.graycard.app",
        reload: vi.fn(),
      },
      history: { replaceState },
      loadScope: async () => "repo:one",
      loadBrowserClient: async () => ({
        init: async () => {
          throw new Error("Unknown authorization session");
        },
        signIn: vi.fn(),
      }),
      onAuthenticated: vi.fn(),
      onLoggedOut,
      logger: { warn: vi.fn() },
    });

    await controller.bootstrap();

    expect(replaceState).toHaveBeenCalledWith(null, "", "/?next=setup");
    expect(onLoggedOut).toHaveBeenCalledOnce();
  });
});

describe("gallery-list boundary", () => {
  it("derives the ordered cover and Gray Card coverage independently of the DOM", () => {
    const gallery = "at://did/social.grain.gallery/summer";
    const first = "at://did/social.grain.photo/first";
    const second = "at://did/social.grain.photo/second";
    const result = deriveGalleryPresentation(
      [
        { uri: "at://item/2", value: { gallery, item: second, position: 2 } },
        { uri: "at://item/1", value: { gallery, item: first, position: 1 } },
      ],
      [
        { uri: first, value: { photo: { ref: "cover" } } },
        { uri: second, value: { photo: { ref: "other" } } },
      ],
      [{ uri: "at://capture/1", value: { photo: first, camera: "at://camera" } }],
      [{ uri: "at://workflow/1", value: { photo: second } }],
      [{ uri: "at://scene/1", value: { subject: first } }],
    );

    expect(result.covers.get(gallery)).toEqual({ ref: "cover" });
    expect(result.coverage.get(gallery)).toEqual({ total: 2, gear: 1, wf: 1, sc: 1 });
  });

  it("loads, renders, and routes a gallery through injected app services", async () => {
    document.body.innerHTML = `
      <p id="list-status"></p>
      <input id="gallery-search">
      <button id="reload-galleries"></button>
      <button id="new-gallery"></button>
      <ul id="gallery-list"></ul>
      <div id="editor-hero" class="hidden"></div>
    `;
    const gallery = "at://did/social.grain.gallery/summer";
    const photo = "at://did/social.grain.photo/first";
    const activate = vi.fn();
    const navigate = vi.fn();
    const showView = vi.fn();
    const providers = {
      getGalleries: vi.fn(async () => [{ uri: gallery, value: { title: "Summer", description: "Lake" } }]),
      listRecords: vi.fn(async (_agent, _did, collection) => {
        if (collection === "gallery.item") return [{ uri: "at://item/1", value: { gallery, item: photo } }];
        if (collection === "photo") return [{ uri: photo, value: { photo: { ref: "cover" } } }];
        if (collection === "capture") return [{ uri: "at://capture/1", value: { photo, camera: "camera" } }];
        return [];
      }),
      collections: { galleryItem: "gallery.item", photo: "photo" },
      ns: { photo: { capture: "capture", workflow: "workflow" }, scene: { graph: "scene" } },
      lazyThumb: vi.fn(() => {
        const thumb = document.createElement("div");
        thumb.className = "gallery-thumb";
        return thumb;
      }),
    };
    const view = createGalleryListView({
      icon,
      getSession: () => ({ agent: {}, did: "did:plc:alice" }),
      loadProviders: async () => providers,
      fuzzyFilter: (_query, galleries) => galleries,
      showView,
      activate,
      navigate,
      createGallery: vi.fn(),
    });

    view.install();
    await view.load();

    expect(document.querySelector(".g-title").textContent).toBe("Summer");
    expect(document.querySelector(".cov-row").textContent).toContain("gear 1/1");
    document.querySelector(".gallery-row").click();
    expect(activate).toHaveBeenCalledOnce();
    expect(showView).toHaveBeenLastCalledWith("editor-view");
    expect(navigate).toHaveBeenCalledWith(gallery);
  });
});

describe("application shell boundary", () => {
  it("renders session chrome and dispatches account-menu actions", async () => {
    document.body.innerHTML = `
      <nav id="primary-nav" class="hidden"><button data-section="setup"></button></nav>
      <nav id="bottom-nav" class="hidden">
        <button class="nav-item" data-section="setup"><span class="nav-ico"></span></button>
        <button id="bottom-account"><span class="nav-ico"></span></button>
      </nav>
      <button id="theme-toggle"></button>
      <button id="shortcuts-btn"></button>
      <div id="session" class="hidden"></div>
      <div id="account-menu" class="hidden"></div>
      <div id="editor-view" class="hidden"></div>
      <input id="handle">
    `;
    const refreshAccountData = vi.fn();
    const shell = createShell({
      icon,
      showView: vi.fn(),
      withTransition: (mutation) => mutation(),
      fetch: vi.fn(async () => ({
        ok: true,
        json: async () => ({ handle: "alice.test", avatar: "https://cdn.test/avatar.jpg" }),
      })),
      actions: {
        navigateSection: vi.fn(),
        navigateProfile: vi.fn(),
        shareSetup: vi.fn(),
        openConflictTray: vi.fn(),
        refreshAccountData,
        openBundle: vi.fn(),
        openSettings: vi.fn(),
        signOut: vi.fn(),
        openShortcuts: vi.fn(),
        openPalette: vi.fn(),
        saveAllDirty: vi.fn(),
        navigatePhotos: vi.fn(),
        hasSession: () => true,
      },
    });

    shell.install({ setup: { icon: "camera" } });
    await shell.showAuthenticated("did:plc:alice");
    document.querySelector("#account-btn").click();

    expect(document.querySelector("#session img").src).toBe("https://cdn.test/avatar.jpg");
    expect(document.querySelector(".menu-account").textContent).toBe("@alice.test");
    expect(document.querySelector("#primary-nav").classList.contains("hidden")).toBe(false);
    [...document.querySelectorAll("#account-menu button")]
      .find((button) => button.textContent === "Refresh from PDS")
      .click();
    expect(refreshAccountData).toHaveBeenCalledOnce();
    expect(document.querySelector("#account-menu").classList.contains("hidden")).toBe(true);
  });
});
