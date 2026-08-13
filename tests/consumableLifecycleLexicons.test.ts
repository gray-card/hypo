import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEAR_INSTANCE_FORM_META, LEXICON_ENUM_OPTIONS } from "@hypo/lexicon";

const ROOT = join(process.cwd(), "lexicons/app/graycard/instance");
const properties = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, `${name}.json`), "utf8")).defs.main.record.properties;

const FILM_MILESTONES = [
  "loadedAt",
  "partialAt",
  "exposedAt",
  "unloadedAt",
  "sentToLabAt",
  "developmentStartedAt",
  "developedAt",
  "receivedFromLabAt",
  "scannedAt",
  "archivedAt",
] as const;

const CHEMICAL_MILESTONES = [
  "acquiredAt",
  "openedAt",
  "mixedAt",
  "expiresAt",
  "replenishedAt",
  "exhaustedAt",
  "discardedAt",
] as const;

describe("consumable lifecycle lexicons and forms", () => {
  it("adds optional dated milestones and development location to film rolls", () => {
    const fields = properties("filmRoll");
    for (const key of FILM_MILESTONES) expect(fields[key]).toMatchObject({ type: "string", format: "datetime" });
    expect(fields.developmentLocation.knownValues).toEqual(["home", "lab", "other"]);
    expect(fields.finishedAt.description).toMatch(/DEPRECATED/);
  });

  it("adds optional lifecycle milestones to chemistry instances", () => {
    const fields = properties("chemistry");
    expect(fields.status.knownValues).toEqual(["unopened", "active", "exhausted", "discarded"]);
    for (const key of CHEMICAL_MILESTONES) expect(fields[key]).toMatchObject({ type: "string", format: "datetime" });
  });

  it("exposes film milestones through typed form metadata", () => {
    const fields = new Map(GEAR_INSTANCE_FORM_META.filmRoll.fields.map((field) => [field.key, field]));
    for (const key of FILM_MILESTONES) expect(fields.get(key)?.control).toBe("datetime");
    expect(fields.get("developmentLocation")).toMatchObject({
      control: "enum",
      options: LEXICON_ENUM_OPTIONS.developmentLocation,
    });
  });

  it("exposes chemistry lifecycle fields through typed form metadata", () => {
    const fields = new Map(GEAR_INSTANCE_FORM_META.chemistry.fields.map((field) => [field.key, field]));
    expect(fields.get("status")).toMatchObject({
      control: "enum",
      options: LEXICON_ENUM_OPTIONS.consumableStatus,
    });
    expect(fields.get("acquiredAt")?.control).toBe("date");
    expect(fields.get("expiresAt")?.control).toBe("date");
    for (const key of CHEMICAL_MILESTONES.filter((field) => !["acquiredAt", "expiresAt"].includes(field)))
      expect(fields.get(key)?.control).toBe("datetime");
  });
});
