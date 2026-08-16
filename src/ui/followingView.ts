import { el } from "./dom.js";
import { icon } from "./icons.js";
import { collectionLabel, kindLabel } from "./labels.js";
import { publicBlobUrl } from "../profile.js";
import {
  loadFollowingFeed,
  type FollowProfile,
  type FollowingActivity,
  type FollowingFeed,
  type FollowingFeedSnapshot,
  type FollowingProgress,
} from "../following.js";
import { openFollowingFeedCache, type FollowingFeedCacheStore } from "../followingCache.js";
import { routePath } from "../router.js";

interface FollowingViewOptions {
  did: string;
  navigateProfile(handle: string): unknown;
  forceRefresh?: boolean;
}

interface ActivityCluster {
  actor: FollowProfile;
  createdAt: string;
  events: FollowingActivity[];
}

let followingRevision = 0;
let runningRefresh:
  | {
      did: string;
      promise: ReturnType<typeof loadFollowingFeed>;
      listeners: Set<(progress: FollowingProgress) => void>;
    }
  | undefined;

const FEED_FRESH_MS = 5 * 60 * 1000;

const sourceLabel = (sources: readonly string[]): string =>
  sources.length > 1 ? "Grain + Bluesky" : sources[0] === "grain" ? "Grain" : "Bluesky";

function profileLink(profile: FollowProfile, navigateProfile: (handle: string) => unknown): HTMLAnchorElement {
  return el(
    "a",
    {
      class: "following-person-link",
      href: routePath("profile", { handle: profile.handle }),
      onclick: (event: MouseEvent) => {
        event.preventDefault();
        navigateProfile(profile.handle);
      },
    },
    profile.displayName || `@${profile.handle}`,
  );
}

function sourceBadge(profile: FollowProfile): HTMLSpanElement {
  return el(
    "span",
    {
      class: `follow-source source-${profile.sources.join("-")}`,
      title: `You follow this photographer on ${sourceLabel(profile.sources)}`,
    },
    sourceLabel(profile.sources),
  );
}

export function clusterFollowingActivity(
  events: readonly FollowingActivity[],
  windowMs = 2 * 60 * 1000,
): ActivityCluster[] {
  const byActor = new Map<string, FollowingActivity[]>();
  for (const event of events) {
    const actorEvents = byActor.get(event.actor.did) || [];
    actorEvents.push(event);
    byActor.set(event.actor.did, actorEvents);
  }
  const clusters: ActivityCluster[] = [];
  for (const actorEvents of byActor.values()) {
    for (const event of actorEvents.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))) {
      const previous = clusters.findLast((cluster) => cluster.actor.did === event.actor.did);
      if (previous && Math.abs(Date.parse(previous.createdAt) - Date.parse(event.createdAt)) <= windowMs) {
        previous.events.push(event);
      } else {
        clusters.push({ actor: event.actor, createdAt: event.createdAt, events: [event] });
      }
    }
  }
  return clusters.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function recordName(value: Record<string, unknown>): string | null {
  const makeModel = [value.make, value.model].filter((part) => typeof part === "string" && part).join(" ");
  if (makeModel) return makeModel;
  const brandName = [value.brand, value.name].filter((part) => typeof part === "string" && part).join(" ");
  if (brandName) return brandName;
  for (const key of ["name", "label", "title", "nickname"]) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return null;
}

function referencedValue(
  event: FollowingActivity,
  byUri: Map<string, FollowingActivity>,
): Record<string, unknown> | null {
  const reference = event.value.type || event.value.stock || event.value.lab;
  if (typeof reference !== "string") return null;
  return byUri.get(reference)?.value || event.references?.[reference] || null;
}

