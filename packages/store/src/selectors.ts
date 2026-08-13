import type { StoredRecord } from "./collection.ts";

export interface ExposureValue {
  readonly shoot?: string;
  readonly roll?: string;
  readonly frameNumber?: number;
  readonly multipleExposure?: boolean;
  readonly frameExposureIndex?: number;
  readonly camera?: string;
  readonly lens?: string;
  readonly filter?: string;
  readonly takenAt?: string;
  readonly createdAt?: string;
  readonly [field: string]: unknown;
}

export type RecordSource<T> = Iterable<StoredRecord<T>> | ReadonlyMap<string, StoredRecord<T>>;

export interface FrameWithExposures<T extends ExposureValue = ExposureValue> {
  readonly roll: string;
  readonly frameNumber: number;
  readonly exposures: readonly StoredRecord<T>[];
}

export interface ShootValue {
  readonly cameras?: readonly string[];
  readonly lenses?: readonly string[];
  readonly rolls?: readonly string[];
  readonly filters?: readonly string[];
  readonly [field: string]: unknown;
}

export type ShootGearKind = "camera" | "lens" | "filmRoll" | "filter";

export interface GearInheritance {
  readonly explicit: readonly string[];
  /** Gear referenced by an exposure; these items cannot be removed from the shoot. */
  readonly inherited: readonly string[];
  readonly effective: readonly string[];
}

export type ShootGearInheritance = Readonly<Record<ShootGearKind, GearInheritance>>;

function sourceValues<T>(source: RecordSource<T>): Iterable<StoredRecord<T>> {
  return source instanceof Map ? source.values() : (source as Iterable<StoredRecord<T>>);
}

function exposureOrder<T extends ExposureValue>(left: StoredRecord<T>, right: StoredRecord<T>): number {
  return (
    (left.value.frameNumber ?? 0) - (right.value.frameNumber ?? 0) ||
    (left.value.frameExposureIndex ?? 0) - (right.value.frameExposureIndex ?? 0) ||
    (left.value.takenAt ?? left.value.createdAt ?? "").localeCompare(
      right.value.takenAt ?? right.value.createdAt ?? "",
    ) ||
    left.uri.localeCompare(right.uri)
  );
}

/** Index logged exposures by roll, with each roll's records in frame order. */
export function selectExposuresByRoll<T extends ExposureValue>(
  exposures: RecordSource<T>,
): ReadonlyMap<string, readonly StoredRecord<T>[]> {
  const result = new Map<string, StoredRecord<T>[]>();
  for (const exposure of sourceValues(exposures)) {
    const roll = exposure.value.roll;
    if (!roll) continue;
    const records = result.get(roll) ?? [];
    records.push(exposure);
    result.set(roll, records);
  }
  for (const records of result.values()) records.sort(exposureOrder);
  return result;
}

export const exposuresByRoll = selectExposuresByRoll;

/**
 * Group a roll's exposures into physical frames. Multiple-exposure records with
 * the same frame number remain distinct and are ordered by exposure index.
 */
export function selectFramesWithExposures<T extends ExposureValue>(
  exposures: RecordSource<T>,
  roll?: string,
): readonly FrameWithExposures<T>[] {
  const frames = new Map<string, { roll: string; frameNumber: number; exposures: StoredRecord<T>[] }>();
  for (const exposure of sourceValues(exposures)) {
    const exposureRoll = exposure.value.roll;
    const frameNumber = exposure.value.frameNumber;
    if (!exposureRoll || !Number.isFinite(frameNumber) || (roll && exposureRoll !== roll)) continue;
    const key = `${exposureRoll}\u0000${String(frameNumber)}`;
    const frame = frames.get(key) ?? { roll: exposureRoll, frameNumber: frameNumber!, exposures: [] };
    frame.exposures.push(exposure);
    frames.set(key, frame);
  }

  return [...frames.values()]
    .sort((left, right) => left.roll.localeCompare(right.roll) || left.frameNumber - right.frameNumber)
    .map((frame) => ({
      roll: frame.roll,
      frameNumber: frame.frameNumber,
      exposures: frame.exposures.sort(exposureOrder),
    }));
}

export const framesWithExposures = selectFramesWithExposures;

export function selectRollsWithFrames<R, E extends ExposureValue>(
  rolls: RecordSource<R>,
  exposures: RecordSource<E>,
): readonly (StoredRecord<R> & { readonly frames: readonly FrameWithExposures<E>[] })[] {
  const frames = selectFramesWithExposures(exposures);
  const byRoll = new Map<string, FrameWithExposures<E>[]>();
  for (const frame of frames) {
    const rollFrames = byRoll.get(frame.roll) ?? [];
    rollFrames.push(frame);
    byRoll.set(frame.roll, rollFrames);
  }
  return [...sourceValues(rolls)].map((record) => ({
    ...record,
    frames: byRoll.get(record.uri) ?? [],
  }));
}

function unique(values: Iterable<string | undefined>): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function inheritance(explicit: Iterable<string | undefined>, inherited: Iterable<string | undefined>): GearInheritance {
  return {
    explicit: unique(explicit),
    inherited: unique(inherited),
    effective: unique([...explicit, ...inherited]),
  };
}

/** Derive explicit, inherited, and effective gear for one capture session. */
export function selectShootGearInheritance<S extends ShootValue, E extends ExposureValue>(
  shoot: StoredRecord<S>,
  exposures: RecordSource<E>,
): ShootGearInheritance {
  const shootExposures = [...sourceValues(exposures)].filter((exposure) => exposure.value.shoot === shoot.uri);
  return {
    camera: inheritance(
      shoot.value.cameras ?? [],
      shootExposures.map((exposure) => exposure.value.camera),
    ),
    lens: inheritance(
      shoot.value.lenses ?? [],
      shootExposures.map((exposure) => exposure.value.lens),
    ),
    filmRoll: inheritance(
      shoot.value.rolls ?? [],
      shootExposures.map((exposure) => exposure.value.roll),
    ),
    filter: inheritance(
      shoot.value.filters ?? [],
      shootExposures.map((exposure) => exposure.value.filter),
    ),
  };
}

export const shootGearInheritance = selectShootGearInheritance;

export function selectEffectiveShootGear<S extends ShootValue, E extends ExposureValue>(
  shoot: StoredRecord<S>,
  exposures: RecordSource<E>,
  kind: ShootGearKind,
): readonly string[] {
  return selectShootGearInheritance(shoot, exposures)[kind].effective;
}
