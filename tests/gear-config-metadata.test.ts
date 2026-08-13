import { describe, expect, it } from "vitest";
import { GEAR_CATALOG_FORM_META, GEAR_INSTANCE_FORM_META } from "@hypo/lexicon";
import {
  DATE_ONLY,
  ENUM_SELECT,
  INSTANCE_ENUM_OPTIONS,
  INSTANCE_FIELDS,
  STRING_LIST,
  TYPE_IDENTITY,
  TYPE_KEY,
  TYPE_OF_INSTANCE,
} from "../apps/web/src/views/library/gear-config.ts";

describe("gear form metadata compatibility projections", () => {
  it("projects ordered catalog and instance fields without a second field table", () => {
    expect(TYPE_IDENTITY.cameraType.map(([key]) => key)).toEqual(
      GEAR_CATALOG_FORM_META.cameraType.fields.map((field) => field.key),
    );
    expect(INSTANCE_FIELDS.filmRoll.map(([key]) => key)).toEqual(
      GEAR_INSTANCE_FORM_META.filmRoll.fields.map((field) => field.key),
    );
    expect(TYPE_IDENTITY.chemistryType.find(([key]) => key === "roles")).toEqual(["roles", "Roles", true]);
  });

  it("projects type links, enum controls, dates, and at-uri selectors", () => {
    expect(TYPE_OF_INSTANCE.filmRoll).toBe("filmStock");
    expect(TYPE_KEY.filmRoll).toBe("stock");
    expect([...ENUM_SELECT]).toEqual(expect.arrayContaining(["format", "status", "process", "mount"]));
    expect([...DATE_ONLY]).toEqual(expect.arrayContaining(["expiresAt", "manufacturedAt"]));
    expect(INSTANCE_FIELDS.filmRoll.find(([key]) => key === "camera")).toEqual(["camera", "@camera"]);
    expect(INSTANCE_ENUM_OPTIONS.chemistry.status).toEqual(["unopened", "active", "exhausted", "discarded"]);
    expect(INSTANCE_ENUM_OPTIONS.filmRoll.developmentLocation).toEqual(["home", "lab", "other"]);
    expect([...STRING_LIST]).toEqual(["alternativeNames"]);
  });
});
