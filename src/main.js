// main.js: Hypo

// self-hosted variable fonts (bundled by vite, no external requests)
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { getGalleries, listRecords, COLLECTIONS } from "./grain.js";
import { NS } from "./graycard.js";
import { OAUTH_SCOPE } from "./oauthScope.js";
import { el, $, field, showView, withTransition, stagger, toast, isAdvanced, setAdvanced, openModal, getVisionConfig, setVisionConfig, loadPhase } from "./ui/dom.js";
import { PROVIDERS, DEFAULT_PROVIDER, validateConfig } from "./vision.js";
import { installAutoFlush } from "./outbox.js";
import { initLibrary, openLibrary, getStore } from "./ui/library.js";
import { openOnboarding, needsOnboarding } from "./ui/onboarding.js";
import { initEditor, openGallery, hasUnsavedChanges, saveAllDirty } from "./ui/editor.js";
import { openBundleModal } from "./ui/importUI.js";
import { openUploadModal } from "./ui/uploadUI.js";
import { openProfile, openProfileSearch, setViewer, navigateProfile, destroyProfileMap } from "./ui/profileView.js";
import { openPublishSetup } from "./ui/publishUI.js";
import { constellationBase, setConstellationBase, DEFAULT_CONSTELLATION } from "./registry.js";
import { openPalette } from "./ui/palette.js";
import { icon } from "./ui/icons.js";
import { lazyThumb } from "./ui/lazy.js";
import { fuzzyFilter, fuzzyMatches } from "./ui/fuzzy.js";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
// Public profiles live at /profile/<handle-or-did>. Returns the handle/DID, or
// null when the path isn't a profile route.
function profileSegment() {
  let seg = decodeURIComponent(location.pathname);
  if (seg.startsWith(BASE)) seg = seg.slice(BASE.length);
  seg = seg.replace(/^\/+|\/+$/g, "");
  const m = /^profile\/(.+)$/.exec(seg);
  if (!m) return null;
  const handle = m[1].replace(/\/+$/, "");
  return handle && (handle.includes(".") || handle.startsWith("did:")) ? handle : null;
}

const SCOPE = OAUTH_SCOPE;   // granular: repo:<collection> per collection we write + blob; no transition:generic
const CLIENT_METADATA_URL = "https://hypo.graycard.app/client-metadata.json";
const PUBLIC_API = "https://public.api.bsky.app/xrpc";

let oauthClient, agent, did, session;
let allGalleries = [];
let coverByGallery = new Map();
let coverageByGallery = new Map();
let viewerHandle = null;

const isLoopback = () => location.hostname === "127.0.0.1" || location.hostname === "localhost";

function loopbackClientId() {
  return "http://localhost" +
    `?redirect_uri=${encodeURIComponent(`${location.origin}/`)}` +
    `&scope=${encodeURIComponent(SCOPE)}`;
}

async function initAuth() {
  if (location.hostname === "localhost") {
    location.href = location.href.replace("localhost", "127.0.0.1");
    return;
  }
  oauthClient = await BrowserOAuthClient.load({
    clientId: isLoopback() ? loopbackClientId() : CLIENT_METADATA_URL,
    handleResolver: "https://bsky.social",
  });
  let result;
  try {
    result = await oauthClient.init();
  } catch (err) {
    // An abandoned or expired sign-in leaves a dangling authorization request
    // ("Unknown authorization session"). Don't brick startup: clear the stale
    // OAuth callback params from the URL so a reload won't retry the dead
    // callback, and fall back to a clean login view.
    clearOAuthCallbackParams();
    console.warn("OAuth init could not resume a session:", err?.message || err);
    showLoggedOut();
    return;
  }
  if (result?.session) onSession(result.session);
  else showLoggedOut();
}

// signed-out state: land on the login view and put a "Log in" button in the
// topbar where the account avatar sits when signed in. Keeps a way back to login
// even while viewing a public profile at /profile/<handle>.
function showLoggedOut() {
  showView("login-view");
  const host = $("#session");
  if (!host) return;
  host.classList.remove("hidden");
  host.replaceChildren(el("button", {
    class: "small-btn login-btn", type: "button",
    onclick: () => showView("login-view"),
  }, "Log in"));
}