export function followingActivityText(event: FollowingActivity, related: readonly FollowingActivity[] = []): string {
  const value = event.value;
  const collection = event.collection;
  const byUri = new Map(related.map((candidate) => [candidate.uri, candidate]));
  const name = recordName(referencedValue(event, byUri) || value);
  if (collection === "social.grain.photo") {
    const alt = typeof value.alt === "string" ? value.alt.trim() : "";
    return alt ? `added a photo: ${alt}` : "added a photo";
  }
  if (collection === "social.grain.gallery") return name ? `created a gallery: ${name}` : "created a gallery";
  if (collection === "app.graycard.setup") return name ? `published their setup: ${name}` : "published their setup";
  if (collection === "app.graycard.photo.capture") return "added gear details to a photo";
  if (collection === "app.graycard.photo.workflow") return "added workflow details to a photo";
  if (collection === "app.graycard.scene.graph") return "described a photo scene";
  if (collection === "app.graycard.meter.reading") return "recorded a meter reading";
  if (collection === "app.graycard.workflow.template")
    return name ? `created a workflow: ${name}` : "created a workflow";
  if (collection === "app.graycard.workflow.run") return "logged a workflow run";
  if (collection === "app.graycard.session.capture") return name ? `logged a shoot: ${name}` : "logged a shoot";
  if (collection === "app.graycard.instance.filmStockpile")
    return name ? `added ${name} to their film reserve` : "added film to their reserve";
  if (collection.startsWith("app.graycard.process.")) {
    const process = collection.split(".").at(-1) || "";
    const labels: Record<string, string> = {
      developSession: "a development session",
      digitizeSession: "a scanning session",
      editSession: "an editing session",
      maintenanceSession: "a maintenance session",
      printSession: "a printing session",
      renderSession: "a render/export session",
    };
    return `logged ${labels[process] || kindLabel(process).toLowerCase()}`;
  }
  if (collection.startsWith("app.graycard.catalog.")) {
    const fallback = kindLabel(collection.split(".").at(-1)).toLowerCase();
    return name ? `added ${name} to their catalog` : `added a ${fallback} to their catalog`;
  }
  if (collection.startsWith("app.graycard.instance.")) {
    const fallback = kindLabel(collection.split(".").at(-1)).toLowerCase();
    return name ? `added ${name} to their setup` : `added a ${fallback} to their setup`;
  }
  return `added ${collectionLabel(collection).toLowerCase()}`;
}

export interface FollowingActivityTarget {
  href: string;
  external: boolean;
  title: string;
}

function recordRkey(uri: string): string | null {
  const rkey = uri.split("/").at(-1);
  return rkey ? encodeURIComponent(rkey) : null;
}

export function followingActivityTarget(event: FollowingActivity): FollowingActivityTarget | null {
  if (event.collection === "social.grain.gallery") {
    const rkey = recordRkey(event.uri);
    return rkey
      ? {
          href: `https://grain.social/profile/${event.actor.did}/gallery/${rkey}`,
          external: true,
          title: "View this gallery on Grain",
        }
      : null;
  }
  if (
    event.collection === "app.graycard.setup" ||
    event.collection === "app.graycard.session.capture" ||
    event.collection.startsWith("app.graycard.catalog.") ||
    event.collection.startsWith("app.graycard.instance.") ||
    event.collection.startsWith("app.graycard.workflow.")
  ) {
    return {
      href: routePath("profile", { handle: event.actor.handle }),
      external: false,
      title: `View @${event.actor.handle}'s public Hypo profile`,
    };
  }
  return null;
}

function activityStamp(collection: string): string {
  if (collection === "social.grain.photo") return "PHOTO";
  if (collection === "app.graycard.setup") return "SETUP";
  if (collection.includes("filmRoll")) return "FILM";
  if (collection.includes("chemistry") || collection.includes("process.")) return "DARKROOM";
  if (collection.includes("workflow")) return "WORKFLOW";
  if (collection.includes("scene") || collection.includes("photo.")) return "DETAILS";
  return "GEAR";
}

function formatActivityTime(createdAt: string): { relative: string; absolute: string } {
  const date = new Date(createdAt);
  const delta = date.getTime() - Date.now();
  const magnitude = Math.abs(delta);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  const [unit, size] = units.find(([, unitSize]) => magnitude >= unitSize) || ["minute", 6e4];
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(delta / size), unit);
  return {
    relative,
    absolute: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date),
  };
}

function eventIsReferencedType(event: FollowingActivity, events: readonly FollowingActivity[]): boolean {
  if (!event.collection.startsWith("app.graycard.catalog.")) return false;
  return events.some((candidate) => candidate.value.type === event.uri || candidate.value.stock === event.uri);
}

