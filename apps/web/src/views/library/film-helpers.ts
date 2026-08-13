import type { FilmRecord, FilmStore, FilmValue } from "./film-types.ts";

const EXPIRY_SOON_MS = 90 * 24 * 60 * 60 * 1000;

export function reserveQuantity(value: FilmValue | null | undefined): number {
  return Math.max(0, Number(value?.quantity) || 0);
}

export function framesForRoll(store: FilmStore, rollUri: string): FilmRecord[] {
  return [...(store.instance.exposure || [])]
    .filter((frame) => frame.value.roll === rollUri)
    .sort((left, right) => (left.value.frameNumber ?? 0) - (right.value.frameNumber ?? 0));
}

export function filmStockLabel(
  store: FilmStore,
  stockUri: string | undefined,
  catalogLabel: (kind: string, value: FilmValue) => string,
): string {
  const stock = (store.catalog.filmStock || []).find((record) => record.uri === stockUri)?.value;
  return stock ? catalogLabel("filmStock", stock) : "Unknown film";
}

export function filmDating(
  value: FilmValue,
  enumLabel: (value: string) => string,
  now = Date.now(),
): { text: string; expired: boolean; soon: boolean } {
  const parts: string[] = [];
  if (value.emulsionBatch) parts.push(`batch ${value.emulsionBatch}`);
  let expired = false;
  let soon = false;
  if (value.expiresAt) {
    const timestamp = Date.parse(value.expiresAt);
    if (Number.isFinite(timestamp)) {
      expired = timestamp < now;
      soon = !expired && timestamp < now + EXPIRY_SOON_MS;
      const when = new Date(timestamp).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      parts.push(expired ? `expired ${when}` : `exp ${when}`);
    }
  }
  if (value.format) parts.push(enumLabel(value.format));
  if (value.storage) parts.push(enumLabel(value.storage));
  return { text: parts.join(" · "), expired, soon };
}

export function compareRollsByStatus(left: FilmRecord, right: FilmRecord, statuses: readonly string[]): number {
  const order = (status: string | undefined) => {
    const index = statuses.indexOf(status || "loaded");
    return index < 0 ? statuses.length : index;
  };
  return (
    order(left.value.status) - order(right.value.status) ||
    (right.value.loadedAt || right.value.createdAt || "").localeCompare(
      left.value.loadedAt || left.value.createdAt || "",
    )
  );
}
