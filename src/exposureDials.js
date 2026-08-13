// Compatibility facade. The strict implementation lives in @hypo/domain.
export {
  APERTURE_SCALE,
  SHUTTER_SCALE,
  STOP_FRACTIONS,
  buildApertureOptions,
  buildShutterOptions,
  displayToShutterScaled,
  formatScaledList,
  parseScaledList,
  scaledApertureToDial,
  scaledShutterToDial,
  shutterLabelToSeconds,
  shutterScaledToDisplay,
  stopFractionDenom,
  usesExactApertureSteps,
  usesExactShutterSteps,
} from "@hypo/domain";
