import type { LensHandle, ProtolensChainHandle } from "@panproto/core";
import { loadPanproto } from "@hypo/schema-runtime";
import type { ApplyWrite, RecordView, RepoRecord } from "@hypo/pds";

import { repoClient } from "./pds.js";

export const LEGACY_DEVELOPER_TYPE = "app.graycard.catalog.developerType";
export const CHEMISTRY_TYPE = "app.graycard.catalog.chemistryType";
export const LEGACY_DEVELOPER_INSTANCE = "app.graycard.instance.developer";
export const CHEMISTRY_INSTANCE = "app.graycard.instance.chemistry";
export const WORKFLOW_TEMPLATE = "app.graycard.workflow.template";

const REFERENCE_COLLECTIONS = [
  "app.graycard.catalog.devRecipe",
  "app.graycard.instance.filmRoll",
  "app.graycard.process.developSession",
  WORKFLOW_TEMPLATE,
] as const;

const TYPE_ROOT = `${LEGACY_DEVELOPER_TYPE}:body`;
const INSTANCE_ROOT = `${LEGACY_DEVELOPER_INSTANCE}:body`;
const WORKFLOW_ROOT = `${WORKFLOW_TEMPLATE}:body`;

const minimalRecordLexicon = (id: string, required: readonly string[], properties: Record<string, object>): object => ({
  lexicon: 1,
  id,
  defs: {
    main: {
      type: "record",
      key: "tid",
      record: { type: "object", required, properties },
    },
  },
});

const LEGACY_TYPE_LEXICON = minimalRecordLexicon(LEGACY_DEVELOPER_TYPE, ["name", "createdAt"], {
  name: { type: "string" },
  createdAt: { type: "string", format: "datetime" },
});

const LEGACY_INSTANCE_LEXICON = minimalRecordLexicon(LEGACY_DEVELOPER_INSTANCE, ["type", "createdAt"], {
  type: { type: "string", format: "at-uri" },
  createdAt: { type: "string", format: "datetime" },
});

const LEGACY_WORKFLOW_LEXICON = minimalRecordLexicon(WORKFLOW_TEMPLATE, ["name", "medium", "createdAt"], {
  name: { type: "string" },
  medium: { type: "string" },
  createdAt: { type: "string", format: "datetime" },
  defaultDeveloper: { type: "string", format: "at-uri" },
});

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

export interface LegacyDeveloperMigrationResult {
  migrated: boolean;
  chemistryTypes: number;
  chemistryInstances: number;
  workflows: number;
  dependents: number;
  deletedLegacyRecords: number;
}

const noMigration = (): LegacyDeveloperMigrationResult => ({
  migrated: false,
  chemistryTypes: 0,
  chemistryInstances: 0,
  workflows: 0,
  dependents: 0,
  deletedLegacyRecords: 0,
});

interface PanprotoTransforms {
  type(record: RepoRecord): RepoRecord;
  instance(record: RepoRecord): RepoRecord;
  workflow(record: RepoRecord): RepoRecord;
  dispose(): void;
}

function dispose(value: { [Symbol.dispose]?: () => void } | undefined): void {
  value?.[Symbol.dispose]?.();
}

/**
 * Compile the value-level part of the migration with Panproto 0.70.1.
 *
 * We intentionally project only fields needed by the lens and merge its patch
 * into the untouched source value. The full legacy records contain open and
 * external-ref fields; preserving those outside the projection prevents a
 * schema lens from accidentally dropping product data it does not understand.
 */
