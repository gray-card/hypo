import { describe, expect, it } from "vitest";
import { FILM_ROLL_COLLECTION, FilmCarrierValidationError, assertFilmRollCarrier } from "@hypo/domain";

describe("film roll carrier invariant", () => {
  it("allows either a fixed-back camera or a detachable back", () => {
    expect(() => assertFilmRollCarrier(FILM_ROLL_COLLECTION, { camera: "at://camera" })).not.toThrow();
    expect(() => assertFilmRollCarrier(FILM_ROLL_COLLECTION, { filmBack: "at://back" })).not.toThrow();
    expect(() => assertFilmRollCarrier(FILM_ROLL_COLLECTION, {})).not.toThrow();
  });

  it("rejects two simultaneous physical carriers", () => {
    expect(() => assertFilmRollCarrier(FILM_ROLL_COLLECTION, { camera: "at://camera", filmBack: "at://back" })).toThrow(
      FilmCarrierValidationError,
    );
  });

  it("does not constrain exposure snapshots, which legitimately include body and back", () => {
    expect(() =>
      assertFilmRollCarrier("app.graycard.instance.exposure", { camera: "at://camera", filmBack: "at://back" }),
    ).not.toThrow();
  });
});
