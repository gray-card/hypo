import type { LensHandle, ProtolensChainHandle } from "@panproto/core";
import { loadPanproto } from "@hypo/schema-runtime";
import type { ApplyWrite, RecordView, RepoRecord } from "@hypo/pds";

import exposureLensDocument from "../lenses/filter-stacks-v2/exposure-lens.json";
import exposureProjectionLexicon from "../lenses/filter-stacks-v2/exposure-projection-lexicon.json";
import meterReadingLensDocument from "../lenses/filter-stacks-v2/meter-reading-lens.json";
import meterReadingProjectionLexicon from "../lenses/filter-stacks-v2/meter-reading-projection-lexicon.json";
import { repoClient } from "./pds.js";

export const FILTER_STACK_COLLECTIONS = {
  exposure: "app.graycard.instance.exposure",
  meterReading: "app.graycard.meter.reading",
} as const;

type FilterStackCollection = (typeof FILTER_STACK_COLLECTIONS)[keyof typeof FILTER_STACK_COLLECTIONS];

const ROOTS: Record<FilterStackCollection, string> = {
  [FILTER_STACK_COLLECTIONS.exposure]: `${FILTER_STACK_COLLECTIONS.exposure}:body`,
  [FILTER_STACK_COLLECTIONS.meterReading]: `${FILTER_STACK_COLLECTIONS.meterReading}:body`,
};

interface MigrationClient {
  describe(input: { repo: string }): Promise<{ collections: string[] }>;
  listAll<T extends RepoRecord = RepoRecord>(input: {
    repo: string;
    collection: string;
  }): Promise<Array<RecordView<T>>>;
  applyWrites(input: {
    repo: string;
    writes: Array<ApplyWrite>;
    validate?: boolean;
    swapCommit?: string;
  }): Promise<unknown>;
  getLatestCommit(input: { did: string }): Promise<{ cid: string; rev: string }>;
}

interface FilterStackTransforms {
  project(collection: FilterStackCollection, record: RepoRecord): string[];
  dispose(): void;
}

function dispose(value: { [Symbol.dispose]?: () => void } | undefined): void {
  value?.[Symbol.dispose]?.();
}

async function createFilterStackTransforms(): Promise<FilterStackTransforms> {
  const panproto = await loadPanproto();
  const schema = panproto.parseSchemaBundle("atproto", [exposureProjectionLexicon, meterReadingProjectionLexicon]);
  const chains = new Map<FilterStackCollection, ProtolensChainHandle>();
  const lenses = new Map<FilterStackCollection, LensHandle>();
  try {
    for (const [collection, document] of [
      [FILTER_STACK_COLLECTIONS.exposure, exposureLensDocument],
      [FILTER_STACK_COLLECTIONS.meterReading, meterReadingLensDocument],
    ] as const) {
      const root = ROOTS[collection];
      const chain = panproto.compileLensDocument(document, root);
      if (!(chain.fieldTransforms()[root]?.length >= 1)) {
        throw new Error(`Panproto did not compile the ${collection} filter-stack transform`);
      }
      chains.set(collection, chain);
      lenses.set(collection, chain.instantiate(schema));
    }
    return {
      project(collection, record) {
        const view = lenses.get(collection)!.getJson(record, ROOTS[collection]).view as RepoRecord;
        if (!Array.isArray(view.filters) || !view.filters.every((filter) => typeof filter === "string")) {
          throw new Error(`Panproto did not produce a filter stack for ${collection}`);
        }
        return view.filters;
      },
      dispose() {
        for (const lens of lenses.values()) dispose(lens);
        for (const chain of chains.values()) dispose(chain);
        dispose(schema);
      },
    };
  } catch (error) {
    for (const lens of lenses.values()) dispose(lens);
    for (const chain of chains.values()) dispose(chain);
    dispose(schema);
    throw error;
  }
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new TypeError(`Invalid AT URI: ${uri}`);
  return rkey;
}

export function isLegacyFilterStackValue(record: RepoRecord): boolean {
  return Object.hasOwn(record, "filter");
}