async function createPanprotoTransforms(): Promise<PanprotoTransforms> {
  const panproto = await loadPanproto();
  const typeSchema = panproto.parseSchemaBundle("atproto", [LEGACY_TYPE_LEXICON]);
  const instanceSchema = panproto.parseSchemaBundle("atproto", [LEGACY_INSTANCE_LEXICON]);
  const workflowSchema = panproto.parseSchemaBundle("atproto", [LEGACY_WORKFLOW_LEXICON]);

  let typeChain: ProtolensChainHandle | undefined;
  let instanceChain: ProtolensChainHandle | undefined;
  let workflowChain: ProtolensChainHandle | undefined;
  let typeLens: LensHandle | undefined;
  let instanceLens: LensHandle | undefined;
  let workflowLens: LensHandle | undefined;

  try {
    typeChain = panproto.compileLensDocument(
      {
        id: "graycard.developer-type-to-chemistry-type.v1",
        source: LEGACY_DEVELOPER_TYPE,
        target: CHEMISTRY_TYPE,
        steps: [
          { compute_field: { target: "roles", kind: "array", expr: '["film-developer"]' } },
          { compute_field: { target: "$type", kind: "string", expr: `"${CHEMISTRY_TYPE}"` } },
        ],
      },
      TYPE_ROOT,
    );
    instanceChain = panproto.compileLensDocument(
      {
        id: "graycard.developer-instance-to-chemistry-instance.v1",
        source: LEGACY_DEVELOPER_INSTANCE,
        target: CHEMISTRY_INSTANCE,
        steps: [{ compute_field: { target: "$type", kind: "string", expr: `"${CHEMISTRY_INSTANCE}"` } }],
      },
      INSTANCE_ROOT,
    );
    workflowChain = panproto.compileLensDocument(
      {
        id: "graycard.workflow-default-developer-to-chemistry.v1",
        source: WORKFLOW_TEMPLATE,
        target: WORKFLOW_TEMPLATE,
        steps: [{ rename_field: { old: "defaultDeveloper", new: "defaultChemistry" } }],
      },
      WORKFLOW_ROOT,
    );

    // A regression in older toolkit releases discarded value transforms at
    // the WASM boundary. Fail closed if the required transforms are absent.
    if (!(typeChain.fieldTransforms()[TYPE_ROOT]?.length >= 2)) {
      throw new Error("Panproto did not compile the developer type value transforms");
    }
    if (!(instanceChain.fieldTransforms()[INSTANCE_ROOT]?.length >= 1)) {
      throw new Error("Panproto did not compile the developer instance value transform");
    }

    typeLens = typeChain.instantiate(typeSchema);
    instanceLens = instanceChain.instantiate(instanceSchema);
    workflowLens = workflowChain.instantiate(workflowSchema);

    return {
      type(record) {
        const projection = { name: record.name, createdAt: record.createdAt };
        return typeLens!.getJson(projection, TYPE_ROOT).view as RepoRecord;
      },
      instance(record) {
        const projection = { type: record.type, createdAt: record.createdAt };
        return instanceLens!.getJson(projection, INSTANCE_ROOT).view as RepoRecord;
      },
      workflow(record) {
        const projection = {
          name: record.name,
          medium: record.medium,
          createdAt: record.createdAt,
          defaultDeveloper: record.defaultDeveloper,
        };
        return workflowLens!.getJson(projection, WORKFLOW_ROOT).view as RepoRecord;
      },
      dispose() {
        dispose(typeLens);
        dispose(instanceLens);
        dispose(workflowLens);
        dispose(typeChain);
        dispose(instanceChain);
        dispose(workflowChain);
        dispose(typeSchema);
        dispose(instanceSchema);
        dispose(workflowSchema);
      },
    };
  } catch (error) {
    dispose(typeLens);
    dispose(instanceLens);
    dispose(workflowLens);
    dispose(typeChain);
    dispose(instanceChain);
    dispose(workflowChain);
    dispose(typeSchema);
    dispose(instanceSchema);
    dispose(workflowSchema);
    throw error;
  }
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new TypeError(`Invalid AT URI: ${uri}`);
  return rkey;
}

function recordUri(repo: string, collection: string, rkey: string): string {
  return `at://${repo}/${collection}/${rkey}`;
}

function rewriteUri(value: unknown, uriMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return uriMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteUri(item, uriMap));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, rewriteUri(item, uriMap)]),
  );
}

function migrateBathRoles(value: RepoRecord): RepoRecord {
  if (!Array.isArray(value.kitBathSequence)) return value;
  return {
    ...value,
    kitBathSequence: value.kitBathSequence.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      const bath = { ...(candidate as RepoRecord) };
      if (!Array.isArray(bath.roles) && typeof bath.role === "string") bath.roles = [bath.role];
      delete bath.role;
      return bath;
    }),
  };
}

