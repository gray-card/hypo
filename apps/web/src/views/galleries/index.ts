import { $, el, loadPhase } from "@hypo/ui";

export interface GalleryRecord {
  uri: string;
  value: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
}

interface RepositoryRecord {
  uri: string;
  value: Record<string, any>;
}

interface GalleryCoverage {
  total: number;
  gear: number;
  wf: number;
  sc: number;
}

interface GalleryProviders {
  getGalleries(agent: unknown, did: string): Promise<GalleryRecord[]>;
  listRecords(agent: unknown, did: string, collection: string): Promise<RepositoryRecord[]>;
  collections: { galleryItem: string; photo: string };
  ns: { photo: { capture: string; workflow: string }; scene: { graph: string } };
  lazyThumb(agent: unknown, did: string, blob: unknown, className: string): HTMLElement;
}

interface GallerySession {
  agent: unknown;
  did: string;
}

export interface GalleryListOptions {
  icon(name: string, size?: number): Node;
  getSession(): GallerySession | null;
  loadProviders(): Promise<GalleryProviders>;
  fuzzyFilter(query: string, galleries: GalleryRecord[], text: (gallery: GalleryRecord) => string): GalleryRecord[];
  showView(view: string): void;
  activate(): void;
  navigate(uri: string): unknown;
  createGallery(): unknown;
}

export function deriveGalleryPresentation(
  items: RepositoryRecord[],
  photos: RepositoryRecord[],
  captures: RepositoryRecord[],
  workflows: RepositoryRecord[],
  scenes: RepositoryRecord[],
): { covers: Map<string, unknown>; coverage: Map<string, GalleryCoverage> } {
  const blobByPhoto = new Map(photos.map((record) => [record.uri, record.value.photo]));
  const gearPhotos = new Set(
    captures
      .filter((record) => record.value.camera || record.value.lens || record.value.filmRoll)
      .map((record) => record.value.photo),
  );
  const workflowPhotos = new Set(workflows.map((record) => record.value.photo));
  const scenePhotos = new Set(scenes.map((record) => record.value.subject).filter(Boolean));
  const covers = new Map<string, unknown>();
  const photosByGallery = new Map<string, string[]>();

  for (const item of items.slice().sort((left, right) => (left.value.position ?? 0) - (right.value.position ?? 0))) {
    const gallery = String(item.value.gallery || "");
    const photo = String(item.value.item || "");
    if (!gallery || !photo) continue;
    if (!covers.has(gallery)) covers.set(gallery, blobByPhoto.get(photo));
    const members = photosByGallery.get(gallery) || [];
    members.push(photo);
    photosByGallery.set(gallery, members);
  }

  const coverage = new Map<string, GalleryCoverage>();
  for (const [gallery, members] of photosByGallery) {
    coverage.set(gallery, {
      total: members.length,
      gear: members.filter((uri) => gearPhotos.has(uri)).length,
      wf: members.filter((uri) => workflowPhotos.has(uri)).length,
      sc: members.filter((uri) => scenePhotos.has(uri)).length,
    });
  }
  return { covers, coverage };
}

const skeletonRows = (count: number) =>
  Array.from({ length: count }, () =>
    el("li", { class: "gallery-row skeleton-row" }, [
      el("div", { class: "skeleton skeleton-title" }),
      el("div", { class: "skeleton skeleton-line" }),
    ]),
  );

const emptyState = (title: string, hint: string, icon: GalleryListOptions["icon"]) =>
  el("div", { class: "empty-state" }, [
    el("div", { class: "empty-mark", "aria-hidden": "true" }, [icon("film", 34)]),
    el("div", { class: "empty-title" }, title),
    el("div", { class: "empty-hint muted small" }, hint),
  ]);

const coverageNode = (coverage?: GalleryCoverage) => {
  if (!coverage?.total) return null;
  const badges = [
    el("span", { class: "cov-badge" }, `${coverage.total} photo${coverage.total !== 1 ? "s" : ""}`),
    el(
      "span",
      {
        class: "cov-badge" + (coverage.gear ? (coverage.gear === coverage.total ? " full" : " partial") : ""),
      },
      `gear ${coverage.gear}/${coverage.total}`,
    ),
  ];
  if (coverage.wf) {
    badges.push(el("span", { class: "cov-badge full" }, `${coverage.wf} workflow${coverage.wf !== 1 ? "s" : ""}`));
  }
  if (coverage.sc) {
    badges.push(el("span", { class: "cov-badge full" }, `${coverage.sc} scene${coverage.sc !== 1 ? "s" : ""}`));
  }
  return el("div", { class: "cov-row" }, badges);
};

