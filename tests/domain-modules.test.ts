import { describe, expect, it } from "vitest";
import {
  type BatchDomainAdapters,
  buildApertureOptions,
  buildPhotoIndex,
  coarseCell,
  defaultStagePayload,
  evaluateCondition,
  listFilms,
  resolveTimeSec,
  searchFilms,
  stepsFromTemplate,
  withCapturedAt,
} from "@hypo/domain";

describe("strict domain module exports", () => {
  it("builds constrained exposure dials", () => {
    expect(buildApertureOptions({ apertureSteps: [2_800_000, 5_600_000] })).toEqual(["2.8", "5.6"]);
  });

  it("queries and resolves explicit development-recipe collections", () => {
    const recipes = [
      {
        filmMake: "Kodak",
        filmName: "Tri-X 400",
        temps: [
          { tempC10: 200, timeSec: 600 },
          { tempC10: 240, timeSec: 300 },
        ],
        interpolationAllowed: true,
      },
    ];
    expect(listFilms(recipes)).toMatchObject([{ make: "Kodak", name: "Tri-X 400", count: 1 }]);
    expect(searchFilms(recipes, "tri x")).toHaveLength(1);
    expect(resolveTimeSec(recipes[0], 220)).toBe(450);
  });

  it("builds pure workflow payloads and template steps", () => {
    expect(defaultStagePayload("output", "at://photo").target).toEqual({
      service: "social.grain",
      ref: "at://photo",
    });
    expect(
      stepsFromTemplate({
        value: { stageKinds: ["capture"], stageDefaults: [{ kind: "capture", fields: { camera: "at://cam" } }] },
      })[0],
    ).toMatchObject({ kind: "capture", configured: true, processFields: { camera: "at://cam" } });
  });

  it("evaluates batch conditions through explicit pure adapters", () => {
    const adapters: BatchDomainAdapters = {
      exifValueToForm: (value) => ({ make: String(value?.make || "") }),
      resolvePhotoCapture: () => ({
        camera: null,
        lens: null,
        filmRoll: null,
        shoot: null,
        medium: null,
      }),
      projectCaptureToExif: (form) => form,
    };
    expect(
      evaluateCondition(
        { exif: { value: { make: "Leica" } } },
        { field: "exif.make", op: "eq", value: "Leica" },
        adapters,
      ),
    ).toBe(true);
  });

  it("scales captured coordinates and builds privacy-coarsened profile locations", () => {
    const location = withCapturedAt({ latitude: 40.7128, longitude: -74.006 }, 0);
    expect(location).toMatchObject({
      latitude: 407_128_000,
      longitude: -740_060_000,
      capturedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(coarseCell(location)?.key).toBe("814,-1480");

    const photo = "at://did/social.grain.photo/one";
    const index = buildPhotoIndex({
      store: { catalog: {}, instance: {} },
      captures: [{ value: { photo, location } }],
    });
    expect(index.meta.get(photo)?.cell).toBe("814,-1480");
  });
});