// strip ?code=&state=&iss= (OAuth redirect params) from the address bar without
// reloading, so a failed/abandoned callback doesn't repeat on the next boot.
function clearOAuthCallbackParams() {
  try {
    const u = new URL(location.href);
    let touched = false;
    for (const k of ["code", "state", "iss", "error", "error_description"]) {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); touched = true; }
    }
    if (touched) history.replaceState(null, "", u.pathname + u.search + u.hash);
  } catch { /* best effort */ }
}

function onSession(sess) {
  session = sess;
  agent = new Agent(sess);
  did = sess.did;
  setViewer(did, agent);
  initLibrary({ agent, did });
  initEditor({ agent, did });
  // drain any shots logged offline as soon as we have a session + connectivity.
  installAutoFlush(agent, did, (res) => { if (res.sent) toast(`Synced ${res.sent} offline shot${res.sent === 1 ? "" : "s"}`, "ok"); });
  renderSession();
  $("#primary-nav")?.classList.remove("hidden");
  $("#bottom-nav")?.classList.remove("hidden");
  $("#session")?.classList.remove("hidden");
  // land in the user's own setup, not the gallery list. Hypo is an editor for
  // your gear first, galleries second. brand-new users get the wizard.
  if (!profileSegment()) {
    goSection("setup").then(() => {
      if (needsOnboarding(getStore())) startOnboarding();
    });
  }
}

function startOnboarding() {
  openOnboarding({ agent, did, onDone: () => goSection("setup") });
}

async function signOut() {
  try {
    if (session?.signOut) await session.signOut();      // revokes tokens at the PDS
    else if (oauthClient?.revoke) await oauthClient.revoke(did);
  } catch { /* revoke best-effort */ }
  location.reload();
}

