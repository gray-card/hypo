// devRecipes.js: lookup over the development-time catalog shard (built from
// manufacturer datasheets). The pure lookup helpers operate over one stable
// array; loadDevRecipes fills that array lazily without invalidating references.
//
// Policy: datasheet-only. A time is returned only for a temperature the datasheet
// supports — an exact published point, or an interior point when the recipe
// explicitly permits interpolation. We never extrapolate outside the published
// range (returns null → "log your own").

import { getDefaultCatalogClient } from "@hypo/catalog";
import {
  listFilms as listRecipeFilms,
  recipesForFilm as filterRecipesForFilm,
  searchFilms as searchRecipeFilms,
} from "@hypo/domain";

export {
  c10ToC,
  cToC10,
  estimateGeneralBWTemperatureTime,
  fmtMMSS,
  GENERAL_BW_MINIMUM_TIME_SEC,
  GENERAL_BW_ROUNDING_INCREMENT_SEC,
  GENERAL_BW_TEMPERATURE_RANGE_C10,
  parseMMSS,
  publishedTemps,
  recipeLabel,
  recipeRecommendationStatus,
  resolveTimeRecommendation,
  resolveTimeSec,
} from "@hypo/domain";

const RECIPES = [];
const loadState = { status: "idle", error: null, promise: null };

export function devRecipesStatus() {
  return { status: loadState.status, error: loadState.error };
}

/** Fetch and cache the content-addressed development-time shard once. */
export async function loadDevRecipes(options = {}) {
  if (loadState.status === "ready" && !options.refresh) return RECIPES;
  if (!loadState.promise) {
    loadState.status = "loading";
    loadState.error = null;
    const client = options.client || getDefaultCatalogClient();
    loadState.promise = client
      .getDomain("dev-times")
      .then((items) => {
        RECIPES.splice(0, RECIPES.length, ...items.map(({ catalogKind: _catalogKind, ...recipe }) => recipe));
        loadState.status = "ready";
        return RECIPES;
      })
      .catch((error) => {
        loadState.status = "error";
        loadState.error = error;
        throw error;
      })
      .finally(() => {
        loadState.promise = null;
      });
  }
  return loadState.promise;
}

// Direct helper tests remain synchronous. Vite removes this test-only import
// from production, where recipes are available solely through the shard.
if (import.meta.env.MODE === "test") {
  const fixture = await import("./data/curated-dev-times.json");
  RECIPES.push(...(fixture.default.recipes || []));
  loadState.status = "ready";
}

export function allRecipes() {
  return RECIPES;
}

// distinct films present in the database, as { make, name, key, count }.
export function listFilms() {
  return listRecipeFilms(RECIPES);
}

// every recipe for a given film (by make+name), grouped nothing — raw list.
export function recipesForFilm(make, name) {
  return filterRecipesForFilm(RECIPES, make, name);
}

// fuzzy film search for the picker.
export function searchFilms(query, limit = 40) {
  return searchRecipeFilms(RECIPES, query, limit);
}
