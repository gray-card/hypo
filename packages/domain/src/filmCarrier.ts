export const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";

export interface FilmCarrierValue {
  readonly camera?: unknown;
  readonly filmBack?: unknown;
}

export class FilmCarrierValidationError extends Error {
  readonly name = "FilmCarrierValidationError";
  readonly collection: string;

  constructor(collection: string) {
    super("A film roll cannot be loaded directly in a camera and in a detachable film back at the same time.");
    this.collection = collection;
  }
}

/** Reject the two mutually exclusive ways a physical film roll can be carried. */
export function assertFilmRollCarrier(collection: string, value: FilmCarrierValue): void {
  if (collection === FILM_ROLL_COLLECTION && value.camera && value.filmBack) {
    throw new FilmCarrierValidationError(collection);
  }
}