async function renderSession() {
  // the avatar is the account-menu trigger. The handle lives inside the menu.
  const host = $("#session");
  const btn = el("button", {
    id: "account-btn", class: "avatar-btn", type: "button",
    "aria-haspopup": "menu", "aria-expanded": "false",
    title: "Account and settings", "aria-label": "Account and settings",
    onclick: toggleAccountMenu,
  }, [icon("user")]);
  host.replaceChildren(btn);
  try {
    const r = await fetch(`${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
    if (!r.ok) return;
    const p = await r.json();
    viewerHandle = p.handle;
    if (p.avatar) btn.replaceChildren(el("img", { src: p.avatar, alt: "" }));
  } catch { /* keep the fallback icon */ }
}

/* ---------- loading + empty states ---------- */
function skeletonRows(n) {
  return Array.from({ length: n }, () =>
    el("li", { class: "gallery-row skeleton-row" }, [
      el("div", { class: "skeleton skeleton-title" }),
      el("div", { class: "skeleton skeleton-line" }),
    ]),
  );
}

function emptyState(title, hint) {
  return el("div", { class: "empty-state" }, [
    el("div", { class: "empty-mark", "aria-hidden": "true" }, [icon("film", 34)]),
    el("div", { class: "empty-title" }, title),
    el("div", { class: "empty-hint muted small" }, hint),
  ]);
}

/* ---------- primary navigation (Setup / Galleries / Discover) ---------- */
const SECTIONS = {
  setup: { view: "library-view", icon: "camera", load: () => openLibrary() },
  galleries: { view: "list-view", icon: "image", load: () => loadGalleries() },
  discover: { view: "profile-view", icon: "compass", load: () => openProfileSearch() },
};
let activeSection = null;

function setActiveSection(name) {
  activeSection = name;
  document.querySelectorAll("[data-section]").forEach((b) => {
    const on = b.dataset.section === name;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}

async function goSection(name) {
  const s = SECTIONS[name];
  if (!s) return;
  if (!guardLeave()) return;
  destroyProfileMap();   // release the profile heatmap's WebGL context when leaving the profile view
  showView(s.view);
  setActiveSection(name);
  await s.load();
}

function showProfile(seg) {
  setActiveSection("discover");
  openProfile(seg);
}

function setupNav() {
  document.querySelectorAll("#bottom-nav .nav-item[data-section]").forEach((b) => {
    const ic = SECTIONS[b.dataset.section]?.icon;
    if (ic) b.querySelector(".nav-ico")?.append(icon(ic, 22));
  });
  $("#bottom-account .nav-ico")?.append(icon("dots", 22));
  document.querySelectorAll("[data-section]").forEach((b) =>
    b.addEventListener("click", () => { closeAccountMenu(); goSection(b.dataset.section); }));
  // #account-btn (the avatar) is created in renderSession and wired there.
  $("#bottom-account")?.addEventListener("click", toggleAccountMenu);
}

/* ---------- account / settings menu ---------- */
function buildAccountMenu() {
  const menu = $("#account-menu");
  if (!menu) return;
  const item = (iconName, label, run, opts = {}) =>
    el("button", { class: "menu-item" + (opts.danger ? " danger" : ""), role: "menuitem",
      onclick: () => { closeAccountMenu(); run(); } }, [icon(iconName), el("span", {}, label)]);
  menu.replaceChildren(
    el("div", { class: "menu-account" }, viewerHandle ? `@${viewerHandle}` : did),
    item("compass", "View my public setup", () => viewerHandle && navigateProfile(viewerHandle)),
    item("share", "Share my setup", shareSetup),
    el("div", { class: "menu-sep" }),
    item("download", "Export / import bundle", () => openBundleModal(agent, did)),
    item("gear", "Settings", openSettings),
    el("div", { class: "menu-sep" }),
    item("users", "Switch account", () => showView("login-view")),
    item("x", "Sign out", signOut, { danger: true }),
  );
}
function toggleAccountMenu() {
  const m = $("#account-menu");
  if (!m) return;
  if (m.classList.contains("hidden")) { buildAccountMenu(); m.classList.remove("hidden"); $("#account-btn")?.setAttribute("aria-expanded", "true"); }
  else closeAccountMenu();
}
function closeAccountMenu() {
  $("#account-menu")?.classList.add("hidden");
  $("#account-btn")?.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (e) => {
  const m = $("#account-menu");
  if (!m || m.classList.contains("hidden")) return;
  if (!m.contains(e.target) && !e.target.closest("#account-btn") && !e.target.closest("#bottom-account")) closeAccountMenu();
});

function startHeroTransition(uri, coverEl) {
  setActiveSection("galleries");
  const hero = $("#editor-hero");
  const coverImg = coverEl?.querySelector("img");
  if (hero && coverImg && document.startViewTransition) {
    coverEl.style.viewTransitionName = "hero-cover";
    hero.style.backgroundImage = `url("${coverImg.src}")`;
    hero.classList.remove("hidden");
    hero.style.viewTransitionName = "hero-cover";
    setTimeout(() => { if (coverEl) coverEl.style.viewTransitionName = ""; if (hero) hero.style.viewTransitionName = ""; }, 700);
  } else if (hero) {
    hero.classList.add("hidden");
  }
  showView("editor-view");
  openGallery(uri);
}

// a compact graycard-coverage strip so the user can see, at a glance, which
// galleries still need metadata assigned.
function galleryCoverage(cov) {
  if (!cov || !cov.total) return null;
  const badges = [el("span", { class: "cov-badge" }, `${cov.total} photo${cov.total !== 1 ? "s" : ""}`)];
  badges.push(el("span", { class: "cov-badge" + (cov.gear ? (cov.gear === cov.total ? " full" : " partial") : "") }, `gear ${cov.gear}/${cov.total}`));
  if (cov.wf) badges.push(el("span", { class: "cov-badge full" }, `${cov.wf} workflow${cov.wf !== 1 ? "s" : ""}`));
  if (cov.sc) badges.push(el("span", { class: "cov-badge full" }, `${cov.sc} scene${cov.sc !== 1 ? "s" : ""}`));
  return el("div", { class: "cov-row" }, badges);
}

function renderGalleries() {
  const q = $("#gallery-search").value.trim().toLowerCase();
  const list = $("#gallery-list");
  const filtered = q
    ? fuzzyFilter(q, allGalleries, (g) => `${g.value.title || ""} ${g.value.description || ""}`)
    : allGalleries;
  if (!filtered.length) {
    list.replaceChildren(el("p", { class: "muted small" }, q ? "No matching galleries." : "No galleries."));
    return;
  }
  const rows = filtered.map((g) =>
    el("li", { class: "gallery-row row", onclick: (e) => startHeroTransition(g.uri, e.currentTarget.querySelector(".gallery-thumb")) }, [
      lazyThumb(agent, did, coverByGallery.get(g.uri), "gallery-thumb"),
      el("div", { class: "gallery-rowtext" }, [
        el("div", { class: "g-title" }, g.value.title || "(untitled)"),
        g.value.description ? el("div", { class: "g-desc muted" }, g.value.description) : null,
        galleryCoverage(coverageByGallery.get(g.uri)),
      ]),
    ]),
  );
  stagger(rows);
  list.replaceChildren(...rows);
}

async function loadGalleries() {
  showView("list-view");
  $("#list-status").textContent = "";
  const search = $("#gallery-search");
  const phase = loadPhase("Loading galleries from your PDS…");
  $("#gallery-list").replaceChildren(...skeletonRows(4), phase.node);
  try {
    allGalleries = await getGalleries(agent, did);
    if (!allGalleries.length) {
      phase.clear();
      search.classList.add("hidden");
      $("#gallery-list").replaceChildren(
        emptyState("No galleries yet", "Create a gallery first, then reload to fix its metadata here."),
      );
      return;
    }
    search.classList.toggle("hidden", allGalleries.length < 6);
    phase.set("Checking coverage from your PDS…");
    try {
      const [items, photos, captures, wfs, scenes] = await Promise.all([
        listRecords(agent, did, COLLECTIONS.galleryItem),
        listRecords(agent, did, COLLECTIONS.photo),
        listRecords(agent, did, NS.photo.capture),
        listRecords(agent, did, NS.photo.workflow),
        listRecords(agent, did, NS.scene.graph),
      ]);
      const blobByPhoto = new Map(photos.map((pr) => [pr.uri, pr.value.photo]));
      const gearPhotos = new Set(captures.filter((c) => c.value.camera || c.value.lens || c.value.filmRoll).map((c) => c.value.photo));
      const wfPhotos = new Set(wfs.map((w) => w.value.photo));
      const scenePhotos = new Set(scenes.map((s) => s.value.subject).filter(Boolean));
      coverByGallery = new Map();
      const photosByGallery = new Map();
      for (const it of items.slice().sort((a, b) => (a.value.position ?? 0) - (b.value.position ?? 0))) {
        if (!coverByGallery.has(it.value.gallery)) coverByGallery.set(it.value.gallery, blobByPhoto.get(it.value.item));
        if (!photosByGallery.has(it.value.gallery)) photosByGallery.set(it.value.gallery, []);
        photosByGallery.get(it.value.gallery).push(it.value.item);
      }
      coverageByGallery = new Map();
      for (const [gal, ps] of photosByGallery) {
        coverageByGallery.set(gal, {
          total: ps.length,
          gear: ps.filter((u) => gearPhotos.has(u)).length,
          wf: ps.filter((u) => wfPhotos.has(u)).length,
          sc: ps.filter((u) => scenePhotos.has(u)).length,
        });
      }
    } catch { coverByGallery = new Map(); coverageByGallery = new Map(); }
    phase.clear();
    renderGalleries();
  } catch (err) {
    phase.clear();
    $("#gallery-list").replaceChildren();
    $("#list-status").textContent = `Error: ${err.message || err}`;
  }
}

/* ---------- theme + settings (localStorage only, no lexicons) ---------- */
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function themePref() { try { return localStorage.getItem("hypo:theme") || "system"; } catch { return "system"; } }
function applyTheme(pref) {
  const root = document.documentElement;
  withTransition(() => {
    if (pref === "system") { root.removeAttribute("data-theme"); try { localStorage.removeItem("hypo:theme"); } catch (e) {} }
    else { root.setAttribute("data-theme", pref); try { localStorage.setItem("hypo:theme", pref); } catch (e) {} }
  });
  paintThemeIcon();
}
function paintThemeIcon() {
  $("#theme-toggle")?.replaceChildren(icon(currentTheme() === "dark" ? "sun" : "moon"));
}
function toggleTheme() { applyTheme(currentTheme() === "dark" ? "light" : "dark"); }
function setupThemeToggle() {
  paintThemeIcon();
  $("#theme-toggle")?.addEventListener("click", toggleTheme);
}

const currentDensity = () => document.documentElement.getAttribute("data-density") || "comfortable";
function setDensity(pref) {
  if (pref === "compact") document.documentElement.setAttribute("data-density", "compact");
  else document.documentElement.removeAttribute("data-density");
  try { localStorage.setItem("hypo:density", pref); } catch (e) {}
}

// a small segmented control that applies its choice immediately
function segmentedControl(options, current, onPick, labelFn = (v) => v) {
  const box = el("div", { class: "segmented" });
  for (const v of options) {
    const b = el("button", {
      type: "button", class: "small-btn" + (v === current ? " active" : ""),
      onclick: () => { box.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); onPick(v); },
    }, labelFn(v));
    box.append(b);
  }
  return box;
}

function openSettings() {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const themeSeg = segmentedControl(["system", "light", "dark"], themePref(), (v) => applyTheme(v), cap);
  const densSeg = segmentedControl(["comfortable", "compact"], currentDensity(), (v) => setDensity(v), cap);
  const advCb = el("input", { type: "checkbox" });
  advCb.checked = isAdvanced();
  advCb.addEventListener("change", () => { setAdvanced(advCb.checked); if (activeSection === "setup") openLibrary(); });

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "Settings" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  // Image analysis (API key) lives here rather than as its own account-menu item.
  const vcfg = getVisionConfig();
  const vprov = vcfg?.provider ? (PROVIDERS[vcfg.provider]?.label || vcfg.provider) : null;
  const visionRow = el("div", { class: "row between" }, [
    el("span", { class: "muted small" }, vcfg?.apiKey ? `Connected · ${vprov}` : "Not connected"),
    el("button", { class: "ghost small-btn", type: "button", onclick: () => { close(); openVisionConnect(); } }, vcfg?.apiKey ? "Manage" : "Connect"),
  ]);

  // Discovery index: which Constellation instance "Discover setups" queries.
  // Blank (or the public default) uses the public instance; point it at your own
  // self-hosted Constellation or Asterism to own the stack.
  const idxInput = el("input", { type: "url", class: "share-url mono", value: constellationBase() === DEFAULT_CONSTELLATION ? "" : constellationBase(), placeholder: DEFAULT_CONSTELLATION, spellcheck: "false", autocomplete: "off", "aria-label": "Discovery index base URL" });
  idxInput.addEventListener("change", () => { setConstellationBase(idxInput.value.trim()); toast("Discovery index updated", "ok"); });

  modal.append(
    el("h2", {}, "Settings"),
    el("label", { class: "field" }, [el("span", {}, "Theme"), themeSeg]),
    el("label", { class: "field" }, [el("span", {}, "Density"), densSeg]),
    el("div", { class: "field" }, [el("span", {}, "Image analysis"), visionRow]),
    el("label", { class: "field" }, [el("span", {}, "Discovery index"), idxInput, el("span", { class: "muted small" }, "Constellation instance for Discover. Blank uses the public one.")]),
    el("label", { class: "inline-check settings-check" }, [advCb, el("span", {}, "Advanced records (show raw record inspectors)")]),
    el("div", { class: "row modal-actions" }, [el("button", { class: "ghost", onclick: close }, "Close")]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

// Connect an image-analysis provider: paste a key, test it, save it. The key is
// stored only in this browser (localStorage) — a static app has no backend to
// proxy it — and images are sent directly to the provider on Analyze.
function openVisionConnect() {
  const cfg = getVisionConfig() || {};
  let provider = PROVIDERS[cfg.provider] || PROVIDERS[DEFAULT_PROVIDER];

  const providers = Object.values(PROVIDERS);
  const provSel = el("select", {}, providers.map((p) => el("option", { value: p.id }, p.label)));
  provSel.value = provider.id;
  const keyInput = el("input", { type: "password", placeholder: provider.keyPlaceholder, value: cfg.apiKey || "", autocomplete: "off", spellcheck: "false" });
  const modelSel = el("select", {}, provider.models.map((m) => el("option", { value: m.id }, m.label)));
  modelSel.value = cfg.model || provider.defaultModel;
  const keyLabel = el("span", {}, provider.keyLabel);
  const hint = el("span", { class: "muted small" }, provider.keyHint || "");
  const keyLink = el("a", { class: "linkbtn small", target: "_blank", rel: "noopener", href: provider.keyUrl || "#" }, "Get an API key ↗");
  keyLink.classList.toggle("hidden", !provider.keyUrl);
  const keyHelp = el("div", { class: "row between", style: "gap:8px; margin-top:-4px" }, [hint, keyLink]);
  const billNote = el("p", { class: "muted small" }, provider.billingNote || "");

  provSel.addEventListener("change", () => {
    provider = PROVIDERS[provSel.value] || provider;
    keyInput.placeholder = provider.keyPlaceholder;
    keyLabel.textContent = provider.keyLabel;
    hint.textContent = provider.keyHint || "";
    keyLink.href = provider.keyUrl || "#";
    keyLink.classList.toggle("hidden", !provider.keyUrl);
    billNote.textContent = provider.billingNote || "";
    modelSel.replaceChildren(...provider.models.map((m) => el("option", { value: m.id }, m.label)));
    modelSel.value = provider.defaultModel;
  });

  const testStatus = el("span", { class: "status" });
  const testBtn = el("button", { type: "button", class: "ghost small-btn" }, "Test connection");
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    const name = (PROVIDERS[provSel.value] || provider).label;
    testStatus.className = "status"; testStatus.textContent = `Checking ${name}…`;
    try {
      await validateConfig({ provider: provSel.value, apiKey: keyInput.value.trim(), model: modelSel.value });
      testStatus.className = "status ok"; testStatus.textContent = "Connection OK ✓";
    } catch (err) {
      const msg = err?.message || String(err);
      testStatus.className = "status err"; testStatus.textContent = msg;
      toast(msg, "err", 4200);
    } finally {
      testBtn.disabled = false;
    }
  });

  const body = [
    el("p", { class: "muted small" }, "Auto-generate alt text and scene graphs for your photos. Only providers that allow direct browser calls can be used here."),
    providers.length > 1 ? field("Provider", provSel) : null,
    el("label", { class: "field" }, [keyLabel, keyInput]),
    keyHelp,
    field("Model", modelSel),
    billNote,
    el("div", { class: "row subtle-actions" }, [testBtn, testStatus]),
  ].filter(Boolean);

  let handle;
  if (cfg.apiKey) {
    body.push(el("div", { class: "row subtle-actions" }, [
      el("button", { type: "button", class: "ghost small-btn danger", onclick: () => { setVisionConfig(null); toast("Disconnected", "ok"); handle?.close(); } }, "Disconnect"),
    ]));
  }

  handle = openModal("Image analysis", body, async () => {
    const next = { provider: provSel.value, apiKey: keyInput.value.trim(), model: modelSel.value };
    if (!next.apiKey) throw new Error("Enter an API key.");
    await validateConfig(next);   // verify the key works before saving
    setVisionConfig(next);
  }, { saveLabel: "Save & connect" });
}

function openShortcuts() {
  const rows = [["⌘/Ctrl K", "Command palette"], ["⌘/Ctrl S", "Save all (editor)"], ["/", "Focus search"], ["J / K", "Next / previous photo"], ["? ", "This help"], ["Esc", "Close dialog"]];
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-label": "Keyboard shortcuts" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  modal.append(
    el("h2", {}, "Keyboard shortcuts"),
    el("div", {}, rows.map(([k, d]) => el("div", { class: "row between shortcut-row" }, [el("span", {}, d), el("kbd", {}, k)]))),
    el("div", { class: "row modal-actions" }, [el("button", { class: "ghost", onclick: close }, "Close")]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

function shareSetup() {
  const url = `https://hypo.graycard.app/profile/${viewerHandle || did}`;
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "Share your setup" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  const urlInput = el("input", { type: "text", readonly: "", value: url, class: "share-url mono", "aria-label": "Setup link" });
  urlInput.addEventListener("focus", () => urlInput.select());

  const copyBtn = el("button", {}, [icon("copy"), el("span", {}, "Copy link")]);
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { urlInput.focus(); urlInput.select(); try { document.execCommand("copy"); } catch (e) {} }
    toast("Link copied", "ok");
  });

  const actions = [copyBtn];
  if (navigator.share) {
    const shareBtn = el("button", { class: "ghost" }, [icon("share"), el("span", {}, "Share…")]);
    shareBtn.addEventListener("click", () => { navigator.share({ title: "My graycard setup", url }).catch(() => {}); });
    actions.push(shareBtn);
  }
  actions.push(el("button", { class: "ghost", onclick: close }, "Close"));

  modal.append(
    el("h2", {}, "Share your setup"),
    el("p", { class: "muted small" }, "Anyone with this link can view your public gear setup. No sign-in needed."),
    field("Link", urlInput),
    el("div", { class: "row modal-actions" }, actions),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  urlInput.focus();
  urlInput.select();
}

function paletteCommands(q) {
  const c = [];
  const add = (label, iconName, run, hint) => c.push({ label, iconName, run, hint });
  add("Setup: your gear", "camera", () => goSection("setup"));
  add("Galleries", "image", () => goSection("galleries"));
  add("Discover setups", "compass", () => goSection("discover"));
  add("Export / import bundle", "download", () => openBundleModal(agent, did));
  add("Image analysis (connect / settings)", "sparkles", openVisionConnect);
  add("Share my setup", "share", shareSetup);
  add("Publish my setup to Discover", "compass", () => openPublishSetup(agent, did, { handle: viewerHandle }));
  add("View my public setup", "compass", () => viewerHandle && navigateProfile(viewerHandle));
  add(`Toggle theme → ${currentTheme() === "dark" ? "light" : "dark"}`, currentTheme() === "dark" ? "sun" : "moon", toggleTheme);
  add("Settings", "gear", openSettings);
  add("Keyboard shortcuts", "keyboard", openShortcuts);
  add("Reload galleries", "refresh", () => loadGalleries());
  add("Sign out", "x", signOut);
  let out = q ? fuzzyFilter(q, c, (x) => x.label) : c;
  if (q) for (const g of allGalleries) { if (fuzzyMatches(q, g.value.title || "")) out.push({ label: `↦ ${g.value.title || "(untitled)"}`, iconName: "image", run: () => { setActiveSection("galleries"); showView("editor-view"); openGallery(g.uri); } }); if (out.length > 30) break; }
  if (q && (q.startsWith("@") || q.includes("."))) out.push({ label: `View @${q.replace(/^@/, "")}`, iconName: "users", run: () => navigateProfile(q.replace(/^@/, "")) });
  return out;
}

let photoIdx = -1;
function navigatePhotos(dir) {
  const cards = [...document.querySelectorAll("#editor-body .photo-card")];
  if (!cards.length) return;
  photoIdx = photoIdx < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, photoIdx + dir));
  cards.forEach((c, i) => c.classList.toggle("photo-focused", i === photoIdx));
  cards[photoIdx].scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- handle autocomplete (mouse + keyboard) ---------- */
