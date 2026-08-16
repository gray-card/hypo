import type { LensHandle, ProtolensChainHandle } from "@panproto/core";
import { loadPanproto } from "@hypo/schema-runtime";
import type { ApplyWrite, RecordView, RepoRecord } from "@hypo/pds";

import developSessionLens from "../lenses/develop-session-v2/lens.json";
import developSessionProjectionLexicon from "../lenses/develop-session-v2/projection-lexicon.json";
import { repoClient } from "./pds.js";

export const DEVELOP_SESSION = "app.graycard.process.developSession";
const DEVELOP_ROOT = `${DEVELOP_SESSION}:body`;

export const LEGACY_DEVELOPMENT_SUMMARY_FIELDS = [
  "recipe",
  "sourceDocument",
  "sourceSpec",
  "chemistry",
  "dilution",
  "temperature",
  "temperatureSetpoint",
  "actualTemperature",
  "timeSeconds",
  "publishedTimeSeconds",
  "actualTimeSeconds",
  "agitation",
  "agitationScheme",
  "stopBath",
  "stopBathChemistry",
  "fixer",
  "fixerChemistry",
  "bleachFix",
] as const;

const PRIMARY_FIELDS = [
  "recipe",
  "sourceDocument",
  "sourceSpec",
  "chemistry",
  "dilution",
  "temperature",
  "temperatureSetpoint",
  "actualTemperature",
  "timeSeconds",
  "publishedTimeSeconds",
  "actualTimeSeconds",
  "agitation",
  "agitationScheme",
] as const;

export const LEGACY_DEVELOPMENT_STEP_FIELDS = ["role", "chemistry", "temperature", "timeSeconds", "agitation"] as const;

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

interface DevelopSessionTransform {
  primary(record: RepoRecord): RepoRecord;
  dispose(): void;
}

function dispose(value: { [Symbol.dispose]?: () => void } | undefined): void {
  value?.[Symbol.dispose]?.();
}

async function createDevelopSessionTransform(): Promise<DevelopSessionTransform> {
  const panproto = await loadPanproto();
  const schema = panproto.parseSchemaBundle("atproto", [developSessionProjectionLexicon]);
  let chain: ProtolensChainHandle | undefined;
  let lens: LensHandle | undefined;
  try {
    chain = panproto.compileLensDocument(developSessionLens, DEVELOP_ROOT);
    if (!(chain.fieldTransforms()[DEVELOP_ROOT]?.length >= 1)) {
      throw new Error("Panproto did not compile the development-stage value transform");
    }
    lens = chain.instantiate(schema);
    return {
      primary(record) {
        const projection: RepoRecord = {
          process: record.process ?? "other",
          createdAt: record.createdAt ?? new Date(0).toISOString(),
          steps: [],
        };
        for (const field of PRIMARY_FIELDS) projection[field] = record[field] ?? null;
        const view = lens!.getJson(projection, DEVELOP_ROOT).view as RepoRecord;
        const primary = Array.isArray(view.steps) ? view.steps[0] : undefined;
        if (!primary || typeof primary !== "object" || Array.isArray(primary)) {
          throw new Error("Panproto did not produce a primary development stage");
        }
        return stripNulls(primary as RepoRecord) as RepoRecord;
      },
      dispose() {
        dispose(lens);
        dispose(chain);
        dispose(schema);
      },
    };
  } catch (error) {
    dispose(lens);
    dispose(chain);
    dispose(schema);
    throw error;
  }
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls).filter((item) => item !== null && item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as RepoRecord)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, stripNulls(item)]),
  );
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new TypeError(`Invalid AT URI: ${uri}`);
  return rkey;
}

function roles(step: RepoRecord): string[] {
  if (Array.isArray(step.roles)) return step.roles.map(String);
  return typeof step.role === "string" ? [step.role] : [];
}

function inferredName(stepRoles: readonly string[]): string {
  if (stepRoles.includes("film-developer")) return "Developer";
  if (stepRoles.includes("first-developer")) return "First developer";
  if (stepRoles.includes("color-developer")) return "Color developer";
  if (stepRoles.includes("stop")) return "Stop bath";
  if (stepRoles.includes("bleach") && stepRoles.includes("fixer")) return "Bleach + fixer";
  if (stepRoles.includes("bleach")) return "Bleach";
  if (stepRoles.includes("fixer")) return "Fixer";
  if (stepRoles.includes("wash")) return "Wash";
  if (stepRoles.includes("final-rinse")) return "Final rinse";
  return stepRoles[0]?.replaceAll("-", " ") || "Process stage";
}

function normalizeStep(source: RepoRecord): RepoRecord {
  const value = { ...source };
  const stepRoles = roles(value);
  delete value.role;
  value.roles = stepRoles;
  value.name ||= inferredName(stepRoles);
  value.kind ||= stepRoles.includes("wash") ? "wash" : "chemical-bath";
  if (typeof value.chemistry === "string") {
    const current = Array.isArray(value.chemistries) ? value.chemistries.map(String) : [];
    value.chemistries = [value.chemistry, ...current.filter((uri) => uri !== value.chemistry)];
  }
  delete value.chemistry;
  if (value.actualTemperature == null && value.temperature != null) value.actualTemperature = value.temperature;
  delete value.temperature;
  if (value.actualTimeSeconds == null && value.timeSeconds != null) value.actualTimeSeconds = value.timeSeconds;
  delete value.timeSeconds;
  if (typeof value.agitation === "string" && value.agitation) {
    const scheme =
      value.agitationScheme && typeof value.agitationScheme === "object" && !Array.isArray(value.agitationScheme)
        ? { ...(value.agitationScheme as RepoRecord) }
        : {};
    if (!scheme.note) scheme.note = value.agitation;
    value.agitationScheme = scheme;
  }
  delete value.agitation;
  return value;
}

