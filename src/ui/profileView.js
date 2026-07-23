// profileView.js: read-only view of another user's public graycard setup,
// reachable at /<handle> (e.g. hypo.graycard.app/alice.bsky.social) or via handle search.
// No auth, no backend.

import { el, $, showView, stagger, field, getVisionConfig, loadPhase } from "./dom.js";
import { catalogLabel, instanceLabel } from "../graycard.js";
import { resolveConcepts, ancestorsOf } from "../data/wikidata.js";
import { catalogImageUrl } from "../data/catalogImage.js";
import { buildSceneIndex, rankScenes, buildTextIndex, makeTokenizer, tokenize } from "../sceneSearch.js";
import { parseSearchQuery, rerankSearch, getProvider } from "../vision.js";
import { loadCaptionIdf } from "../data/captionIdf.js";
import { loadPhraseModel } from "../data/tokenizerModel.js";
import { SPATIAL_SEED } from "../ontology.js";
import { STAGE_LABELS } from "../workflow.js";
import { enumLabel } from "./labels.js";
import { loadSetup, publicBlobUrl, hasGraycard, getFollows, getGrainFollows, clearGraycardCache } from "../profile.js";
import { buildPhotoIndex, emptyFilterState, filterIsEmpty, photoMatches } from "../profileFilter.js";
import { loadDiscover, discoverCounts } from "../discover.js";
import { getMySetup } from "../publish.js";
import { openPublishSetup } from "./publishUI.js";
import { mountHeatmap } from "./mapView.js";
import { icon } from "./icons.js";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
const PUBLIC = "https://public.api.bsky.app/xrpc";
let viewerDid = null, viewerAgent = null;
export function setViewer(did, agent = null) { viewerDid = did; viewerAgent = agent; }

// The profile heatmap holds a WebGL context. Tear down the previous one before
// building another (or when leaving the profile) so navigating between profiles
// does not accumulate leaked contexts — scarce on mobile. openProfile registers
// its map state here; destroyProfileMap() releases it.
let liveHeatmap = null;
export function destroyProfileMap() { try { liveHeatmap?.map?.remove(); } catch { /* already gone */ } liveHeatmap = null; }

const TYPE_OF_INSTANCE = { camera: "cameraType", lens: "lensType", developer: "developerType", scanner: "scannerType", chemistry: "chemistryType", filmRoll: "filmStock" };

function bgThumb() { return el("div", { class: "type-thumb", "aria-hidden": "true" }); }
function setBg(thumb, url) { if (url) { thumb.style.backgroundImage = `url("${url}")`; thumb.classList.add("has-img"); } }

// A catalog type's picture: the type's own image (a link it carries, or a file
// its owner uploaded and we read as a public blob), else a curated manufacturer
// product shot, else the Wikidata stock image. `repo` is optional; without it an
// uploaded file simply falls through to the shared sources.
function typeThumb(kind, value, repo = null) {
  const t = bgThumb();
  const blobUrl = repo ? (b) => publicBlobUrl(repo.pds, repo.did, b) : null;
  catalogImageUrl(kind, value, { blobUrl }).then((u) => setBg(t, u)).catch(() => {});
  return t;
}
function instThumb(repo, store, kind, value) {
  const t = bgThumb();
  if (value.image) { setBg(t, publicBlobUrl(repo.pds, repo.did, value.image)); return t; }
  const tk = TYPE_OF_INSTANCE[kind];
  const typeUri = kind === "filmRoll" ? value.stock : value.type;
  const tv = typeUri ? store.byUri.get(typeUri)?.item?.value : null;
  if (tk && tv) {
    catalogImageUrl(tk, tv, { blobUrl: (b) => publicBlobUrl(repo.pds, repo.did, b) })
      .then((u) => setBg(t, u)).catch(() => {});
  }
  return t;
}

export function navigateProfile(handle) {
  handle = handle.replace(/^@/, "").trim();
  if (!handle) return;
  history.pushState({ profile: handle }, "", `${BASE}profile/${handle}`);
  openProfile(handle);
}

export function buildHandleSearch(placeholder = "View a setup by @handle") {
  const input = el("input", { type: "text", placeholder, autocomplete: "off", class: "search-input" });
  const menu = el("div", { class: "term-menu hidden" });
  let debounce;
  const go = (h) => { menu.classList.add("hidden"); input.value = ""; navigateProfile(h); };
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) { menu.classList.add("hidden"); return; }
    debounce = setTimeout(async () => {
      try {
        const r = await fetch(`${PUBLIC}/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=8`);
        const actors = (await r.json()).actors || [];
        const rows = new Map();
        menu.replaceChildren(...actors.map((a) => {
          const badge = el("span", { class: "gc-badge hidden" }, "graycard");
          const row = el("div", { class: "term-opt", onmousedown: (e) => { e.preventDefault(); go(a.handle); } }, [
            el("span", {}, `@${a.handle}`),
            el("span", { class: "row", style: "gap:6px" }, [a.displayName ? el("span", { class: "term-sub muted small" }, a.displayName) : null, badge]),
          ]);
          rows.set(a.handle, { row, badge });
          return row;
        }));
        menu.classList.toggle("hidden", !actors.length);
        // badge + float graycard users to the top (one describeRepo per candidate, cached)
        actors.forEach((a) => hasGraycard(a.did).then((yes) => {
          const rec = rows.get(a.handle);
          if (yes && rec) { rec.badge.classList.remove("hidden"); rec.row.classList.add("gc-user"); menu.prepend(rec.row); }
        }));
      } catch { /* offline */ }
    }, 220);
  });
  let idx = -1;
  const opts = () => [...menu.querySelectorAll(".term-opt")];
  const hi = (list) => list.forEach((o, i) => o.classList.toggle("active", i === idx));
  input.addEventListener("keydown", (e) => {
    const list = opts();
    if (e.key === "ArrowDown" && list.length) { e.preventDefault(); idx = (idx + 1) % list.length; hi(list); }
    else if (e.key === "ArrowUp" && list.length) { e.preventDefault(); idx = (idx - 1 + list.length) % list.length; hi(list); }
    else if (e.key === "Enter") { e.preventDefault(); if (idx >= 0 && list[idx]) list[idx].dispatchEvent(new MouseEvent("mousedown")); else if (input.value.trim()) go(input.value.trim()); }
  });
  input.addEventListener("input", () => { idx = -1; });
  input.addEventListener("blur", () => setTimeout(() => menu.classList.add("hidden"), 150));
  return el("div", { class: "term-input" }, [input, menu]);
}