const TYPEAHEAD = `${PUBLIC_API}/app.bsky.actor.searchActorsTypeahead`;

function setupAutocomplete() {
  const input = $("#handle");
  const list = $("#handle-suggestions");
  let items = [], idx = -1, debounce, abort;

  const nameOf = (it) => (typeof it === "string" ? it : it.handle);
  function hide() { list.classList.add("hidden"); list.replaceChildren(); idx = -1; items = []; }
  function choose(i) { input.value = nameOf(items[i]); hide(); }
  function render() {
    list.replaceChildren();
    items.forEach((item, i) => {
      list.append(el("li", {
        class: "handle-option" + (i === idx ? " active" : ""),
        onmousedown: (e) => e.preventDefault(),
        onclick: () => choose(i),
      }, nameOf(item)));
    });
    list.classList.toggle("hidden", !items.length);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { hide(); return; }
      if (abort) abort.abort();
      abort = new AbortController();
      try {
        const res = await fetch(`${TYPEAHEAD}?q=${encodeURIComponent(q)}&limit=8`, { signal: abort.signal });
        items = (await res.json()).actors || [];
        idx = -1;
        render();
      } catch { /* aborted or offline */ }
    }, 200);
  });

  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden") || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); idx = (idx + 1) % items.length; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); choose(idx); }
    else if (e.key === "Escape") { hide(); }
  });
}