function developerStepIndex(steps: readonly RepoRecord[]): number {
  return steps.findIndex((step) =>
    roles(step).some((role) => ["film-developer", "first-developer", "color-developer"].includes(role)),
  );
}

function hasAny(record: RepoRecord, fields: readonly string[]): boolean {
  return fields.some((field) => record[field] !== undefined && record[field] !== null);
}

function appendLegacyBath(steps: RepoRecord[], stepRoles: readonly string[], name: unknown, chemistry: unknown): void {
  if (name === undefined && chemistry === undefined) return;
  if (steps.some((step) => stepRoles.every((role) => roles(step).includes(role)))) return;
  const value: RepoRecord = {
    name: typeof name === "string" && name ? name : inferredName(stepRoles),
    kind: "chemical-bath",
    roles: [...stepRoles],
  };
  if (typeof chemistry === "string" && chemistry) {
    value.chemistries = [chemistry];
  }
  steps.push(value);
}

export function migrateDevelopSessionValue(source: RepoRecord, panprotoPrimary: RepoRecord): RepoRecord {
  const migrated: RepoRecord = { ...source };
  const steps = Array.isArray(source.steps)
    ? source.steps.flatMap((candidate) =>
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? [normalizeStep(candidate as RepoRecord)]
          : [],
      )
    : [];

  if (hasAny(source, PRIMARY_FIELDS)) {
    const index = developerStepIndex(steps);
    if (index < 0) {
      steps.unshift(normalizeStep(panprotoPrimary));
    } else {
      const current = steps[index];
      steps[index] = normalizeStep({
        ...panprotoPrimary,
        ...current,
        chemistries:
          Array.isArray(current.chemistries) && current.chemistries.length
            ? current.chemistries
            : panprotoPrimary.chemistries,
      });
    }
  }

  appendLegacyBath(steps, ["stop"], source.stopBath, source.stopBathChemistry);
  appendLegacyBath(steps, ["fixer"], source.fixer, source.fixerChemistry);
  appendLegacyBath(steps, ["bleach", "fixer"], source.bleachFix, undefined);

  if (steps.length) migrated.steps = steps;
  else delete migrated.steps;
  for (const field of LEGACY_DEVELOPMENT_SUMMARY_FIELDS) delete migrated[field];
  return migrated;
}

function changed(left: RepoRecord, right: RepoRecord): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function isLegacyDevelopSessionValue(record: RepoRecord): boolean {
  if (hasAny(record, LEGACY_DEVELOPMENT_SUMMARY_FIELDS)) return true;
  return Array.isArray(record.steps)
    ? record.steps.some(
        (step) =>
          step &&
          typeof step === "object" &&
          !Array.isArray(step) &&
          hasAny(step as RepoRecord, LEGACY_DEVELOPMENT_STEP_FIELDS),
      )
    : false;
}

export async function migrateDevelopSessionValueWithPanproto(source: RepoRecord): Promise<RepoRecord> {
  if (!isLegacyDevelopSessionValue(source)) return source;
  const transform = await createDevelopSessionTransform();
  try {
    return migrateDevelopSessionValue(source, transform.primary(source));
  } finally {
    transform.dispose();
  }
}

export interface DevelopSessionMigrationResult {
  migrated: boolean;
  sessions: number;
}

const noMigration = (): DevelopSessionMigrationResult => ({ migrated: false, sessions: 0 });

export async function migrateDevelopSessionsWithClient(
  client: MigrationClient,
  repo: string,
): Promise<DevelopSessionMigrationResult> {
  const description = await client.describe({ repo });
  if (!description.collections.includes(DEVELOP_SESSION)) return noMigration();
  const records = await client.listAll({ repo, collection: DEVELOP_SESSION });
  const candidates = records.filter((record) => isLegacyDevelopSessionValue(record.value));
  if (!candidates.length) return noMigration();

  const transform = await createDevelopSessionTransform();
  const writes: ApplyWrite[] = [];
  try {
    for (const record of candidates) {
      const value = migrateDevelopSessionValue(record.value, transform.primary(record.value));
      if (!changed(record.value, value)) continue;
      writes.push({
        $type: "com.atproto.repo.applyWrites#update",
        collection: DEVELOP_SESSION,
        rkey: rkeyFromUri(record.uri),
        value,
      });
    }
  } finally {
    transform.dispose();
  }

  for (let offset = 0; offset < writes.length; offset += 200) {
    const latest = await client.getLatestCommit({ did: repo });
    await client.applyWrites({
      repo,
      writes: writes.slice(offset, offset + 200),
      validate: false,
      swapCommit: latest.cid,
    });
  }
  return { migrated: writes.length > 0, sessions: writes.length };
}

const migrationsByAgent = new WeakMap<object, Map<string, Promise<DevelopSessionMigrationResult>>>();

/** Rewrite summary-shaped development sessions before the current store reads them. */
export function migrateDevelopSessions(agent: object, repo: string): Promise<DevelopSessionMigrationResult> {
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
    migration = migrateDevelopSessionsWithClient(repoClient(agent), repo).catch((error) => {
      byRepo!.delete(repo);
      throw error;
    });
    byRepo.set(repo, migration);
  }
  return migration;
}
