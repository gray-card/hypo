import type { ApplyWrite, RecordView, RepoRecord } from "@hypo/pds";

import { createCanonicalShapeTransforms } from "./canonicalShapePanproto.js";
import { repoClient } from "./pds.js";

export const LEGACY_SHAPE_COLLECTIONS = {
  filmStock: "app.graycard.catalog.filmStock",
  filmRoll: "app.graycard.instance.filmRoll",
  filmStockpile: "app.graycard.instance.filmStockpile",
  workflowTemplate: "app.graycard.workflow.template",
  workflowRun: "app.graycard.workflow.run",
  workflowStage: "app.graycard.workflow.stage",
} as const;

const TEMPLATE_LEGACY_FIELDS = [
  "stageKinds",
  "stageDefaults",
  "defaultCamera",
  "defaultFilmBack",
  "defaultLens",
  "defaultFilters",
  "defaultFilmRoll",
  "defaultChemistry",
  "defaultScanner",
  "defaultScanProfile",
  "defaultLab",
] as const;

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

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new TypeError(`Invalid AT URI: ${uri}`);
  return rkey;
}

function stableStepIds(kinds: readonly string[]): string[] {
  const occurrences = new Map<string, number>();
  return kinds.map((kind, index) => {
    const base =
      String(kind)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `step-${index + 1}`;
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    return `${base}-${occurrence}`;
  });
}

function legacyDefaults(kinds: readonly string[], value: RepoRecord): Array<Record<string, unknown>> {
  const entries = Array.isArray(value.stageDefaults) ? value.stageDefaults : [];
  const byKind = new Map<string, Array<Record<string, unknown>>>();
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as RepoRecord;
    const kind = String(entry.kind || "");
    const list = byKind.get(kind) || [];
    list.push(entry);
    byKind.set(kind, list);
  }
  const occurrences = new Map<string, number>();
  return kinds.map((kind) => {
    const list = byKind.get(kind) || [];
    const occurrence = occurrences.get(kind) || 0;
    occurrences.set(kind, occurrence + 1);
    const entry = list.length === 1 ? list[0] : list[occurrence];
    return entry?.fields && typeof entry.fields === "object" ? { ...(entry.fields as RepoRecord) } : {};
  });
}

const TOP_LEVEL_DEFAULTS: ReadonlyArray<readonly [string, string, string]> = [
  ["defaultCamera", "capture", "camera"],
  ["defaultFilmBack", "capture", "filmBack"],
  ["defaultLens", "capture", "lens"],
  ["defaultFilters", "capture", "filters"],
  ["defaultFilmRoll", "capture", "filmRoll"],
  ["defaultChemistry", "develop", "chemistry"],
  ["defaultLab", "develop", "lab"],
  ["defaultScanner", "digitize", "scanner"],
  ["defaultScanProfile", "digitize", "scanProfile"],
];

export function isLegacyWorkflowTemplate(value: RepoRecord): boolean {
  return TEMPLATE_LEGACY_FIELDS.some((field) => Object.hasOwn(value, field));
}

export function migrateWorkflowTemplateValue(source: RepoRecord): RepoRecord {
  const migrated: RepoRecord = { ...source };
  const kinds = Array.isArray(source.stageKinds) ? source.stageKinds.map(String) : [];
  const defaults = legacyDefaults(kinds, source);
  const steps = Array.isArray(source.steps)
    ? source.steps.map((step) => ({ ...(step as RepoRecord) }))
    : kinds.map((kind, index) => ({
        id: stableStepIds(kinds)[index],
        kind,
        ...(Object.keys(defaults[index]).length ? { processDefaults: defaults[index] } : {}),
      }));

  for (const [legacyField, kind, canonicalField] of TOP_LEVEL_DEFAULTS) {
    const legacyValue = source[legacyField];
    if (legacyValue === undefined) continue;
    const step = steps.find((candidate) => candidate.kind === kind);
    if (!step) continue;
    const processDefaults =
      step.processDefaults && typeof step.processDefaults === "object"
        ? { ...(step.processDefaults as RepoRecord) }
        : {};
    if (processDefaults[canonicalField] === undefined) processDefaults[canonicalField] = legacyValue;
    step.processDefaults = processDefaults;
  }
  if (steps.length) migrated.steps = steps;
  for (const field of TEMPLATE_LEGACY_FIELDS) delete migrated[field];
  return migrated;
}

