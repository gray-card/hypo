const PLANNED_STEP_FIELDS = [
  "name",
  "kind",
  "roles",
  "recipe",
  "chemistries",
  "dilution",
  "temperatureSetpoint",
  "publishedTimeSeconds",
  "agitationMethod",
  "agitationScheme",
  "volumeMl",
  "notes",
] as const;

export interface DevelopmentPlanValue {
  name: string;
  process: string;
  tankType?: string;
  steps: Record<string, unknown>[];
  notes?: string;
  [key: string]: unknown;
}

export function plannedDevelopmentStep(step: Record<string, unknown>) {
  return Object.fromEntries(
    PLANNED_STEP_FIELDS.filter((field) => step[field] !== undefined).map((field) => [
      field,
      structuredClone(step[field]),
    ]),
  );
}

export function developmentPlanSnapshot(value: DevelopmentPlanValue) {
  return structuredClone({
    name: value.name,
    process: value.process,
    tankType: value.tankType,
    steps: (value.steps || []).map(plannedDevelopmentStep),
    notes: value.notes,
  });
}

export function validateDevelopmentPlan(value: DevelopmentPlanValue) {
  if (!String(value?.name || "").trim()) throw new Error("Name the film-processing sequence.");
  if (!String(value?.process || "").trim()) throw new Error("Choose a film process.");
  if (!Array.isArray(value.steps) || !value.steps.length) throw new Error("Add at least one bath or operation.");
  if (value.steps.length > 64) throw new Error("A sequence can have at most 64 stages.");
  for (const [index, step] of value.steps.entries()) {
    if (!Array.isArray(step.roles)) throw new Error(`Stage ${index + 1} needs roles, even if the list is empty.`);
    if (
      step.publishedTimeSeconds !== undefined &&
      (typeof step.publishedTimeSeconds !== "number" ||
        !Number.isInteger(step.publishedTimeSeconds) ||
        step.publishedTimeSeconds < 0)
    )
      throw new Error(`Stage ${index + 1} needs a non-negative planned duration.`);
  }
  return value;
}