/** Own gallery-list reads, coverage aggregation, search, and DOM rendering. */
export function createGalleryListView(options: GalleryListOptions) {
  let galleries: GalleryRecord[] = [];
  let covers = new Map<string, unknown>();
  let coverage = new Map<string, GalleryCoverage>();
  let providers: GalleryProviders | null = null;

  const openGallery = (uri: string, cover: HTMLElement | null) => {
    options.activate();
    const hero = $("#editor-hero") as HTMLElement | null;
    const image = cover?.querySelector("img") as HTMLImageElement | null;
    const startViewTransition = (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    if (hero && cover && image && typeof startViewTransition === "function") {
      cover.style.viewTransitionName = "hero-cover";
      hero.style.backgroundImage = `url("${image.src}")`;
      hero.classList.remove("hidden");
      hero.style.viewTransitionName = "hero-cover";
      setTimeout(() => {
        cover.style.viewTransitionName = "";
        hero.style.viewTransitionName = "";
      }, 700);
    } else {
      hero?.classList.add("hidden");
    }
    options.showView("editor-view");
    options.navigate(uri);
  };

  const render = () => {
    const search = $("#gallery-search") as HTMLInputElement | null;
    const list = $("#gallery-list");
    if (!search || !list) return;
    const query = search.value.trim().toLowerCase();
    const filtered = query
      ? options.fuzzyFilter(
          query,
          galleries,
          (gallery) => `${gallery.value.title || ""} ${gallery.value.description || ""}`,
        )
      : galleries;
    if (!filtered.length) {
      list.replaceChildren(el("p", { class: "muted small" }, query ? "No matching galleries." : "No galleries."));
      return;
    }
    const session = options.getSession();
    if (!session) return;
    const rows = filtered.map((gallery) =>
      el(
        "li",
        {
          class: "gallery-row row",
          onclick: (event: Event) => {
            const row = event.currentTarget as HTMLElement;
            openGallery(gallery.uri, row.querySelector(".gallery-thumb"));
          },
        },
        [
          providers?.lazyThumb(session.agent, session.did, covers.get(gallery.uri), "gallery-thumb") ||
            el("div", { class: "gallery-thumb" }),
          el("div", { class: "gallery-rowtext" }, [
            el("div", { class: "g-title" }, gallery.value.title || "(untitled)"),
            gallery.value.description ? el("div", { class: "g-desc muted" }, gallery.value.description) : null,
            coverageNode(coverage.get(gallery.uri)),
          ]),
        ],
      ),
    );
    rows.forEach((row, index) => {
      row.classList.add("reveal");
      row.style.setProperty("--i", String(index));
    });
    list.replaceChildren(...rows);
  };

  const load = async () => {
    options.showView("list-view");
    const status = $("#list-status");
    const search = $("#gallery-search") as HTMLInputElement | null;
    const list = $("#gallery-list");
    const session = options.getSession();
    if (!status || !search || !list || !session) return;
    status.textContent = "";
    const phase = loadPhase("Loading galleries from your PDS…");
    list.replaceChildren(...skeletonRows(4), phase.node);
    try {
      providers ||= await options.loadProviders();
      galleries = await providers.getGalleries(session.agent, session.did);
      if (!galleries.length) {
        phase.clear();
        search.classList.add("hidden");
        list.replaceChildren(
          emptyState("No galleries yet", "Create a gallery first, then reload to fix its metadata here.", options.icon),
        );
        return;
      }
      search.classList.toggle("hidden", galleries.length < 6);
      phase.set("Checking coverage from your PDS…");
      try {
        const [items, photos, captures, workflows, scenes] = await Promise.all([
          providers.listRecords(session.agent, session.did, providers.collections.galleryItem),
          providers.listRecords(session.agent, session.did, providers.collections.photo),
          providers.listRecords(session.agent, session.did, providers.ns.photo.capture),
          providers.listRecords(session.agent, session.did, providers.ns.photo.workflow),
          providers.listRecords(session.agent, session.did, providers.ns.scene.graph),
        ]);
        ({ covers, coverage } = deriveGalleryPresentation(items, photos, captures, workflows, scenes));
      } catch {
        covers = new Map();
        coverage = new Map();
      }
      phase.clear();
      render();
    } catch (error) {
      phase.clear();
      list.replaceChildren();
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const install = () => {
    $("#gallery-search")?.addEventListener("input", render);
    $("#reload-galleries")?.addEventListener("click", () => void load());
    $("#new-gallery")?.addEventListener("click", options.createGallery);
  };

  return { galleries: () => galleries, install, load, render };
}
