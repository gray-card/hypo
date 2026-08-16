import { PublicRepoClient, type RecordView, type RepoRecord } from "@hypo/pds";
import { getFollows, getGrainFollows, resolvePds } from "./profile.js";
import type { FollowingFeedCacheStore } from "./followingCache.js";

export type FollowSource = "grain" | "bluesky";

export interface FollowProfile {
  did: string;
  handle: string;
  displayName?: string | null;
  avatar?: string | null;
  sources: FollowSource[];
}

interface SourceProfile {
  did?: string | null;
  handle?: string | null;
  displayName?: string | null;
  avatar?: string | null;
}

export interface FollowingActivity {
  actor: FollowProfile;
  pds: string;
  uri: string;
  cid?: string | null;
  collection: string;
  value: RepoRecord;
  createdAt: string;
  references?: Record<string, RepoRecord>;
}

export interface FollowingFeed {
  profiles: FollowProfile[];
  events: FollowingActivity[];
}

export interface FollowingActorStats {
  did: string;
  pds?: string;
  recordCount: number;
  latestRecordAt?: string;
  lastScannedAt?: string;
  consecutiveEmptyScans: number;
}

export interface FollowingFeedSnapshot extends FollowingFeed {
  actorStats: Record<string, FollowingActorStats>;
  cachedAt?: string;
  refreshCompletedAt?: string;
}

export interface FollowingProgress {
  done: number;
  total: number;
  profile: FollowProfile;
  feed: FollowingFeedSnapshot;
}

interface ActivityClient {
  describe(input: { repo: string }): Promise<{ collections: string[] }>;
  list<T extends RepoRecord = RepoRecord>(input: {
    repo: string;
    collection: string;
    limit?: number;
    reverse?: boolean;
  }): Promise<{ records: Array<RecordView<T>> }>;
  get?<T extends RepoRecord = RepoRecord>(input: {
    repo: string;
    collection: string;
    rkey: string;
  }): Promise<RecordView<T>>;
}

interface FollowingFeedOptions {
  perCollection?: number;
  perPerson?: number;
  concurrency?: number;
  timeoutMs?: number;
  getGrain?: (did: string) => Promise<SourceProfile[]>;
  getBluesky?: (did: string) => Promise<SourceProfile[]>;
  resolvePdsFor?: (did: string) => Promise<string>;
  clientFor?: (pds: string) => ActivityClient;
  cache?: FollowingFeedCacheStore | null;
  cached?: FollowingFeedSnapshot | null;
  now?: () => number;
  onProgress?: (progress: FollowingProgress) => void;
}

interface ProfileActivityResult {
  events: FollowingActivity[];
  pds?: string;
  succeeded: boolean;
}

const MAX_EVENTS_PER_ACTOR = 50;
const MAX_CACHED_EVENTS = 500;

const ACTIVITY_EXCLUSIONS = new Set([
  "app.graycard.scene.edge",
  "app.graycard.scene.node",
  "app.graycard.scene.region",
  "app.graycard.workflow.stage",
]);

export function isFollowingActivityCollection(collection: string): boolean {
  if (ACTIVITY_EXCLUSIONS.has(collection)) return false;
  return (
    collection === "social.grain.photo" ||
    collection === "social.grain.gallery" ||
    collection.startsWith("app.graycard.")
  );
}

export function mergeFollowSources(
  grain: readonly SourceProfile[],
  bluesky: readonly SourceProfile[],
  viewerDid?: string | null,
): FollowProfile[] {
  const merged = new Map<string, FollowProfile>();
  const add = (profile: SourceProfile, source: FollowSource): void => {
    const did = profile.did || "";
    if (!did || did === viewerDid) return;
    const existing = merged.get(did);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (!existing.avatar && profile.avatar) existing.avatar = profile.avatar;
      if (!existing.displayName && profile.displayName) existing.displayName = profile.displayName;
      if ((!existing.handle || existing.handle === did) && profile.handle) existing.handle = profile.handle;
      return;
    }
    merged.set(did, {
      did,
      handle: profile.handle || did,
      displayName: profile.displayName,
      avatar: profile.avatar,
      sources: [source],
    });
  };
  grain.forEach((profile) => add(profile, "grain"));
  bluesky.forEach((profile) => add(profile, "bluesky"));
  return [...merged.values()];
}

function profilesForSource(profiles: readonly FollowProfile[], source: FollowSource): SourceProfile[] {
  return profiles
    .filter((profile) => profile.sources.includes(source))
    .map(({ did, handle, displayName, avatar }) => ({ did, handle, displayName, avatar }));
}

