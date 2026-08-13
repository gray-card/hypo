export interface ScaledMeasure {
  value: number;
  scale?: number;
  unit?: string;
}

export interface ReciprocityPointInput {
  meteredSeconds: number;
  correctedSeconds?: number;
  correctionStops?: ScaledMeasure;
  colorFilter?: string;
  notes?: string;
}

export interface FilmStockReciprocityInput {
  reciprocity?: string;
  reciprocityPoints?: ReciprocityPointInput[];
  notes?: string;
}

export interface ReciprocityPoint {
  meteredSeconds: number;
  correctedSeconds: number;
  correctionStops: number;
  colorFilter?: string;
  notes?: string;
}

export type ReciprocityModel =
  | { kind: "power-law"; exponent: number; source: string }
  | { kind: "points"; points: ReciprocityPoint[]; source: string };

export interface ReciprocityResult {
  meteredSeconds: number;
  correctedSeconds: number;
  correctionStops: number;
  model: ReciprocityModel;
}

function measureValue(measure?: ScaledMeasure): number | undefined {
  if (!measure || !Number.isFinite(measure.value)) return undefined;
  const scale = measure.scale ?? 1;
  return scale > 0 ? measure.value / scale : undefined;
}

function normalizePoint(point: ReciprocityPointInput): ReciprocityPoint | null {
  if (!Number.isFinite(point.meteredSeconds) || point.meteredSeconds <= 0) return null;
  const statedStops = measureValue(point.correctionStops);
  const corrected =
    point.correctedSeconds && point.correctedSeconds > 0
      ? point.correctedSeconds
      : statedStops !== undefined
        ? point.meteredSeconds * 2 ** statedStops
        : point.meteredSeconds;
  return {
    meteredSeconds: point.meteredSeconds,
    correctedSeconds: corrected,
    correctionStops: statedStops ?? Math.log2(corrected / point.meteredSeconds),
    ...(point.colorFilter ? { colorFilter: point.colorFilter } : {}),
    ...(point.notes ? { notes: point.notes } : {}),
  };
}

/** Parse explicit correction points first, then manufacturer power-law prose such as Ta=Tm^1.31. */
export function parseReciprocityModel(stock: FilmStockReciprocityInput): ReciprocityModel | null {
  const points = (stock.reciprocityPoints ?? [])
    .map(normalizePoint)
    .filter((point): point is ReciprocityPoint => point !== null)
    .sort((left, right) => left.meteredSeconds - right.meteredSeconds);
  if (points.length) return { kind: "points", points, source: "reciprocityPoints" };

  const source = [stock.reciprocity, stock.notes].filter(Boolean).join(" ");
  const match = source.match(/T\s*a\s*=\s*T\s*m\s*\^\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const exponent = Number(match[1]);
  return Number.isFinite(exponent) && exponent > 0 ? { kind: "power-law", exponent, source: match[0] } : null;
}

function interpolateStops(points: ReciprocityPoint[], meteredSeconds: number): number {
  const first = points[0];
  if (meteredSeconds < first.meteredSeconds) return 0;
  const last = points.at(-1) ?? first;
  if (meteredSeconds >= last.meteredSeconds) return last.correctionStops;
  const upperIndex = points.findIndex((point) => point.meteredSeconds >= meteredSeconds);
  const upper = points[upperIndex];
  const lower = points[Math.max(0, upperIndex - 1)];
  if (upper.meteredSeconds === lower.meteredSeconds) return upper.correctionStops;
  const position =
    (Math.log2(meteredSeconds) - Math.log2(lower.meteredSeconds)) /
    (Math.log2(upper.meteredSeconds) - Math.log2(lower.meteredSeconds));
  return lower.correctionStops + position * (upper.correctionStops - lower.correctionStops);
}

export function applyReciprocity(model: ReciprocityModel, meteredSeconds: number): ReciprocityResult {
  if (!Number.isFinite(meteredSeconds) || meteredSeconds <= 0) {
    throw new RangeError("meteredSeconds must be a positive finite number");
  }
  let correctedSeconds: number;
  if (model.kind === "power-law")
    correctedSeconds = meteredSeconds < 1 ? meteredSeconds : meteredSeconds ** model.exponent;
  else correctedSeconds = meteredSeconds * 2 ** interpolateStops(model.points, meteredSeconds);
  return {
    meteredSeconds,
    correctedSeconds,
    correctionStops: Math.log2(correctedSeconds / meteredSeconds),
    model,
  };
}

export function reciprocityForStock(
  stock: FilmStockReciprocityInput,
  meteredSeconds: number,
): ReciprocityResult | null {
  const model = parseReciprocityModel(stock);
  return model ? applyReciprocity(model, meteredSeconds) : null;
}
