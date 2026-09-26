export interface DevelopmentTimePoint {
  tempC10: number;
  timeSec: number;
  [key: string]: unknown;
}

export interface DevelopmentRecipe {
  filmMake?: string | null;
  filmName?: string | null;
  developerMake?: string | null;
  developerName?: string | null;
  dilution?: string | null;
  ei?: number | null;
  temps?: readonly DevelopmentTimePoint[];
  derived?: boolean;
  recommendationStatus?: string | null;
  interpolationAllowed?: boolean;
  interpolationMethod?: string | null;
  [key: string]: unknown;
}

export interface FilmRecipeSummary {
  make: string;
  name: string;
  key: string;
  count: number;
}

export interface TimeRecommendation {
  timeSec: number;
  tempC10: number;
  kind: "published" | "interpolated";
  derived: boolean;
  recommendationStatus: string;
  interpolationMethod?: string;
  points: DevelopmentTimePoint[];
}

export interface GeneralTemperatureEstimate {
  timeSec: number;
  unroundedTimeSec: number;
  referenceTimeSec: number;
  referenceTempC10: number;
  targetTempC10: number;
  roundingIncrementSec: number;
  belowRecommendedMinimum: boolean;
  largeTemperatureChange: boolean;
}

export const GENERAL_BW_TEMPERATURE_RANGE_C10 = { minimum: 180, maximum: 270 } as const;
export const GENERAL_BW_MINIMUM_TIME_SEC = 5 * 60;
export const GENERAL_BW_ROUNDING_INCREMENT_SEC = 15;

/**
 * Estimate a black-and-white development time using the 10%-per-degree relation
 * represented by Ilford's general 18–27 °C compensation chart.
 *
 * This is deliberately separate from recipe recommendations: it is an approximate
 * fallback, rounded to the chart's 15-second resolution, and never treated as a
 * manufacturer-published value for a particular film/developer combination.
 */
export function estimateGeneralBWTemperatureTime(
  referenceTimeSec: number,
  referenceTempC10: number,
  targetTempC10: number,
): GeneralTemperatureEstimate | null {
  const values = [referenceTimeSec, referenceTempC10, targetTempC10];
  if (!values.every(Number.isFinite) || referenceTimeSec <= 0) return null;
  const { minimum, maximum } = GENERAL_BW_TEMPERATURE_RANGE_C10;
  if (referenceTempC10 < minimum || referenceTempC10 > maximum) return null;
  if (targetTempC10 < minimum || targetTempC10 > maximum) return null;

  const temperatureDifferenceCelsius = (referenceTempC10 - targetTempC10) / 10;
  const unroundedTimeSec = referenceTimeSec * 1.1 ** temperatureDifferenceCelsius;
  const timeSec = Math.max(
    GENERAL_BW_ROUNDING_INCREMENT_SEC,
    Math.round(unroundedTimeSec / GENERAL_BW_ROUNDING_INCREMENT_SEC) * GENERAL_BW_ROUNDING_INCREMENT_SEC,
  );
  return {
    timeSec,
    unroundedTimeSec,
    referenceTimeSec,
    referenceTempC10,
    targetTempC10,
    roundingIncrementSec: GENERAL_BW_ROUNDING_INCREMENT_SEC,
    belowRecommendedMinimum: timeSec < GENERAL_BW_MINIMUM_TIME_SEC,
    largeTemperatureChange: Math.abs(targetTempC10 - referenceTempC10) >= 40,
  };
}

