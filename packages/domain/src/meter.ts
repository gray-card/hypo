export const DEFAULT_REFLECTED_K = 12.5;
export const DEFAULT_INCIDENT_C_FLAT = 250;
export const DEFAULT_INCIDENT_C_DOME = 330;
export const LUX_PER_FOOT_CANDLE = 10.7639104167;
export const CANDELA_PER_SQUARE_METRE_PER_FOOT_LAMBERT = 3.4262590996;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

/** EV normalized to ISO 100 for an exposure solution. */
export function ev100FromExposure(aperture: number, shutterSeconds: number, iso = 100): number {
  positive(aperture, "aperture");
  positive(shutterSeconds, "shutterSeconds");
  positive(iso, "iso");
  return Math.log2((aperture * aperture) / shutterSeconds) - Math.log2(iso / 100);
}

export function shutterForEv100(ev100: number, aperture: number, iso = 100): number {
  positive(aperture, "aperture");
  positive(iso, "iso");
  return (aperture * aperture) / 2 ** (ev100 + Math.log2(iso / 100));
}

export function apertureForEv100(ev100: number, shutterSeconds: number, iso = 100): number {
  positive(shutterSeconds, "shutterSeconds");
  positive(iso, "iso");
  return Math.sqrt(shutterSeconds * 2 ** (ev100 + Math.log2(iso / 100)));
}

/** ISO 2720 incident-light conversion using the selected C constant. */
export function ev100FromLux(lux: number, constantC = DEFAULT_INCIDENT_C_FLAT): number {
  positive(lux, "lux");
  positive(constantC, "constantC");
  return Math.log2((lux * 100) / constantC);
}

export function luxFromEv100(ev100: number, constantC = DEFAULT_INCIDENT_C_FLAT): number {
  positive(constantC, "constantC");
  return (constantC / 100) * 2 ** ev100;
}

/** ISO 2720 reflected-light conversion using the selected K constant. */
export function ev100FromLuminance(luminanceCdM2: number, constantK = DEFAULT_REFLECTED_K): number {
  positive(luminanceCdM2, "luminanceCdM2");
  positive(constantK, "constantK");
  return Math.log2((luminanceCdM2 * 100) / constantK);
}

export function luminanceFromEv100(ev100: number, constantK = DEFAULT_REFLECTED_K): number {
  positive(constantK, "constantK");
  return (constantK / 100) * 2 ** ev100;
}

export const luxToFootCandles = (lux: number): number => lux / LUX_PER_FOOT_CANDLE;
export const footCandlesToLux = (footCandles: number): number => footCandles * LUX_PER_FOOT_CANDLE;
export const luminanceToFootLamberts = (luminanceCdM2: number): number =>
  luminanceCdM2 / CANDELA_PER_SQUARE_METRE_PER_FOOT_LAMBERT;
export const footLambertsToLuminance = (footLamberts: number): number =>
  footLamberts * CANDELA_PER_SQUARE_METRE_PER_FOOT_LAMBERT;

export function cineShutterSeconds(frameRate: number, shutterAngle: number): number {
  positive(frameRate, "frameRate");
  positive(shutterAngle, "shutterAngle");
  if (shutterAngle > 360) throw new RangeError("shutterAngle cannot exceed 360 degrees");
  return shutterAngle / (360 * frameRate);
}

export function stopDifference(left: number, right: number): number {
  positive(left, "left");
  positive(right, "right");
  return Math.log2(left / right);
}
