import type { CatalogDomain, CatalogItem, CatalogSearchResult } from "./types.ts";

const LABEL_PAIRS = [
  ["make", "model"],
  ["brand", "name"],
  ["developerMake", "developerName"],
  ["filmMake", "filmName"],
] as const;

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function catalogItemLabel(item: CatalogItem): string {
  for (const [left, right] of LABEL_PAIRS) {
    const parts = [item[left], item[right]].filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    );
    if (parts.length === 2) return parts.join(" ");
  }
  for (const key of ["name", "model", "title", "label"]) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "Catalog item";
}

function scalarStrings(value: unknown, depth = 0): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (depth >= 2 || !value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => scalarStrings(entry, depth + 1));
  if (typeof value === "object") {
    return Object.values(value).flatMap((entry) => scalarStrings(entry, depth + 1));
  }
  return [];
}

function boundedDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const value = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function itemValues(item: CatalogItem, fields?: ReadonlyArray<string>): string[] {
  const values = fields ? fields.flatMap((field) => scalarStrings(item[field])) : scalarStrings(item);
  return [...new Set(values.map(normalizeSearchText).filter(Boolean))];
}

function relevance(query: string, label: string, values: string[]): number {
  if (label === query) return 1_000;
  if (label.startsWith(query)) return 850 - Math.min(100, label.length - query.length);
  const position = label.indexOf(query);
  if (position >= 0) return 700 - Math.min(100, position);

  const queryTokens = query.split(" ");
  const valueTokens = values.flatMap((value) => value.split(" "));
  let tokenScore = 0;
  for (const token of queryTokens) {
    if (valueTokens.includes(token)) tokenScore += 100;
    else if (valueTokens.some((candidate) => candidate.startsWith(token))) tokenScore += 75;
    else if (values.some((candidate) => candidate.includes(token))) tokenScore += 45;
    else return fuzzyRelevance(query, label, values);
  }
  return 450 + tokenScore;
}

function fuzzyRelevance(query: string, label: string, values: string[]): number {
  if (query.length < 3) return 0;
  const maximum = Math.max(1, Math.min(3, Math.floor(query.length / 4)));
  const candidates = [label, ...values].filter((value) => value.length <= 80);
  let best = maximum + 1;
  for (const candidate of candidates) {
    best = Math.min(best, boundedDistance(query, candidate, maximum));
    for (const token of candidate.split(" ")) {
      best = Math.min(best, boundedDistance(query, token, maximum));
    }
  }
  return best <= maximum ? 250 - best * 40 : 0;
}

export function searchCatalogItems(
  domain: CatalogDomain,
  items: ReadonlyArray<CatalogItem>,
  query: string,
  fields?: ReadonlyArray<string>,
): CatalogSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const results: CatalogSearchResult[] = [];
  items.forEach((item, index) => {
    const displayLabel = catalogItemLabel(item);
    const label = normalizeSearchText(displayLabel);
    const score = relevance(normalizedQuery, label, itemValues(item, fields));
    if (score > 0) results.push({ domain, item, label: displayLabel, score: score - index / 1e9 });
  });
  return results;
}
