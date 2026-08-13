// Browser compatibility facade for the pure geolocation conversion in @hypo/domain.

import { withCapturedAt } from "@hypo/domain";

// capture the current device location via the browser Geolocation API. Resolves
// to a scaled geoLocation object ready to store on an exposure, or rejects with
// a human-readable reason. Never throws synchronously.
export function captureGeolocation({ timeout = 15000, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location isn't available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = pos.coords || {};
        resolve(
          withCapturedAt(
            {
              latitude: c.latitude,
              longitude: c.longitude,
              altitude: Number.isFinite(c.altitude) ? c.altitude : undefined,
              accuracy: Number.isFinite(c.accuracy) ? c.accuracy : undefined,
            },
            pos.timestamp || Date.now(),
          ),
        );
      },
      (err) => reject(new Error(err?.message || "Couldn't get a location fix.")),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 10000 },
    );
  });
}
