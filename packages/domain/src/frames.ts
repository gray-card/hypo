export type FrameClusteringSensitivity = "conservative" | "balanced" | "detailed";

export interface FramesGearDescription {
  readonly make?: string | null;
  readonly model?: string | null;
  readonly serial?: string | null;
  readonly [key: string]: unknown;
}

export interface FramesPlacemark {
  readonly name?: string | null;
  readonly locality?: string | null;
  readonly subLocality?: string | null;
  readonly administrativeArea?: string | null;
  readonly postalCode?: string | null;
  readonly country?: string | null;
  readonly isoCountryCode?: string | null;
  readonly timeZoneIdentifier?: string | null;
  readonly [key: string]: unknown;
}

export interface FramesFrame {
  readonly id?: string | null;
  readonly number?: number | null;
  readonly createdAt?: string | null;
  readonly timeZoneIdentifier?: string | null;
  readonly aperture?: number | null;
  readonly shutterSpeed?: number | null;
  readonly focal?: number | null;
  readonly focusDistance?: number | string | null;
  readonly meteringMode?: number | string | null;
  readonly exposureProgram?: number | string | null;
  readonly exposure?: number | string | null;
  readonly hasFlash?: boolean | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly altitude?: number | null;
  readonly placemark?: FramesPlacemark | null;
  readonly lens?: FramesGearDescription | null;
  readonly filter?: FramesGearDescription | null;
  readonly notes?: string | null;
  readonly [key: string]: unknown;
}

export interface FramesArchive {
  readonly sourceName: string;
  readonly name: string;
  readonly createdAt?: string;
  readonly notes?: string;
  readonly iso?: number;
  readonly camera?: FramesGearDescription;
  readonly stock?: FramesGearDescription & { readonly iso?: number | null };
  readonly frames: readonly FramesFrame[];
}

export interface FrameShootCluster {
  readonly frames: readonly FramesFrame[];
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly boundaryBefore?: {
    readonly gapSeconds: number;
    readonly longGapProbability: number;
    readonly distanceKm?: number;
  };
}

export interface FrameClusteringResult {
  readonly clusters: readonly FrameShootCluster[];
  readonly method: "single-shoot" | "gamma-gap-mixture" | "spatiotemporal-gamma-mixture" | "sparse-gap-rule";
  readonly diagnostics: {
    readonly gapCount: number;
    readonly bicImprovement?: number;
    readonly withinShootSeconds?: number;
    readonly betweenShootSeconds?: number;
    readonly spatialGapCount?: number;
    readonly spatialBicImprovement?: number;
    readonly withinShootKm?: number;
    readonly betweenShootKm?: number;
  };
}

const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function parseGear(value: unknown): FramesGearDescription | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return {
    ...record,
    make: optionalString(record.make),
    model: optionalString(record.model),
    serial: optionalString(record.serial),
  };
}

export function parseFramesArchive(input: unknown, sourceName = "Imported.frames"): FramesArchive {
  const record = recordValue(input);
  if (!record) throw new Error(`${sourceName} does not contain a .frames archive`);
  if (!Array.isArray(record.frames)) throw new Error(`${sourceName} has no frames array`);
  if (!record.frames.length) throw new Error(`${sourceName} contains no frames`);

  const frames = record.frames.map((candidate, index) => {
    const frame = recordValue(candidate);
    if (!frame) throw new Error(`${sourceName} frame ${index + 1} is not an object`);
    const createdAt = optionalString(frame.createdAt);
    if (createdAt && !Number.isFinite(Date.parse(createdAt))) {
      throw new Error(`${sourceName} frame ${index + 1} has an invalid timestamp`);
    }
    return {
      ...frame,
      id: optionalString(frame.id),
      number: finiteNumber(frame.number),
      createdAt,
      timeZoneIdentifier: optionalString(frame.timeZoneIdentifier),
      aperture: finiteNumber(frame.aperture),
      shutterSpeed: finiteNumber(frame.shutterSpeed),
      focal: finiteNumber(frame.focal),
      focusDistance:
        typeof frame.focusDistance === "string"
          ? optionalString(frame.focusDistance)
          : finiteNumber(frame.focusDistance),
      meteringMode:
        typeof frame.meteringMode === "string" ? optionalString(frame.meteringMode) : finiteNumber(frame.meteringMode),
      exposureProgram:
        typeof frame.exposureProgram === "string"
          ? optionalString(frame.exposureProgram)
          : finiteNumber(frame.exposureProgram),
      exposure: typeof frame.exposure === "string" ? optionalString(frame.exposure) : finiteNumber(frame.exposure),
      hasFlash: typeof frame.hasFlash === "boolean" ? frame.hasFlash : undefined,
      latitude: finiteNumber(frame.latitude),
      longitude: finiteNumber(frame.longitude),
      altitude: finiteNumber(frame.altitude),
      placemark: recordValue(frame.placemark) as FramesPlacemark | undefined,
      lens: parseGear(frame.lens),
      filter: parseGear(frame.filter),
      notes: optionalString(frame.notes),
    } satisfies FramesFrame;
  });

  const createdAt = optionalString(record.createdAt);
  if (createdAt && !Number.isFinite(Date.parse(createdAt)))
    throw new Error(`${sourceName} has an invalid creation date`);
  const stock = parseGear(record.stock) as (FramesGearDescription & { iso?: number }) | undefined;
  const stockRecord = recordValue(record.stock);
  if (stock && stockRecord) stock.iso = finiteNumber(stockRecord.iso);

  return {
    sourceName,
    name: optionalString(record.name) || sourceName.replace(/\.frames$/i, ""),
    createdAt,
    notes: optionalString(record.notes),
    iso: finiteNumber(record.iso),
    camera: parseGear(record.camera),
    stock,
    frames,
  };
}