/* ---------- unsaved-changes guard ---------- */
function guardLeave() {
  return !hasUnsavedChanges() ||
    confirm("You have unsaved photo edits. Leave without saving?");
}
window.addEventListener("beforeunload", (e) => {
  if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ""; }
});

// A deploy replaces the hashed JS chunks, so a tab left open on the previous
// index.html 404s the moment it lazily imports one (the map, the tokenizer, the
// caption index). Vite fires `vite:preloadError` for exactly this. Without a
// handler the failed import just rejects and the feature silently does nothing
// (e.g. "Set on map" not opening). Offer a one-tap reload instead — but only if
// there is nothing unsaved to lose, and only once.
let staleReloadPrompted = false;
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();   // we handle it; don't let Vite rethrow
  if (staleReloadPrompted) return;
  staleReloadPrompted = true;
  toast(
    "A newer version is available. Reload to finish this action.",
    "err", 15000,
    { label: "Reload", fn: () => { if (!hasUnsavedChanges() || confirm("Reload now? Unsaved photo edits will be lost.")) location.reload(); } },
  );
});

/* ---------- wiring ---------- */
$("#login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const handle = $("#handle").value.trim();
  if (!handle) return;
  try { await oauthClient.signIn(handle, { scope: SCOPE }); }
  catch (err) { $("#login-error").textContent = err.message || String(err); }
});