function activityCard(cluster: ActivityCluster, navigateProfile: (handle: string) => unknown): HTMLElement {
  const time = formatActivityTime(cluster.createdAt);
  const shownEvents = cluster.events.filter((event) => !eventIsReferencedType(event, cluster.events));
  const photo = cluster.events.find((event) => event.collection === "social.grain.photo");
  const photoUrl = photo ? publicBlobUrl(photo.pds, photo.actor.did, photo.value.photo) : null;
  const activityLine = (event: FollowingActivity): HTMLElement => {
    const text = followingActivityText(event, cluster.events);
    const target = followingActivityTarget(event);
    if (!target) return el("span", {}, text);
    return el(
      "a",
      {
        class: "activity-line-link",
        href: target.href,
        title: target.title,
        ...(target.external ? { target: "_blank", rel: "noopener" } : {}),
        onclick: target.external
          ? undefined
          : (click: MouseEvent) => {
              click.preventDefault();
              navigateProfile(event.actor.handle);
            },
      },
      text,
    );
  };
  const oldest = [...cluster.events].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
  const key = `${cluster.actor.did}|${oldest?.uri || cluster.createdAt}`;
  const signature = cluster.events
    .map((event) => `${event.uri}:${event.cid || ""}:${String(event.value.updatedAt || event.createdAt)}`)
    .sort()
    .concat(
      JSON.stringify([cluster.actor.handle, cluster.actor.displayName, cluster.actor.avatar, cluster.actor.sources]),
    )
    .join("|");
  return el("article", { class: "following-event", "data-following-key": key, "data-following-signature": signature }, [
    el("div", { class: "activity-stamp", "aria-hidden": "true" }, activityStamp(shownEvents[0]?.collection || "")),
    cluster.actor.avatar
      ? el("img", { class: "following-avatar", src: cluster.actor.avatar, alt: "", loading: "lazy" })
      : el("div", { class: "following-avatar fallback", "aria-hidden": "true" }),
    el("div", { class: "following-event-body" }, [
      el("div", { class: "following-event-head" }, [
        el("div", { class: "following-byline" }, [
          profileLink(cluster.actor, navigateProfile),
          el("span", { class: "mono muted following-handle" }, `@${cluster.actor.handle}`),
          sourceBadge(cluster.actor),
        ]),
        el(
          "time",
          { class: "mono muted activity-time", datetime: cluster.createdAt, title: time.absolute },
          time.relative,
        ),
      ]),
      el(
        "ul",
        { class: "activity-lines" },
        shownEvents.map((event) =>
          el("li", {}, [
            activityLine(event),
            el("span", { class: "activity-kind mono" }, collectionLabel(event.collection)),
          ]),
        ),
      ),
    ]),
    photoUrl
      ? el("img", {
          class: "activity-photo",
          src: photoUrl,
          alt: typeof photo?.value.alt === "string" ? photo.value.alt : "",
          loading: "lazy",
        })
      : null,
  ]);
}

function rosterCard(profile: FollowProfile, navigateProfile: (handle: string) => unknown): HTMLElement {
  return el(
    "div",
    {
      class: "following-person",
      "data-following-key": profile.did,
      "data-following-signature": JSON.stringify([
        profile.handle,
        profile.displayName,
        profile.avatar,
        profile.sources,
      ]),
    },
    [
      profile.avatar
        ? el("img", { class: "following-avatar", src: profile.avatar, alt: "", loading: "lazy" })
        : el("div", { class: "following-avatar fallback", "aria-hidden": "true" }),
      el("div", { class: "following-person-name" }, [
        profileLink(profile, navigateProfile),
        el("span", { class: "mono muted" }, `@${profile.handle}`),
      ]),
      sourceBadge(profile),
    ],
  );
}

function patchKeyedChildren(host: HTMLElement, next: HTMLElement[]): void {
  const current = new Map(
    [...host.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement && Boolean(child.dataset.followingKey))
      .map((child) => [child.dataset.followingKey as string, child]),
  );
  for (const candidate of next) {
    const key = candidate.dataset.followingKey as string;
    const existing = current.get(key);
    if (existing?.dataset.followingSignature === candidate.dataset.followingSignature) {
      const existingTime = existing.querySelector("time");
      const nextTime = candidate.querySelector("time");
      if (existingTime && nextTime) {
        existingTime.textContent = nextTime.textContent;
        existingTime.setAttribute("title", nextTime.getAttribute("title") || "");
      }
      host.append(existing);
      current.delete(key);
    } else {
      existing?.remove();
      host.append(candidate);
      current.delete(key);
    }
  }
  current.forEach((element) => element.remove());
}

