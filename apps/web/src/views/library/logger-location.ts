import type { LoggerValue } from "./logger-types.ts";

export interface LoggerLocationTracker {
  readonly value: LoggerValue | null;
  start(): void;
  stop(): void;
  clear(): void;
  syncPill(): void;
}

/** Own the optional geolocation watch used by the shot logger. */
export function createLoggerLocationTracker(enabled: () => boolean, pill: HTMLSpanElement): LoggerLocationTracker {
  let value: LoggerValue | null = null;
  let watchId: number | null = null;

  const syncPill = () => {
    pill.classList.toggle("hidden", !enabled());
    pill.textContent = !enabled()
      ? ""
      : value
        ? `GPS ±${Math.round(((value.accuracy as number | undefined) || 0) / 1000)}m`
        : "GPS…";
    pill.classList.toggle("ok", Boolean(value));
  };

  const stop = () => {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  };

  return {
    get value() {
      return value;
    },
    start() {
      if (!enabled() || watchId != null || typeof navigator === "undefined" || !navigator.geolocation) return;
      try {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            value = {
              latitude: Math.round(position.coords.latitude * 1e7),
              longitude: Math.round(position.coords.longitude * 1e7),
              altitude: Number.isFinite(position.coords.altitude)
                ? Math.round(position.coords.altitude! * 1000)
                : undefined,
              accuracy: Number.isFinite(position.coords.accuracy)
                ? Math.round(position.coords.accuracy * 1000)
                : undefined,
              capturedAt: new Date().toISOString(),
            };
            syncPill();
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 10_000 },
        );
      } catch {
        // Logging remains available when geolocation is unavailable.
      }
    },
    stop,
    clear() {
      value = null;
    },
    syncPill,
  };
}