interface GammaMixture {
  readonly means: readonly [number, number];
  readonly shape: number;
  readonly scales: readonly [number, number];
  readonly weights: readonly [number, number];
  readonly posteriors: readonly number[];
  readonly logLikelihood: number;
}

const LOG_GAMMA_COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
  -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
] as const;

function logGamma(value: number): number {
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const shifted = value - 1;
  let series = 0.9999999999998099;
  LOG_GAMMA_COEFFICIENTS.forEach((coefficient, index) => {
    series += coefficient / (shifted + index + 1);
  });
  const tail = shifted + LOG_GAMMA_COEFFICIENTS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(tail) - tail + Math.log(series);
}

function digamma(value: number): number {
  let x = value;
  let result = 0;
  while (x < 8) {
    result -= 1 / x;
    x += 1;
  }
  const inverse = 1 / x;
  const inverseSquared = inverse * inverse;
  return (
    result + Math.log(x) - inverse / 2 - inverseSquared * (1 / 12 - inverseSquared * (1 / 120 - inverseSquared / 252))
  );
}

function trigamma(value: number): number {
  let x = value;
  let result = 0;
  while (x < 8) {
    result += 1 / (x * x);
    x += 1;
  }
  const inverse = 1 / x;
  const inverseSquared = inverse * inverse;
  return (
    result +
    inverse +
    inverseSquared / 2 +
    (inverseSquared * inverse) / 6 -
    (inverseSquared * inverseSquared * inverse) / 30 +
    (inverseSquared * inverseSquared * inverseSquared * inverse) / 42
  );
}

function gammaShape(logMeanDifference: number): number {
  const difference = Math.max(1e-9, logMeanDifference);
  let shape = Math.max(
    0.05,
    Math.min(1000, (3 - difference + Math.sqrt((difference - 3) ** 2 + 24 * difference)) / (12 * difference)),
  );
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const score = Math.log(shape) - digamma(shape) - difference;
    const derivative = 1 / shape - trigamma(shape);
    const next = Math.max(0.05, Math.min(1000, shape - score / derivative));
    if (Math.abs(next - shape) < 1e-8 * Math.max(1, shape)) return next;
    shape = next;
  }
  return shape;
}

const gammaLogDensity = (value: number, shape: number, scale: number) =>
  (shape - 1) * Math.log(value) - value / scale - shape * Math.log(scale) - logGamma(shape);

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * probability));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function fitSingleGamma(values: readonly number[]): { readonly logLikelihood: number } | null {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanLog = values.reduce((sum, value) => sum + Math.log(value), 0) / values.length;
  const shape = gammaShape(Math.log(mean) - meanLog);
  const scale = mean / shape;
  return { logLikelihood: values.reduce((sum, value) => sum + gammaLogDensity(value, shape, scale), 0) };
}