export function migrateWorkflowRunValue(source: RepoRecord, projectedProducts?: readonly unknown[]): RepoRecord {
  if (typeof source.photo !== "string") return source;
  const migrated: RepoRecord = { ...source };
  const products = Array.isArray(source.products)
    ? source.products.map((product) => ({ ...(product as RepoRecord) }))
    : [];
  const projected = Array.isArray(projectedProducts) ? projectedProducts[0] : undefined;
  const product =
    projected && typeof projected === "object"
      ? { ...(projected as RepoRecord) }
      : { kind: "digital-raster", ref: source.photo };
  if (!products.some((candidate) => candidate.ref === source.photo)) {
    products.push(product);
  }
  migrated.products = products;
  delete migrated.photo;
  return migrated;
}

export function migrateFilmStockValue(source: RepoRecord, projectedFormats?: readonly unknown[]): RepoRecord {
  if (source.format === undefined) return source;
  const migrated: RepoRecord = { ...source };
  const formats = Array.isArray(source.formats) ? [...source.formats] : [];
  const projected = Array.isArray(projectedFormats) ? projectedFormats : [source.format];
  for (const format of [...projected].reverse()) if (!formats.includes(format)) formats.unshift(format);
  migrated.formats = formats;
  delete migrated.format;
  return migrated;
}

export function migrateWorkflowStageValue(source: RepoRecord): RepoRecord {
  const migrated: RepoRecord = { ...source };
  if (source.$type === "app.graycard.workflow#captureStage" && typeof source.session === "string") {
    if (source.shoot !== undefined && source.shoot !== source.session) {
      throw new Error("Capture workflow stage has conflicting session and shoot references");
    }
    migrated.shoot = source.session;
    delete migrated.session;
  }
  if (source.$type === "app.graycard.workflow#outputStage" && typeof source.photo === "string") {
    const target = source.target as RepoRecord | undefined;
    if (target?.ref !== undefined && target.ref !== source.photo) {
      throw new Error("Output workflow stage has conflicting photo and target references");
    }
    migrated.target = { service: String(target?.service || "social.grain"), ref: source.photo };
    delete migrated.photo;
  }
  return migrated;
}

export interface MigratedFilmRoll {
  roll: RepoRecord;
  stockpile?: RepoRecord;
}

/** Preserve N total rolls as one physical roll and N-1 unshot reserve rolls. */
export function migrateFilmRollValue(source: RepoRecord): MigratedFilmRoll {
  const quantity = Number(source.quantity);
  const roll: RepoRecord = { ...source };
  delete roll.quantity;
  if (!Number.isInteger(quantity) || quantity <= 1) return { roll };
  const stockpile: RepoRecord = {
    $type: LEGACY_SHAPE_COLLECTIONS.filmStockpile,
    stock: source.stock,
    quantity: quantity - 1,
    createdAt: source.createdAt,
  };
  for (const field of ["format", "storage", "expiresAt", "emulsionBatch", "notes", "updatedAt", "image"] as const) {
    if (source[field] !== undefined) stockpile[field] = source[field];
  }
  return { roll, stockpile };
}

export interface LegacyShapeMigrationResult {
  migrated: boolean;
  filmStocks: number;
  filmRolls: number;
  workflowTemplates: number;
  workflowRuns: number;
  workflowStages: number;
}

const noMigration = (): LegacyShapeMigrationResult => ({
  migrated: false,
  filmStocks: 0,
  filmRolls: 0,
  workflowTemplates: 0,
  workflowRuns: 0,
  workflowStages: 0,
});

