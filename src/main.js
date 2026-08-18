// main.js: Hypo

// Self-hosted, Latin-only variable fonts (bundled by Vite, no external requests).
import "./fonts.css";

import {
  el,
  $,
  showView,
  withTransition,
  toast,
  isAdvanced,
  setAdvanced,
  openModal,
  getVisionConfig,
  setVisionConfig,
  loadPhase,
} from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { fuzzyFilter, fuzzyMatches } from "./ui/fuzzy.js";
import { createRouter } from "./router.js";
import { createSessionController } from "../apps/web/src/pds/session.ts";
import { createGalleryListView } from "../apps/web/src/views/galleries/index.ts";
import { createShell, segmentedControl } from "../apps/web/src/shell.ts";
import { createSettingsActions } from "../apps/web/src/actions/settings.ts";
import { createShortcutActions } from "../apps/web/src/actions/shortcuts.ts";
import { createShareActions } from "../apps/web/src/actions/share.ts";
import { createPaletteCommands } from "../apps/web/src/actions/palette.ts";
import { cachedImport, createAppBootstrap } from "../apps/web/src/bootstrap.ts";
import { createLibraryRecordHistory } from "../apps/web/src/routes/library-record-history.ts";
import { installPreloadRecovery } from "../apps/web/src/preload-recovery.ts";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
const router = createRouter({ base: BASE });
const libraryRecordHistory = createLibraryRecordHistory({ router, history });

const loadOAuthScope = cachedImport(() => import("./oauthScope.js"));
const loadGrain = cachedImport(() => import("./grain.js"));
const loadGraycard = cachedImport(() => import("./graycard.js"));
const loadLibraryModule = cachedImport(() => import("./ui/library.js"));
const loadOnboardingModule = cachedImport(() => import("./ui/onboarding.js"));
const loadEditorModule = cachedImport(() => import("./ui/editor.js"));
const loadImportModule = cachedImport(() => import("./ui/importUI.js"));
const loadUploadModule = cachedImport(() => import("./ui/uploadUI.js"));
const loadProfileModule = cachedImport(() => import("./ui/profileView.js"));
const loadFollowingModule = cachedImport(() => import("./ui/followingView.ts"));
const loadPublishModule = cachedImport(() => import("./ui/publishUI.js"));
const loadPaletteModule = cachedImport(() => import("./ui/palette.js"));
const loadLazyThumbModule = cachedImport(() => import("./ui/lazy.js"));
const loadMeterModule = cachedImport(() => import("./ui/meter.js"));
const loadConflictTrayModule = cachedImport(() => import("./ui/conflictTray.js"));
const loadVisionModule = cachedImport(() => import("./vision.js"));
const loadRegistryModule = cachedImport(() => import("./registry.js"));
const loadOutboxModule = cachedImport(() => import("./outbox.js"));

let agent, did;

/* ---------- loading + empty states ---------- */
function beginFeatureLoad(view, target, message) {
  showView(view);
  const host = $(target);
  if (!host) return { clear() {} };
  const phase = loadPhase(message);
  host.replaceChildren(phase.node);
  return phase;
}

function showFeatureLoadError(target, error) {
  const host = $(target);
  if (!host) return;
  const retry = el("button", { type: "button", onclick: () => router.refresh() }, "Try again");
  host.replaceChildren(
    el("div", { class: "empty-state" }, [
      el("div", { class: "empty-title" }, "This view couldn't load"),
      el("div", { class: "empty-hint muted small" }, error?.message || "The feature chunk was unavailable."),
      retry,
    ]),
  );
}

async function loadViewModule(loader, { view, target, message }) {
  if (loader.peek()) return loader();
  const phase = beginFeatureLoad(view, target, message);
  try {
    return await loader();
  } catch (error) {
    showFeatureLoadError(target, error);
    throw error;
  } finally {
    phase.clear();
  }
}

let libraryContextDid = null;
function initializeLibrary(module) {
  if (agent && did && libraryContextDid !== did) {
    module.initLibrary({ agent, did, ...libraryRecordHistory });
    libraryContextDid = did;
  }
  return module;
}

