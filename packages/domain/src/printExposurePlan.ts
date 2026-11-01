const MAX_RECORD_BYTES = 750_000;

export interface ExposurePlanPoint {
  x: number;
  y: number;
}
export interface ExposurePlanSelection {
  kind: "brush" | "polygon" | "ellipse" | "linear-gradient";
  points: ExposurePlanPoint[];
  width?: number;
  feather?: number;
  opacity?: number;
  combine?: string;
}
export interface ExposurePlanStep {
  id: string;
  action: "base" | "dodge" | "burn";
  durationMs: number;
  baseId?: string;
  startOffsetMs?: number;
  selections?: ExposurePlanSelection[];
  [key: string]: unknown;
}
export interface ExposurePlanValue {
  name: string;
  referencePhoto?: string;
  imageWidth?: number;
  imageHeight?: number;
  exposures: ExposurePlanStep[];
  testStrips?: unknown[];
  notes?: string;
  [key: string]: unknown;
}

export function exposurePlanSnapshot(value: ExposurePlanValue) {
  return structuredClone({
    name: value.name,
    referencePhoto: value.referencePhoto,
    imageWidth: value.imageWidth,
    imageHeight: value.imageHeight,
    exposures: value.exposures || [],
    testStrips: value.testStrips || [],
    notes: value.notes,
  });
}

export function validateExposurePlan(value: ExposurePlanValue) {
  if (!String(value?.name || "").trim()) throw new Error("Name the print exposure plan.");
  const steps = value.exposures;
  if (!Array.isArray(steps) || !steps.length) throw new Error("Add at least one base exposure.");
  if (steps.length > 48) throw new Error("A plan can contain at most 48 exposure steps.");
  const ids = new Set();
  const bases = new Map();
  let activeBaseId: string | null = null;
  let lastSequentialEnd = 0;
  for (const [index, step] of steps.entries()) {
    const label = `Exposure ${index + 1}`;
    if (!step.id || ids.has(step.id)) throw new Error(`${label} needs a unique step ID.`);
    ids.add(step.id);
    if (!["base", "dodge", "burn"].includes(step.action)) throw new Error(`${label} has an unsupported action.`);
    if (!Number.isInteger(step.durationMs) || step.durationMs < 1 || step.durationMs > 3_600_000)
      throw new Error(`${label} needs a duration between 0.001 and 3600 seconds.`);
    if (step.action === "base") {
      bases.set(step.id, step);
      activeBaseId = step.id;
      lastSequentialEnd += step.durationMs;
    } else if (step.action === "dodge") {
      const base = bases.get(step.baseId);
      if (!base) throw new Error(`${label}: choose a preceding base exposure to dodge.`);
      if (step.baseId !== activeBaseId)
        throw new Error(`${label}: put this dodge immediately after its base exposure, before the next base or burn.`);
      const start = step.startOffsetMs ?? 0;
      if (!Number.isInteger(start) || start < 0 || start + step.durationMs > base.durationMs)
        throw new Error(`${label}: the dodge must fit inside its base exposure.`);
    } else {
      activeBaseId = null;
      lastSequentialEnd += step.durationMs;
    }
    if (step.action !== "base" && (!Array.isArray(step.selections) || !step.selections.length))
      throw new Error(`${label}: draw a region for this ${step.action}.`);
    if ((step.selections?.length || 0) > 16) throw new Error(`${label} has too many selections (maximum 16).`);
    for (const shape of step.selections || []) {
      const points = shape.points || [];
      const required = { brush: 1, polygon: 3, ellipse: 2, "linear-gradient": 2 }[shape.kind];
      if (!required || points.length < required || points.length > 256)
        throw new Error(`${label}: ${shape.kind || "selection"} has an invalid number of points.`);
      if (
        points.some(
          (point) =>
            !Number.isInteger(point.x) ||
            !Number.isInteger(point.y) ||
            point.x < 0 ||
            point.x > 10000 ||
            point.y < 0 ||
            point.y > 10000,
        )
      )
        throw new Error(`${label}: selection coordinates must lie within the reference image.`);
      if (
        shape.opacity !== undefined &&
        (!Number.isInteger(shape.opacity) || shape.opacity < 0 || shape.opacity > 10000)
      )
        throw new Error(`${label}: selection strength must be between 0 and 100%.`);
      if (shape.width !== undefined && (!Number.isInteger(shape.width) || shape.width < 1 || shape.width > 5000))
        throw new Error(`${label}: brush size is out of range.`);
      if (
        shape.feather !== undefined &&
        (!Number.isInteger(shape.feather) || shape.feather < 0 || shape.feather > 10000)
      )
        throw new Error(`${label}: feathering is out of range.`);
    }
  }
  if (!bases.size) throw new Error("Add at least one base exposure.");
  if (steps.some((step) => step.selections?.length) && !value.referencePhoto)
    throw new Error("Choose a reference photo before saving image selections.");
  for (const [index, strip] of (value.testStrips || []).entries()) {
    if (!strip || typeof strip !== "object") throw new Error(`Test strip ${index + 1} is invalid.`);
    const trial = strip as Record<string, unknown>;
    for (const key of ["baseDurationMs", "incrementMs", "chosenDurationMs"]) {
      const amount = trial[key];
      if (
        amount !== undefined &&
        (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > 3_600_000)
      )
        throw new Error(`Test strip ${index + 1}: ${key} must be a positive duration.`);
    }
    if (trial.baseDurationMs === undefined) throw new Error(`Test strip ${index + 1} needs a first exposure.`);
    if (
      trial.strips !== undefined &&
      (typeof trial.strips !== "number" || !Number.isInteger(trial.strips) || trial.strips < 1 || trial.strips > 64)
    )
      throw new Error(`Test strip ${index + 1} needs a count between 1 and 64.`);
  }
  if (value.referencePhoto && !/^at:\/\/[a-zA-Z0-9:.%-]+\/[a-zA-Z0-9.]+\/[a-zA-Z0-9._~:-]+$/.test(value.referencePhoto))
    throw new Error("Choose a photo from your library as the reference image.");
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_RECORD_BYTES)
    throw new Error("This plan is too large to save. Simplify long brush paths or use fewer selections.");
  return { sequentialDurationMs: lastSequentialEnd, baseCount: bases.size };
}

export function exposureTimeline(value: ExposurePlanValue) {
  validateExposurePlan(value);
  let cursor = 0;
  const baseStarts = new Map<string, number>();
  return value.exposures.map((step) => {
    if (step.action === "dodge") {
      const startMs = (baseStarts.get(step.baseId || "") || 0) + (step.startOffsetMs || 0);
      return { ...step, startMs, endMs: startMs + step.durationMs };
    }
    const startMs = cursor;
    cursor += step.durationMs;
    if (step.action === "base") baseStarts.set(step.id, startMs);
    return { ...step, startMs, endMs: cursor };
  });
}