interface FollowingRenderOptions {
  status?: string;
  refreshing?: boolean;
}

export function renderFollowing(
  host: HTMLElement,
  feed: FollowingFeed,
  navigateProfile: (handle: string) => unknown,
  options: FollowingRenderOptions = {},
): void {
  if (!feed.profiles.length) {
    host.replaceChildren(
      el("div", { class: "empty-state" }, [
        el("div", { class: "empty-title" }, "Your following feed is empty"),
        el(
          "div",
          { class: "empty-hint muted small" },
          "Follow photographers on Grain or Bluesky, then refresh this page to see their public activity.",
        ),
      ]),
    );
    return;
  }
  const grainCount = feed.profiles.filter((profile) => profile.sources.includes("grain")).length;
  const blueskyCount = feed.profiles.filter((profile) => profile.sources.includes("bluesky")).length;
  const summary = el("div", { class: "following-source-summary", "aria-label": "Following sources" }, [
    el("span", { class: "follow-source source-grain" }, `${grainCount} on Grain`),
    el("span", { class: "follow-source source-bluesky" }, `${blueskyCount} on Bluesky`),
  ]);
  const syncStatus = el(
    "p",
    {
      class: `following-cache-status muted small${options.refreshing ? " refreshing" : ""}`,
      role: "status",
      hidden: options.status ? undefined : "",
    },
    options.status || "",
  );
  const clusters = clusterFollowingActivity(feed.events);
  const activity = el("section", { class: "card following-feed" }, [
    el("div", { class: "following-section-head" }, [
      el("h3", {}, "Latest public activity"),
      el(
        "p",
        { class: "muted small" },
        clusters.length
          ? "Photos and public graycard records, newest first. Related records saved together appear as one entry."
          : "No Grain photos or public graycard records were found for these photographers.",
      ),
    ]),
    el(
      "div",
      { class: "following-events", hidden: clusters.length ? undefined : "" },
      clusters.map((cluster) => activityCard(cluster, navigateProfile)),
    ),
  ]);
  const roster = el("details", { class: "card following-roster" }, [
    el("summary", {}, [
      el("span", {}, "People you follow"),
      el("span", { class: "mono muted" }, String(feed.profiles.length)),
    ]),
    el("p", { class: "muted small" }, "This list combines your separate Grain and Bluesky follow graphs."),
    el(
      "div",
      { class: "following-people" },
      feed.profiles.map((profile) => rosterCard(profile, navigateProfile)),
    ),
  ]);
  const existingActivity = host.querySelector<HTMLElement>(".following-feed");
  const existingRoster = host.querySelector<HTMLElement>(".following-roster");
  const existingSummary = host.querySelector<HTMLElement>(".following-source-summary");
  const existingStatus = host.querySelector<HTMLElement>(".following-cache-status");
  if (!existingActivity || !existingRoster || !existingSummary || !existingStatus) {
    host.replaceChildren(summary, syncStatus, activity, roster);
    return;
  }
  existingSummary.replaceChildren(...summary.childNodes);
  existingStatus.textContent = options.status || "";
  existingStatus.toggleAttribute("hidden", !options.status);
  existingStatus.classList.toggle("refreshing", Boolean(options.refreshing));
  const existingHint = existingActivity.querySelector<HTMLElement>(".following-section-head p");
  const nextHint = activity.querySelector<HTMLElement>(".following-section-head p");
  if (existingHint && nextHint) existingHint.textContent = nextHint.textContent;
  const existingEvents = existingActivity.querySelector<HTMLElement>(".following-events");
  if (existingEvents) {
    patchKeyedChildren(
      existingEvents,
      clusters.map((cluster) => activityCard(cluster, navigateProfile)),
    );
    existingEvents.toggleAttribute("hidden", !clusters.length);
  }
  const existingCount = existingRoster.querySelector<HTMLElement>("summary .mono");
  if (existingCount) existingCount.textContent = String(feed.profiles.length);
  const existingPeople = existingRoster.querySelector<HTMLElement>(".following-people");
  if (existingPeople)
    patchKeyedChildren(
      existingPeople,
      feed.profiles.map((profile) => rosterCard(profile, navigateProfile)),
    );
}