/** Make the plural stack canonical after Panproto has projected the legacy value. */
export function migrateFilterStackValue(source: RepoRecord, projectedFilters: readonly string[]): RepoRecord {
  const migrated: RepoRecord = { ...source };
  delete migrated.filter;

  // A prerelease record may contain both shapes. Preserve its explicit ordered
  // stack; released records have only the singular field and take the projection.
  if (Array.isArray(source.filters) && source.filters.length) migrated.filters = source.filters;
  else if (projectedFilters.length) migrated.filters = [...projectedFilters];
  else if (Array.isArray(source.filters)) migrated.filters = source.filters;
  else delete migrated.filters;
  return migrated;
}

export async function migrateFilterStackValueWithPanproto(
  collection: FilterStackCollection,
  source: RepoRecord,
): Promise<RepoRecord> {
  if (!isLegacyFilterStackValue(source)) return source;
  const transforms = await createFilterStackTransforms();
  try {
    return migrateFilterStackValue(source, transforms.project(collection, source));
  } finally {
    transforms.dispose();
  }
}

export interface FilterStackMigrationResult {
  migrated: boolean;
  exposures: number;
  meterReadings: number;
}

const noMigration = (): FilterStackMigrationResult => ({ migrated: false, exposures: 0, meterReadings: 0 });

export async function migrateFilterStacksWithClient(
  client: MigrationClient,
  repo: string,
): Promise<FilterStackMigrationResult> {
  const description = await client.describe({ repo });
  const collections = Object.values(FILTER_STACK_COLLECTIONS).filter((collection) =>
    description.collections.includes(collection),
  );
  if (!collections.length) return noMigration();

  const recordsByCollection = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      records: await client.listAll({ repo, collection }),
    })),
  );
  const candidates = recordsByCollection.flatMap(({ collection, records }) =>
    records.filter((record) => isLegacyFilterStackValue(record.value)).map((record) => ({ collection, record })),
  );
  if (!candidates.length) return noMigration();

  const transforms = await createFilterStackTransforms();
  const writes: ApplyWrite[] = [];
  let exposures = 0;
  let meterReadings = 0;
  try {
    for (const { collection, record } of candidates) {
      const value = migrateFilterStackValue(record.value, transforms.project(collection, record.value));
      writes.push({
        $type: "com.atproto.repo.applyWrites#update",
        collection,
        rkey: rkeyFromUri(record.uri),
        value,
      });
      if (collection === FILTER_STACK_COLLECTIONS.exposure) exposures += 1;
      else meterReadings += 1;
    }
  } finally {
    transforms.dispose();
  }

  // applyWrites is capped at 200 operations. Each batch is commit-guarded;
  // rerunning after a later failure safely resumes from the remaining records.
  for (let offset = 0; offset < writes.length; offset += 200) {
    const latest = await client.getLatestCommit({ did: repo });
    await client.applyWrites({
      repo,
      writes: writes.slice(offset, offset + 200),
      validate: false,
      swapCommit: latest.cid,
    });
  }
  return { migrated: writes.length > 0, exposures, meterReadings };
}

const migrationsByAgent = new WeakMap<object, Map<string, Promise<FilterStackMigrationResult>>>();

/** Rewrite singular filter references before the current store reads them. */
export function migrateFilterStacks(agent: object, repo: string): Promise<FilterStackMigrationResult> {
  const candidate = agent as { com?: { atproto?: { repo?: { describeRepo?: unknown } } } };
  if (typeof candidate.com?.atproto?.repo?.describeRepo !== "function") return Promise.resolve(noMigration());
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(noMigration());
  let byRepo = migrationsByAgent.get(agent);
  if (!byRepo) {
    byRepo = new Map();
    migrationsByAgent.set(agent, byRepo);
  }
  let migration = byRepo.get(repo);
  if (!migration) {
    migration = migrateFilterStacksWithClient(repoClient(agent), repo).catch((error) => {
      byRepo!.delete(repo);
      throw error;
    });
    byRepo.set(repo, migration);
  }
  return migration;
}
