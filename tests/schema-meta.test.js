import { describe, expect, it } from "vitest";
import {
  CURATED_MOUNT_NAMES,
  GEAR_CATALOG_FORM_META,
  GEAR_FIELD_ENUM_OPTIONS,
  GEAR_INSTANCE_FORM_META,
  GEAR_GROUPS,
  KNOWN_VALUES,
  LEXICON_ENUM_OPTIONS,
  RECORD_NSID_LIST,
  RECORD_SCHEMA_META,
  TECHNICAL_FIELD_LABELS,
} from "../packages/lexicon/src/index.ts";
import { collectionLabel, kindLabel, kindLabelPlural, technicalFieldLabel } from "../src/ui/labels.js";

describe("typed schema metadata", () => {
  it("has one metadata entry for every generated record NSID", () => {
    expect(Object.keys(RECORD_SCHEMA_META)).toEqual([...RECORD_NSID_LIST]);
    for (const nsid of RECORD_NSID_LIST) {
      const metadata = RECORD_SCHEMA_META[nsid];
      expect(metadata.nsid).toBe(nsid);
      expect(metadata.kind).toBe(nsid.split(".").at(-1));
      expect(metadata.labels.one).toEqual(expect.any(String));
      expect(metadata.labels.many).toEqual(expect.any(String));
    }
  });

  it("drives the existing kind and collection label API", () => {
    expect(kindLabel("cameraType")).toBe("Camera");
    expect(kindLabelPlural("filmStock")).toBe("Film stocks");
    expect(kindLabelPlural("enlarger")).toBe("Darkroom");
    expect(collectionLabel("app.graycard.photo.capture")).toBe("Photo gear");
    expect(collectionLabel("app.graycard.process.digitizeSession")).toBe("Scanning");
    expect(collectionLabel("social.grain.gallery.item")).toBe("Gallery photo");
  });

  it("keeps setup groups constrained to generated record kinds", () => {
    const recordKinds = new Set(RECORD_NSID_LIST.map((nsid) => nsid.split(".").at(-1)));
    for (const group of GEAR_GROUPS) {
      expect(recordKinds.has(group.kind)).toBe(true);
      expect(group.icon).toEqual(expect.any(String));
    }
  });

  it("derives editor enum options from generated knownValues", () => {
    expect(LEXICON_ENUM_OPTIONS.captureFormat).toBe(KNOWN_VALUES["app.graycard.defs/defs/captureFormat"]);
    expect(LEXICON_ENUM_OPTIONS.filmProcess).toBe(KNOWN_VALUES["app.graycard.defs/defs/filmProcess"]);
    expect(LEXICON_ENUM_OPTIONS.paperBase).toBe(
      KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/base"],
    );
    expect(LEXICON_ENUM_OPTIONS.cassetteType).toBe(
      KNOWN_VALUES["app.graycard.instance.filmRoll/defs/main/record/properties/cassetteType"],
    );
    expect(GEAR_FIELD_ENUM_OPTIONS.format).toBe(LEXICON_ENUM_OPTIONS.captureFormat);
    expect(GEAR_FIELD_ENUM_OPTIONS.status).toBe(LEXICON_ENUM_OPTIONS.rollStatus);
    expect(GEAR_FIELD_ENUM_OPTIONS.mount).toBe(CURATED_MOUNT_NAMES);
  });

  it("owns ordered, typed gear form controls and record links", () => {
    expect(GEAR_CATALOG_FORM_META.cameraType.fields.map((field) => field.key)).toEqual([
      "make",
      "model",
      "alternativeNames",
      "mount",
      "format",
      "category",
      "minShutterSpeed",
      "maxShutterSpeed",
      "shutterSpeedSteps",
      "shutterStopIncrement",
    ]);
    expect(GEAR_CATALOG_FORM_META.cameraType.fields.find((field) => field.key === "mount")).toMatchObject({
      control: "enum",
      options: CURATED_MOUNT_NAMES,
    });
    expect(GEAR_CATALOG_FORM_META.lensType.fields.find((field) => field.key === "alternativeNames")).toMatchObject({
      control: "string-list",
    });
    expect(GEAR_CATALOG_FORM_META.chemistryType.fields.find((field) => field.key === "roles")).toMatchObject({
      required: true,
      control: "enum-list",
      options: LEXICON_ENUM_OPTIONS.chemistryRole,
    });
    expect(GEAR_INSTANCE_FORM_META.filmRoll.typeLink).toEqual({ catalogKind: "filmStock", field: "stock" });
    expect(GEAR_INSTANCE_FORM_META.filmRoll.fields.find((field) => field.key === "camera")).toMatchObject({
      control: "at-uri",
      targetKind: "camera",
    });
    expect(GEAR_INSTANCE_FORM_META.filmRoll.fields.find((field) => field.key === "expiresAt")).toMatchObject({
      control: "date",
    });
  });

  it("owns technical field labels with the legacy fallback behavior", () => {
    expect(RECORD_SCHEMA_META["app.graycard.catalog.cameraType"].fields.flashSyncSpeed).toBe("Flash sync speed");
    expect(RECORD_SCHEMA_META["app.graycard.catalog.filmStock"].fields.reciprocityPoints).toBe(
      "Reciprocity corrections",
    );
    expect(TECHNICAL_FIELD_LABELS.shelfLife).toBe("Shelf life");
    expect(technicalFieldLabel("viewfinderMagnification")).toBe("Viewfinder magnification");
    expect(technicalFieldLabel("newTechnicalField")).toBe("New Technical Field");
  });
});