async function libraryFeature() {
  const module = await loadViewModule(loadLibraryModule, {
    view: "library-view",
    target: "#library-body",
    message: "Loading setup tools…",
  });
  return initializeLibrary(module);
}

async function openLibrary() {
  return (await libraryFeature()).openLibrary();
}

let editorContextDid = null;
async function editorFeature() {
  const needsPhase = !loadEditorModule.peek() || !loadLibraryModule.peek();
  const phase = needsPhase ? beginFeatureLoad("editor-view", "#editor-body", "Loading gallery editor…") : null;
  try {
    const [editor, library] = await Promise.all([loadEditorModule(), loadLibraryModule()]);
    initializeLibrary(library);
    if (agent && did && editorContextDid !== did) {
      editor.initEditor({ agent, did });
      editorContextDid = did;
    }
    return editor;
  } catch (error) {
    showFeatureLoadError("#editor-body", error);
    throw error;
  } finally {
    phase?.clear();
  }
}

async function openGallery(uri) {
  return (await editorFeature()).openGallery(uri);
}

function hasUnsavedChanges() {
  return loadEditorModule.peek()?.hasUnsavedChanges() || false;
}

function saveAllDirty() {
  return loadEditorModule.peek()?.saveAllDirty();
}

let profileContextDid = null;
async function profileFeature(message = "Loading public profile tools…") {
  const module = await loadViewModule(loadProfileModule, {
    view: "profile-view",
    target: "#profile-body",
    message,
  });
  if (agent && did && profileContextDid !== did) {
    module.setViewer(did, agent);
    profileContextDid = did;
  }
  return module;
}

function destroyProfileMap() {
  loadProfileModule.peek()?.destroyProfileMap();
}

function destroyFollowing() {
  loadFollowingModule.peek()?.destroyFollowing();
}

async function openProfileSearch() {
  return (await profileFeature("Loading Discover…")).openProfileSearch();
}

async function openFollowing() {
  const module = await loadViewModule(loadFollowingModule, {
    view: "following-view",
    target: "#following-body",
    message: "Loading your following feed…",
  });
  if (!did) return;
  return module.openFollowing({ did, navigateProfile });
}

function navigateProfile(handle) {
  const normalized = String(handle || "")
    .replace(/^@/, "")
    .trim();
  if (normalized) router.navigate("profile", { handle: normalized });
}

async function openBundleModal(...args) {
  try {
    return (await loadImportModule()).openBundleModal(...args);
  } catch (error) {
    toast(`Import tools couldn't load: ${error?.message || error}`, "err");
  }
}

async function openUploadModal(...args) {
  try {
    return (await loadUploadModule()).openUploadModal(...args);
  } catch (error) {
    toast(`Upload tools couldn't load: ${error?.message || error}`, "err");
  }
}

async function openPublishSetup(...args) {
  try {
    return (await loadPublishModule()).openPublishSetup(...args);
  } catch (error) {
    toast(`Publishing tools couldn't load: ${error?.message || error}`, "err");
  }
}

async function openPalette() {
  try {
    return (await loadPaletteModule()).openPalette(paletteCommands);
  } catch (error) {
    toast(`Command palette couldn't load: ${error?.message || error}`, "err");
  }
}

async function openMeter() {
  if (!agent) return shell.showLoggedOut();
  const library = await libraryFeature();
  const store = library.getStore() || (await library.refreshStore());
  showView("library-view");
  setActiveSection("setup");
  return (await loadMeterModule()).openMeter({ agent, did, store });
}

async function refreshAccountData() {
  if (!agent || !did) return shell.showLoggedOut();
  try {
    const library = await libraryFeature();
    await library.refreshStore();
    if (activeSection === "setup") await library.openLibrary();
    if (activeSection === "galleries") await loadGalleries();
    if (activeSection === "following") await openFollowing();
    toast("Data refreshed from your PDS", "ok");
  } catch (error) {
    toast(`Refresh failed: ${error?.message || error}`, "err");
  }
}

async function openConflictTray() {
  if (!agent || !did) return shell.showLoggedOut();
  try {
    return (await loadConflictTrayModule()).openConflictTray({ agent, did });
  } catch (error) {
    toast(`Conflict tools couldn't load: ${error?.message || error}`, "err");
  }
}

