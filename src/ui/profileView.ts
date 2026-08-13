// profileView.ts: read-only view of another user's public graycard setup,
// reachable at /<handle> (e.g. hypo.graycard.app/alice.bsky.social) or via handle search.
// No auth, no backend.

import { el, $, showView, stagger, field, getVisionConfig, loadPhase } from "./dom.js";
import { NS, catalogLabel, instanceLabel } from "../graycard.js";
import { recordStore } from "../grain.js";
import { renderOn, type RecordStore } from "@hypo/store";
import { resolveConcepts, ancestorsOf } from "../data/wikidata.js";
import { catalogImageUrl } from "../data/catalogImage.js";
import { buildSceneIndex, rankScenes, buildTextIndex, makeTokenizer, tokenize } from "../sceneSearch.js";
import { loadCaptionIdf } from "../data/captionIdf.js";
import { loadPhraseModel } from "../data/tokenizerModel.js";
import { SPATIAL_SEED } from "../ontology.js";
import { STAGE_LABELS } from "../workflow.js";
import { enumLabel } from "./labels.js";
import { loadSetup, publicBlobUrl, hasGraycard } from "../profile.js";
import { buildPhotoIndex, emptyFilterState, filterIsEmpty, photoMatches } from "../profileFilter.js";
import { loadDiscover } from "../discover.js";
import { getMySetup } from "../publish.js";
import { openPublishSetup } from "./publishUI.js";
import { mountHeatmap } from "./mapView.js";
import { icon } from "./icons.js";
import { imageAlt } from "./lazy.js";
import { routePath } from "../router.js";
import type { PhotoFacetMetadata, PhotoFilterState, PhotoIndex, ProfileIndexInput } from "@hypo/domain";

interface ImportMetaWithEnv extends ImportMeta {
  env?: { BASE_URL?: string };
}

interface RepoView {
  pds: string;
  did: string;
  handle: string;
  displayName?: string | null;
  avatar?: string | null;
}

interface RecordValue {
  [key: string]: unknown;
  image?: unknown;
  type?: string | null;
  stock?: string | null;
  photo?: unknown;
  name?: string | null;
  summary?: string | null;
  gallery?: string | null;
  gear?: unknown[];
  label?: string | null;
  title?: string | null;
  description?: string | null;
  alt?: string | null;
  stageKinds?: string[];
  medium?: string | null;
  createdAt?: string | null;
}

interface RecordView {
  uri: string;
  cid?: string | null;
  value: RecordValue;
}

interface StoreView {
  catalog: Record<string, RecordView[]>;
  instance: Record<string, RecordView[]>;
  byUri: Map<string, { item: RecordView; layer?: string; kind?: string }>;
}

interface SetupView {
  repo: RepoView;
  store: StoreView;
  templates: RecordView[];
  shoots: RecordView[];
  galleries: RecordView[];
  photos: RecordView[];
  galleryItems: RecordView[];
  captures: RecordView[];
  photoWorkflows: RecordView[];
  scenes: RecordView[];
  sceneNodes: RecordView[];
  sceneEdges: RecordView[];
  exif: RecordView[];
  galleryDefaults: RecordView[];
}

interface ActorView {
  did: string;
  handle: string;
  displayName?: string | null;
  avatar?: string | null;
}

interface DiscoverSetupView {
  uri: string;
  did: string;
  author?: ActorView;
  value?: {
    name?: string | null;
    summary?: string | null;
    gear?: unknown[];
    gallery?: unknown;
  };
}

interface LocationCell {
  key: string;
  lat: number;
  lon: number;
  label: string | null;
  count: number;
}

interface HeatmapMap {
  remove(): void;
  resize(): void;
}

interface HeatmapState {
  map?: HeatmapMap;
  node?: HTMLDivElement;
  mountHeat?: () => void;
  refineOpen?: boolean;
}

interface ChipOption {
  uri: string;
  label: string;
  thumb?: HTMLElement | null;
  count?: number;
}

type SceneScore = Awaited<ReturnType<typeof rankScenes>>[number];
type TextIndex = ReturnType<typeof buildTextIndex>;
type Tokenizer = typeof tokenize;
type CaptionIdf = Awaited<ReturnType<typeof loadCaptionIdf>>;
type SearchPreset = "balanced" | "strict" | "broad";
type Listing = Awaited<ReturnType<typeof getMySetup>>;

const BASE = (import.meta as ImportMetaWithEnv).env?.BASE_URL || "/";
const PUBLIC = "https://public.api.bsky.app/xrpc";
let viewerDid: string | null = null;
let viewerAgent: unknown = null;
let disposeProfileSignals = () => {};
let profileRevision = 0;
export function setViewer(did: string | null, agent: unknown = null): void {
  viewerDid = did;
  viewerAgent = agent;
}

