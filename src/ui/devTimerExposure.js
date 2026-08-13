function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function measureNumber(measure) {
  if (!measure || typeof measure.value !== "number") return null;
  return measure.value / (measure.scale || 1);
}

function median(values) {
  const sorted = values
    .map(positive)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recordValue(record) {
  return record?.value || record?.record || record || {};
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function deriveExposureObservation({ store, rollUris = [], meterReadings = [] } = {}) {
  const wanted = new Set(rollUris);
  const rolls = (store?.instance?.filmRoll || []).filter((roll) => wanted.has(roll.uri));
  if (!rolls.length) return null;

  const stocks = rolls
    .map((roll) => (store?.catalog?.filmStock || []).find((stock) => stock.uri === roll.value.stock)?.value)
    .filter(Boolean);
  const boxValues = unique(stocks.map((stock) => positive(stock.iso)));
  const boxIso = boxValues.length === 1 ? boxValues[0] : null;
  const exposures = (store?.instance?.exposure || []).filter((exposure) => wanted.has(exposure.value.roll));
  const exposureUris = new Set(exposures.map((exposure) => exposure.uri));
  const linkedReadingUris = new Set(exposures.flatMap((exposure) => exposure.value.meterReadings || []));
  const linkedReadings = meterReadings.filter((reading) => {
    const value = recordValue(reading);
    return linkedReadingUris.has(reading.uri) || exposureUris.has(value.exposure);
  });

  const rollRatings = rolls.map((roll) => positive(roll.value.shotAtIso)).filter(Boolean);
  const exposureRatings = exposures.map((exposure) => positive(exposure.value.shotAtIso)).filter(Boolean);
  const readingRatings = linkedReadings.map((reading) => positive(recordValue(reading).iso)).filter(Boolean);
  const candidates = rollRatings.length ? rollRatings : exposureRatings.length ? exposureRatings : readingRatings;
  const observedIso = median(candidates);
  if (!observedIso) return null;
  const source = rollRatings.length
    ? "roll rating"
    : exposureRatings.length
      ? "logged exposure"
      : linkedReadings.length === 1
        ? "linked meter reading"
        : "linked meter readings";
  const stops = boxIso ? Math.round(Math.log2(observedIso / boxIso) * 3) / 3 : null;
  return {
    observedIso,
    boxIso,
    stops,
    source,
    sourceCount: candidates.length,
    linkedReadingCount: linkedReadings.length,
    rollCount: rolls.length,
  };
}

export function recipeExposureIndex(recipe, boxIso) {
  const explicit = positive(recipe?.ei);
  if (explicit) return explicit;
  const stops = measureNumber(recipe?.pushPull);
  return boxIso && stops != null ? boxIso * 2 ** stops : boxIso || null;
}

export function closestExposureRecipe(recipes, observation) {
  if (!observation?.observedIso) return null;
  return (
    [...recipes]
      .map((recipe) => ({
        recipe,
        ei: recipeExposureIndex(recipe, observation.boxIso),
      }))
      .filter((entry) => entry.ei)
      .sort(
        (left, right) =>
          Math.abs(Math.log2(left.ei / observation.observedIso)) -
          Math.abs(Math.log2(right.ei / observation.observedIso)),
      )[0]?.recipe || null
  );
}

function stopLabel(stops) {
  if (stops == null) return "box speed unavailable";
  if (Math.abs(stops) < 1 / 6) return "box speed";
  return `${stops > 0 ? "push" : "pull"} ${Number(Math.abs(stops).toFixed(2))} stop${Math.abs(stops) === 1 ? "" : "s"}`;
}

export function exposureSuggestionText(observation) {
  if (!observation) return "No roll exposure rating or attached meter-reading ISO is available.";
  const count = observation.sourceCount > 1 ? ` (${observation.sourceCount} values)` : "";
  const relative = observation.boxIso
    ? `${stopLabel(observation.stops)} relative to ISO ${observation.boxIso}`
    : stopLabel(null);
  return `Observed EI ${Math.round(observation.observedIso)} from ${observation.source}${count}; ${relative}.`;
}

export function selectedVsObservedText(observation, recipe) {
  if (!observation || !recipe) return null;
  const selectedEi = recipeExposureIndex(recipe, observation.boxIso);
  const selectedStops = selectedEi && observation.boxIso ? Math.log2(selectedEi / observation.boxIso) : null;
  return `${exposureSuggestionText(observation)} Selected recipe: ${selectedEi ? `EI ${Math.round(selectedEi)}, ${stopLabel(selectedStops)}` : "no stated EI"}.`;
}