document.addEventListener("hypo:complement-conflict", async (event) => {
  try {
    (await loadConflictTrayModule()).openComplementConflictTray(event.detail);
  } catch (error) {
    toast(`Schema conflict tools couldn't load: ${error?.message || error}`, "err");
  }
});

const { openSettings, openVisionConnect } = createSettingsActions({
  loadVision: loadVisionModule,
  loadRegistry: loadRegistryModule,
  openModal,
  toast,
  segmentedControl,
  getVisionConfig,
  setVisionConfig,
  isAdvanced,
  setAdvanced,
  themePreference: () => shell.themePreference(),
  applyTheme: (preference) => shell.applyTheme(preference),
  currentDensity: () => shell.currentDensity(),
  setDensity: (preference) => shell.setDensity(preference),
  isSetupActive: () => activeSection === "setup",
  openLibrary,
});

const { openShortcuts } = createShortcutActions({ openModal });

const { shareSetup } = createShareActions({
  openModal,
  icon,
  toast,
  profileIdentifier: () => shell.handle() || did,
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  fallbackCopy: () => {
    document.execCommand("copy");
  },
  canShare: () => Boolean(navigator.share),
  share: (data) => navigator.share(data),
});

const paletteCommands = createPaletteCommands({
  navigateSection,
  openMeter: () => router.navigate("meter"),
  openBundle: () => openBundleModal(agent, did),
  openVisionConnect,
  shareSetup,
  publishSetup: () => openPublishSetup(agent, did, { handle: shell.handle() }),
  profileHandle: () => shell.handle(),
  navigateProfile,
  currentTheme: () => shell.currentTheme(),
  toggleTheme: () => shell.toggleTheme(),
  openSettings,
  openShortcuts,
  reloadGalleries: () => loadGalleries(),
  signOut: () => sessionController.signOut(),
  galleries: () => galleryList.galleries(),
  openGallery: (uri) => {
    setActiveSection("galleries");
    showView("editor-view");
    navigateGallery(uri);
  },
  filter: (query, commands) => fuzzyFilter(query, commands, (command) => command.label),
  matches: fuzzyMatches,
});

/* ---------- primary navigation (Setup / Galleries / Following / Discover) ---------- */
const SECTIONS = {
  setup: { view: "library-view", icon: "camera", load: () => openLibrary() },
  galleries: { view: "list-view", icon: "image", load: () => loadGalleries() },
  following: { view: "following-view", icon: "users", load: () => openFollowing() },
  discover: { view: "profile-view", icon: "compass", load: () => openProfileSearch() },
};
let activeSection = null;

const shell = createShell({
  icon,
  showView,
  withTransition,
  actions: {
    navigateSection,
    navigateProfile,
    shareSetup,
    openConflictTray,
    refreshAccountData,
    openBundle: () => openBundleModal(agent, did),
    openSettings,
    signOut: () => sessionController.signOut(),
    openShortcuts,
    openPalette,
    saveAllDirty,
    navigatePhotos,
    hasSession: () => Boolean(agent),
  },
});

const galleryList = createGalleryListView({
  icon,
  getSession: () => (agent && did ? { agent, did } : null),
  loadProviders: async () => {
    const [grain, graycard, lazy] = await Promise.all([loadGrain(), loadGraycard(), loadLazyThumbModule()]);
    return {
      getGalleries: grain.getGalleries,
      listRecords: grain.listRecords,
      collections: grain.COLLECTIONS,
      ns: graycard.NS,
      lazyThumb: lazy.lazyThumb,
    };
  },
  fuzzyFilter,
  showView,
  activate: () => setActiveSection("galleries"),
  navigate: navigateGallery,
  createGallery: () =>
    openUploadModal(agent, did, (uri) => {
      setActiveSection("galleries");
      showView("editor-view");
      navigateGallery(uri);
    }),
});

