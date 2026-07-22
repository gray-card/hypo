import { describe, it, expect } from "vitest";
import { rawExifToForm } from "../src/readExif.js";

describe("rawExifToForm", () => {
  it("maps common EXIF tags into the Hypo form", () => {
    const form = rawExifToForm({
      Make: "Leica",
      Model: "M6",
      LensMake: "Leica",
      LensModel: "Summicron-M 50mm f/2",
      FNumber: 2.8,
      ExposureTime: 1 / 125,
      ISO: 400,
      FocalLengthIn35mmFormat: 50,
      Flash: "Off, Did not fire",
      DateTimeOriginal: new Date("2025-06-01T14:30:00Z"),
    });
    expect(form).toMatchObject({
      make: "Leica",
      model: "M6",
      lensMake: "Leica",
      lensModel: "Summicron-M 50mm f/2",
      fNumber: "2.8",
      exposureTime: "1/125",
      iSO: "400",
      focalLengthIn35mmFormat: "50",
      flash: "Off, Did not fire",
      dateTimeOriginal: "2025-06-01T14:30:00.000Z",
    });
  });

  it("falls back to ISOSpeedRatings and returns blanks for missing tags", () => {
    const form = rawExifToForm({ ISOSpeedRatings: 200, ExposureTime: 2 });
    expect(form.iSO).toBe("200");
    expect(form.exposureTime).toBe("2");
    expect(form.make).toBe("");
    expect(form.fNumber).toBe("");
  });

  it("handles an empty / null payload", () => {
    expect(rawExifToForm(null).make).toBe("");
    expect(rawExifToForm().iSO).toBe("");
  });
});
