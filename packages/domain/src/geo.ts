const GEO_SCALE = 1e7;
const ALTITUDE_SCALE = 1000;

export interface GeographicCoordinates {
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  accuracy?: number | null;
}

export interface ScaledGeographicLocation {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  accuracy?: number;
  capturedAt?: string;
}

/** Convert browser coordinate units to the integer scales used by Graycard records. */
export function geoToScaled(coordinates: GeographicCoordinates = {}): ScaledGeographicLocation {
  const scaled: ScaledGeographicLocation = {};
  if (Number.isFinite(coordinates.latitude)) scaled.latitude = Math.round(coordinates.latitude! * GEO_SCALE);
  if (Number.isFinite(coordinates.longitude)) scaled.longitude = Math.round(coordinates.longitude! * GEO_SCALE);
  if (Number.isFinite(coordinates.altitude)) scaled.altitude = Math.round(coordinates.altitude! * ALTITUDE_SCALE);
  if (Number.isFinite(coordinates.accuracy)) scaled.accuracy = Math.round(coordinates.accuracy! * ALTITUDE_SCALE);
  return scaled;
}

export function withCapturedAt(
  coordinates: GeographicCoordinates,
  timestamp: number | string | Date,
): ScaledGeographicLocation {
  return { ...geoToScaled(coordinates), capturedAt: new Date(timestamp).toISOString() };
}