export function openProfileSearch() {
  destroyProfileMap();
  showView("profile-view");
  $("#profile-search").replaceChildren(buildHandleSearch());
  const body = $("#profile-body");
  body.replaceChildren();   // the header's "@handle" search is the browse CTA
  // cross-network Discover leads (works logged-out); the follows list backs it up.
  discoverSetups(body);
  if (viewerDid) discoverFollows(body);
}

// Cross-network Discover: every published app.graycard.setup on the network,
// enumerated via Constellation (a shared backlink index) and hydrated from each
// author's PDS. No login required — published setups are public. Filtering is
// client-side over the hydrated cards, since Constellation indexes links, not
// record fields.
async function discoverSetups(body) {
  const section = el("div", { class: "card" });
  const countLine = el("p", { class: "muted small discover-setups-head", style: "margin:0" }, "Setups shared across the network.");
  const refreshBtn = el("button", { class: "ghost small-btn", type: "button", title: "Reload the setup index" }, [icon("refresh", 14), el("span", {}, "Refresh")]);
  const filterInput = el("input", { type: "search", class: "search-input discover-filter", placeholder: "Filter by name, photographer, or words in the summary", "aria-label": "Filter setups" });
  const grid = el("div", { class: "setup-grid" });
  const status = el("p", { class: "muted small" }, "Loading setups…");
  const moreWrap = el("div", { class: "setup-more" });
  section.append(
    el("div", { class: "row between", style: "margin-bottom:4px" }, [el("h3", { style: "margin:0" }, "Discover setups"), refreshBtn]),
    countLine, filterInput, status, grid, moreWrap,
  );
  body.append(section);

  const all = [];
  const seen = new Set();
  let cursor, hasMore = true, loading = false;

  const matches = (s) => {
    const q = filterInput.value.trim().toLowerCase();
    if (!q) return true;
    const hay = [s.value?.name, s.value?.summary, s.author?.handle, s.author?.displayName].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  };

  const setupCard = (s) => {
    const a = s.author || { handle: s.did };
    const mine = viewerDid && s.did === viewerDid;
    const meta = [];
    if (mine) meta.push(el("span", { class: "setup-tag you" }, "You"));
    const gearN = Array.isArray(s.value?.gear) ? s.value.gear.length : 0;
    if (gearN) meta.push(el("span", { class: "setup-tag" }, `${gearN} gear`));
    if (s.value?.gallery) meta.push(el("span", { class: "setup-tag" }, "gallery"));
    return el("a", {
      class: "setup-card", href: `${BASE}profile/${a.handle}`,
      onclick: (e) => { e.preventDefault(); navigateProfile(a.handle); },
    }, [
      a.avatar ? el("img", { class: "setup-av", src: a.avatar, alt: "", loading: "lazy" }) : el("div", { class: "setup-av" }),
      el("div", { class: "setup-body" }, [
        el("div", { class: "setup-name" }, s.value?.name || "Setup"),
        el("div", { class: "setup-handle mono muted" }, `@${a.handle}${a.displayName ? ` · ${a.displayName}` : ""}`),
        s.value?.summary ? el("div", { class: "setup-summary" }, s.value.summary) : null,
        meta.length ? el("div", { class: "setup-meta" }, meta) : null,
      ]),
    ]);
  };

  const render = () => {
    const shown = all.filter(matches);
    grid.replaceChildren(...shown.map(setupCard));
    if (!all.length) status.textContent = loading ? "Loading setups…" : "No published setups yet. Publish yours from the account menu to be the first.";
    else if (!shown.length) status.textContent = "No setups match your filter.";
    else status.textContent = "";
  };

  const setCounts = () => discoverCounts().then((c) => {
    if (c) countLine.textContent = `${c.setups.toLocaleString()} setup${c.setups === 1 ? "" : "s"} from ${c.authors.toLocaleString()} photographer${c.authors === 1 ? "" : "s"}. To appear in this listing, you can publish your setup from your public profile page.`;
  });

  const loadMore = async () => {
    if (loading || !hasMore) return;
    loading = true;
    moreWrap.replaceChildren();
    if (all.length) status.textContent = "Loading more…";
    try {
      const res = await loadDiscover(cursor);
      cursor = res.cursor;
      hasMore = res.hasMore;
      for (const s of res.setups) if (!seen.has(s.uri)) { seen.add(s.uri); all.push(s); }
    } catch (err) {
      loading = false;
      status.textContent = `Couldn't reach the setup index: ${err.message || err}`;
      return;
    }
    loading = false;
    render();
    if (hasMore) {
      const btn = el("button", { class: "ghost", type: "button" }, "Load more setups");
      btn.addEventListener("click", loadMore);
      moreWrap.replaceChildren(btn);
    }
  };

  filterInput.addEventListener("input", render);
  refreshBtn.onclick = () => {
    if (loading) return;
    all.length = 0; seen.clear(); cursor = undefined; hasMore = true;
    grid.replaceChildren(); moreWrap.replaceChildren();
    setCounts();
    loadMore();
  };

  setCounts();
  loadMore();
}

