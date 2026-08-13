import { PublicRepoClient, type RecordView, type RepoRecord } from "@hypo/pds";
import { getFollows, getGrainFollows, resolvePds } from "./profile.js";

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
  collection: string;
  value: RepoRecord;
  createdAt: string;
  references?: Record<string, RepoRecord>;
}

export interface FollowingFeed {
  profiles: FollowProfile[];
  events: FollowingActivity[];
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
  onProgress?: (progress: { done: number; total: number; profile: FollowProfile }) => void;
}

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
    Pick<FollowingFeedOptions, "resolvePdsFor" | "clientFor">,
): Promise<FollowingActivity[]> {
  try {
    const pds = await withTimeout((options.resolvePdsFor || resolvePds)(actor.did), options.timeoutMs);
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
            ? [{ actor, pds, uri: record.uri, collection: collections[index], value: record.value, createdAt }]
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
  } catch {
    return [];
  }
}

export async function loadFollowingFeed(viewerDid: string, options: FollowingFeedOptions = {}): Promise<FollowingFeed> {
  const [grain, bluesky] = await Promise.all([
    (options.getGrain || getGrainFollows)(viewerDid),
    (options.getBluesky || getFollows)(viewerDid),
  ]);
  const profiles = mergeFollowSources(grain, bluesky, viewerDid);
  let done = 0;
  const eventGroups = await mapLimit(
    profiles,
    options.concurrency || 4,
    (profile) =>
      loadProfileActivity(profile, {
        perCollection: options.perCollection || 2,
        perPerson: options.perPerson || 8,
        timeoutMs: options.timeoutMs || 10_000,
        resolvePdsFor: options.resolvePdsFor,
        clientFor: options.clientFor,
      }),
    (profile) => options.onProgress?.({ done: ++done, total: profiles.length, profile }),
  );
  const events = eventGroups.flat().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return { profiles, events };
}
