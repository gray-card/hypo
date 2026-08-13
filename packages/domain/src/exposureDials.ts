const SCALE = 1_000_000;

export interface LensExposureLimits {
  apertureSteps?: readonly number[];
  maxAperture?: number | null;
  minAperture?: number | null;
  apertureStopIncrement?: string | null;
}

export interface CameraExposureLimits {
  shutterSpeedSteps?: readonly number[];
  minShutterSpeed?: number | null;
  maxShutterSpeed?: number | null;
  shutterStopIncrement?: string | null;
}

export const APERTURE_SCALE = [
  "1",
  "1.2",
  "1.4",
  "1.7",
  "2",
  "2.4",
  "2.8",
  "3.4",
  "4",
  "4.8",
  "5.6",
  "6.7",
  "8",
  "9.5",
  "11",
  "13",
  "16",
  "19",
  "22",
  "27",
  "32",
  "45",
  "64",
];

export const SHUTTER_SCALE = [
  "B",
  "30s",
  "15s",
  "8s",
  "4s",
  "2s",
  "1s",
  "1/2",
  "1/4",
  "1/8",
  "1/15",
  "1/30",
  "1/60",
  "1/125",
  "1/250",
  "1/500",
  "1/1000",
  "1/2000",
  "1/4000",
  "1/8000",
];

export const STOP_FRACTIONS = ["1", "1/2", "1/3"];

export function stopFractionDenom(stopFraction: string): number {
  if (stopFraction === "1/2") return 2;
  if (stopFraction === "1/3") return 3;
  return 1;
}

export function scaledApertureToDial(value: number | null | undefined): string | null {
  if (value == null) return null;
  const aperture = value / SCALE;
  const rounded = Math.round(aperture * 10) / 10;
  return String(rounded);
}

export function scaledShutterToDial(value: number | null | undefined): string | null {
  if (value == null) return null;
  const seconds = value / SCALE;
  if (seconds <= 0) return null;
  if (seconds < 1) return `1/${Math.round(1 / seconds)}`;
  const rounded = Number.isInteger(seconds) ? seconds : +seconds.toFixed(1);
  return `${rounded}s`;
}

export function shutterScaledToDisplay(value: number | null | undefined): string {
  return scaledShutterToDial(value) || "";
}