export async function migrateLegacyShapesWithClient(
  client: MigrationClient,
  repo: string,
): Promise<LegacyShapeMigrationResult> {
  const description = await client.describe({ repo });
  const present = new Set(description.collections);
  const wanted = [
    LEGACY_SHAPE_COLLECTIONS.filmStock,
    LEGACY_SHAPE_COLLECTIONS.filmRoll,
    LEGACY_SHAPE_COLLECTIONS.filmStockpile,
    LEGACY_SHAPE_COLLECTIONS.workflowTemplate,
    LEGACY_SHAPE_COLLECTIONS.workflowRun,
    LEGACY_SHAPE_COLLECTIONS.workflowStage,
  ].filter((collection) => present.has(collection));
  if (!wanted.length) return noMigration();
  const records = new Map(
    await Promise.all(
      wanted.map(async (collection) => [collection, await client.listAll({ repo, collection })] as const),
    ),
  );
  const stockpileKeys = new Set(
    (records.get(LEGACY_SHAPE_COLLECTIONS.filmStockpile) || []).map((record) => rkeyFromUri(record.uri)),
  );
  const groups: ApplyWrite[][] = [];
  const result = noMigration();
  const transforms = await createCanonicalShapeTransforms();

  const update = (collection: string, record: RecordView, value: RepoRecord): void => {
    groups.push([{ $type: "com.atproto.repo.applyWrites#update", collection, rkey: rkeyFromUri(record.uri), value }]);
  };

  try {
    for (const record of records.get(LEGACY_SHAPE_COLLECTIONS.filmStock) || []) {
      if (record.value.format === undefined) continue;
      const projected = transforms.filmStock(record.value);
      update(
        LEGACY_SHAPE_COLLECTIONS.filmStock,
        record,
        migrateFilmStockValue(record.value, projected.formats as readonly unknown[]),
      );
      result.filmStocks += 1;
    }
    for (const record of records.get(LEGACY_SHAPE_COLLECTIONS.workflowTemplate) || []) {
      if (!isLegacyWorkflowTemplate(record.value)) continue;
      transforms.workflowTemplate(record.value);
      update(LEGACY_SHAPE_COLLECTIONS.workflowTemplate, record, migrateWorkflowTemplateValue(record.value));
      result.workflowTemplates += 1;
    }
    for (const record of records.get(LEGACY_SHAPE_COLLECTIONS.workflowRun) || []) {
      if (typeof record.value.photo !== "string") continue;
      const projected = transforms.workflowRun(record.value);
      update(
        LEGACY_SHAPE_COLLECTIONS.workflowRun,
        record,
        migrateWorkflowRunValue(record.value, projected.products as readonly unknown[]),
      );
      result.workflowRuns += 1;
    }
    for (const record of records.get(LEGACY_SHAPE_COLLECTIONS.workflowStage) || []) {
      if (!(
        (record.value.$type === "app.graycard.workflow#captureStage" && typeof record.value.session === "string") ||
        (record.value.$type === "app.graycard.workflow#outputStage" && typeof record.value.photo === "string")
      ))
        continue;
      transforms.workflowStage(record.value);
      update(LEGACY_SHAPE_COLLECTIONS.workflowStage, record, migrateWorkflowStageValue(record.value));
      result.workflowStages += 1;
    }
    for (const record of records.get(LEGACY_SHAPE_COLLECTIONS.filmRoll) || []) {
      if (!Object.hasOwn(record.value, "quantity")) continue;
      const projected = transforms.filmRoll(record.value);
      if (projected.quantity !== record.value.quantity) {
        throw new Error(`Panproto did not preserve the reserve count for ${record.uri}`);
      }
      const rkey = rkeyFromUri(record.uri);
      const migrated = migrateFilmRollValue(record.value);
      const writes: ApplyWrite[] = [];
      if (migrated.stockpile) {
        if (stockpileKeys.has(rkey))
          throw new Error(`Cannot migrate ${record.uri}: stockpile key ${rkey} already exists`);
        const stockpileUri = `at://${repo}/${LEGACY_SHAPE_COLLECTIONS.filmStockpile}/${rkey}`;
        migrated.roll.stockpile = stockpileUri;
        writes.push({
          $type: "com.atproto.repo.applyWrites#create",
          collection: LEGACY_SHAPE_COLLECTIONS.filmStockpile,
          rkey,
          value: migrated.stockpile,
        });
        stockpileKeys.add(rkey);
      }
      writes.push({
        $type: "com.atproto.repo.applyWrites#update",
        collection: LEGACY_SHAPE_COLLECTIONS.filmRoll,
        rkey,
        value: migrated.roll,
      });
      groups.push(writes);
      result.filmRolls += 1;
    }
  } finally {
    transforms.dispose();
  }

  let batch: ApplyWrite[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const latest = await client.getLatestCommit({ did: repo });
    await client.applyWrites({ repo, writes: batch, validate: false, swapCommit: latest.cid });
    batch = [];
  };
  for (const group of groups) {
    if (batch.length + group.length > 200) await flush();
    batch.push(...group);
  }
  await flush();
  result.migrated = groups.length > 0;
  return result;
}

const migrationsByAgent = new WeakMap<object, Map<string, Promise<LegacyShapeMigrationResult>>>();

/** Canonicalize every supported legacy record shape before the current-schema store read. */
export function migrateLegacyShapes(agent: object, repo: string): Promise<LegacyShapeMigrationResult> {
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
    migration = migrateLegacyShapesWithClient(repoClient(agent), repo).catch((error) => {
      byRepo!.delete(repo);
      throw error;
    });
    byRepo.set(repo, migration);
  }
  return migration;
}
