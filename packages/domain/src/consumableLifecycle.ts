export interface ConsumableLifecycleIssue {
  readonly code: "chronology";
  readonly path: string;
  readonly relatedPath: string;
  readonly message: string;
}

type LifecycleValue = Readonly<Record<string, unknown>>;
type ChronologyEdge = readonly [earlier: string, later: string];

const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";
const CHEMISTRY_COLLECTION = "app.graycard.instance.chemistry";

// These edges encode only lifecycle orderings that do not depend on a
// particular lab or darkroom workflow. In particular, a lab scan may arrive
// before the physical negatives, so scannedAt and receivedFromLabAt are not
// comparable.
const FILM_ROLL_EDGES: readonly ChronologyEdge[] = [
  ["loadedAt", "partialAt"],
  ["partialAt", "exposedAt"],
  ["exposedAt", "unloadedAt"],
  ["unloadedAt", "sentToLabAt"],
  ["unloadedAt", "developmentStartedAt"],
  ["sentToLabAt", "developmentStartedAt"],
  ["developmentStartedAt", "developedAt"],
  ["developedAt", "receivedFromLabAt"],
  ["developedAt", "scannedAt"],
  ["receivedFromLabAt", "archivedAt"],
  ["scannedAt", "archivedAt"],
];

// acquiredAt and expiresAt are intentionally excluded: a user may acquire an
// already-open or already-mixed solution, and a use-by date is not an event.
// Replenishment and exhaustion are also unordered because replenishment may
// revive an exhausted solution or precede its eventual exhaustion.
const CHEMICAL_EDGES: readonly ChronologyEdge[] = [
  ["openedAt", "mixedAt"],
  ["mixedAt", "replenishedAt"],
  ["mixedAt", "exhaustedAt"],
  ["acquiredAt", "discardedAt"],
  ["openedAt", "discardedAt"],
  ["mixedAt", "discardedAt"],
  ["replenishedAt", "discardedAt"],
  ["exhaustedAt", "discardedAt"],
];

function transitivePairs(edges: readonly ChronologyEdge[]): readonly ChronologyEdge[] {
  const successors = new Map<string, Set<string>>();
  for (const [earlier, later] of edges) {
    const values = successors.get(earlier) ?? new Set<string>();
    values.add(later);
    successors.set(earlier, values);
  }

  const pairs: ChronologyEdge[] = [];
  for (const earlier of successors.keys()) {
    const seen = new Set<string>();
    const pending = [...(successors.get(earlier) ?? [])];
    while (pending.length) {
      const later = pending.pop()!;
      if (seen.has(later)) continue;
      seen.add(later);
      pairs.push([earlier, later]);
      pending.push(...(successors.get(later) ?? []));
    }
  }
  return pairs;
}

const FILM_ROLL_PAIRS = transitivePairs(FILM_ROLL_EDGES);
const CHEMICAL_PAIRS = transitivePairs(CHEMICAL_EDGES);

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectionPairs(collection: string): readonly ChronologyEdge[] | null {
  if (collection === FILM_ROLL_COLLECTION) return FILM_ROLL_PAIRS;
  if (collection === CHEMISTRY_COLLECTION) return CHEMICAL_PAIRS;
  return null;
}

/**
 * Report chronologically impossible consumable milestones.
 *
 * Missing and malformed timestamps are left to lexicon validation; this check
 * only compares valid timestamps whose lifecycle ordering is unambiguous.
 */
export function validateConsumableLifecycle(collection: string, value: LifecycleValue): ConsumableLifecycleIssue[] {
  const pairs = collectionPairs(collection);
  if (!pairs) return [];

  const issues: ConsumableLifecycleIssue[] = [];
  for (const [earlierField, laterField] of pairs) {
    const earlier = timestamp(value[earlierField]);
    const later = timestamp(value[laterField]);
    if (earlier == null || later == null || earlier <= later) continue;
    const path = `$.${earlierField}`;
    const relatedPath = `$.${laterField}`;
    issues.push({
      code: "chronology",
      path,
      relatedPath,
      message: `${path} must not be after ${relatedPath}`,
    });
  }
  return issues;
}

export class ConsumableLifecycleValidationError extends Error {
  readonly name = "ConsumableLifecycleValidationError";
  readonly collection: string;
  readonly issues: readonly ConsumableLifecycleIssue[];

  constructor(collection: string, issues: readonly ConsumableLifecycleIssue[]) {
    super(`Invalid consumable lifecycle for ${collection}: ${issues.map((issue) => issue.message).join("; ")}`);
    this.collection = collection;
    this.issues = issues;
  }
}

/** Throw when a consumable record contains chronologically impossible dates. */
export function assertConsumableLifecycle(collection: string, value: LifecycleValue): void {
  const issues = validateConsumableLifecycle(collection, value);
  if (issues.length) throw new ConsumableLifecycleValidationError(collection, issues);
}
