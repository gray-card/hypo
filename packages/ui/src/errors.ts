/** Translate known storage and write failures into steps a person can take. */
export function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (/gallery.*(?:AT URI|queued but has not been saved)/i.test(message)) {
    return "The gallery has not finished saving, so its photos cannot be linked yet. Check your connection, then retry the upload after the gallery appears in your library.";
  }
  if (/photo.*queued but has not been saved/i.test(message)) {
    return "The photo has not finished saving, so it cannot be added to the gallery yet. Check your connection, then retry after it appears in your library.";
  }
  if (name === "QuotaExceededError" || /storage (?:quota|is full)/i.test(message)) {
    return "This browser is out of storage space. Free some space and reload Hypo. Check whether the record already appears before trying again.";
  }
  if (
    name === "InvalidStateError" ||
    /(?:database connection is closing|database.*(?:closed|closing)|transaction.*connection is closing)/i.test(message)
  ) {
    return "Hypo lost access to this browser's storage while finishing the action. Reload Hypo and check whether the record already appears before trying again. If it keeps happening, check that browser storage is enabled.";
  }
  if (name === "SwapConflict" || /record changed remotely|invalid.?swap/i.test(message)) {
    return "This record changed on another device. Open “Needs attention” from the menu to review your local change before retrying.";
  }
  if (/failed to fetch|network (?:error|down)|fetch failed/i.test(message)) {
    return "Hypo could not reach your account's server. Check your connection and try again; queued changes will sync when you reconnect.";
  }
  return message;
}