function fitTwoGammaComponents(values: readonly number[]): GammaMixture | null {
  if (values.length < 4) return null;
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const meanLog = values.reduce((sum, value) => sum + Math.log(value), 0) / values.length;
  let means: [number, number] = [Math.max(1e-9, quantile(values, 0.25)), Math.max(1e-9, quantile(values, 0.85))];
  let shape = 2;
  let scales: [number, number] = [means[0] / shape, means[1] / shape];
  let weights: [number, number] = [0.8, 0.2];
  let posteriors = values.map(() => 0.2);
  let previousLogLikelihood = Number.NEGATIVE_INFINITY;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    posteriors = values.map((value) => {
      const shortLog = Math.log(Math.max(weights[0], 1e-9)) + gammaLogDensity(value, shape, scales[0]);
      const longLog = Math.log(Math.max(weights[1], 1e-9)) + gammaLogDensity(value, shape, scales[1]);
      const pivot = Math.max(shortLog, longLog);
      const shortValue = Math.exp(shortLog - pivot);
      const longValue = Math.exp(longLog - pivot);
      return longValue / (shortValue + longValue);
    });

    const longWeight = posteriors.reduce((sum, value) => sum + value, 0);
    const shortWeight = values.length - longWeight;
    if (longWeight < 0.5 || shortWeight < 0.5) return null;
    let nextMeans: [number, number] = [
      values.reduce((sum, value, index) => sum + value * (1 - posteriors[index]!), 0) / shortWeight,
      values.reduce((sum, value, index) => sum + value * posteriors[index]!, 0) / longWeight,
    ];
    let nextWeights: [number, number] = [shortWeight / values.length, longWeight / values.length];
    if (nextMeans[0] > nextMeans[1]) {
      nextMeans = [nextMeans[1], nextMeans[0]];
      nextWeights = [nextWeights[1], nextWeights[0]];
      posteriors = posteriors.map((value) => 1 - value);
    }
    means = nextMeans;
    weights = nextWeights;
    shape = gammaShape(weights[0] * Math.log(means[0]) + weights[1] * Math.log(means[1]) - meanLog);
    scales = [Math.max(1e-9, means[0] / shape), Math.max(1e-9, means[1] / shape)];
    const logLikelihood = values.reduce((sum, value) => {
      const left = Math.log(Math.max(weights[0], 1e-9)) + gammaLogDensity(value, shape, scales[0]);
      const right = Math.log(Math.max(weights[1], 1e-9)) + gammaLogDensity(value, shape, scales[1]);
      const pivot = Math.max(left, right);
      return sum + pivot + Math.log(Math.exp(left - pivot) + Math.exp(right - pivot));
    }, 0);
    if (Math.abs(logLikelihood - previousLogLikelihood) < 1e-8 * Math.max(1, Math.abs(logLikelihood))) break;
    previousLogLikelihood = logLikelihood;
  }

  const logLikelihood = values.reduce((sum, value) => {
    const left = Math.log(Math.max(weights[0], 1e-9)) + gammaLogDensity(value, shape, scales[0]);
    const right = Math.log(Math.max(weights[1], 1e-9)) + gammaLogDensity(value, shape, scales[1]);
    const pivot = Math.max(left, right);
    return sum + pivot + Math.log(Math.exp(left - pivot) + Math.exp(right - pivot));
  }, 0);
  posteriors = values.map((value) => {
    const left = Math.log(Math.max(weights[0], 1e-9)) + gammaLogDensity(value, shape, scales[0]);
    const right = Math.log(Math.max(weights[1], 1e-9)) + gammaLogDensity(value, shape, scales[1]);
    const pivot = Math.max(left, right);
    const leftValue = Math.exp(left - pivot);
    const rightValue = Math.exp(right - pivot);
    return rightValue / (leftValue + rightValue);
  });
  return { means, shape, scales, weights, posteriors, logLikelihood };
}

function clusterFromBoundaries(
  frames: readonly FramesFrame[],
  gaps: readonly number[],
  distances: readonly (number | undefined)[],
  boundaryProbabilities: ReadonlyMap<number, number>,
): FrameShootCluster[] {
  const clusters: FrameShootCluster[] = [];
  let current: FramesFrame[] = [];
  let boundaryBefore: FrameShootCluster["boundaryBefore"];
  const finish = () => {
    if (!current.length) return;
    const timed = current.filter((frame) => frame.createdAt && Number.isFinite(Date.parse(frame.createdAt)));
    clusters.push({
      frames: current,
      startedAt: timed[0]?.createdAt || undefined,
      endedAt: timed.at(-1)?.createdAt || undefined,
      boundaryBefore,
    });
    current = [];
  };
  frames.forEach((frame, index) => {
    if (index > 0 && boundaryProbabilities.has(index - 1)) {
      finish();
      boundaryBefore = {
        gapSeconds: gaps[index - 1]!,
        longGapProbability: boundaryProbabilities.get(index - 1)!,
        distanceKm: distances[index - 1],
      };
    }
    current.push(frame);
  });
  finish();
  return clusters;
}