function rewriteDependentRecord(
  collection: (typeof REFERENCE_COLLECTIONS)[number],
  source: RepoRecord,
  uriMap: ReadonlyMap<string, string>,
  panprotoPatch: RepoRecord,
): RepoRecord {
  if (collection === WORKFLOW_TEMPLATE) return rewriteLegacyWorkflowReferences(source, uriMap, panprotoPatch);
  const value = rewriteUri(source, uriMap) as RepoRecord;
  if (collection === "app.graycard.catalog.devRecipe" && typeof source.developerType === "string") {
    if (value.chemistryType !== undefined && value.chemistryType !== value.developerType) {
      throw new Error("Development recipe contains conflicting developerType and chemistryType references");
    }
    value.chemistryType = value.developerType;
    delete value.developerType;
  }
  if (collection === "app.graycard.process.developSession") {
    if (typeof source.developer === "string") {
      if (value.chemistry !== undefined && value.chemistry !== value.developer) {
        throw new Error("Development session contains conflicting developer and chemistry references");
      }
      value.chemistry = value.developer;
      delete value.developer;
    }
    if (Array.isArray(value.steps)) {
      value.steps = value.steps.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
        const step = { ...(candidate as RepoRecord) };
        if (!Array.isArray(step.roles) && typeof step.role === "string") step.roles = [step.role];
        delete step.role;
        return step;
      });
    }
  }
  return value;
}

export function rewriteLegacyWorkflowReferences(
  source: RepoRecord,
  uriMap: ReadonlyMap<string, string>,
  panprotoPatch: RepoRecord = {},
): RepoRecord {
  const value = rewriteUri(source, uriMap) as RepoRecord;
  const migrated = { ...value };

  if (typeof source.defaultDeveloper === "string") {
    if (migrated.defaultChemistry === undefined) {
      migrated.defaultChemistry = uriMap.get(source.defaultDeveloper) ?? panprotoPatch.defaultChemistry;
    }
    delete migrated.defaultDeveloper;
  }

  if (Array.isArray(migrated.stageDefaults)) {
    migrated.stageDefaults = migrated.stageDefaults.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      const stageDefault = { ...(candidate as RepoRecord) };
      if (!stageDefault.fields || typeof stageDefault.fields !== "object" || Array.isArray(stageDefault.fields)) {
        return stageDefault;
      }
      const fields = { ...(stageDefault.fields as RepoRecord) };
      if (typeof fields.developer === "string") {
        if (fields.chemistry === undefined) fields.chemistry = uriMap.get(fields.developer) ?? fields.developer;
        delete fields.developer;
      }
      return { ...stageDefault, fields };
    });
  }

  return migrated;
}