$("#gallery-search")?.addEventListener("input", renderGalleries);
$("#reload-galleries")?.addEventListener("click", loadGalleries);
$("#new-gallery")?.addEventListener("click", () => openUploadModal(agent, did, (uri) => { setActiveSection("galleries"); showView("editor-view"); openGallery(uri); }));
$("#library-reload")?.addEventListener("click", openLibrary);
$("#guided-setup")?.addEventListener("click", startOnboarding);
$("#back")?.addEventListener("click", () => goSection("galleries"));

window.addEventListener("popstate", () => {
  const seg = profileSegment();
  if (seg) showProfile(seg);
  else if (agent) goSection("setup");
  else showLoggedOut();
});

window.addEventListener("keydown", (e) => {
  const editorOpen = !document.getElementById("editor-view")?.classList.contains("hidden");
  if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) { if (editorOpen) { e.preventDefault(); saveAllDirty(); } return; }
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { if (agent) { e.preventDefault(); openPalette(paletteCommands); } return; }
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  if (e.key === "/") { e.preventDefault(); (document.querySelector("#gallery-search:not(.hidden)") || document.querySelector("#profile-search input") || $("#handle"))?.focus(); }
  else if (e.key === "?") { openShortcuts(); }
  else if ((e.key === "j" || e.key === "k") && editorOpen) { navigatePhotos(e.key === "j" ? 1 : -1); }
});

try { if (localStorage.getItem("hypo:density") === "compact") document.documentElement.setAttribute("data-density", "compact"); } catch (e) {}
setupNav();
setupThemeToggle();
$("#shortcuts-btn")?.append(icon("keyboard"));
$("#shortcuts-btn")?.addEventListener("click", openShortcuts);
setupAutocomplete();
initAuth()
  .then(() => { const seg = profileSegment(); if (seg) showProfile(seg); })
  .catch((err) => {
    clearOAuthCallbackParams();
    showLoggedOut();
    // a public profile is still viewable without a session; only surface an error
    // when there's nothing else to show.
    const seg = profileSegment();
    if (seg) showProfile(seg);
    else $("#login-error").textContent = "Couldn't restore your session. Please sign in again.";
    console.warn("startup init failed:", err?.message || err);
  });
