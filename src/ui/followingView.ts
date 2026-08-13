import { el } from "./dom.js";
import { icon } from "./icons.js";
import { collectionLabel, kindLabel } from "./labels.js";
import { publicBlobUrl } from "../profile.js";
import { loadFollowingFeed, type FollowProfile, type FollowingActivity, type FollowingFeed } from "../following.js";
import { routePath } from "../router.js";

interface FollowingViewOptions {
  did: string;
  navigateProfile(handle: string): unknown;
}

interface ActivityCluster {
  actor: FollowProfile;
  createdAt: string;
  events: FollowingActivity[];
}

let followingRevision = 0;

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
  return el("article", { class: "following-event" }, [
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
  return el("div", { class: "following-person" }, [
    profile.avatar
      ? el("img", { class: "following-avatar", src: profile.avatar, alt: "", loading: "lazy" })
      : el("div", { class: "following-avatar fallback", "aria-hidden": "true" }),
    el("div", { class: "following-person-name" }, [
      profileLink(profile, navigateProfile),
      el("span", { class: "mono muted" }, `@${profile.handle}`),
    ]),
    sourceBadge(profile),
  ]);
}

export function renderFollowing(
  host: HTMLElement,
  feed: FollowingFeed,
  navigateProfile: (handle: string) => unknown,
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
    clusters.length
      ? el(
          "div",
          { class: "following-events" },
          clusters.map((cluster) => activityCard(cluster, navigateProfile)),
        )
      : null,
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
  host.replaceChildren(summary, activity, roster);
}

export function destroyFollowing(): void {
  followingRevision += 1;
}

export async function openFollowing({ did, navigateProfile }: FollowingViewOptions): Promise<void> {
  const revision = ++followingRevision;
  const host = document.querySelector<HTMLElement>("#following-body");
  const refresh = document.querySelector<HTMLButtonElement>("#following-refresh");
  if (!host || !refresh) return;
  refresh.replaceChildren(icon("refresh", 14), el("span", {}, "Refresh"));
  refresh.onclick = () => void openFollowing({ did, navigateProfile });
  refresh.disabled = true;
  const status = el("p", { class: "muted small", role: "status" }, "Combining your Grain and Bluesky follows…");
  host.replaceChildren(el("div", { class: "card following-loading" }, status));
  try {
    const feed = await loadFollowingFeed(did, {
      onProgress: ({ done, total, profile }) => {
        if (revision === followingRevision)
          status.textContent = `Reading public activity… ${done} / ${total} · @${profile.handle}`;
      },
    });
    if (revision !== followingRevision) return;
    renderFollowing(host, feed, navigateProfile);
  } catch (error) {
    if (revision !== followingRevision) return;
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
  } finally {
    if (revision === followingRevision) refresh.disabled = false;
  }
}