function changed(left: RepoRecord, right: RepoRecord): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export async function migrateLegacyDeveloperRecordsWithClient(
  client: MigrationClient,
  repo: string,
): Promise<LegacyDeveloperMigrationResult> {
  const description = await client.describe({ repo });
  const collectionSet = new Set(description.collections);
  const hasTypes = collectionSet.has(LEGACY_DEVELOPER_TYPE);
  const hasInstances = collectionSet.has(LEGACY_DEVELOPER_INSTANCE);
  if (!hasTypes && !hasInstances) {
    return noMigration();
  }

  const [legacyTypes, legacyInstances, currentTypes, currentInstances, ...dependentLists] = await Promise.all([
    hasTypes ? client.listAll({ repo, collection: LEGACY_DEVELOPER_TYPE }) : [],
    hasInstances ? client.listAll({ repo, collection: LEGACY_DEVELOPER_INSTANCE }) : [],
    client.listAll({ repo, collection: CHEMISTRY_TYPE }),
    client.listAll({ repo, collection: CHEMISTRY_INSTANCE }),
    ...REFERENCE_COLLECTIONS.map((collection) => client.listAll({ repo, collection })),
  ]);

  const typeUriMap = new Map<string, string>();
  for (const record of legacyTypes) {
    const rkey = rkeyFromUri(record.uri);
    typeUriMap.set(record.uri, recordUri(repo, CHEMISTRY_TYPE, rkey));
  }
  const instanceUriMap = new Map<string, string>();
  for (const record of legacyInstances) {
    const rkey = rkeyFromUri(record.uri);
    instanceUriMap.set(record.uri, recordUri(repo, CHEMISTRY_INSTANCE, rkey));
  }
  const uriMap = new Map([...typeUriMap, ...instanceUriMap]);

  for (const record of legacyInstances) {
    if (typeof record.value.type !== "string" || !typeUriMap.has(record.value.type)) {
      throw new Error(`Cannot migrate ${record.uri}: its developer type is not present in this repository`);
    }
  }

  const currentTypeKeys = new Set(currentTypes.map((record) => rkeyFromUri(record.uri)));
  const currentInstanceKeys = new Set(currentInstances.map((record) => rkeyFromUri(record.uri)));
  const typeCollisions = legacyTypes.filter((record) => currentTypeKeys.has(rkeyFromUri(record.uri)));
  const instanceCollisions = legacyInstances.filter((record) => currentInstanceKeys.has(rkeyFromUri(record.uri)));
  if (typeCollisions.length || instanceCollisions.length) {
    throw new Error("Cannot migrate developer records because a target chemistry record already uses the same key");
  }
  const writes: Array<ApplyWrite> = [];
  let transformedWorkflows = 0;
  let transformedDependents = 0;
  const transforms = await createPanprotoTransforms();
  try {
    for (const record of legacyTypes) {
      const rkey = rkeyFromUri(record.uri);
      const value = migrateBathRoles({ ...record.value, ...transforms.type(record.value) });
      writes.push({
        $type: "com.atproto.repo.applyWrites#create",
        collection: CHEMISTRY_TYPE,
        rkey,
        value,
      });
    }

    for (const record of legacyInstances) {
      const rkey = rkeyFromUri(record.uri);
      const value = rewriteUri({ ...record.value, ...transforms.instance(record.value) }, typeUriMap) as RepoRecord;
      writes.push({
        $type: "com.atproto.repo.applyWrites#create",
        collection: CHEMISTRY_INSTANCE,
        rkey,
        value,
      });
    }

    for (let index = 0; index < REFERENCE_COLLECTIONS.length; index += 1) {
      const collection = REFERENCE_COLLECTIONS[index];
      for (const record of dependentLists[index]) {
        const needsPanproto = collection === WORKFLOW_TEMPLATE && typeof record.value.defaultDeveloper === "string";
        const patch = needsPanproto ? transforms.workflow(record.value) : {};
        const value = rewriteDependentRecord(collection, record.value, uriMap, patch);
        if (!changed(record.value, value)) continue;
        transformedDependents += 1;
        if (collection === WORKFLOW_TEMPLATE) transformedWorkflows += 1;
        writes.push({
          $type: "com.atproto.repo.applyWrites#update",
          collection,
          rkey: rkeyFromUri(record.uri),
          value,
        });
      }
    }
  } finally {
    transforms.dispose();
  }

  // Deletes belong to the same repository commit as their replacements and
  // reference rewrites. applyWrites is atomic: a failed create/update leaves
  // every legacy record intact, and a successful commit leaves none behind.
  for (const record of legacyInstances) {
    writes.push({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: LEGACY_DEVELOPER_INSTANCE,
      rkey: rkeyFromUri(record.uri),
    });
  }
  for (const record of legacyTypes) {
    writes.push({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: LEGACY_DEVELOPER_TYPE,
      rkey: rkeyFromUri(record.uri),
    });
  }

  if (!writes.length) {
    return noMigration();
  }
  if (writes.length > 200) {
    throw new Error(`Developer migration needs ${writes.length} writes; the PDS atomic limit is 200`);
  }
  const latestCommit = await client.getLatestCommit({ did: repo });
  await client.applyWrites({ repo, writes, validate: false, swapCommit: latestCommit.cid });
  return {
    migrated: true,
    chemistryTypes: legacyTypes.length,
    chemistryInstances: legacyInstances.length,
    workflows: transformedWorkflows,
    dependents: transformedDependents,
    deletedLegacyRecords: legacyTypes.length + legacyInstances.length,
  };
}

const migrationsByAgent = new WeakMap<object, Map<string, Promise<LegacyDeveloperMigrationResult>>>();

/** Run the one-time migration before the first current-schema store read. */
export function migrateLegacyDeveloperRecords(agent: object, repo: string): Promise<LegacyDeveloperMigrationResult> {
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
    migration = migrateLegacyDeveloperRecordsWithClient(repoClient(agent), repo).catch((error) => {
      byRepo!.delete(repo);
      throw error;
    });
    byRepo.set(repo, migration);
  }
  return migration;
}