/**
 * Infers shoot boundaries from the waiting times between frames. The positive,
 * right-skewed gaps are fitted as a two-component common-shape gamma mixture.
 * The components represent within-shoot and between-shoot waiting regimes; the
 * number of resulting shoots is determined by the inferred long gaps, not
 * supplied as K.
 */
export function inferFrameShoots(
  inputFrames: readonly FramesFrame[],
  options: { readonly sensitivity?: FrameClusteringSensitivity; readonly useLocation?: boolean } = {},
): FrameClusteringResult {
  const frames = [...inputFrames].sort((left, right) => {
    const leftAt = left.createdAt ? Date.parse(left.createdAt) : Number.POSITIVE_INFINITY;
    const rightAt = right.createdAt ? Date.parse(right.createdAt) : Number.POSITIVE_INFINITY;
    return leftAt - rightAt || (finiteNumber(left.number) || 0) - (finiteNumber(right.number) || 0);
  });
  if (frames.length < 2) {
    return {
      clusters: clusterFromBoundaries(frames, [], [], new Map()),
      method: "single-shoot",
      diagnostics: { gapCount: 0 },
    };
  }
  const timed = frames.filter((frame) => frame.createdAt && Number.isFinite(Date.parse(frame.createdAt)));
  const gaps = timed
    .slice(1)
    .map((frame, index) => Math.max(1, (Date.parse(frame.createdAt!) - Date.parse(timed[index]!.createdAt!)) / 1000));
  if (!gaps.length) {
    return {
      clusters: clusterFromBoundaries(frames, [], [], new Map()),
      method: "single-shoot",
      diagnostics: { gapCount: 0 },
    };
  }

  const sensitivity = options.sensitivity || "balanced";
  const settings = {
    conservative: { posterior: 0.8, minimumGap: 2 * 3600, minimumBic: 6, minimumSpatialKm: 25 },
    balanced: { posterior: 0.5, minimumGap: 45 * 60, minimumBic: 2, minimumSpatialKm: 10 },
    detailed: { posterior: 0.25, minimumGap: 15 * 60, minimumBic: 0, minimumSpatialKm: 3 },
  }[sensitivity];
  const mixture = fitTwoGammaComponents(gaps);
  const boundaries = new Map<number, number>();
  const timeProbabilities = gaps.map(() => 0);
  let bicImprovement: number | undefined;
  let withinShootSeconds: number | undefined;
  let betweenShootSeconds: number | undefined;

  if (mixture) {
    const single = fitSingleGamma(gaps)!;
    const singleBic = -2 * single.logLikelihood + 2 * Math.log(gaps.length);
    const mixtureBic = -2 * mixture.logLikelihood + 4 * Math.log(gaps.length);
    bicImprovement = singleBic - mixtureBic;
    withinShootSeconds = mixture.means[0];
    betweenShootSeconds = mixture.means[1];
    const separated = betweenShootSeconds >= withinShootSeconds * 2.5 && bicImprovement >= settings.minimumBic;
    if (separated) {
      mixture.posteriors.forEach((probability, index) => {
        timeProbabilities[index] = probability;
      });
    }
  }

  const haversineKm = (left: FramesFrame, right: FramesFrame): number | undefined => {
    const leftLat = finiteNumber(left.latitude);
    const leftLon = finiteNumber(left.longitude);
    const rightLat = finiteNumber(right.latitude);
    const rightLon = finiteNumber(right.longitude);
    if (leftLat === undefined || leftLon === undefined || rightLat === undefined || rightLon === undefined)
      return undefined;
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = radians(rightLat - leftLat);
    const longitudeDelta = radians(rightLon - leftLon);
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(longitudeDelta / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  };
  const distances = timed.slice(1).map((frame, index) => haversineKm(timed[index]!, frame));
  const spatialProbabilities = gaps.map(() => 0);
  const located = distances.flatMap((distance, index) =>
    distance === undefined ? [] : [{ index, distance: Math.max(0.001, distance) }],
  );
  let spatialBicImprovement: number | undefined;
  let withinShootKm: number | undefined;
  let betweenShootKm: number | undefined;
  if (options.useLocation !== false && located.length >= 4) {
    const spatialValues = located.map(({ distance }) => distance);
    const spatialMixture = fitTwoGammaComponents(spatialValues);
    if (spatialMixture) {
      const single = fitSingleGamma(spatialValues)!;
      spatialBicImprovement =
        -2 * single.logLikelihood +
        2 * Math.log(spatialValues.length) -
        (-2 * spatialMixture.logLikelihood + 4 * Math.log(spatialValues.length));
      withinShootKm = spatialMixture.means[0];
      betweenShootKm = spatialMixture.means[1];
      if (betweenShootKm >= withinShootKm * 3 && spatialBicImprovement >= settings.minimumBic) {
        located.forEach(({ index }, mixtureIndex) => {
          spatialProbabilities[index] = spatialMixture.posteriors[mixtureIndex]!;
        });
      }
    }
  }

  gaps.forEach((gap, index) => {
    const distance = distances[index];
    let spatialProbability = spatialProbabilities[index]!;
    if (options.useLocation !== false && distance !== undefined && distance >= settings.minimumSpatialKm) {
      spatialProbability = Math.max(spatialProbability, distance >= 50 ? 0.95 : 0.75);
    }
    const probability = 1 - (1 - timeProbabilities[index]!) * (1 - spatialProbability);
    const hasTemporalSupport = gap >= settings.minimumGap;
    const hasSpatialSupport =
      options.useLocation !== false && distance !== undefined && distance >= settings.minimumSpatialKm;
    if (probability >= settings.posterior && (hasTemporalSupport || hasSpatialSupport))
      boundaries.set(index, probability);
  });

  let method: FrameClusteringResult["method"] = boundaries.size
    ? [...boundaries.keys()].some(
        (index) => spatialProbabilities[index]! > 0 || (distances[index] || 0) >= settings.minimumSpatialKm,
      )
      ? "spatiotemporal-gamma-mixture"
      : "gamma-gap-mixture"
    : "single-shoot";
  if (!boundaries.size) {
    const median = quantile(gaps, 0.5);
    gaps.forEach((gap, index) => {
      const absoluteMinimum =
        sensitivity === "conservative" ? 12 * 3600 : sensitivity === "detailed" ? 4 * 3600 : 6 * 3600;
      if (gap >= absoluteMinimum && (gaps.length === 1 || gap >= median * 6)) boundaries.set(index, 1);
    });
    if (boundaries.size) method = "sparse-gap-rule";
  }

  return {
    clusters: clusterFromBoundaries(frames, gaps, distances, boundaries),
    method,
    diagnostics: {
      gapCount: gaps.length,
      bicImprovement,
      withinShootSeconds,
      betweenShootSeconds,
      spatialGapCount: located.length,
      withinShootKm,
      betweenShootKm,
      ...(spatialBicImprovement === undefined ? {} : { spatialBicImprovement }),
    },
  };
}

export function formatFramesShutterSpeed(seconds: unknown): string | undefined {
  const value = finiteNumber(seconds);
  if (value === undefined || value <= 0) return undefined;
  if (value >= 1) return `${Number(value.toFixed(2))}s`;
  const denominator = Math.max(1, Math.round(1 / value));
  return `1/${denominator}`;
}

export function framesMeteringMode(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return (
    {
      1: "average",
      2: "center-weighted",
      3: "spot",
      4: "multi-spot",
      5: "matrix",
      6: "partial",
      255: "other",
    } as Record<number, string>
  )[Number(value)];
}

export function framesExposureProgram(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return (
    {
      1: "manual",
      2: "program",
      3: "aperture-priority",
      4: "shutter-priority",
      5: "creative",
      6: "action",
      7: "portrait",
      8: "landscape",
    } as Record<number, string>
  )[Number(value)];
}

export function framesLocation(frame: FramesFrame): Record<string, unknown> | undefined {
  const latitude = finiteNumber(frame.latitude);
  const longitude = finiteNumber(frame.longitude);
  if (latitude === undefined || longitude === undefined) return undefined;
  const placemarkSource = frame.placemark;
  const placemark = placemarkSource
    ? Object.fromEntries(
        ["name", "locality", "subLocality", "administrativeArea", "postalCode", "country", "isoCountryCode"]
          .map((key) => [key, optionalString(placemarkSource[key])])
          .filter(([, value]) => value),
      )
    : undefined;
  return {
    latitude: Math.round(latitude * 1e7),
    longitude: Math.round(longitude * 1e7),
    altitude: finiteNumber(frame.altitude) === undefined ? undefined : Math.round(finiteNumber(frame.altitude)! * 1000),
    capturedAt: frame.createdAt || undefined,
    placemark: placemark && Object.keys(placemark).length ? placemark : undefined,
  };
}