function requiredElement<T extends Element>(selector: string): T {
  const node = $(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The profile heatmap holds a WebGL context. Tear down the previous one before
// building another (or when leaving the profile) so navigating between profiles
// does not accumulate leaked contexts — scarce on mobile. openProfile registers
// its map state here; destroyProfileMap() releases it.
let liveHeatmap: HeatmapState | null = null;
export function destroyProfileMap(): void {
  profileRevision += 1;
  disposeProfileSignals();
  disposeProfileSignals = () => {};
  try {
    liveHeatmap?.map?.remove();
  } catch {
    /* already gone */
  }
  liveHeatmap = null;
}

interface ProfileGearSignals {
  cameras: ReturnType<RecordStore["collection"]>["value"];
  lenses: ReturnType<RecordStore["collection"]>["value"];
  filmStocks: ReturnType<RecordStore["collection"]>["value"];
}

export function renderProfileGearOn(
  signals: Pick<RecordStore, "collection">,
  render: (records: ProfileGearSignals) => void,
): () => void {
  return renderOn(
    () => ({
      cameras: signals.collection(NS.instance.camera).value,
      lenses: signals.collection(NS.instance.lens).value,
      filmStocks: signals.collection(NS.catalog.filmStock).value,
    }),
    render,
  );
}

const TYPE_OF_INSTANCE: Partial<Record<string, string>> = {
  camera: "cameraType",
  lens: "lensType",
  scanner: "scannerType",
  chemistry: "chemistryType",
  filmRoll: "filmStock",
};

function bgThumb(): HTMLDivElement {
  return el("div", { class: "type-thumb", "aria-hidden": "true" });
}
function setBg(thumb: HTMLElement, url: string | null | undefined): void {
  if (url) {
    thumb.style.backgroundImage = `url("${url}")`;
    thumb.classList.add("has-img");
  }
}

// A catalog type's picture: the type's own image (a link it carries, or a file
// its owner uploaded and we read as a public blob), else a curated manufacturer
// product shot, else the Wikidata stock image. `repo` is optional; without it an
// uploaded file simply falls through to the shared sources.
function typeThumb(kind: string, value: RecordValue, repo: RepoView | null = null): HTMLDivElement {
  const t = bgThumb();
  const blobUrl = repo ? (blob: unknown) => publicBlobUrl(repo.pds, repo.did, blob) : null;
  catalogImageUrl(kind, value, { blobUrl })
    .then((u) => setBg(t, u))
    .catch(() => {});
  return t;
}
function instThumb(repo: RepoView, store: StoreView, kind: string, value: RecordValue): HTMLDivElement {
  const t = bgThumb();
  if (value.image) {
    setBg(t, publicBlobUrl(repo.pds, repo.did, value.image));
    return t;
  }
  const tk = TYPE_OF_INSTANCE[kind];
  const typeUri = kind === "filmRoll" ? value.stock : value.type;
  const tv = typeUri ? store.byUri.get(typeUri)?.item?.value : null;
  if (tk && tv) {
    catalogImageUrl(tk, tv, { blobUrl: (blob: unknown) => publicBlobUrl(repo.pds, repo.did, blob) })
      .then((u) => setBg(t, u))
      .catch(() => {});
  }
  return t;
}

export function navigateProfile(handle: string): void {
  handle = handle.replace(/^@/, "").trim();
  if (!handle) return;
  history.pushState({ profile: handle }, "", routePath("profile", { handle }, { base: BASE }));
  openProfile(handle);
}

export function buildHandleSearch(placeholder = "View a setup by @handle"): HTMLDivElement {
  const input = el("input", { type: "text", placeholder, autocomplete: "off", class: "search-input" });
  const menu = el("div", { class: "term-menu hidden" });
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const go = (handle: string): void => {
    menu.classList.add("hidden");
    input.value = "";
    navigateProfile(handle);
  };
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) {
      menu.classList.add("hidden");
      return;
    }
    debounce = setTimeout(async () => {
      try {
        const r = await fetch(`${PUBLIC}/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=8`);
        const payload = (await r.json()) as { actors?: ActorView[] };
        const actors = payload.actors || [];
        const rows = new Map<string, { row: HTMLDivElement; badge: HTMLSpanElement }>();
        menu.replaceChildren(
          ...actors.map((a) => {
            const badge = el("span", { class: "gc-badge hidden" }, "graycard");
            const row = el(
              "div",
              {
                class: "term-opt",
                onmousedown: (event: MouseEvent) => {
                  event.preventDefault();
                  go(a.handle);
                },
              },
              [
                el("span", {}, `@${a.handle}`),
                el("span", { class: "row", style: "gap:6px" }, [
                  a.displayName ? el("span", { class: "term-sub muted small" }, a.displayName) : null,
                  badge,
                ]),
              ],
            );
            rows.set(a.handle, { row, badge });
            return row;
          }),
        );
        menu.classList.toggle("hidden", !actors.length);
        // badge + float graycard users to the top (one describeRepo per candidate, cached)
        actors.forEach((a) =>
          hasGraycard(a.did).then((yes: boolean) => {
            const rec = rows.get(a.handle);
            if (yes && rec) {
              rec.badge.classList.remove("hidden");
              rec.row.classList.add("gc-user");
              menu.prepend(rec.row);
            }
          }),
        );
      } catch {
        /* offline */
      }
    }, 220);
  });
  let idx = -1;
  const opts = (): Element[] => [...menu.querySelectorAll(".term-opt")];
  const hi = (list: Element[]): void =>
    list.forEach((option, index) => option.classList.toggle("active", index === idx));
  input.addEventListener("keydown", (e) => {
    const list = opts();
    if (e.key === "ArrowDown" && list.length) {
      e.preventDefault();
      idx = (idx + 1) % list.length;
      hi(list);
    } else if (e.key === "ArrowUp" && list.length) {
      e.preventDefault();
      idx = (idx - 1 + list.length) % list.length;
      hi(list);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0 && list[idx]) list[idx].dispatchEvent(new MouseEvent("mousedown"));
      else if (input.value.trim()) go(input.value.trim());
    }
  });
  input.addEventListener("input", () => {
    idx = -1;
  });
  input.addEventListener("blur", () => setTimeout(() => menu.classList.add("hidden"), 150));
  return el("div", { class: "term-input" }, [input, menu]);
}

export function openProfileSearch() {
  destroyProfileMap();
  showView("profile-view");
  requiredElement<HTMLElement>("#profile-search").replaceChildren(buildHandleSearch());
  const body = requiredElement<HTMLElement>("#profile-body");
  body.replaceChildren(); // the header's "@handle" search is the browse CTA
  // Discover has one job: list explicitly published setups across the network.
  // Follow-graph activity lives on the peer Following page.
  discoverSetups(body);
}

