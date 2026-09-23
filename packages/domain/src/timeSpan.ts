export interface TimeSpanChronologyIssue {
  readonly code: "chronology";
  readonly path: string;
  readonly relatedPath: string;
  readonly message: string;
}

type RecordValue = Readonly<Record<string, unknown>>;

const END_FIELDS = ["finishedAt", "endedAt", "completedAt", "failedAt", "cancelledAt", "skippedAt"] as const;

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/**
 * Report reversed time spans anywhere in a JSON-shaped record.
 *
 * Missing, equal, and malformed timestamps remain valid here. Missing endpoints
 * represent partial historical knowledge, equal endpoints remain available to
 * non-interactive importers, and malformed values are handled by lexicon
 * validation. Interactive session forms may impose a stricter positive-duration
 * rule when both endpoints are supplied.
 */
export function validateRecordTimeSpans(value: unknown): TimeSpanChronologyIssue[] {
  const issues: TimeSpanChronologyIssue[] = [];

  const visit = (candidate: unknown, path: string): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;

    const record = candidate as RecordValue;
    const startedAt = timestamp(record.startedAt);
    if (startedAt !== null) {
      for (const endField of END_FIELDS) {
        const endedAt = timestamp(record[endField]);
        if (endedAt === null || endedAt >= startedAt) continue;
        const endPath = childPath(path, endField);
        const startPath = childPath(path, "startedAt");
        issues.push({
          code: "chronology",
          path: endPath,
          relatedPath: startPath,
          message: `${endPath} must not be before ${startPath}`,
        });
      }
    }

    for (const [key, nested] of Object.entries(record)) visit(nested, childPath(path, key));
  };

  visit(value, "$");
  return issues;
}

export class RecordTimeSpanValidationError extends Error {
  readonly name = "RecordTimeSpanValidationError";
  readonly collection: string;
  readonly issues: readonly TimeSpanChronologyIssue[];

  constructor(collection: string, issues: readonly TimeSpanChronologyIssue[]) {
    super(`Invalid time span for ${collection}: ${issues.map((issue) => issue.message).join("; ")}`);
    this.collection = collection;
    this.issues = issues;
  }
}

/** Throw when a record or one of its nested process stages has a reversed interval. */
export function assertRecordTimeSpans(collection: string, value: unknown): void {
  const issues = validateRecordTimeSpans(value);
  if (issues.length) throw new RecordTimeSpanValidationError(collection, issues);
}