async function discoverFollows(body) {
  const section = el("div", { class: "card" });
  const content = el("div");
  // Persistent header with a Refresh button that force-clears the graycard cache
  // and re-checks — the escape hatch for a follow whose graycard records are newer
  // than a stale "no graycard" cache entry.
  const refreshBtn = el("button", { class: "ghost small-btn", type: "button", title: "Re-check your follows for graycard records" }, [icon("refresh", 14), el("span", {}, "Refresh")]);
  section.append(
    el("div", { class: "row between", style: "margin-bottom:10px" }, [el("h3", { style: "margin:0" }, "graycard people you follow"), refreshBtn]),
    content,
  );
  body.append(section);

  let busy = false;
  const populate = async () => {
    if (busy) return;
    busy = true; refreshBtn.disabled = true;
    content.replaceChildren(el("p", { class: "muted small" }, "Loading your follows…"));
    try {
      // Union BOTH follow graphs — grain (photographers) first, then Bluesky —
      // deduped by DID. grain.social keeps its own graph separate from Bluesky's.
      const [grain, bsky] = await Promise.all([getGrainFollows(viewerDid), getFollows(viewerDid)]);
      const seen = new Set(), follows = [];
      for (const f of [...grain, ...bsky]) if (f.did && !seen.has(f.did)) { seen.add(f.did); follows.push(f); }
      // Progress while we check every follow (no cap) via describeRepo; keep
      // source order so grain follows lead.
      const status = el("p", { class: "muted small", style: "margin:0 0 8px" });
      const fill = el("div", { class: "bar-fill", style: "width:0%" });
      const track = el("div", {
        class: "bar-track discover-progress-bar",
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": String(follows.length),
        "aria-valuenow": "0",
        "aria-label": "Checking follows for graycard records",
      }, [fill]);
      content.replaceChildren(el("div", { class: "discover-progress" }, [status, track]));
      let processed = 0, withGc = 0;
      const inFlight = new Map();   // did -> handle (who's still on a live PDS check)
      const updateProgress = () => {
        const total = follows.length;
        const pct = total ? Math.round((processed / total) * 100) : 0;
        let line = total
          ? `Checking follows… ${processed} / ${total} · ${withGc} with graycard`
          : "No follows to check.";
        if (inFlight.size) {
          const names = [...inFlight.values()].slice(0, 2).map((h) => `@${h}`);
          const extra = inFlight.size > names.length ? ` +${inFlight.size - names.length}` : "";
          line += ` · waiting on ${names.join(", ")}${extra}`;
        }
        status.textContent = line;
        fill.style.width = `${pct}%`;
        track.setAttribute("aria-valuenow", String(processed));
      };
      updateProgress();
      const flags = await mapLimit(follows, 24, async (f) => {
        inFlight.set(f.did, f.handle || f.did);
        updateProgress();
        try { return await hasGraycard(f.did); }
        finally { inFlight.delete(f.did); }
      }, (done, _total, has) => {
        processed = done;
        if (has) withGc++;
        updateProgress();
      });
      const found = follows.filter((_, i) => flags[i]);
      if (!found.length) { content.replaceChildren(el("p", { class: "muted small" }, "None of your follows have graycard records yet.")); return; }
      const ul = el("ul", { class: "gear-list" });
      for (const f of found) ul.append(el("li", { class: "gear-row", style: "cursor:pointer", onclick: () => navigateProfile(f.handle) }, [el("span", {}, `@${f.handle}`), f.displayName ? el("span", { class: "muted small" }, ` · ${f.displayName}`) : null]));
      content.replaceChildren(ul);
    } finally { busy = false; refreshBtn.disabled = false; }
  };
  refreshBtn.onclick = () => { clearGraycardCache(); populate(); };
  populate();
}