// Cross-network Discover: every published app.graycard.setup on the network,
// enumerated via Constellation (a shared backlink index) and hydrated from each
// author's PDS. No login required — published setups are public. Filtering is
// client-side over the hydrated cards, since Constellation indexes links, not
// record fields.
async function discoverSetups(body: HTMLElement): Promise<void> {
  const section = el("div", { class: "card" });
  const intro = el(
    "p",
    { class: "muted small discover-setups-head", style: "margin:0" },
    "Public setups shared by photographers across the atmosphere. Your own listing stays on your public profile.",
  );
  const refreshBtn = el("button", { class: "ghost small-btn", type: "button", title: "Reload the setup index" }, [
    icon("refresh", 14),
    el("span", {}, "Refresh"),
  ]);
  const filterInput = el("input", {
    type: "search",
    class: "search-input discover-filter",
    placeholder: "Filter by name, photographer, or words in the summary",
    "aria-label": "Filter setups",
  });
  const grid = el("div", { class: "setup-grid" });
  const status = el("p", { class: "muted small" }, "Loading setups…");
  const moreWrap = el("div", { class: "setup-more" });
  section.append(
    el("div", { class: "row between", style: "margin-bottom:4px" }, [intro, refreshBtn]),
    filterInput,
    status,
    grid,
    moreWrap,
  );
  body.append(section);

  const all: DiscoverSetupView[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined,
    hasMore = true,
    loading = false;

  const matches = (setup: DiscoverSetupView): boolean => {
    const q = filterInput.value.trim().toLowerCase();
    if (!q) return true;
    const hay = [setup.value?.name, setup.value?.summary, setup.author?.handle, setup.author?.displayName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const setupCard = (setup: DiscoverSetupView): HTMLAnchorElement => {
    const actor = setup.author || { did: setup.did, handle: setup.did };
    const meta: HTMLElement[] = [];
    const gearN = Array.isArray(setup.value?.gear) ? setup.value.gear.length : 0;
    if (gearN) meta.push(el("span", { class: "setup-tag" }, `${gearN} gear`));
    if (setup.value?.gallery) meta.push(el("span", { class: "setup-tag" }, "gallery"));
    return el(
      "a",
      {
        class: "setup-card",
        href: `${BASE}profile/${actor.handle}`,
        onclick: (event: MouseEvent) => {
          event.preventDefault();
          navigateProfile(actor.handle);
        },
      },
      [
        actor.avatar
          ? el("img", { class: "setup-av", src: actor.avatar, alt: "", loading: "lazy" })
          : el("div", { class: "setup-av" }),
        el("div", { class: "setup-body" }, [
          el("div", { class: "setup-name" }, setup.value?.name || "Setup"),
          el(
            "div",
            { class: "setup-handle mono muted" },
            `@${actor.handle}${actor.displayName ? ` · ${actor.displayName}` : ""}`,
          ),
          setup.value?.summary ? el("div", { class: "setup-summary" }, setup.value.summary) : null,
          meta.length ? el("div", { class: "setup-meta" }, meta) : null,
        ]),
      ],
    );
  };

  const render = () => {
    const shown = all.filter(matches);
    grid.replaceChildren(...shown.map(setupCard));
    if (!all.length)
      status.textContent = loading
        ? "Loading setups…"
        : viewerDid
          ? "No other published setups yet."
          : "No published setups yet.";
    else if (!shown.length) status.textContent = "No setups match your filter.";
    else status.textContent = "";
  };

  const loadMore = async () => {
    if (loading || !hasMore) return;
    loading = true;
    moreWrap.replaceChildren();
    if (all.length) status.textContent = "Loading more…";
    try {
      const res = (await loadDiscover(cursor)) as {
        cursor?: string;
        hasMore: boolean;
        setups: DiscoverSetupView[];
      };
      cursor = res.cursor;
      hasMore = res.hasMore;
      for (const s of res.setups)
        if (s.did !== viewerDid && !seen.has(s.uri)) {
          seen.add(s.uri);
          all.push(s);
        }
    } catch (error) {
      loading = false;
      status.textContent = `Couldn't reach the setup index: ${errorMessage(error)}`;
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
    all.length = 0;
    seen.clear();
    cursor = undefined;
    hasMore = true;
    grid.replaceChildren();
    moreWrap.replaceChildren();
    loadMore();
  };

  loadMore();
}

// -- public profile: gear-first, filterable galleries -------------------------

const grainRkey = (uri: string | null | undefined): string | undefined => (uri || "").split("/").pop();
const grainGalleryUrl = (repo: RepoView, galleryUri: string): string =>
  `https://grain.social/profile/${repo.did}/gallery/${grainRkey(galleryUri)}`;

// header: centered, no card. Avatar, name, handle, a short gear summary, and the
// two off-site links (Grain in our accent, Bluesky in Bluesky blue).
// Your own profile carries the Discover listing control: "Publish to Discover"
// when you are not listed, "Edit profile" once you are. It only renders on your
// own profile while signed in — this is the page the listing is about, so it is
// where the action belongs.
function ownListingButton(repo: RepoView): HTMLButtonElement | null {
  if (!viewerDid || !viewerAgent || repo.did !== viewerDid) return null;
  const did = viewerDid;
  const agent = viewerAgent;
  const btn = el("button", { class: "linkbtn", type: "button" }, "Publish to Discover");
  const paint = (setup: Listing | null | undefined): void => {
    btn.textContent = setup ? "Edit profile" : "Publish to Discover";
  };
  let known: Listing | null | undefined; // the loaded setup, so the modal need not refetch
  getMySetup(agent, did)
    .then((s) => {
      known = s;
      paint(s);
    })
    .catch(() => {});
  btn.addEventListener("click", () => {
    const openSetup = openPublishSetup as (
      agent: unknown,
      did: string,
      options: {
        handle?: string | null;
        existing?: Listing | null;
        onChange?: (setup: Listing | null) => void;
      },
    ) => unknown;
    openSetup(agent, did, {
      handle: repo.handle,
      existing: known,
      onChange: (s) => {
        known = s;
        paint(s);
      },
    });
  });
  return btn;
}

function headerBar(repo: RepoView, store: StoreView): HTMLDivElement {
  const nCam = (store.instance.camera || []).length,
    nLens = (store.instance.lens || []).length;
  const bits = [`${nCam} camera${nCam !== 1 ? "s" : ""}`, `${nLens} lens${nLens !== 1 ? "es" : ""}`];
  return el("div", { class: "profile-header" }, [
    repo.avatar ? el("img", { class: "profile-avatar", src: repo.avatar, alt: "" }) : null,
    el("h2", { class: "profile-name" }, repo.displayName || `@${repo.handle}`),
    el("div", { class: "mono muted small" }, `@${repo.handle}`),
    el("div", { class: "muted small profile-summary" }, bits.join(" · ")),
    el("div", { class: "row profile-links" }, [
      ownListingButton(repo),
      el(
        "a",
        {
          class: "linkbtn primary-link",
          href: `https://grain.social/profile/${repo.handle}`,
          target: "_blank",
          rel: "noopener",
        },
        "Grain ↗",
      ),
      el(
        "a",
        {
          class: "linkbtn bsky-link",
          href: `https://bsky.app/profile/${repo.handle}`,
          target: "_blank",
          rel: "noopener",
        },
        "Bluesky ↗",
      ),
    ]),
  ]);
}

const toggleSet = (set: Set<string>, uri: string): void => {
  if (set.has(uri)) set.delete(uri);
  else set.add(uri);
};

// a card that collapses to just its title. Native <details>, so no JS to toggle;
// callers append content after the summary and read/set `.open`.
function collapsibleCard(title: string, open = false): HTMLDetailsElement {
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
  const modal = el("div", {
    class: "card modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "How search works",
  });
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }
  const ex = (query: string, description: string): HTMLDivElement =>
    el("div", { class: "search-help-row" }, [
      el("code", { class: "search-help-q" }, query),
      el("span", { class: "muted small" }, description),
    ]);
  modal.append(
    el("h2", {}, "How search works"),
    el(
      "p",
      { class: "muted small" },
      "Search finds photos by what is actually in them: the objects and how they relate. Type naturally.",
    ),
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
    el(
      "p",
      { class: "muted small" },
      "It searches the photographer's tags plus each photo's title, description, and alt text. Connecting an image-analysis provider in Settings improves parsing of longer phrases.",
    ),
    el("div", { class: "row modal-actions" }, [el("button", { class: "ghost", onclick: close }, "Got it")]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

function sceneSearchCard(
  repo: RepoView,
  data: SetupView,
  photoByUri: Map<string, RecordView>,
  galleryOfPhoto: Map<string, string>,
): HTMLDetailsElement | null {
  const buildIndex = buildSceneIndex as (input: {
    scenes: RecordView[];
    sceneNodes: RecordView[];
    sceneEdges: RecordView[];
  }) => ReturnType<typeof buildSceneIndex>;
  const index = buildIndex({ scenes: data.scenes, sceneNodes: data.sceneNodes, sceneEdges: data.sceneEdges });
  if (!index.photos.size) return null;

  // BM25 corpus + rerank descriptors: a photo's alt text + its gallery's
  // title/description, plus scene-node labels for the LLM reranker.
  const galleryVal = new Map((data.galleries || []).map((g) => [g.uri, g.value]));
  const nodeLabels = new Map<string, string>();
  for (const rec of index.photos.values())
    nodeLabels.set(
      rec.photo,
      rec.nodes
        .map((node: { label?: string }) => node.label)
        .filter(Boolean)
        .join(" "),
    );
  const textOf = (uri: string): string => {
    const p = photoByUri.get(uri);
    const galleryUri = galleryOfPhoto.get(uri);
    const gv = galleryUri ? galleryVal.get(galleryUri) : undefined;
    return [p?.value?.alt, gv?.title, gv?.description].filter(Boolean).join(" ");
  };
  const descriptorOf = (uri: string): string => [textOf(uri), nodeLabels.get(uri)].filter(Boolean).join(" ");
  const searchDocs = (data.photos || []).map((p) => ({ uri: p.uri, text: textOf(p.uri) }));
  let textIndex: TextIndex | undefined; // built on first query with the phrase tokenizer, so doc tokens match the df keys
  let tokenizer: Tokenizer | undefined; // phrase-aware tokenizer (base tokenizer if the phrase asset is unavailable)

  let captionIdf: CaptionIdf | null | undefined; // lazily loaded corpus IDF (null when unavailable -> per-profile)
  const PRESETS = ["balanced", "strict", "broad"] as const;
  const PRESET_KEY = "hypo:searchPreset";
  let preset: SearchPreset = "balanced";
  try {
    const v = localStorage.getItem(PRESET_KEY);
    if (v && PRESETS.includes(v as SearchPreset)) preset = v as SearchPreset;
  } catch {
    /* private mode / blocked storage */
  }

  const card = collapsibleCard("Search");
  const input = el("input", {
    type: "search",
    class: "search-input",
    "aria-label": "Search this photographer's photos",
    enterkeyhint: "search",
    placeholder: "e.g. dog · animal · person riding bicycle · car left of tree",
  });
  const presetSel = el(
    "select",
    { class: "search-preset", "aria-label": "Result strictness", title: "How strictly to cut off weaker matches" },
    PRESETS.map((p) => el("option", { value: p }, p[0].toUpperCase() + p.slice(1))),
  );
  presetSel.value = preset;
  presetSel.addEventListener("change", () => {
    preset = presetSel.value as SearchPreset;
    try {
      localStorage.setItem(PRESET_KEY, preset);
    } catch {
      /* private mode */
    }
    run();
  });
  const hintRow = el("div", { class: "row between search-hint-row" }, [
    el("p", { class: "muted small", style: "margin:0" }, "Searches what's in each photo."),
    el("div", { class: "row", style: "gap:8px" }, [
      presetSel,
      el(
        "button",
        { class: "ghost small-btn", type: "button", "aria-label": "How search works", onclick: openSearchHelp },
        [icon("info", 14), el("span", {}, "How it works")],
      ),
    ]),
  ]);
  const results = el("div", { class: "search-results" });
  card.append(hintRow, input, results);

  const grainLink = (uri: string, _photo: RecordView | undefined): string => {
    const g = galleryOfPhoto.get(uri);
    return g ? grainGalleryUrl(repo, g) : `https://grain.social/profile/${repo.handle}`;
  };
  const cell = (uri: string, index: number): HTMLAnchorElement => {
    const p = photoByUri.get(uri);
    const url = p && publicBlobUrl(repo.pds, repo.did, p.value.photo);
    const photoName = imageAlt(p?.value?.alt, `Photo ${index + 1}`);
    const c = el("div", { class: "search-cell", "aria-hidden": "true" });
    if (url) c.style.backgroundImage = `url("${url}")`;
    return el(
      "a",
      {
        class: "search-hit",
        href: grainLink(uri, p),
        target: "_blank",
        rel: "noopener",
        title: photoName,
        "aria-label": `View ${photoName} on Grain`,
      },
      c,
    );
  };
  const gridOf = (rows: SceneScore[]): HTMLDivElement =>
    el(
      "div",
      { class: "search-grid" },
      rows.slice(0, 60).map((r, index) => cell(r.uri, index)),
    );

  const relationHint = [...new Set<string>([...index.relationForms, ...SPATIAL_SEED.map((seed) => seed.label)])].filter(
    Boolean,
  );
  const cache = new Map<string, SceneScore[]>(); // `${preset}::${q}` -> scored rankScenes results

  let token = 0;
  async function run() {
    const q = input.value.trim();
    const mine = ++token;
    if (!q) {
      results.replaceChildren();
      return;
    }
    const setStatus = (message: string): void => {
      if (mine === token) results.replaceChildren(el("p", { class: "muted small" }, message));
    };
    setStatus("Searching…");
    if (captionIdf === undefined || tokenizer === undefined) {
      setStatus("Preparing search index…");
      if (captionIdf === undefined) {
        try {
          captionIdf = await loadCaptionIdf();
        } catch {
          captionIdf = null;
        }
        if (mine !== token) return;
      }
      if (tokenizer === undefined) {
        let phrases = null;
        try {
          phrases = await loadPhraseModel();
        } catch {
          phrases = null;
        }
        if (mine !== token) return;
        tokenizer = phrases ? makeTokenizer({ phrases }) : tokenize; // same code path built the df table
        textIndex = buildTextIndex(searchDocs, tokenizer);
        // The corpus df table was tokenized WITH phrases; if the phrase asset is
        // missing we index/query with the base tokenizer, so the phrase-built IDF
        // no longer aligns (phrase-component unigrams are deflated). Drop it and
        // let bm25Search use the per-profile IDF, which matches the base index.
        if (!phrases) captionIdf = null;
      }
    }
    const render = (scored: SceneScore[], busyMsg: string | null = null): void => {
      const match = scored.filter((r) => r.band === "match");
      const near = scored.filter((r) => r.band === "near");
      if (!match.length && !near.length) {
        results.replaceChildren(
          (busyMsg ? el("p", { class: "muted small" }, busyMsg) : null) as unknown as Node,
          el("p", { class: "muted small" }, "No photos match. Try a broader word, or a different relation."),
        );
        return;
      }
      const children: HTMLElement[] = [];
      if (busyMsg) children.push(el("p", { class: "muted small search-busy" }, busyMsg));
      if (match.length)
        children.push(
          el("div", { class: "muted small search-count" }, `${match.length} photo${match.length === 1 ? "" : "s"}`),
          gridOf(match),
        );
      else children.push(el("p", { class: "muted small" }, "No strong matches, but some are close:"));
      if (near.length) {
        const box = el("details", { class: "collapse-card search-near" }, [
          el("summary", { class: "collapse-summary" }, [
            el("h3", { style: "margin:0; font-size:14px" }, `Closest matches · ${near.length}`),
            el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄"),
          ]),
          gridOf(near),
        ]);
        children.push(box);
      }
      results.replaceChildren(...children);
    };

    const key = `${preset}::${q}`;
    if (cache.has(key)) {
      render(cache.get(key) || []);
      return;
    }

    const cfg = getVisionConfig();
    const vision = cfg?.apiKey ? await import("../vision.js") : null;
    if (mine !== token) return;
    const providerName = vision ? vision.getProvider(cfg).label : null;
    // LLM parse only for multi-word, non-mixed-boolean queries (the flat LLM
    // schema can't express OR-of-AND grouping the heuristic handles).
    const llmParse =
      cfg?.apiKey && q.split(/\s+/).length > 1 && !/\bor\b/.test(q)
        ? (query: string) => {
            const parse = vision!.parseSearchQuery as (
              text: string,
              config: unknown,
              options: { relations: string[] },
            ) => Promise<unknown>;
            return parse(query, cfg, { relations: relationHint });
          }
        : null;
    // The LLM reranker is the slow signal, so rankScenes paints the fast
    // Wikidata+BM25 result first (onPartial) and this only reorders it.
    const llmRerank = cfg?.apiKey
      ? (query: string, uris: string[]) =>
          vision!.rerankSearch(
            query,
            cfg,
            uris.map((u) => ({ uri: u, text: descriptorOf(u) })),
          )
      : null;
    const onStage = (stage: string): void => {
      if (mine !== token) return;
      if (stage === "parse" && providerName) setStatus(`Understanding query with ${providerName}…`);
      else if (stage === "match") setStatus("Matching scene graphs and captions…");
    };
    const onPartial = (partial: SceneScore[]): void => {
      if (mine === token) render(partial, providerName ? `Reranking with ${providerName}…` : null);
    };
    let scored: SceneScore[];
    try {
      scored = await rankScenes(index, q, {
        resolveTerm: resolveConcepts,
        ancestorsOf,
        llmParse,
        llmRerank,
        textIndex,
        tokenizer,
        captionIdf,
        preset,
        onPartial,
        onStage,
      });
    } catch {
      scored = [];
    }
    if (mine !== token) return; // a newer query superseded this one
    cache.set(key, scored);
    render(scored);
  }

  let debounce: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 320);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounce);
      run();
    }
  });
  return card;
}

// one facet's row of toggle chips. `options`: [{ uri, label, thumb?, count }].
// `onClick(uri)` fully handles a click (the caller re-renders to reflect state).
function chipFilter(
  options: readonly ChipOption[],
  selected: Set<string>,
  onClick: (uri: string) => void,
  { thumbs = false }: { thumbs?: boolean } = {},
): HTMLDivElement {
  const row = el("div", { class: "filter-chip-row" });
  for (const o of options) {
    const chip = el("button", { class: `filter-chip${selected.has(o.uri) ? " on" : ""}`, type: "button" }, [
      thumbs && o.thumb ? o.thumb : null,
      el("span", {}, o.label),
      o.count ? el("span", { class: "chip-count" }, String(o.count)) : null, // hide 0 — gear also just showcases the setup
    ]);
    chip.addEventListener("click", () => onClick(o.uri));
    row.append(chip);
  }
  return row;
}

// count photos matching a facet value, so chips can show how much they'd filter.
function facetCount(index: PhotoIndex, key: keyof PhotoFacetMetadata, val: string): number {
  let n = 0;
  for (const m of index.meta.values()) {
    const set = m[key];
    if (set instanceof Set ? set.has(val) : m[key] === val) n += 1;
  }
  return n;
}

export async function openProfile(handle: string): Promise<void> {
  destroyProfileMap();
  const revision = profileRevision;
  handle = handle.replace(/^@/, "");
  showView("profile-view");
  requiredElement<HTMLElement>("#profile-search").replaceChildren(buildHandleSearch());
  const body = requiredElement<HTMLElement>("#profile-body");
  const phase = loadPhase(`Loading @${handle}'s graycard from their PDS…`);
  body.replaceChildren(
    ...Array.from({ length: 3 }, () =>
      el("div", { class: "card" }, [
        el("div", { class: "skeleton skeleton-title" }),
        el("div", { class: "skeleton skeleton-line" }),
      ]),
    ),
    phase.node,
  );
  try {
    const data = (await loadSetup(handle)) as unknown as SetupView;
    if (revision !== profileRevision) return;
    const { repo, store, templates, galleries, photos, shoots } = data;
    const index = buildPhotoIndex(data as unknown as ProfileIndexInput);
    const photoByUri = new Map<string, RecordView>(photos.map((photo) => [photo.uri, photo]));
    const state = emptyFilterState();
    body.replaceChildren();

    const headerMount = el("div", { "data-profile-section": "header" });
    body.append(headerMount);

    const gearMount = el("div");
    const filtersMount = el("div");
    const galleriesMount = el("div");
    const hasGear = () =>
      Boolean(
        store.instance.camera?.length ||
        store.instance.lens?.length ||
        store.catalog.filmStock?.length ||
        photos.length,
      );
    const locMapState: HeatmapState = {};
    liveHeatmap = locMapState;
    const renderGear = () =>
      gearMount.replaceChildren(hasGear() ? gearFilterCard(repo, store, index, state, shoots || [], rerender) : "");
    const renderFilters = () =>
      filtersMount.replaceChildren(advancedFiltersCard(index, state, rerender, locMapState) || "");
    const renderGalleries = () =>
      galleriesMount.replaceChildren(galleriesCard(repo, galleries, index, state, photoByUri));
    function rerender() {
      renderGear();
      renderFilters();
      renderGalleries();
    }

    // gear FIRST, then the additional (aperture/shutter/date/location) filters
    body.append(gearMount);
    body.append(filtersMount);
    renderFilters();

    // workflows (between gear and galleries)
    if (templates.length) {
      const ul = el("ul", { class: "gear-list" });
      for (const t of templates) {
        const kinds = (t.value.stageKinds || []).map((kind) => STAGE_LABELS[kind] || kind).join(" → ");
        ul.append(
          el("li", { class: "gear-row" }, [
            el("div", {}, [
              el("strong", {}, t.value.name),
              el("div", { class: "muted small" }, `${enumLabel(t.value.medium || "")} · ${kinds || "(no stages)"}`),
            ]),
          ]),
        );
      }
      body.append(el("div", { class: "card" }, [el("h3", {}, "Workflows"), ul]));
    }

    // semantic scene search (collapsed) — after gear + refine, just before galleries.
    const galleryOfPhoto = new Map<string, string>();
    for (const [gUri, phs] of index.galleryPhotos)
      for (const ph of phs) if (!galleryOfPhoto.has(ph)) galleryOfPhoto.set(ph, gUri);
    const searchCard = sceneSearchCard(repo, data, photoByUri, galleryOfPhoto);
    if (searchCard) body.append(searchCard);

    // galleries LAST
    body.append(galleriesMount);
    if (galleries.length) renderGalleries();

    const signals = recordStore(repo.did);
    signals.replaceRemote(NS.instance.camera, store.instance.camera || []);
    signals.replaceRemote(NS.instance.lens, store.instance.lens || []);
    signals.replaceRemote(NS.catalog.filmStock, store.catalog.filmStock || []);
    disposeProfileSignals = renderProfileGearOn(signals, ({ cameras, lenses, filmStocks }) => {
      const replaceKind = (
        layer: "instance" | "catalog",
        kind: string,
        records: ReturnType<RecordStore["collection"]>["value"],
      ) => {
        for (const [uri, entry] of store.byUri) {
          if (entry.layer === layer && entry.kind === kind) store.byUri.delete(uri);
        }
        const values = [...records.values()] as unknown as RecordView[];
        store[layer][kind] = values;
        for (const item of values) store.byUri.set(item.uri, { layer, kind, item });
      };
      replaceKind("instance", "camera", cameras);
      replaceKind("instance", "lens", lenses);
      replaceKind("catalog", "filmStock", filmStocks);
      headerMount.replaceChildren(headerBar(repo, store));
      renderGear();
    });

    if (!store.instance.camera?.length && !templates.length && !galleries.length)
      body.append(el("p", { class: "muted" }, "No public graycard records yet."));
    stagger([...body.querySelectorAll(".card")]);
  } catch (error) {
    if (revision === profileRevision)
      body.replaceChildren(el("p", { class: "error" }, `Couldn't load @${handle}: ${errorMessage(error)}`));
  } finally {
    phase.clear();
  }
}

// the gear card doubles as the filter: multiselect gear chips + an advanced
// reveal (aperture / shutter / date / location).
function gearFilterCard(
  repo: RepoView,
  store: StoreView,
  index: PhotoIndex,
  state: PhotoFilterState,
  shoots: RecordView[],
  rerender: () => void,
): HTMLDivElement {
  const card = el("div", { class: "card" }, [el("h3", {}, "Gear")]);
  const opts = (
    items: readonly RecordView[],
    metaKey: keyof PhotoFacetMetadata,
    labelFn: (item: RecordView) => string,
    thumbFn?: (item: RecordView) => HTMLElement,
  ): ChipOption[] =>
    items
      .map((it) => ({
        uri: it.uri,
        label: labelFn(it),
        thumb: thumbFn ? thumbFn(it) : null,
        count: facetCount(index, metaKey, it.uri),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const simpleClick =
    (set: Set<string>) =>
    (uri: string): void => {
      toggleSet(set, uri);
      rerender();
    };
  const group = (title: string, options: ChipOption[], stateSet: Set<string>, onClick: (uri: string) => void): void => {
    if (options.length)
      card.append(el("h4", { class: "stat-h" }, title), chipFilter(options, stateSet, onClick, { thumbs: true }));
  };

  // Camera / lens / filter each have an instance level, plus a model level that
  // appears only when the user owns two-or-more copies of at least one model.
  // Once a camera- or lens-model row appears, it includes every model represented
  // in the user's setup; filter rows retain their duplicate-only options.
  const KINDS = [
    {
      kind: "camera",
      catKind: "cameraType",
      title: "Cameras",
      modelTitle: "Camera models",
      inst: "cameras",
      type: "cameraTypes",
      sInst: "camera",
      sType: "cameraType",
    },
    {
      kind: "lens",
      catKind: "lensType",
      title: "Lenses",
      modelTitle: "Lens models",
      inst: "lenses",
      type: "lensTypes",
      sInst: "lens",
      sType: "lensType",
    },
    {
      kind: "filter",
      catKind: "filterType",
      title: "Filters",
      modelTitle: "Filter models",
      inst: "filters",
      type: "filterTypes",
      sInst: "filter",
      sType: "filterType",
    },
  ] as const;
  for (const K of KINDS) {
    const instances = store.instance[K.kind] || [];
    if (!instances.length) continue;
    const byType = new Map<string, RecordView[]>();
    for (const it of instances) {
      const ty = it.value.type;
      if (!ty) continue;
      if (!byType.has(ty)) byType.set(ty, []);
      byType.get(ty)?.push(it);
    }
    const dupTypes = [...byType.keys()].filter((typeUri) => (byType.get(typeUri)?.length || 0) >= 2);
    const dupSet = new Set(dupTypes);

    // clicking a body toggles it, and keeps the model chip in sync (a model is
    // "on" exactly when all of its duplicated bodies are selected). Single-copy
    // camera models remain independent because a model can match EXIF-only
    // photos while an instance filter is exact.
    const instClick = (uri: string): void => {
      toggleSet(state[K.sInst], uri);
      const ty = instances.find((i) => i.uri === uri)?.value.type;
      if (ty && dupSet.has(ty)) {
        if ((byType.get(ty) || []).every((item) => state[K.sInst].has(item.uri))) state[K.sType].add(ty);
        else state[K.sType].delete(ty);
      }
      rerender();
    };
    // clicking a model selects/deselects the model AND all its bodies.
    const modelClick = (ty: string): void => {
      const on = !state[K.sType].has(ty);
      if (on) state[K.sType].add(ty);
      else state[K.sType].delete(ty);
      for (const item of byType.get(ty) || []) {
        if (on) state[K.sInst].add(item.uri);
        else state[K.sInst].delete(item.uri);
      }
      rerender();
    };

    // A type precedes its instances: show the model group first when there are
    // duplicated models to distinguish, then the individual bodies. Camera and
    // lens options cover all owned models, including models with a single copy.
    if (dupTypes.length) {
      const modelTypes = K.kind === "filter" ? dupTypes : [...byType.keys()];
      const typeItems = modelTypes
        .map((ty) => (store.catalog[K.catKind] || []).find((t) => t.uri === ty))
        .filter((item): item is RecordView => Boolean(item));
      group(
        K.modelTitle,
        opts(
          typeItems,
          K.type,
          (t) => catalogLabel(K.catKind, t.value),
          (t) => typeThumb(K.catKind, t.value, repo),
        ),
        state[K.sType],
        modelClick,
      );
    }
    group(
      K.title,
      opts(
        instances,
        K.inst,
        (it) => instanceLabel(K.kind, it.value, store),
        (it) => instThumb(repo, store, K.kind, it.value),
      ),
      state[K.sInst],
      instClick,
    );
  }

  // film is filtered by stock (a roll is consumable inventory, not reusable gear,
  // so per-roll chips would be noise on a public gallery).
  group(
    "Film",
    opts(
      store.catalog.filmStock || [],
      "films",
      (t) => catalogLabel("filmStock", t.value),
      (t) => typeThumb("filmStock", t.value, repo),
    ),
    state.film,
    simpleClick(state.film),
  );

  // shoots: unique sessions, no type distinction; only those that contain photos.
  const shootOpts = (shoots || [])
    .map((sh) => ({ uri: sh.uri, label: sh.value.label || "Shoot", count: facetCount(index, "shoots", sh.uri) }))
    .filter((o) => o.count > 0); // shoots arrive newest-first (sorted in loadSetup)
  if (shootOpts.length)
    card.append(el("h4", { class: "stat-h" }, "Shoots"), chipFilter(shootOpts, state.shoot, simpleClick(state.shoot)));

  return card;
}

// the additional (non-gear) filters — aperture / shutter / date / location — in
// their own card between gear and galleries. Returns null when there's nothing
// but the date range to offer (kept minimal) — actually we always show at least
// a date range, so it always returns a card.
function advancedFiltersCard(
  index: PhotoIndex,
  state: PhotoFilterState,
  rerender: () => void,
  mapState: HeatmapState,
): HTMLDetailsElement {
  const simpleClick =
    (set: Set<string>) =>
    (uri: string): void => {
      toggleSet(set, uri);
      rerender();
    };
  const apertures = [...new Set([...index.meta.values()].flatMap((m) => [...m.apertures]))].sort(
    (a, b) => parseFloat(a) - parseFloat(b),
  );
  const shutters = [...new Set([...index.meta.values()].flatMap((m) => [...m.shutters]))].sort(
    (a, b) => shutterSeconds(b) - shutterSeconds(a),
  );
  const isos = [...new Set([...index.meta.values()].flatMap((m) => [...m.isos]))].sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10),
  );
  const cells = locationCells(index);

  // collapsed by default; open-state persists across re-renders (mapState survives
  // them). The heatmap is built LAZILY on first open — a maplibre map created
  // inside a display:none <details> fits to a 0-size box and opens mis-framed —
  // and merely resized on later opens.
  const card = collapsibleCard("Refine", mapState.refineOpen);
  card.addEventListener("toggle", () => {
    mapState.refineOpen = card.open;
    if (card.open)
      requestAnimationFrame(() => {
        if (mapState.map) mapState.map.resize();
        else mapState.mountHeat?.();
      });
  });
  if (apertures.length)
    card.append(
      el("h4", { class: "stat-h" }, "Aperture"),
      chipFilter(
        apertures.map((a) => ({ uri: a, label: `ƒ/${a}`, count: facetCount(index, "apertures", a) })),
        state.aperture,
        simpleClick(state.aperture),
      ),
    );
  if (shutters.length)
    card.append(
      el("h4", { class: "stat-h" }, "Shutter"),
      chipFilter(
        shutters.map((s) => ({ uri: s, label: s, count: facetCount(index, "shutters", s) })),
        state.shutter,
        simpleClick(state.shutter),
      ),
    );
  if (isos.length)
    card.append(
      el("h4", { class: "stat-h" }, "ISO"),
      chipFilter(
        isos.map((i) => ({ uri: i, label: `ISO ${i}`, count: facetCount(index, "isos", i) })),
        state.iso,
        simpleClick(state.iso),
      ),
    );

  // location: a coarse density heatmap. The map instance persists in mapState so
  // toggling other filters doesn't tear it down; tapping a cell filters the gallery.
  if (cells.length) {
    if (!mapState.node) mapState.node = el("div", { class: "map-canvas heat" });
    const selCount = [...state.cell].length;
    card.append(
      el("div", { class: "row between" }, [
        el("h4", { class: "stat-h", style: "margin:0" }, "Location"),
        selCount
          ? el(
              "button",
              {
                class: "ghost small-btn",
                onclick: () => {
                  state.cell.clear();
                  rerender();
                },
              },
              "Clear",
            )
          : null,
      ]),
      el("p", { class: "muted small" }, "Coarse ~5 km. Tap an area to filter; tap again to clear."),
      mapState.node,
    );
    mapState.mountHeat = () =>
      mountHeatmap(mapState.node!, mapState, cells, state.cell, (key: string) => {
        toggleSet(state.cell, key);
        rerender();
      }).catch(() => {});
    if (card.open) requestAnimationFrame(mapState.mountHeat); // only build while visible
  }

  const fromIn = el("input", { type: "date", class: "date-input", value: state.from || "" });
  const toIn = el("input", { type: "date", class: "date-input", value: state.to || "" });
  fromIn.addEventListener("change", () => {
    state.from = fromIn.value || null;
    rerender();
  });
  toIn.addEventListener("change", () => {
    state.to = toIn.value || null;
    rerender();
  });
  card.append(
    el("h4", { class: "stat-h" }, "Date"),
    el("div", { class: "row date-range" }, [field("From", fromIn), field("To", toIn)]),
  );
  return card;
}

// aggregate indexed photos into coarse location cells for the heatmap.
function locationCells(index: PhotoIndex): LocationCell[] {
  const byCell = new Map<string, LocationCell>();
  for (const m of index.meta.values()) {
    if (!m.cell) continue;
    const cell = byCell.get(m.cell) || {
      key: m.cell,
      lat: m.cellLat as number,
      lon: m.cellLon as number,
      label: m.cellLabel,
      count: 0,
    };
    cell.count += 1;
    byCell.set(m.cell, cell);
  }
  return [...byCell.values()];
}

// approximate seconds for a shutter string ("1/500", "2s", "B") for sorting.
function shutterSeconds(s: string): number {
  if (!s) return 0;
  if (/^b$/i.test(s)) return 1e6;
  if (s.includes("/")) {
    const [a, b] = s.replace("s", "").split("/").map(Number);
    return b ? a / b : 0;
  }
  return parseFloat(s) || 0;
}

// galleries: 3-up teasers (matching the filters), each linking to its grain
// gallery, with a slide-down to reveal the rest.
function galleriesCard(
  repo: RepoView,
  galleries: RecordView[],
  index: PhotoIndex,
  state: PhotoFilterState,
  photoByUri: Map<string, RecordView>,
): HTMLDivElement {
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
      el(
        "a",
        {
          class: "linkbtn small",
          href: `https://grain.social/profile/${repo.handle}`,
          target: "_blank",
          rel: "noopener",
        },
        `All on Grain ↗`,
      ),
    ]),
  ]);
  if (!ranked.length) {
    card.append(el("p", { class: "muted small" }, "No galleries match these filters."));
    return card;
  }

  const teaser = (row: (typeof ranked)[number]): HTMLAnchorElement => {
    // one cover photo per gallery, like grain — no multi-photo montage.
    const cover = (active ? row.matched : row.all)[0];
    const p = cover && photoByUri.get(cover);
    const url = p && publicBlobUrl(repo.pds, repo.did, p.value.photo);
    const sheet = el("div", { class: "teaser-sheet single", "aria-hidden": "true" });
    const cell = el("div", { class: "teaser-cell" });
    if (url) cell.style.backgroundImage = `url("${url}")`;
    sheet.append(cell);
    return el("a", { class: "teaser", href: grainGalleryUrl(repo, row.g.uri), target: "_blank", rel: "noopener" }, [
      sheet,
      el("div", { class: "teaser-title" }, row.g.value.title || "Untitled"),
      active
        ? el(
            "div",
            { class: "muted small teaser-count" },
            `${row.matched.length} match${row.matched.length === 1 ? "" : "es"}`,
          )
        : null,
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