const appBootstrap = createAppBootstrap({
  router,
  session: () => ({ agent, did }),
  setSession: (session) => {
    agent = session.agent;
    did = session.did;
  },
  showAuthenticated: (nextDid) => shell.showAuthenticated(nextDid),
  showLoggedOut: () => shell.showLoggedOut(),
  loadOutbox: loadOutboxModule,
  loadOnboarding: loadOnboardingModule,
  libraryFeature,
  openLibraryRecord: async (target) => (await libraryFeature()).openLibraryRecordRoute(target),
  closeLibraryRecord: () => loadLibraryModule.peek()?.closeLibraryRecordRoute(),
  goSection,
  navigateSection,
  setLibraryTab: (tab) => {
    const body = $("#library-body");
    if (body) body.dataset.tab = tab;
  },
  setActiveSection,
  showView,
  openGallery,
  openMeter,
  showProfile,
  showFeatureLoadError,
  setLoginError: (message) => {
    const error = $("#login-error");
    if (error) error.textContent = message;
  },
  toast,
});

const sessionController = createSessionController({
  loadScope: async () => (await loadOAuthScope()).OAUTH_SCOPE,
  e2e: {
    enabled: import.meta.env.DEV && import.meta.env.MODE === "e2e",
    pdsOrigin: import.meta.env.VITE_E2E_PDS_ORIGIN,
    loadRuntime: async (pdsOrigin) => {
      const { createE2ERuntime } = await import("../tests/e2e/runtime.js");
      return createE2ERuntime({ pdsOrigin });
    },
  },
  onAuthenticated: appBootstrap.onAuthenticated,
  onLoggedOut: appBootstrap.onLoggedOut,
});

function setActiveSection(name) {
  activeSection = name;
  document.querySelectorAll("[data-section]").forEach((b) => {
    const on = b.dataset.section === name;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

async function goSection(name) {
  const s = SECTIONS[name];
  if (!s) return;
  if (!guardLeave()) return;
  destroyProfileMap(); // release the profile heatmap's WebGL context when leaving the profile view
  destroyFollowing(); // ignore a slow public-feed response after leaving Following
  showView(s.view);
  setActiveSection(name);
  await s.load();
}

async function showProfile(seg) {
  setActiveSection("discover");
  return (await profileFeature()).openProfile(seg);
}

function navigateSection(name) {
  const routeName = { setup: "home", galleries: "galleries", following: "following", discover: "discover" }[name];
  if (!routeName) return goSection(name);
  if (router.current().name === routeName) return goSection(name);
  router.navigate(routeName);
}

function navigateGallery(uri) {
  const match = /^at:\/\/[^/]+\/social\.grain\.gallery\/([^/]+)$/.exec(String(uri || ""));
  if (!match) {
    showView("editor-view");
    return openGallery(uri);
  }
  const rkey = match[1];
  const current = router.current();
  if (current.name === "gallery" && current.params.rkey === rkey) return openGallery(uri);
  router.navigate("gallery", { rkey });
}

async function loadGalleries() {
  return galleryList.load();
}

let photoIdx = -1;
function navigatePhotos(dir) {
  const cards = [...document.querySelectorAll("#editor-body .photo-card")];
  if (!cards.length) return;
  photoIdx = photoIdx < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, photoIdx + dir));
  cards.forEach((c, i) => c.classList.toggle("photo-focused", i === photoIdx));
  cards[photoIdx].scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- unsaved-changes guard ---------- */
function guardLeave() {
  return !hasUnsavedChanges() || confirm("You have unsaved photo edits. Leave without saving?");
}
window.addEventListener("beforeunload", (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// Deploys replace hashed lazy chunks. Reload one stale shell automatically
// when it is safe, or let the user protect unsaved edits and reload explicitly.
installPreloadRecovery({
  target: window,
  storage: sessionStorage,
  hasUnsavedChanges,
  reload: () => location.reload(),
  confirmReload: () => confirm("Reload now? Unsaved photo edits will be lost."),
  notify: (reload) => {
    toast("A newer version is available. Reload to finish this action.", "err", 15000, {
      label: "Reload",
      fn: reload,
    });
  },
});

/* ---------- wiring ---------- */
$("#library-reload")?.addEventListener("click", openLibrary);
$("#guided-setup")?.addEventListener("click", appBootstrap.startOnboarding);
$("#back")?.addEventListener("click", () => navigateSection("galleries"));

shell.install(SECTIONS);
galleryList.install();
sessionController.installLoginControls();
void appBootstrap.start(sessionController);