async function loadFollowProfiles(
  viewerDid: string,
  cached: FollowingFeedSnapshot,
  options: FollowingFeedOptions,
): Promise<FollowProfile[]> {
  const [grain, bluesky] = await Promise.allSettled([
    (options.getGrain || getGrainFollows)(viewerDid),
    (options.getBluesky || getFollows)(viewerDid),
  ]);
  if (grain.status === "rejected" && bluesky.status === "rejected" && !cached.profiles.length) {
    throw grain.reason || bluesky.reason || new Error("The follow graphs were unavailable");
  }
  return mergeFollowSources(
    grain.status === "fulfilled" ? grain.value : profilesForSource(cached.profiles, "grain"),
    bluesky.status === "fulfilled" ? bluesky.value : profilesForSource(cached.profiles, "bluesky"),
    viewerDid,
  );
}

function validTime(value?: string): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Known publishers lead the queue. Record volume and recency rank publishers;
 * scan staleness prevents low-signal accounts from being postponed forever.
 */
export function rankFollowingProfiles(
  profiles: readonly FollowProfile[],
  actorStats: Readonly<Record<string, FollowingActorStats>>,
  now = Date.now(),
): FollowProfile[] {
  const score = (profile: FollowProfile): [number, number] => {
    const stats = actorStats[profile.did];
    const knownPublisher = Boolean(stats?.recordCount);
    const neverScanned = !stats?.lastScannedAt;
    const tier = knownPublisher ? 2 : neverScanned ? 1 : 0;
    const recordWeight = Math.log2((stats?.recordCount || 0) + 1) * 40;
    const latest = validTime(stats?.latestRecordAt);
    const ageDays = latest == null ? Number.POSITIVE_INFINITY : Math.max(0, now - latest) / 86_400_000;
    const recencyWeight = Number.isFinite(ageDays) ? 60 * Math.exp(-ageDays / 30) : 0;
    const lastScan = validTime(stats?.lastScannedAt);
    const staleDays = lastScan == null ? 30 : Math.max(0, now - lastScan) / 86_400_000;
    return [tier, recordWeight + recencyWeight + Math.min(30, staleDays)];
  };
  return [...profiles].sort((left, right) => {
    const [leftTier, leftScore] = score(left);
    const [rightTier, rightScore] = score(right);
    return (
      rightTier - leftTier ||
      rightScore - leftScore ||
      left.handle.localeCompare(right.handle) ||
      left.did.localeCompare(right.did)
    );
  });
}

function emptySnapshot(): FollowingFeedSnapshot {
  return { profiles: [], events: [], actorStats: {} };
}

function mergeActivity(
  profiles: readonly FollowProfile[],
  cachedEvents: readonly FollowingActivity[],
  incoming: readonly FollowingActivity[],
): FollowingActivity[] {
  const profilesByDid = new Map(profiles.map((profile) => [profile.did, profile]));
  const byUri = new Map<string, FollowingActivity>();
  for (const event of [...cachedEvents, ...incoming]) {
    const actor = profilesByDid.get(event.actor.did);
    if (!actor) continue;
    byUri.set(event.uri, { ...event, actor });
  }
  const byActor = new Map<string, FollowingActivity[]>();
  for (const event of byUri.values()) {
    const events = byActor.get(event.actor.did) || [];
    events.push(event);
    byActor.set(event.actor.did, events);
  }
  return [...byActor.values()]
    .flatMap((events) =>
      events
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, MAX_EVENTS_PER_ACTOR),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_CACHED_EVENTS);
}

function cloneSnapshot(snapshot: FollowingFeedSnapshot): FollowingFeedSnapshot {
  return typeof structuredClone === "function"
    ? structuredClone(snapshot)
    : (JSON.parse(JSON.stringify(snapshot)) as FollowingFeedSnapshot);
}

function validCreatedAt(value: RepoRecord): string | null {
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : null;
  return createdAt && Number.isFinite(Date.parse(createdAt)) ? createdAt : null;
}

function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  return match ? { did: match[1], collection: match[2], rkey: match[3] } : null;
}

