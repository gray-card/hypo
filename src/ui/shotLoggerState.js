const STICKY_FIELDS = Object.freeze([
  "quick",
  "camera",
  "lens",
  "filter",
  "roll",
  "aperture",
  "shutter",
  "ev",
  "apertureStopFraction",
  "shutterStopFraction",
  "metering",
  "flash",
]);

export function shotLoggerStateKey(did, shootUri) {
  return `hypo:shot-logger:${did}:${shootUri}`;
}

export function loadShotLoggerState(did, shootUri, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(shotLoggerStateKey(did, shootUri)) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      STICKY_FIELDS.filter((field) => parsed[field] !== undefined).map((field) => [field, parsed[field]]),
    );
  } catch {
    return {};
  }
}

export function saveShotLoggerState(did, shootUri, state, storage = globalThis.localStorage) {
  const sticky = Object.fromEntries(
    STICKY_FIELDS.filter((field) => state[field] !== undefined).map((field) => [field, state[field]]),
  );
  try {
    storage?.setItem(shotLoggerStateKey(did, shootUri), JSON.stringify(sticky));
  } catch {
    // Field logging remains usable when storage is blocked or full.
  }
  return sticky;
}