export function destroyFollowing(): void {
  followingRevision += 1;
}

function refreshFollowing(
  did: string,
  cached: FollowingFeedSnapshot | null,
  cache: FollowingFeedCacheStore,
  listener: (progress: FollowingProgress) => void,
): Promise<FollowingFeedSnapshot> {
  if (!runningRefresh || runningRefresh.did !== did) {
    const listeners = new Set<(progress: FollowingProgress) => void>();
    const promise = loadFollowingFeed(did, {
      cache,
      cached,
      onProgress: (progress) => listeners.forEach((notify) => notify(progress)),
    });
    const current = { did, promise, listeners };
    runningRefresh = current;
    const clear = () => {
      if (runningRefresh === current) runningRefresh = undefined;
    };
    void promise.then(clear, clear);
  }
  const current = runningRefresh;
  current.listeners.add(listener);
  return current.promise.finally(() => current.listeners.delete(listener));
}

function isFresh(feed: FollowingFeedSnapshot | null): boolean {
  const completed = feed?.refreshCompletedAt ? Date.parse(feed.refreshCompletedAt) : Number.NaN;
  return Number.isFinite(completed) && Date.now() - completed < FEED_FRESH_MS;
}

export async function openFollowing({
  did,
  navigateProfile,
  forceRefresh = false,
}: FollowingViewOptions): Promise<void> {
  const revision = ++followingRevision;
  const host = document.querySelector<HTMLElement>("#following-body");
  const refresh = document.querySelector<HTMLButtonElement>("#following-refresh");
  if (!host || !refresh) return;
  refresh.replaceChildren(icon("refresh", 14), el("span", {}, "Refresh"));
  refresh.onclick = () => void openFollowing({ did, navigateProfile, forceRefresh: true });
  refresh.disabled = true;
  const cache = await openFollowingFeedCache();
  const cached = await cache.read(did).catch(() => null);
  if (revision !== followingRevision) return;
  const sameViewer = host.dataset.followingViewer === did;
  host.dataset.followingViewer = did;
  if (cached) {
    renderFollowing(host, cached, navigateProfile, {
      status: isFresh(cached)
        ? "Showing the copy saved on this device. It was checked recently."
        : "Showing the copy saved on this device while Hypo checks likely updates first.",
      refreshing: !isFresh(cached) || forceRefresh,
    });
  } else if (!sameViewer || !host.querySelector(".following-feed")) {
    const status = el("p", { class: "muted small", role: "status" }, "Combining your Grain and Bluesky follows…");
    host.replaceChildren(el("div", { class: "card following-loading" }, status));
  }
  if (!forceRefresh && isFresh(cached)) {
    refresh.disabled = false;
    return;
  }
  try {
    const feed = await refreshFollowing(did, cached, cache, ({ done, total, profile, feed: progressFeed }) => {
      if (revision !== followingRevision) return;
      renderFollowing(host, progressFeed, navigateProfile, {
        status: `Checking updates… ${done} / ${total} · @${profile.handle}`,
        refreshing: true,
      });
    });
    if (revision !== followingRevision) return;
    renderFollowing(host, feed, navigateProfile, {
      status: `Saved on this device · checked ${feed.profiles.length} account${feed.profiles.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    if (revision !== followingRevision) return;
    if (cached?.profiles.length) {
      renderFollowing(host, cached, navigateProfile, {
        status: "Showing the saved copy. Hypo could not check for updates just now.",
      });
    } else {
      host.replaceChildren(
        el("div", { class: "empty-state" }, [
          el("div", { class: "empty-title" }, "Following couldn't load"),
          el(
            "div",
            { class: "empty-hint muted small" },
            error instanceof Error ? error.message : "The follow graphs were unavailable.",
          ),
        ]),
      );
    }
  } finally {
    if (revision === followingRevision) refresh.disabled = false;
  }
}