async function mapLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  fn: (item: Item) => Promise<Result>,
  onDone?: (item: Item) => void,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
      onDone?.(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

function withTimeout<Result>(promise: Promise<Result>, timeoutMs: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Activity read timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadProfileActivity(
  actor: FollowProfile,
  options: Required<Pick<FollowingFeedOptions, "perCollection" | "perPerson" | "timeoutMs">> &
    Pick<FollowingFeedOptions, "resolvePdsFor" | "clientFor"> & { preferredPds?: string },
): Promise<ProfileActivityResult> {
  const readFromPds = async (pds: string): Promise<FollowingActivity[]> => {
    const client = options.clientFor ? options.clientFor(pds) : new PublicRepoClient(pds);
    const description = await withTimeout(client.describe({ repo: actor.did }), options.timeoutMs);
    const collections = description.collections.filter(isFollowingActivityCollection);
    const pages = await mapLimit(collections, 6, async (collection) => {
      try {
        return await withTimeout(
          client.list({ repo: actor.did, collection, limit: options.perCollection, reverse: true }),
          options.timeoutMs,
        );
      } catch {
        return { records: [] };
      }
    });
    const events = pages
      .flatMap((page, index) =>
        page.records.flatMap((record) => {
          const createdAt = validCreatedAt(record.value);
          return createdAt
            ? [
                {
                  actor,
                  pds,
                  uri: record.uri,
                  cid: record.cid,
                  collection: collections[index],
                  value: record.value,
                  createdAt,
                },
              ]
            : [];
        }),
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, options.perPerson);
    if (!client.get) return events;
    const referencedUris = [
      ...new Set(
        events.flatMap((event) =>
          [event.value.type, event.value.stock, event.value.lab].filter(
            (reference): reference is string => typeof reference === "string",
          ),
        ),
      ),
    ];
    const referenceRecords = await mapLimit(referencedUris, 6, async (uri) => {
      const target = parseAtUri(uri);
      if (!target || target.did !== actor.did) return null;
      try {
        return await withTimeout(
          client.get!({ repo: actor.did, collection: target.collection, rkey: target.rkey }),
          options.timeoutMs,
        );
      } catch {
        return null;
      }
    });
    const references: Record<string, RepoRecord> = {};
    referenceRecords.forEach((record, index) => {
      if (record?.value) references[referencedUris[index]] = record.value;
    });
    for (const event of events) event.references = references;
    return events;
  };

  if (options.preferredPds) {
    try {
      return { events: await readFromPds(options.preferredPds), pds: options.preferredPds, succeeded: true };
    } catch {
      // A DID can migrate between PDS hosts. Resolve it again before giving up.
    }
  }
  try {
    const pds = await withTimeout((options.resolvePdsFor || resolvePds)(actor.did), options.timeoutMs);
    return { events: await readFromPds(pds), pds, succeeded: true };
  } catch {
    return { events: [], pds: options.preferredPds, succeeded: false };
  }
}

export async function loadFollowingFeed(
  viewerDid: string,
  options: FollowingFeedOptions = {},
): Promise<FollowingFeedSnapshot> {
  const cache = options.cache || null;
  const cached = options.cached || (cache ? await cache.read(viewerDid).catch(() => null) : null) || emptySnapshot();
  const profiles = await loadFollowProfiles(viewerDid, cached, options);
  const now = options.now || Date.now;
  const actorStats: Record<string, FollowingActorStats> = {};
  for (const profile of profiles) {
    const previous = cached.actorStats[profile.did];
    const cachedEvents = cached.events.filter((event) => event.actor.did === profile.did);
    actorStats[profile.did] = previous || {
      did: profile.did,
      recordCount: cachedEvents.length,
      latestRecordAt: cachedEvents[0]?.createdAt,
      consecutiveEmptyScans: 0,
    };
  }
  const snapshot: FollowingFeedSnapshot = {
    profiles,
    events: mergeActivity(profiles, cached.events, []),
    actorStats,
    cachedAt: cached.cachedAt,
    refreshCompletedAt: cached.refreshCompletedAt,
  };
  let persist = Promise.resolve();
  const persistSnapshot = (): void => {
    if (!cache) return;
    const copy = cloneSnapshot(snapshot);
    persist = persist.then(() => cache.write(viewerDid, copy)).catch(() => undefined);
  };
  persistSnapshot();

  const rankedProfiles = rankFollowingProfiles(profiles, actorStats, now());
  const clients = new Map<string, ActivityClient>();
  const clientFor = (pds: string): ActivityClient => {
    let client = clients.get(pds);
    if (!client) {
      client = options.clientFor ? options.clientFor(pds) : new PublicRepoClient(pds);
      clients.set(pds, client);
    }
    return client;
  };
  let done = 0;
  await mapLimit(rankedProfiles, options.concurrency || 4, async (profile) => {
    const result = await loadProfileActivity(profile, {
      perCollection: options.perCollection || 2,
      perPerson: options.perPerson || 8,
      timeoutMs: options.timeoutMs || 10_000,
      resolvePdsFor: options.resolvePdsFor,
      clientFor,
      preferredPds: snapshot.actorStats[profile.did]?.pds,
    });
    if (result.succeeded) {
      snapshot.events = mergeActivity(profiles, snapshot.events, result.events);
      const actorEvents = snapshot.events.filter((event) => event.actor.did === profile.did);
      const previous = snapshot.actorStats[profile.did];
      snapshot.actorStats[profile.did] = {
        did: profile.did,
        pds: result.pds,
        recordCount: actorEvents.length,
        latestRecordAt: actorEvents[0]?.createdAt,
        lastScannedAt: new Date(now()).toISOString(),
        consecutiveEmptyScans: result.events.length ? 0 : (previous?.consecutiveEmptyScans || 0) + 1,
      };
      snapshot.cachedAt = new Date(now()).toISOString();
      persistSnapshot();
    }
    options.onProgress?.({
      done: ++done,
      total: rankedProfiles.length,
      profile,
      feed: cloneSnapshot(snapshot),
    });
    return result;
  });
  snapshot.cachedAt = new Date(now()).toISOString();
  snapshot.refreshCompletedAt = snapshot.cachedAt;
  persistSnapshot();
  await persist;
  return snapshot;
}