export function displayToShutterScaled(text: unknown): number | null {
  const normalized = String(text).trim();
  if (!normalized || normalized === "B") return null;
  let seconds: number;
  if (normalized.endsWith("s")) seconds = parseFloat(normalized.slice(0, -1));
  else if (normalized.startsWith("1/")) seconds = 1 / parseFloat(normalized.slice(2));
  else {
    const value = parseFloat(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    seconds = value;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * SCALE);
}

function parseApertureLabel(label: string): number {
  return parseFloat(label);
}

export function shutterLabelToSeconds(label: string): number | null {
  if (label === "B") return Infinity;
  if (label.endsWith("s")) return parseFloat(label.slice(0, -1));
  if (label.startsWith("1/")) return 1 / parseFloat(label.slice(2));
  const value = parseFloat(label);
  return Number.isFinite(value) ? value : null;
}

function isOnStopFraction(fNumber: number, denominator: number): boolean {
  const stops = Math.log2(fNumber * fNumber);
  return Math.abs(stops * denominator - Math.round(stops * denominator)) < 0.06;
}

function filterApertureScale(
  scale: readonly string[],
  wide: number | null,
  stopped: number | null,
  stopFraction: string,
): string[] {
  const denominator = stopFractionDenom(stopFraction);
  return scale.filter((label) => {
    const aperture = parseApertureLabel(label);
    if (!Number.isFinite(aperture)) return false;
    if (wide != null && aperture < wide - 1e-6) return false;
    if (stopped != null && aperture > stopped + 1e-6) return false;
    return isOnStopFraction(aperture, denominator);
  });
}

function generateApertureFromRange(wide: number | null, stopped: number | null, stopFraction: string): string[] {
  const denominator = stopFractionDenom(stopFraction);
  const step = Math.pow(Math.sqrt(2), 1 / denominator);
  const low = wide ?? 1;
  const high = stopped ?? 64;
  const options: string[] = [];
  const seen = new Set<string>();
  for (let aperture = low; aperture <= high + 1e-6; aperture *= step) {
    const label = scaledApertureToDial(Math.round(aperture * SCALE));
    if (label && !seen.has(label)) {
      seen.add(label);
      options.push(label);
    }
  }
  return options;
}

function filterShutterScale(
  scale: string[],
  minSeconds: number | null,
  maxSeconds: number | null,
  stopFraction: string,
  { allowBulb = true }: { allowBulb?: boolean } = {},
): string[] {
  const denominator = stopFractionDenom(stopFraction);
  const filtered = scale.filter((label) => {
    const seconds = shutterLabelToSeconds(label);
    if (seconds == null) return false;
    if (label === "B") return allowBulb && (maxSeconds == null || maxSeconds >= 1);
    if (minSeconds != null && seconds < minSeconds - 1e-9) return false;
    if (maxSeconds != null && seconds > maxSeconds + 1e-9) return false;
    if (denominator === 3) return true;
    const stops = Math.log2(seconds);
    return Math.abs(stops * denominator - Math.round(stops * denominator)) < 0.06;
  });
  return filtered.length ? filtered : scale;
}

function generateShutterFromRange(
  minSeconds: number | null,
  maxSeconds: number | null,
  stopFraction: string,
): string[] {
  const denominator = stopFractionDenom(stopFraction);
  const step = Math.pow(2, 1 / denominator);
  const low = minSeconds ?? 1 / 8000;
  const high = maxSeconds ?? 30;
  const options: string[] = [];
  const seen = new Set<string>();
  for (let seconds = high; seconds >= low - 1e-12; seconds /= step) {
    const label = scaledShutterToDial(Math.round(seconds * SCALE));
    if (label && !seen.has(label)) {
      seen.add(label);
      options.push(label);
    }
  }
  if ((maxSeconds == null || maxSeconds >= 1) && !seen.has("B")) options.unshift("B");
  return options;
}

export function buildApertureOptions(
  lensType: LensExposureLimits | null | undefined,
  userStopFraction = "1/3",
): string[] {
  if (lensType?.apertureSteps?.length) {
    return lensType.apertureSteps.map(scaledApertureToDial).filter((label): label is string => Boolean(label));
  }
  const wide = lensType?.maxAperture != null ? lensType.maxAperture / SCALE : null;
  const stopped = lensType?.minAperture != null ? lensType.minAperture / SCALE : null;
  const stopFraction = lensType?.apertureStopIncrement || userStopFraction;
  const fromScale = filterApertureScale(APERTURE_SCALE, wide, stopped, stopFraction);
  if (fromScale.length) return fromScale;
  return generateApertureFromRange(wide, stopped, stopFraction);
}

export function buildShutterOptions(
  cameraType: CameraExposureLimits | null | undefined,
  userStopFraction = "1/3",
): string[] {
  if (cameraType?.shutterSpeedSteps?.length) {
    const steps = cameraType.shutterSpeedSteps
      .map(scaledShutterToDial)
      .filter((label): label is string => Boolean(label));
    return steps.length ? steps : SHUTTER_SCALE;
  }
  const minSeconds = cameraType?.minShutterSpeed != null ? cameraType.minShutterSpeed / SCALE : null;
  const maxSeconds = cameraType?.maxShutterSpeed != null ? cameraType.maxShutterSpeed / SCALE : null;
  const stopFraction = cameraType?.shutterStopIncrement || userStopFraction;
  const allowBulb = maxSeconds == null || maxSeconds >= 1;
  const fromScale = filterShutterScale(SHUTTER_SCALE, minSeconds, maxSeconds, stopFraction, { allowBulb });
  if (fromScale.length) return fromScale;
  return generateShutterFromRange(minSeconds, maxSeconds, stopFraction);
}

export function usesExactApertureSteps(lensType: LensExposureLimits | null | undefined): boolean {
  return Boolean(lensType?.apertureSteps?.length);
}

export function usesExactShutterSteps(cameraType: CameraExposureLimits | null | undefined): boolean {
  return Boolean(cameraType?.shutterSpeedSteps?.length);
}

export function parseScaledList(text: unknown, toScaled: (text: string) => number | null | undefined): number[] {
  return String(text)
    .split(",")
    .map((part) => toScaled(part.trim()))
    .filter((value): value is number => value != null);
}

export function formatScaledList<T>(
  values: readonly T[] | null | undefined,
  toDisplay: (value: T) => string | null | undefined,
): string {
  return (values || []).map(toDisplay).filter(Boolean).join(", ");
}