function normalize(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Return the distinct films represented by a development-recipe collection. */
export function listFilms(recipes: readonly DevelopmentRecipe[]): FilmRecipeSummary[] {
  const byKey = new Map<string, FilmRecipeSummary>();
  for (const recipe of recipes) {
    const make = recipe.filmMake as string;
    const name = recipe.filmName as string;
    const key = `${make}␟${name}`;
    const entry = byKey.get(key) || { make, name, key, count: 0 };
    entry.count += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort(
    (left, right) => left.make.localeCompare(right.make) || left.name.localeCompare(right.name),
  );
}

export function recipesForFilm(recipes: readonly DevelopmentRecipe[], make: string, name: string): DevelopmentRecipe[] {
  return recipes.filter(
    (recipe) => normalize(recipe.filmMake) === normalize(make) && normalize(recipe.filmName) === normalize(name),
  );
}

export function searchFilms(
  recipes: readonly DevelopmentRecipe[],
  query: string | null | undefined,
  limit = 40,
): FilmRecipeSummary[] {
  const normalizedQuery = normalize(query);
  const films = listFilms(recipes);
  if (!normalizedQuery) return films.slice(0, limit);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return films
    .map((film) => ({ film, haystack: normalize(`${film.make} ${film.name}`) }))
    .filter(({ haystack }) => tokens.every((token) => haystack.includes(token)))
    .slice(0, limit)
    .map(({ film }) => film);
}

export function recipeLabel(recipe: DevelopmentRecipe): string {
  const developer = [recipe.developerMake, recipe.developerName].filter(Boolean).join(" ");
  const dilution =
    recipe.dilution && recipe.dilution !== "stock"
      ? ` ${recipe.dilution}`
      : recipe.dilution === "stock"
        ? " (stock)"
        : "";
  const exposureIndex = recipe.ei ? ` · EI ${recipe.ei}` : "";
  return `${developer}${dilution}${exposureIndex}`;
}

export function publishedTemps(recipe: DevelopmentRecipe): number[] {
  return [...(recipe.temps || [])].map((point) => point.tempC10).sort((left, right) => left - right);
}

/** Resolve a datasheet recommendation without extrapolating beyond published points. */
export function resolveTimeRecommendation(recipe: DevelopmentRecipe, targetC10: number): TimeRecommendation | null {
  const points = [...(recipe.temps || [])].sort((left, right) => left.tempC10 - right.tempC10);
  if (!points.length) return null;
  for (const point of points) {
    if (point.tempC10 === targetC10) {
      const derived = recipe.derived === true;
      return {
        timeSec: point.timeSec,
        tempC10: point.tempC10,
        kind: "published",
        derived,
        recommendationStatus: derived ? "derived" : recipe.recommendationStatus || "unknown",
        points: [point],
      };
    }
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (targetC10 < first.tempC10 || targetC10 > last.tempC10) return null;
  if (recipe.interpolationAllowed !== true) return null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const lower = points[index];
    const upper = points[index + 1];
    if (targetC10 > lower.tempC10 && targetC10 < upper.tempC10 && upper.tempC10 !== lower.tempC10) {
      const fraction = (targetC10 - lower.tempC10) / (upper.tempC10 - lower.tempC10);
      const interpolated =
        recipe.interpolationMethod === "log-time-linear" && lower.timeSec > 0 && upper.timeSec > 0
          ? Math.exp(Math.log(lower.timeSec) + fraction * (Math.log(upper.timeSec) - Math.log(lower.timeSec)))
          : lower.timeSec + fraction * (upper.timeSec - lower.timeSec);
      return {
        timeSec: Math.round(interpolated),
        tempC10: targetC10,
        kind: "interpolated",
        derived: true,
        recommendationStatus: "derived",
        interpolationMethod: recipe.interpolationMethod || "linear",
        points: [lower, upper],
      };
    }
  }
  return null;
}

export function resolveTimeSec(recipe: DevelopmentRecipe, targetC10: number): number | null {
  return resolveTimeRecommendation(recipe, targetC10)?.timeSec ?? null;
}

export function recipeRecommendationStatus(recipe: DevelopmentRecipe | null | undefined): string {
  return recipe?.derived === true ? "derived" : recipe?.recommendationStatus || "unknown";
}

export const c10ToC = (c10: number): number => c10 / 10;
export const cToC10 = (celsius: number): number => Math.round(celsius * 10);

export function fmtMMSS(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function parseMMSS(value: string | null | undefined): number | null {
  const normalized = (value || "").trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return parseInt(normalized, 10);
  const match = normalized.match(/^(\d+):([0-5]?\d)$/);
  return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : null;
}
