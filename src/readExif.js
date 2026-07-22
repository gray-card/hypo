// readExif.js: pull camera metadata out of an image file into Hypo's EXIF form shape.
import exifr from "exifr";
import { formatExposure } from "./grain.js";

const SCALE = 1_000_000;

const TAGS = [
  "Make", "Model", "LensMake", "LensModel",
  "FNumber", "ExposureTime", "ISO", "ISOSpeedRatings",
  "FocalLengthIn35mmFormat", "Flash", "DateTimeOriginal",
];

function str(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function exposureFromSeconds(seconds) {
  if (seconds == null || !(seconds > 0)) return "";
  return formatExposure(Math.round(seconds * SCALE));
}

function dateTaken(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// map a raw exifr (or similar) tag bag into the human-editable EXIF form.
export function rawExifToForm(raw) {
  const r = raw || {};
  const iso = num(r.ISO ?? r.ISOSpeedRatings);
  const fNumber = num(r.FNumber);
  const focal = num(r.FocalLengthIn35mmFormat);
  const exposure = num(r.ExposureTime);

  return {
    make: str(r.Make),
    model: str(r.Model),
    lensMake: str(r.LensMake),
    lensModel: str(r.LensModel),
    flash: str(r.Flash),
    dateTimeOriginal: dateTaken(r.DateTimeOriginal),
    fNumber: fNumber != null ? String(fNumber) : "",
    iSO: iso != null ? String(Math.round(iso)) : "",
    focalLengthIn35mmFormat: focal != null ? String(Math.round(focal)) : "",
    exposureTime: exposureFromSeconds(exposure),
  };
}

// read EXIF tags from a File/Blob/ArrayBuffer into the EXIF form. Returns an
// empty form (all "") when the file has no readable metadata.
export async function fileToExifForm(file) {
  let raw = null;
  try {
    raw = await exifr.parse(file, { pick: TAGS });
  } catch {
    raw = null;
  }
  return rawExifToForm(raw || {});
}
