import { $, el, loadPhase } from "@hypo/ui";
import { resolvePhotoCapture } from "@hypo/domain/photo-capture";

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
  listRecordCollections(
    agent: unknown,
    did: string,
    collections: string[],
    options?: { refresh?: boolean },
  ): Promise<RepositoryRecord[][]>;
  collections: { galleryItem: string; photo: string };
  ns: { photo: { capture: string; workflow: string }; scene: { graph: string }; gallery: { defaults: string } };
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
  defaults: RepositoryRecord[] = [],
): { covers: Map<string, unknown>; coverage: Map<string, GalleryCoverage> } {
  const blobByPhoto = new Map(photos.map((record) => [record.uri, record.value.photo]));
  const captureByPhoto = new Map(captures.map((record) => [record.value.photo, record]));
  const defaultsByGallery = new Map(defaults.map((record) => [record.value.gallery, record]));
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
      gear: members.filter((uri) => {
        const refs = resolvePhotoCapture(captureByPhoto.get(uri), defaultsByGallery.get(gallery));
        return refs.camera || refs.filmBack || refs.lens || refs.filmRoll || refs.filters.length > 0;
      }).length,
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
  let viewer: string | undefined;
  let loadRevision = 0;

  const openGallery = (uri: string) => {
    options.activate();
    $("#editor-hero")?.classList.add("hidden");
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
          "data-gallery-uri": gallery.uri,
          onclick: () => openGallery(gallery.uri),
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
    list.replaceChildren(...rows);
  };

  const load = async () => {
    options.showView("list-view");
    const status = $("#list-status");
    const search = $("#gallery-search") as HTMLInputElement | null;
    const list = $("#gallery-list");
    const session = options.getSession();
    if (!status || !search || !list || !session) return;
    const revision = ++loadRevision;
    const isCurrent = () => loadRevision === revision && options.getSession()?.did === session.did;
    status.textContent = "";
    const warm = viewer === session.did;
    const phase = warm ? null : loadPhase("Loading galleries from your PDS…");
    if (phase) {
      galleries = [];
      covers = new Map();
      coverage = new Map();
      list.replaceChildren(...skeletonRows(4), phase.node);
    }
    try {
      providers ||= await options.loadProviders();
      const incoming = await providers.getGalleries(session.agent, session.did);
      if (!isCurrent()) return;
      const changed =
        incoming.length !== galleries.length ||
        incoming.some((gallery, index) => {
          const previous = galleries[index];
          return (
            gallery.uri !== previous?.uri ||
            gallery.value.title !== previous.value.title ||
            gallery.value.description !== previous.value.description
          );
        });
      galleries = incoming;
      viewer = session.did;
      phase?.clear();
      if (!galleries.length) {
        search.classList.add("hidden");
        list.replaceChildren(
          emptyState("No galleries yet", "Create a gallery first, then reload to fix its metadata here.", options.icon),
        );
        return;
      }
      search.classList.toggle("hidden", galleries.length < 6);
      if (!warm || changed) render();
      try {
        const [items, photos, captures, workflows, scenes, defaults] = await providers.listRecordCollections(
          session.agent,
          session.did,
          [
            providers.collections.galleryItem,
            providers.collections.photo,
            providers.ns.photo.capture,
            providers.ns.photo.workflow,
            providers.ns.scene.graph,
            providers.ns.gallery.defaults,
          ],
          { refresh: true },
        );
        if (!isCurrent()) return;
        const previousCovers = covers;
        ({ covers, coverage } = deriveGalleryPresentation(items, photos, captures, workflows, scenes, defaults));
        for (const row of list.querySelectorAll<HTMLElement>("[data-gallery-uri]")) {
          const uri = row.dataset.galleryUri!;
          const oldCover = previousCovers.get(uri);
          const cover = covers.get(uri);
          if (JSON.stringify(cover) !== JSON.stringify(oldCover)) {
            row
              .querySelector(".gallery-thumb")
              ?.replaceWith(providers.lazyThumb(session.agent, session.did, cover, "gallery-thumb"));
          }
          row.querySelector(".cov-row")?.remove();
          const badges = coverageNode(coverage.get(uri));
          if (badges) row.querySelector(".gallery-rowtext")?.append(badges);
        }
      } catch {
        // Gallery titles and links remain usable when coverage is unavailable.
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Galleries could not be loaded:", error);
      phase?.clear();
      if (!warm) list.replaceChildren();
      status.textContent = "Galleries could not be loaded. Check your connection and reload this page.";
    }
  };

  const install = () => {
    $("#gallery-search")?.addEventListener("input", render);
    $("#reload-galleries")?.addEventListener("click", () => void load());
    $("#new-gallery")?.addEventListener("click", options.createGallery);
  };

  return { galleries: () => galleries, install, load, render };
}
