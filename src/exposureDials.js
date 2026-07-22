// Aperture and shutter dial scales for the shot logger, with gear-constrained option builders.

const SCALE = 1_000_000;

export const APERTURE_SCALE = ["1", "1.2", "1.4", "1.7", "2", "2.4", "2.8", "3.4", "4", "4.8", "5.6", "6.7", "8", "9.5", "11", "13", "16", "19", "22", "27", "32", "45", "64"];
export const SHUTTER_SCALE = ["B", "30s", "15s", "8s", "4s", "2s", "1s", "1/2", "1/4", "1/8", "1/15", "1/30", "1/60", "1/125", "1/250", "1/500", "1/1000", "1/2000", "1/4000", "1/8000"];
export const STOP_FRACTIONS = ["1", "1/2", "1/3"];

export function stopFractionDenom(stopFraction) {
  if (stopFraction === "1/2") return 2;
  if (stopFraction === "1/3") return 3;
  return 1;
}

export function scaledApertureToDial(n) {
  if (n == null) return null;
  const a = n / SCALE;
  const rounded = Math.round(a * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function scaledShutterToDial(n) {
  if (n == null) return null;
  const s = n / SCALE;
  if (s <= 0) return null;
  if (s < 1) return `1/${Math.round(1 / s)}`;
  const rounded = Number.isInteger(s) ? s : +s.toFixed(1);
  return `${rounded}s`;
}

export function shutterScaledToDisplay(n) {
  return scaledShutterToDial(n) || "";
}

export function displayToShutterScaled(text) {
  const t = String(text).trim();
  if (!t || t === "B") return null;
  let seconds;
  if (t.endsWith("s")) seconds = parseFloat(t.slice(0, -1));
  else if (t.startsWith("1/")) seconds = 1 / parseFloat(t.slice(2));
  else {
    const v = parseFloat(t);
    if (!Number.isFinite(v) || v <= 0) return null;
    seconds = v;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * SCALE);
}

function parseApertureLabel(label) {
  return parseFloat(label);
}

export function shutterLabelToSeconds(label) {
  if (label === "B") return Infinity;
  if (label.endsWith("s")) return parseFloat(label.slice(0, -1));
  if (label.startsWith("1/")) return 1 / parseFloat(label.slice(2));
  const v = parseFloat(label);
  return Number.isFinite(v) ? v : null;
}

function isOnStopFraction(fNumber, denom) {
  const k = Math.log2(fNumber * fNumber);
  const steps = denom;
  return Math.abs(k * steps - Math.round(k * steps)) < 0.06;
}

function filterApertureScale(scale, wide, stopped, stopFraction) {
  const denom = stopFractionDenom(stopFraction);
  return scale.filter((label) => {
    const f = parseApertureLabel(label);
    if (!Number.isFinite(f)) return false;
    if (wide != null && f < wide - 1e-6) return false;
    if (stopped != null && f > stopped + 1e-6) return false;
    return isOnStopFraction(f, denom);
  });
}

function generateApertureFromRange(wide, stopped, stopFraction) {
  const denom = stopFractionDenom(stopFraction);
  const step = Math.pow(Math.sqrt(2), 1 / denom);
  const lo = wide ?? 1;
  const hi = stopped ?? 64;
  const out = [];
  const seen = new Set();
  for (let f = lo; f <= hi + 1e-6; f *= step) {
    const label = scaledApertureToDial(Math.round(f * SCALE));
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function filterShutterScale(scale, minSeconds, maxSeconds, stopFraction, { allowBulb = true } = {}) {
  const denom = stopFractionDenom(stopFraction);
  const filtered = scale.filter((label) => {
    const seconds = shutterLabelToSeconds(label);
    if (seconds == null) return false;
    if (label === "B") return allowBulb && (maxSeconds == null || maxSeconds >= 1);
    if (minSeconds != null && seconds < minSeconds - 1e-9) return false;
    if (maxSeconds != null && seconds > maxSeconds + 1e-9) return false;
    if (denom === 3) return true;
    const k = Math.log2(seconds);
    return Math.abs(k * denom - Math.round(k * denom)) < 0.06;
  });
  return filtered.length ? filtered : scale;
}

function generateShutterFromRange(minSeconds, maxSeconds, stopFraction) {
  const denom = stopFractionDenom(stopFraction);
  const step = Math.pow(2, 1 / denom);
  const lo = minSeconds ?? 1 / 8000;
  const hi = maxSeconds ?? 30;
  const out = [];
  const seen = new Set();
  for (let s = hi; s >= lo - 1e-12; s /= step) {
    const label = scaledShutterToDial(Math.round(s * SCALE));
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  if ((maxSeconds == null || maxSeconds >= 1) && !seen.has("B")) out.unshift("B");
  return out;
}

export function buildApertureOptions(lensType, userStopFraction = "1/3") {
  if (lensType?.apertureSteps?.length) {
    return lensType.apertureSteps.map(scaledApertureToDial).filter(Boolean);
  }
  const wide = lensType?.maxAperture != null ? lensType.maxAperture / SCALE : null;
  const stopped = lensType?.minAperture != null ? lensType.minAperture / SCALE : null;
  const stopFraction = lensType?.apertureStopIncrement || userStopFraction;
  const fromScale = filterApertureScale(APERTURE_SCALE, wide, stopped, stopFraction);
  if (fromScale.length) return fromScale;
  return generateApertureFromRange(wide, stopped, stopFraction);
}

export function buildShutterOptions(cameraType, userStopFraction = "1/3") {
  if (cameraType?.shutterSpeedSteps?.length) {
    const steps = cameraType.shutterSpeedSteps.map(scaledShutterToDial).filter(Boolean);
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

export function usesExactApertureSteps(lensType) {
  return Boolean(lensType?.apertureSteps?.length);
}

export function usesExactShutterSteps(cameraType) {
  return Boolean(cameraType?.shutterSpeedSteps?.length);
}

export function parseScaledList(text, toScaled) {
  return String(text)
    .split(",")
    .map((part) => toScaled(part.trim()))
    .filter((n) => n != null);
}

export function formatScaledList(values, toDisplay) {
  return (values || []).map(toDisplay).filter(Boolean).join(", ");
}