// Run an async fn over items with bounded concurrency, returning results in
// input order (so callers can preserve the source ordering of `items`).
// onProgress(done, total, result, index) fires after each item settles.
async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let i = 0, done = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
      done++;
      onProgress?.(done, items.length, results[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// -- public profile: gear-first, filterable galleries -------------------------

const grainRkey = (uri) => (uri || "").split("/").pop();
const grainGalleryUrl = (repo, galleryUri) => `https://grain.social/profile/${repo.did}/gallery/${grainRkey(galleryUri)}`;

// header: centered, no card. Avatar, name, handle, a short gear summary, and the
// two off-site links (Grain in our accent, Bluesky in Bluesky blue).
// Your own profile carries the Discover listing control: "Publish to Discover"
// when you are not listed, "Edit profile" once you are. It only renders on your
// own profile while signed in — this is the page the listing is about, so it is
// where the action belongs.
function ownListingButton(repo) {
  if (!viewerDid || !viewerAgent || repo.did !== viewerDid) return null;
  const btn = el("button", { class: "linkbtn", type: "button" }, "Publish to Discover");
  const paint = (setup) => { btn.textContent = setup ? "Edit profile" : "Publish to Discover"; };
  let known;                                   // the loaded setup, so the modal need not refetch
  getMySetup(viewerAgent, viewerDid).then((s) => { known = s; paint(s); }).catch(() => {});
  btn.addEventListener("click", () => {
    openPublishSetup(viewerAgent, viewerDid, {
      handle: repo.handle,
      existing: known,
      onChange: (s) => { known = s; paint(s); },
    });
  });
  return btn;
}

function headerBar(repo, store) {
  const nCam = (store.instance.camera || []).length, nLens = (store.instance.lens || []).length;
  const bits = [`${nCam} camera${nCam !== 1 ? "s" : ""}`, `${nLens} lens${nLens !== 1 ? "es" : ""}`];
  return el("div", { class: "profile-header" }, [
    repo.avatar ? el("img", { class: "profile-avatar", src: repo.avatar, alt: "" }) : null,
    el("h2", { class: "profile-name" }, repo.displayName || `@${repo.handle}`),
    el("div", { class: "mono muted small" }, `@${repo.handle}`),
    el("div", { class: "muted small profile-summary" }, bits.join(" · ")),
    el("div", { class: "row profile-links" }, [
      ownListingButton(repo),
      el("a", { class: "linkbtn primary-link", href: `https://grain.social/profile/${repo.handle}`, target: "_blank", rel: "noopener" }, "Grain ↗"),
      el("a", { class: "linkbtn bsky-link", href: `https://bsky.app/profile/${repo.handle}`, target: "_blank", rel: "noopener" }, "Bluesky ↗"),
    ]),
  ]);
}

const toggleSet = (set, uri) => { if (set.has(uri)) set.delete(uri); else set.add(uri); };

// a card that collapses to just its title. Native <details>, so no JS to toggle;
// callers append content after the summary and read/set `.open`.
function collapsibleCard(title, open = false) {
  const card = el("details", { class: "card collapse-card" }, [
    el("summary", { class: "collapse-summary" }, [
      el("h3", { style: "margin:0" }, title),
      el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄"),
    ]),
  ]);
  if (open) card.open = true;
  return card;
}

// Semantic search over this profile's scene graphs. Collapsed by default. A query
// matches a photo's objects / relations / spatial relations, expanded through
// Wikidata's class hierarchy ("animal" finds a dog). Returns null when there is
// nothing indexable to search.
// An info-only modal explaining what the search understands, with examples.
function openSearchHelp() {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "How search works" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  const ex = (q, d) => el("div", { class: "search-help-row" }, [el("code", { class: "search-help-q" }, q), el("span", { class: "muted small" }, d)]);
  modal.append(
    el("h2", {}, "How search works"),
    el("p", { class: "muted small" }, "Search finds photos by what is actually in them: the objects and how they relate. Type naturally."),
    el("div", { class: "search-help" }, [
      ex("dog", "photos that contain a dog"),
      ex("fire hydrant", "multi-word things stay together"),
      ex("animal", "broader words match specifics too: also finds a dog or a bird, via Wikidata"),
      ex("dog, tree", "several things at once (both present)"),
      ex("car or bicycle", "either one"),
      ex("person riding bicycle", "a relation between two things"),
      ex("car left of tree", "spatial relations (and “tree right of car” finds the same photo)"),
      ex("no cars", "exclude something (also written “-cars”)"),
      ex("two dogs", "at least this many"),
    ]),
    el("p", { class: "muted small" }, "It searches the photographer's tags plus each photo's title, description, and alt text. Connecting an image-analysis provider in Settings improves parsing of longer phrases."),
    el("div", { class: "row modal-actions" }, [el("button", { class: "ghost", onclick: close }, "Got it")]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

function sceneSearchCard(repo, data, photoByUri, galleryOfPhoto) {
  const index = buildSceneIndex({ scenes: data.scenes, sceneNodes: data.sceneNodes, sceneEdges: data.sceneEdges });
  if (!index.photos.size) return null;

  // BM25 corpus + rerank descriptors: a photo's alt text + its gallery's
  // title/description, plus scene-node labels for the LLM reranker.
  const galleryVal = new Map((data.galleries || []).map((g) => [g.uri, g.value]));
  const nodeLabels = new Map();
  for (const rec of index.photos.values()) nodeLabels.set(rec.photo, rec.nodes.map((n) => n.label).filter(Boolean).join(" "));
  const textOf = (uri) => { const p = photoByUri.get(uri); const gv = galleryVal.get(galleryOfPhoto.get(uri)); return [p?.value?.alt, gv?.title, gv?.description].filter(Boolean).join(" "); };
  const descriptorOf = (uri) => [textOf(uri), nodeLabels.get(uri)].filter(Boolean).join(" ");
  const searchDocs = (data.photos || []).map((p) => ({ uri: p.uri, text: textOf(p.uri) }));
  let textIndex;    // built on first query with the phrase tokenizer, so doc tokens match the df keys
  let tokenizer;    // phrase-aware tokenizer (base tokenizer if the phrase asset is unavailable)

  let captionIdf;   // lazily loaded corpus IDF (null when unavailable -> per-profile)
  const PRESETS = ["balanced", "strict", "broad"];
  const PRESET_KEY = "hypo:searchPreset";
  let preset = "balanced";
  try { const v = localStorage.getItem(PRESET_KEY); if (PRESETS.includes(v)) preset = v; } catch { /* private mode / blocked storage */ }

  const card = collapsibleCard("Search");
  const input = el("input", {
    type: "search", class: "search-input", "aria-label": "Search this photographer's photos",
    enterkeyhint: "search", placeholder: "e.g. dog · animal · person riding bicycle · car left of tree",
  });
  const presetSel = el("select", { class: "search-preset", "aria-label": "Result strictness", title: "How strictly to cut off weaker matches" },
    PRESETS.map((p) => el("option", { value: p }, p[0].toUpperCase() + p.slice(1))));
  presetSel.value = preset;
  presetSel.addEventListener("change", () => { preset = presetSel.value; try { localStorage.setItem(PRESET_KEY, preset); } catch { /* private mode */ } run(); });
  const hintRow = el("div", { class: "row between search-hint-row" }, [
    el("p", { class: "muted small", style: "margin:0" }, "Searches what's in each photo."),
    el("div", { class: "row", style: "gap:8px" }, [presetSel, el("button", { class: "ghost small-btn", type: "button", "aria-label": "How search works", onclick: openSearchHelp }, [icon("info", 14), el("span", {}, "How it works")])]),
  ]);
  const results = el("div", { class: "search-results" });
  card.append(hintRow, input, results);

  const grainLink = (uri, p) => { const g = galleryOfPhoto.get(uri); return g ? grainGalleryUrl(repo, g) : `https://grain.social/profile/${repo.handle}`; };
  const cell = (uri) => {
    const p = photoByUri.get(uri);
    const url = p && publicBlobUrl(repo.pds, repo.did, p.value.photo);
    const c = el("div", { class: "search-cell" });
    if (url) c.style.backgroundImage = `url("${url}")`;
    return el("a", { class: "search-hit", href: grainLink(uri, p), target: "_blank", rel: "noopener", title: p?.value?.alt || "" }, c);
  };
  const gridOf = (rows) => el("div", { class: "search-grid" }, rows.slice(0, 60).map((r) => cell(r.uri)));

  const relationHint = [...new Set([...index.relationForms, ...SPATIAL_SEED.map((s) => s.label)])].filter(Boolean);
  const cache = new Map();   // `${preset}::${q}` -> scored rankScenes results

  let token = 0;
  async function run() {
    const q = input.value.trim();
    const mine = ++token;
    if (!q) { results.replaceChildren(); return; }
    const setStatus = (msg) => { if (mine === token) results.replaceChildren(el("p", { class: "muted small" }, msg)); };
    setStatus("Searching…");
    if (captionIdf === undefined || tokenizer === undefined) {
      setStatus("Preparing search index…");
      if (captionIdf === undefined) { try { captionIdf = await loadCaptionIdf(); } catch { captionIdf = null; } if (mine !== token) return; }
      if (tokenizer === undefined) {
        let phrases = null;
        try { phrases = await loadPhraseModel(); } catch { phrases = null; }
        if (mine !== token) return;
        tokenizer = phrases ? makeTokenizer({ phrases }) : tokenize;   // same code path built the df table
        textIndex = buildTextIndex(searchDocs, tokenizer);
        // The corpus df table was tokenized WITH phrases; if the phrase asset is
        // missing we index/query with the base tokenizer, so the phrase-built IDF
        // no longer aligns (phrase-component unigrams are deflated). Drop it and
        // let bm25Search use the per-profile IDF, which matches the base index.
        if (!phrases) captionIdf = null;
      }
    }
    const render = (scored, busyMsg = null) => {
      const match = scored.filter((r) => r.band === "match");
      const near = scored.filter((r) => r.band === "near");
      if (!match.length && !near.length) {
        results.replaceChildren(
          busyMsg ? el("p", { class: "muted small" }, busyMsg) : null,
          el("p", { class: "muted small" }, "No photos match. Try a broader word, or a different relation."),
        );
        return;
      }
      const children = [];
      if (busyMsg) children.push(el("p", { class: "muted small search-busy" }, busyMsg));
      if (match.length) children.push(el("div", { class: "muted small search-count" }, `${match.length} photo${match.length === 1 ? "" : "s"}`), gridOf(match));
      else children.push(el("p", { class: "muted small" }, "No strong matches, but some are close:"));
      if (near.length) {
        const box = el("details", { class: "collapse-card search-near" }, [
          el("summary", { class: "collapse-summary" }, [el("h3", { style: "margin:0; font-size:14px" }, `Closest matches · ${near.length}`), el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄")]),
          gridOf(near),
        ]);
        children.push(box);
      }
      results.replaceChildren(...children);
    };

    const key = `${preset}::${q}`;
    if (cache.has(key)) { render(cache.get(key)); return; }

    const cfg = getVisionConfig();
    const providerName = cfg?.apiKey ? getProvider(cfg).label : null;
    // LLM parse only for multi-word, non-mixed-boolean queries (the flat LLM
    // schema can't express OR-of-AND grouping the heuristic handles).
    const llmParse = (cfg?.apiKey && q.split(/\s+/).length > 1 && !/\bor\b/.test(q))
      ? ((query) => parseSearchQuery(query, cfg, { relations: relationHint })) : null;
    // The LLM reranker is the slow signal, so rankScenes paints the fast
    // Wikidata+BM25 result first (onPartial) and this only reorders it.
    const llmRerank = cfg?.apiKey
      ? ((query, uris) => rerankSearch(query, cfg, uris.map((u) => ({ uri: u, text: descriptorOf(u) })))) : null;
    const onStage = (stage) => {
      if (mine !== token) return;
      if (stage === "parse" && providerName) setStatus(`Understanding query with ${providerName}…`);
      else if (stage === "match") setStatus("Matching scene graphs and captions…");
    };
    const onPartial = (partial) => {
      if (mine === token) render(partial, providerName ? `Reranking with ${providerName}…` : null);
    };
    let scored;
    try {
      scored = await rankScenes(index, q, { resolveTerm: resolveConcepts, ancestorsOf, llmParse, llmRerank, textIndex, tokenizer, captionIdf, preset, onPartial, onStage });
    } catch { scored = []; }
    if (mine !== token) return;   // a newer query superseded this one
    cache.set(key, scored);
    render(scored);
  }

  let debounce;
  input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(run, 320); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(debounce); run(); } });
  return card;
}

// one facet's row of toggle chips. `options`: [{ uri, label, thumb?, count }].
// `onClick(uri)` fully handles a click (the caller re-renders to reflect state).
function chipFilter(options, selected, onClick, { thumbs = false } = {}) {
  const row = el("div", { class: "filter-chip-row" });
  for (const o of options) {
    const chip = el("button", { class: `filter-chip${selected.has(o.uri) ? " on" : ""}`, type: "button" }, [
      thumbs && o.thumb ? o.thumb : null,
      el("span", {}, o.label),
      o.count ? el("span", { class: "chip-count" }, String(o.count)) : null,  // hide 0 — gear also just showcases the setup
    ]);
    chip.addEventListener("click", () => onClick(o.uri));
    row.append(chip);
  }
  return row;
}

// count photos matching a facet value, so chips can show how much they'd filter.
function facetCount(index, key, val) {
  let n = 0;
  for (const m of index.meta.values()) { const set = m[key]; if (set instanceof Set ? set.has(val) : m[key] === val) n += 1; }
  return n;
}

export async function openProfile(handle) {
  handle = handle.replace(/^@/, "");
  showView("profile-view");
  $("#profile-search").replaceChildren(buildHandleSearch());
  const body = $("#profile-body");
  const phase = loadPhase(`Loading @${handle}'s graycard from their PDS…`);
  body.replaceChildren(
    ...Array.from({ length: 3 }, () => el("div", { class: "card" }, [el("div", { class: "skeleton skeleton-title" }), el("div", { class: "skeleton skeleton-line" })])),
    phase.node,
  );
  try {
    const data = await loadSetup(handle);
    const { repo, store, templates, galleries, galleryItems, photos, shoots } = data;
    const index = buildPhotoIndex(data);
    const photoByUri = new Map(photos.map((p) => [p.uri, p]));
    const state = emptyFilterState();
    body.replaceChildren();

    body.append(headerBar(repo, store));

    const gearMount = el("div");
    const filtersMount = el("div");
    const galleriesMount = el("div");
    const hasGear = store.instance.camera?.length || store.instance.lens?.length || store.catalog.filmStock?.length || photos.length;
    destroyProfileMap();               // release the prior profile's map before building a new one
    const locMapState = {};
    liveHeatmap = locMapState;
    const renderGear = () => gearMount.replaceChildren(gearFilterCard(repo, store, index, state, shoots || [], rerender));
    const renderFilters = () => filtersMount.replaceChildren(advancedFiltersCard(index, state, rerender, locMapState) || "");
    const renderGalleries = () => galleriesMount.replaceChildren(galleriesCard(repo, galleries, index, state, photoByUri));
    function rerender() { if (hasGear) renderGear(); renderFilters(); renderGalleries(); }

    // gear FIRST, then the additional (aperture/shutter/date/location) filters
    if (hasGear) { body.append(gearMount); renderGear(); }
    body.append(filtersMount); renderFilters();

    // workflows (between gear and galleries)
    if (templates.length) {
      const ul = el("ul", { class: "gear-list" });
      for (const t of templates) {
        const kinds = (t.value.stageKinds || []).map((k) => STAGE_LABELS[k] || k).join(" → ");
        ul.append(el("li", { class: "gear-row" }, [el("div", {}, [el("strong", {}, t.value.name), el("div", { class: "muted small" }, `${enumLabel(t.value.medium || "")} · ${kinds || "(no stages)"}`)])]));
      }
      body.append(el("div", { class: "card" }, [el("h3", {}, "Workflows"), ul]));
    }

    // semantic scene search (collapsed) — after gear + refine, just before galleries.
    const galleryOfPhoto = new Map();
    for (const [gUri, phs] of index.galleryPhotos) for (const ph of phs) if (!galleryOfPhoto.has(ph)) galleryOfPhoto.set(ph, gUri);
    const searchCard = sceneSearchCard(repo, data, photoByUri, galleryOfPhoto);
    if (searchCard) body.append(searchCard);

    // galleries LAST
    body.append(galleriesMount);
    if (galleries.length) renderGalleries();

    if (!store.instance.camera?.length && !templates.length && !galleries.length) body.append(el("p", { class: "muted" }, "No public graycard records yet."));
    stagger([...body.querySelectorAll(".card")]);
  } catch (err) {
    body.replaceChildren(el("p", { class: "error" }, `Couldn't load @${handle}: ${err.message || err}`));
  } finally {
    phase.clear();
  }
}

// the gear card doubles as the filter: multiselect gear chips + an advanced
// reveal (aperture / shutter / date / location).
function gearFilterCard(repo, store, index, state, shoots, rerender) {
  const card = el("div", { class: "card" }, [el("h3", {}, "Gear")]);
  const opts = (items, metaKey, labelFn, thumbFn) => items
    .map((it) => ({ uri: it.uri, label: labelFn(it), thumb: thumbFn ? thumbFn(it) : null, count: facetCount(index, metaKey, it.uri) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const simpleClick = (set) => (uri) => { toggleSet(set, uri); rerender(); };
  const group = (title, o, stateSet, onClick) => { if (o.length) card.append(el("h4", { class: "stat-h" }, title), chipFilter(o, stateSet, onClick, { thumbs: true })); };

  // camera / lens / filter each have an instance level, plus a model level that
  // appears ONLY for models the user owns two-or-more copies of.
  const KINDS = [
    { kind: "camera", catKind: "cameraType", title: "Cameras", modelTitle: "Camera models", inst: "cameras", type: "cameraTypes", sInst: "camera", sType: "cameraType" },
    { kind: "lens", catKind: "lensType", title: "Lenses", modelTitle: "Lens models", inst: "lenses", type: "lensTypes", sInst: "lens", sType: "lensType" },
    { kind: "filter", catKind: "filterType", title: "Filters", modelTitle: "Filter models", inst: "filters", type: "filterTypes", sInst: "filter", sType: "filterType" },
  ];
  for (const K of KINDS) {
    const instances = store.instance[K.kind] || [];
    if (!instances.length) continue;
    const byType = new Map();
    for (const it of instances) { const ty = it.value.type; if (!ty) continue; if (!byType.has(ty)) byType.set(ty, []); byType.get(ty).push(it); }
    const dupTypes = [...byType.keys()].filter((ty) => byType.get(ty).length >= 2);
    const dupSet = new Set(dupTypes);

    // clicking a body toggles it, and keeps the model chip in sync (a model is
    // "on" exactly when all of its bodies are selected).
    const instClick = (uri) => {
      toggleSet(state[K.sInst], uri);
      const ty = instances.find((i) => i.uri === uri)?.value.type;
      if (ty && dupSet.has(ty)) {
        if (byType.get(ty).every((i) => state[K.sInst].has(i.uri))) state[K.sType].add(ty); else state[K.sType].delete(ty);
      }
      rerender();
    };
    // clicking a model selects/deselects the model AND all its bodies.
    const modelClick = (ty) => {
      const on = !state[K.sType].has(ty);
      if (on) state[K.sType].add(ty); else state[K.sType].delete(ty);
      for (const i of byType.get(ty)) { if (on) state[K.sInst].add(i.uri); else state[K.sInst].delete(i.uri); }
      rerender();
    };

    // a type precedes its instances: show the model group first (when there are
    // duplicated models to distinguish), then the individual bodies.
    if (dupTypes.length) {
      const typeItems = dupTypes.map((ty) => (store.catalog[K.catKind] || []).find((t) => t.uri === ty)).filter(Boolean);
      group(K.modelTitle, opts(typeItems, K.type, (t) => catalogLabel(K.catKind, t.value), (t) => typeThumb(K.catKind, t.value, repo)), state[K.sType], modelClick);
    }
    group(K.title, opts(instances, K.inst, (it) => instanceLabel(K.kind, it.value, store), (it) => instThumb(repo, store, K.kind, it.value)), state[K.sInst], instClick);
  }

  // film is filtered by stock (a roll is consumable inventory, not reusable gear,
  // so per-roll chips would be noise on a public gallery).
  group("Film", opts(store.catalog.filmStock || [], "films", (t) => catalogLabel("filmStock", t.value), (t) => typeThumb("filmStock", t.value, repo)), state.film, simpleClick(state.film));

  // shoots: unique sessions, no type distinction; only those that contain photos.
  const shootOpts = (shoots || []).map((sh) => ({ uri: sh.uri, label: sh.value.label || "Shoot", count: facetCount(index, "shoots", sh.uri) })).filter((o) => o.count > 0);   // shoots arrive newest-first (sorted in loadSetup)
  if (shootOpts.length) card.append(el("h4", { class: "stat-h" }, "Shoots"), chipFilter(shootOpts, state.shoot, simpleClick(state.shoot)));

  return card;
}

// the additional (non-gear) filters — aperture / shutter / date / location — in
// their own card between gear and galleries. Returns null when there's nothing
// but the date range to offer (kept minimal) — actually we always show at least
// a date range, so it always returns a card.
function advancedFiltersCard(index, state, rerender, mapState) {
  const simpleClick = (set) => (uri) => { toggleSet(set, uri); rerender(); };
  const apertures = [...new Set([...index.meta.values()].flatMap((m) => [...m.apertures]))].sort((a, b) => parseFloat(a) - parseFloat(b));
  const shutters = [...new Set([...index.meta.values()].flatMap((m) => [...m.shutters]))].sort((a, b) => shutterSeconds(b) - shutterSeconds(a));
  const isos = [...new Set([...index.meta.values()].flatMap((m) => [...m.isos]))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const cells = locationCells(index);

  // collapsed by default; open-state persists across re-renders (mapState survives
  // them). The heatmap is built LAZILY on first open — a maplibre map created
  // inside a display:none <details> fits to a 0-size box and opens mis-framed —
  // and merely resized on later opens.
  const card = collapsibleCard("Refine", mapState.refineOpen);
  card.addEventListener("toggle", () => {
    mapState.refineOpen = card.open;
    if (card.open) requestAnimationFrame(() => { if (mapState.map) mapState.map.resize(); else mapState.mountHeat?.(); });
  });
  if (apertures.length) card.append(el("h4", { class: "stat-h" }, "Aperture"), chipFilter(apertures.map((a) => ({ uri: a, label: `ƒ/${a}`, count: facetCount(index, "apertures", a) })), state.aperture, simpleClick(state.aperture)));
  if (shutters.length) card.append(el("h4", { class: "stat-h" }, "Shutter"), chipFilter(shutters.map((s) => ({ uri: s, label: s, count: facetCount(index, "shutters", s) })), state.shutter, simpleClick(state.shutter)));
  if (isos.length) card.append(el("h4", { class: "stat-h" }, "ISO"), chipFilter(isos.map((i) => ({ uri: i, label: `ISO ${i}`, count: facetCount(index, "isos", i) })), state.iso, simpleClick(state.iso)));

  // location: a coarse density heatmap. The map instance persists in mapState so
  // toggling other filters doesn't tear it down; tapping a cell filters the gallery.
  if (cells.length) {
    if (!mapState.node) mapState.node = el("div", { class: "map-canvas heat" });
    const selCount = [...state.cell].length;
    card.append(
      el("div", { class: "row between" }, [el("h4", { class: "stat-h", style: "margin:0" }, "Location"), selCount ? el("button", { class: "ghost small-btn", onclick: () => { state.cell.clear(); rerender(); } }, "Clear") : null]),
      el("p", { class: "muted small" }, "Coarse ~5 km. Tap an area to filter; tap again to clear."),
      mapState.node,
    );
    mapState.mountHeat = () => mountHeatmap(mapState.node, mapState, cells, state.cell, (key) => { toggleSet(state.cell, key); rerender(); }).catch(() => {});
    if (card.open) requestAnimationFrame(mapState.mountHeat);   // only build while visible
  }

  const fromIn = el("input", { type: "date", class: "date-input", value: state.from || "" });
  const toIn = el("input", { type: "date", class: "date-input", value: state.to || "" });
  fromIn.addEventListener("change", () => { state.from = fromIn.value || null; rerender(); });
  toIn.addEventListener("change", () => { state.to = toIn.value || null; rerender(); });
  card.append(el("h4", { class: "stat-h" }, "Date"), el("div", { class: "row date-range" }, [field("From", fromIn), field("To", toIn)]));
  return card;
}

// aggregate indexed photos into coarse location cells for the heatmap.
function locationCells(index) {
  const byCell = new Map();
  for (const m of index.meta.values()) {
    if (!m.cell) continue;
    const e = byCell.get(m.cell) || { key: m.cell, lat: m.cellLat, lon: m.cellLon, label: m.cellLabel, count: 0 };
    e.count += 1;
    byCell.set(m.cell, e);
  }
  return [...byCell.values()];
}

// approximate seconds for a shutter string ("1/500", "2s", "B") for sorting.
function shutterSeconds(s) {
  if (!s) return 0;
  if (/^b$/i.test(s)) return 1e6;
  if (s.includes("/")) { const [a, b] = s.replace("s", "").split("/").map(Number); return b ? a / b : 0; }
  return parseFloat(s) || 0;
}

// galleries: 3-up teasers (matching the filters), each linking to its grain
// gallery, with a slide-down to reveal the rest.
function galleriesCard(repo, galleries, index, state, photoByUri) {
  const active = !filterIsEmpty(state);
  const ranked = [...galleries]
    .map((g) => {
      const all = index.galleryPhotos.get(g.uri) || [];
      const matched = active ? all.filter((ph) => photoMatches(index.meta.get(ph), state)) : all;
      return { g, matched, all };
    })
    .filter((r) => (active ? r.matched.length > 0 : true))
    .sort((a, b) => (b.g.value.createdAt || "").localeCompare(a.g.value.createdAt || ""));

  const card = el("div", { class: "card" }, [
    el("div", { class: "row between" }, [
      el("h3", {}, active ? `Galleries · ${ranked.length} match` : "Galleries"),
      el("a", { class: "linkbtn small", href: `https://grain.social/profile/${repo.handle}`, target: "_blank", rel: "noopener" }, `All on Grain ↗`),
    ]),
  ]);
  if (!ranked.length) { card.append(el("p", { class: "muted small" }, "No galleries match these filters.")); return card; }

  const teaser = (r) => {
    // one cover photo per gallery, like grain — no multi-photo montage.
    const cover = (active ? r.matched : r.all)[0];
    const p = cover && photoByUri.get(cover);
    const url = p && publicBlobUrl(repo.pds, repo.did, p.value.photo);
    const sheet = el("div", { class: "teaser-sheet single" });
    const cell = el("div", { class: "teaser-cell" });
    if (url) cell.style.backgroundImage = `url("${url}")`;
    sheet.append(cell);
    return el("a", { class: "teaser", href: grainGalleryUrl(repo, r.g.uri), target: "_blank", rel: "noopener" }, [
      sheet,
      el("div", { class: "teaser-title" }, r.g.value.title || "Untitled"),
      active ? el("div", { class: "muted small teaser-count" }, `${r.matched.length} match${r.matched.length === 1 ? "" : "es"}`) : null,
    ]);
  };

  const first = el("div", { class: "teaser-grid" }, ranked.slice(0, 3).map(teaser));
  card.append(first);
  if (ranked.length > 3) {
    // reveal the rest inline and drop the button — it has served its purpose.
    const moreBtn = el("button", { class: "reveal-summary show-more", type: "button" }, [
      el("span", {}, `Show ${ranked.length - 3} more`),
      el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄"),
    ]);
    moreBtn.addEventListener("click", () => {
      card.insertBefore(el("div", { class: "teaser-grid reveal" }, ranked.slice(3).map(teaser)), moreBtn);
      moreBtn.remove();
    });
    card.append(moreBtn);
  }
  return card;
}
