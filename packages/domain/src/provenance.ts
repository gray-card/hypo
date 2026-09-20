export interface ProvenanceEvidence {
  kind: string;
  record?: string;
  uri?: string;
  digest?: string;
  label?: string;
  redacted?: boolean;
  note?: string;
}

export interface ProvenanceAssertion {
  source?: string;
  confidence?: string;
  assertedAt?: string;
  assertedBy?: string;
  method?: string;
  evidence?: readonly ProvenanceEvidence[];
  note?: string;
}

export interface FieldProvenanceAssertion {
  field: string;
  relationship?: string;
  valueDigest?: string;
  provenance: ProvenanceAssertion;
}

export interface ProvenanceRecord {
  provenance?: ProvenanceAssertion;
  fieldProvenance?: readonly FieldProvenanceAssertion[];
}

export type EffectiveProvenanceState = "direct" | "fallback" | "missing" | "stale" | "conflict";

export interface EffectiveProvenance {
  state: EffectiveProvenanceState;
  provenance?: ProvenanceAssertion;
  assertions: readonly FieldProvenanceAssertion[];
}

/** Normalize a legacy top-level name and a JSON Pointer to the same target. */
export function provenancePointer(field: string): string {
  if (!field) return "";
  return field.startsWith("/") ? field : `/${field.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalProvenanceValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Return a portable SHA-256 binding for the canonical encoded current value. */
export async function digestProvenanceValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProvenanceValue(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Resolve narrow provenance before the record fallback. Relationship members
 * are matched by stable serialized value, never their current array index.
 */
export function resolveEffectiveProvenance(
  record: ProvenanceRecord,
  field: string,
  options: { relationship?: string; valueDigest?: string } = {},
): EffectiveProvenance {
  const target = provenancePointer(field);
  const assertions = (record.fieldProvenance || []).filter(
    (candidate) =>
      provenancePointer(candidate.field) === target &&
      (options.relationship === undefined || candidate.relationship === options.relationship),
  );
  if (!assertions.length) {
    return record.provenance
      ? { state: "fallback", provenance: record.provenance, assertions: [] }
      : { state: "missing", assertions: [] };
  }
  const digests = new Set(assertions.map((assertion) => assertion.valueDigest).filter(Boolean));
  if (
    options.valueDigest &&
    assertions.every((assertion) => assertion.valueDigest && assertion.valueDigest !== options.valueDigest)
  ) {
    return { state: "stale", assertions };
  }
  if (!options.valueDigest && digests.size > 1) return { state: "conflict", assertions };
  const current = options.valueDigest
    ? assertions.filter((assertion) => !assertion.valueDigest || assertion.valueDigest === options.valueDigest)
    : assertions;
  const sorted = [...current].sort((left, right) =>
    String(right.provenance.assertedAt || "").localeCompare(String(left.provenance.assertedAt || "")),
  );
  return sorted[0]
    ? { state: "direct", provenance: sorted[0].provenance, assertions: sorted }
    : { state: "stale", assertions };
}
