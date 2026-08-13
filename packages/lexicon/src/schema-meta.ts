import { KNOWN_VALUES } from "./generated.ts";
import type { RecordNsid, RecordTypeMap } from "./generated.ts";

type LastSegment<Value extends string> = Value extends `${string}.${infer Rest}` ? LastSegment<Rest> : Value;

export type RecordKind = LastSegment<RecordNsid>;
export type RecordField<Nsid extends RecordNsid> = Exclude<Extract<keyof RecordTypeMap[Nsid], string>, "$type">;
export type RecordFieldLabels<Nsid extends RecordNsid> = Partial<Record<RecordField<Nsid>, string>>;

export interface RecordDisplayLabels {
  one: string;
  many: string;
  collection?: string;
}

export interface RecordSchemaMetadata<Nsid extends RecordNsid> {
  nsid: Nsid;
  kind: LastSegment<Nsid>;
  labels: RecordDisplayLabels;
  fields?: RecordFieldLabels<Nsid>;
}

export type RecordSchemaMetadataMap = {
  [Nsid in RecordNsid]: RecordSchemaMetadata<Nsid>;
};

function meta<const Nsid extends RecordNsid>(
  nsid: Nsid,
  one: string,
  many: string,
  options: { collection?: string; fields?: RecordFieldLabels<Nsid> } = {},
): RecordSchemaMetadata<Nsid> {
  const kind = nsid.split(".").at(-1) as LastSegment<Nsid>;
  return {
    nsid,
    kind,
    labels: { one, many, ...(options.collection ? { collection: options.collection } : {}) },
    ...(options.fields ? { fields: options.fields } : {}),
  };
}

export const LEXICON_ENUM_OPTIONS = Object.freeze({
  artifactKind: KNOWN_VALUES["app.graycard.workflow.defs/defs/artifactKind"],
  cameraCategory: KNOWN_VALUES["app.graycard.defs/defs/cameraCategory"],
  captureFormat: KNOWN_VALUES["app.graycard.defs/defs/captureFormat"],
  cassetteType: KNOWN_VALUES["app.graycard.instance.filmRoll/defs/main/record/properties/cassetteType"],
  consumableStatus: KNOWN_VALUES["app.graycard.instance.chemistry/defs/main/record/properties/status"],
  chemistryProductKind: KNOWN_VALUES["app.graycard.defs/defs/chemistryProductKind"],
  chemistryRole: KNOWN_VALUES["app.graycard.defs/defs/chemistryRole"],
  developmentLocation: KNOWN_VALUES["app.graycard.instance.filmRoll/defs/main/record/properties/developmentLocation"],
  developerForm: KNOWN_VALUES["app.graycard.defs/defs/developerForm"],
  exposureProgram: KNOWN_VALUES["app.graycard.defs/defs/exposureProgram"],
  filmProcess: KNOWN_VALUES["app.graycard.defs/defs/filmProcess"],
  filmType: KNOWN_VALUES["app.graycard.defs/defs/filmType"],
  filterKind: KNOWN_VALUES["app.graycard.defs/defs/filterKind"],
  headType: KNOWN_VALUES["app.graycard.catalog.enlargerType/defs/main/record/properties/headType"],
  inkType: KNOWN_VALUES["app.graycard.catalog.printerType/defs/main/record/properties/inkType"],
  lensTypeKind: KNOWN_VALUES["app.graycard.defs/defs/lensTypeKind"],
  lightTechnology: KNOWN_VALUES["app.graycard.catalog.lightSourceType/defs/main/record/properties/lightTechnology"],
  meteringMode: KNOWN_VALUES["app.graycard.defs/defs/meteringMode"],
  negativeFormat: KNOWN_VALUES["app.graycard.defs/defs/negativeFormat"],
  paperBase: KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/base"],
  paperContrast: KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/contrast"],
  paperMedium: KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/medium"],
  paperSurface: KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/surface"],
  paperTone: KNOWN_VALUES["app.graycard.catalog.paperType/defs/main/record/properties/tone"],
  printProcess: KNOWN_VALUES["app.graycard.process.printSession/defs/main/record/properties/printProcess"],
  printerTechnology: KNOWN_VALUES["app.graycard.catalog.printerType/defs/main/record/properties/printerTechnology"],
  rollStatus: KNOWN_VALUES["app.graycard.defs/defs/rollStatus"],
  scannerKind: KNOWN_VALUES["app.graycard.defs/defs/scannerKind"],
  stopFraction: KNOWN_VALUES["app.graycard.defs/defs/stopFraction"],
  storage: KNOWN_VALUES["app.graycard.defs/defs/storage"],
});

// Mount is deliberately open text in the lexicon. These are physical-system
// suggestions compiled for the editor, not a second schema enum; custom values
// remain accepted by the shared enum control.
export const CURATED_MOUNT_NAMES = Object.freeze([
  "Nikon F",
  "Nikon Z",
  "Canon EF",
  "Canon EF-M",
  "Canon FD",
  "Canon RF",
  "Leica M",
  "Leica L",
  "Leica R",
  "Leica screw (LTM)",
  "Sony E",
  "Sony A",
  "Pentax K",
  "Pentax 645",
  "Pentax 67",
  "Fujifilm X",
  "Fujifilm G",
  "Micro Four Thirds",
  "Four Thirds",
  "M42",
  "Contax/Yashica",
  "Contax G",
  "Olympus OM",
  "Minolta MD",
  "Minolta A",
  "Konica AR",
  "Hasselblad V",
  "Hasselblad X",
  "Mamiya RB/RZ",
  "Mamiya 645",
  "Bronica SQ",
  "Bronica ETR",
  "medium format",
  "large format",
  "fixed",
  "other",
] as const);

export const GEAR_FIELD_ENUM_OPTIONS = Object.freeze({
  apertureStopIncrement: LEXICON_ENUM_OPTIONS.stopFraction,
  base: LEXICON_ENUM_OPTIONS.paperBase,
  cassetteType: LEXICON_ENUM_OPTIONS.cassetteType,
  category: LEXICON_ENUM_OPTIONS.cameraCategory,
  contrast: LEXICON_ENUM_OPTIONS.paperContrast,
  coversFormat: LEXICON_ENUM_OPTIONS.negativeFormat,
  exposureProgram: LEXICON_ENUM_OPTIONS.exposureProgram,
  filmType: LEXICON_ENUM_OPTIONS.filmType,
  filterKind: LEXICON_ENUM_OPTIONS.filterKind,
  form: LEXICON_ENUM_OPTIONS.developerForm,
  format: LEXICON_ENUM_OPTIONS.captureFormat,
  headType: LEXICON_ENUM_OPTIONS.headType,
  inkType: LEXICON_ENUM_OPTIONS.inkType,
  kind: LEXICON_ENUM_OPTIONS.artifactKind,
  lensTypeKind: LEXICON_ENUM_OPTIONS.lensTypeKind,
  lightTechnology: LEXICON_ENUM_OPTIONS.lightTechnology,
  maxFormat: LEXICON_ENUM_OPTIONS.negativeFormat,
  medium: LEXICON_ENUM_OPTIONS.paperMedium,
  meteringMode: LEXICON_ENUM_OPTIONS.meteringMode,
  mount: CURATED_MOUNT_NAMES,
  printerTechnology: LEXICON_ENUM_OPTIONS.printerTechnology,
  process: LEXICON_ENUM_OPTIONS.filmProcess,
  productKind: LEXICON_ENUM_OPTIONS.chemistryProductKind,
  roles: LEXICON_ENUM_OPTIONS.chemistryRole,
  scannerKind: LEXICON_ENUM_OPTIONS.scannerKind,
  shutterStopIncrement: LEXICON_ENUM_OPTIONS.stopFraction,
  status: LEXICON_ENUM_OPTIONS.rollStatus,
  storage: LEXICON_ENUM_OPTIONS.storage,
  surface: LEXICON_ENUM_OPTIONS.paperSurface,
  tone: LEXICON_ENUM_OPTIONS.paperTone,
});

export type GearCatalogKind =
  | "cameraType"
  | "chemistryType"
  | "enlargerType"
  | "enlargingLensType"
  | "filmStock"
  | "filterType"
  | "lab"
  | "lensType"
  | "lightSourceType"
  | "paperType"
  | "printerType"
  | "scannerType"
  | "scanProfile";

export type GearInstanceKind =
  | "camera"
  | "chemistry"
  | "enlarger"
  | "enlargingLens"
  | "filmRoll"
  | "filmStockpile"
  | "filter"
  | "intermediate"
  | "labAccount"
  | "lens"
  | "lightSource"
  | "printer"
  | "scanner"
  | "storageLocation";

export type GearFormControlKind =
  | "text"
  | "integer"
  | "scaled"
  | "scaled-list"
  | "measure"
  | "uri"
  | "enum"
  | "enum-list"
  | "date"
  | "datetime"
  | "at-uri";

type GearFormFieldBase<Key extends string> = {
  key: Key;
  label: string;
  required?: true;
};

type GearFormFieldForKey<Key extends string> =
  | (GearFormFieldBase<Key> & {
      control?: "text" | "integer" | "scaled" | "scaled-list" | "string-list" | "uri";
    })
  | (GearFormFieldBase<Key> & { control: "measure"; unit: string })
  | (GearFormFieldBase<Key> & { control: "enum"; options: readonly string[] })
  | (GearFormFieldBase<Key> & { control: "enum-list"; options: readonly string[] })
  | (GearFormFieldBase<Key> & { control: "date" | "datetime" })
  | (GearFormFieldBase<Key> & { control: "at-uri"; targetKind: GearInstanceKind });

export type GearFormField<Nsid extends RecordNsid> = {
  [Key in RecordField<Nsid>]: GearFormFieldForKey<Key>;
}[RecordField<Nsid>];

export interface GearTypeLink<Nsid extends RecordNsid> {
  catalogKind: GearCatalogKind;
  field: RecordField<Nsid>;
}

export interface GearFormMetadata<Nsid extends RecordNsid> {
  nsid: Nsid;
  fields: readonly GearFormField<Nsid>[];
  typeLink?: GearTypeLink<Nsid>;
}

export type AnyGearFormMetadata = {
  [Nsid in RecordNsid]: GearFormMetadata<Nsid>;
}[RecordNsid];

function gearForm<const Nsid extends RecordNsid>(
  nsid: Nsid,
  fields: readonly GearFormField<Nsid>[],
  typeLink?: GearTypeLink<Nsid>,
): GearFormMetadata<Nsid> {
  return { nsid, fields, ...(typeLink ? { typeLink } : {}) };
}

// `gearForm` is generic in RecordTypeMap. A renamed or removed lexicon field
// therefore makes the corresponding form entry fail type checking.
export const GEAR_CATALOG_FORM_META = {
  cameraType: gearForm("app.graycard.catalog.cameraType", [
    { key: "make", label: "Make", required: true },
    { key: "model", label: "Model", required: true },
    { key: "alternativeNames", label: "Alternative names", control: "string-list" },
    { key: "mount", label: "Mount", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.mount },
    { key: "format", label: "Format", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.format },
    { key: "category", label: "Category", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.category },
    { key: "minShutterSpeed", label: "Fastest shutter (e.g. 1/8000)", control: "scaled" },
    { key: "maxShutterSpeed", label: "Slowest shutter (e.g. 30s)", control: "scaled" },
    { key: "shutterSpeedSteps", label: "Shutter steps (comma-separated)", control: "scaled-list" },
    {
      key: "shutterStopIncrement",
      label: "Shutter stop increment",
      control: "enum",
      options: GEAR_FIELD_ENUM_OPTIONS.shutterStopIncrement,
    },
  ]),
  chemistryType: gearForm("app.graycard.catalog.chemistryType", [
    { key: "brand", label: "Brand" },
    { key: "name", label: "Name", required: true },
    { key: "roles", label: "Roles", required: true, control: "enum-list", options: GEAR_FIELD_ENUM_OPTIONS.roles },
    { key: "productKind", label: "Product kind", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.productKind },
    { key: "process", label: "Process", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.process },
    { key: "form", label: "Form", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.form },
    { key: "defaultDilution", label: "Default dilution" },
    { key: "defaultTemperature", label: "Default temp °C", control: "measure", unit: "celsius" },
  ]),
  enlargerType: gearForm("app.graycard.catalog.enlargerType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    { key: "maxFormat", label: "Max negative format", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.maxFormat },
    { key: "headType", label: "Head / light source", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.headType },
    { key: "lensMount", label: "Lens mount" },
  ]),
  enlargingLensType: gearForm("app.graycard.catalog.enlargingLensType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    { key: "focalLengthMm", label: "Focal length (mm)", control: "integer" },
    { key: "maxAperture", label: "Max aperture (f)", control: "scaled" },
    { key: "mount", label: "Mount", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.mount },
    { key: "coversFormat", label: "Covers format", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.coversFormat },
  ]),
  filmStock: gearForm("app.graycard.catalog.filmStock", [
    { key: "brand", label: "Brand" },
    { key: "name", label: "Name", required: true },
    { key: "iso", label: "ISO", control: "integer" },
    { key: "filmType", label: "Film type", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.filmType },
    { key: "process", label: "Process", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.process },
  ]),
  filterType: gearForm("app.graycard.catalog.filterType", [
    { key: "make", label: "Make" },
    { key: "name", label: "Name", required: true },
    { key: "filterKind", label: "Kind", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.filterKind },
    { key: "threadDiameterMm", label: "Thread size (mm)", control: "integer" },
  ]),
  lab: gearForm("app.graycard.catalog.lab", [
    { key: "name", label: "Name", required: true },
    { key: "website", label: "Website", control: "uri" },
    { key: "location", label: "Location" },
  ]),
  lensType: gearForm("app.graycard.catalog.lensType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    { key: "alternativeNames", label: "Alternative names", control: "string-list" },
    { key: "mount", label: "Mount", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.mount },
    { key: "focalLengthMin", label: "Focal length min (mm)", control: "scaled" },
    { key: "focalLengthMax", label: "Focal length max (mm)", control: "scaled" },
    { key: "maxAperture", label: "Max aperture (f)", control: "scaled" },
    { key: "minAperture", label: "Min aperture (f)", control: "scaled" },
    { key: "apertureSteps", label: "Aperture steps (ƒ/, comma-separated)", control: "scaled-list" },
    {
      key: "apertureStopIncrement",
      label: "Aperture stop increment",
      control: "enum",
      options: GEAR_FIELD_ENUM_OPTIONS.apertureStopIncrement,
    },
  ]),
  lightSourceType: gearForm("app.graycard.catalog.lightSourceType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    {
      key: "lightTechnology",
      label: "Technology",
      control: "enum",
      options: GEAR_FIELD_ENUM_OPTIONS.lightTechnology,
    },
    { key: "peakWavelengthNm", label: "Peak UV wavelength (nm)", control: "integer" },
  ]),
  paperType: gearForm("app.graycard.catalog.paperType", [
    { key: "brand", label: "Brand" },
    { key: "name", label: "Name", required: true },
    { key: "medium", label: "Medium", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.medium },
    { key: "base", label: "Base", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.base },
    { key: "surface", label: "Surface", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.surface },
    { key: "contrast", label: "Contrast", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.contrast },
    { key: "grade", label: "Grade" },
    { key: "tone", label: "Tone", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.tone },
    { key: "weight", label: "Weight" },
  ]),
  printerType: gearForm("app.graycard.catalog.printerType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    {
      key: "printerTechnology",
      label: "Technology",
      control: "enum",
      options: GEAR_FIELD_ENUM_OPTIONS.printerTechnology,
    },
    { key: "inkType", label: "Ink type", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.inkType },
    { key: "inkChannels", label: "Ink channels", control: "integer" },
    { key: "maxMediaWidthMm", label: "Max media width (mm)", control: "integer" },
  ]),
  scannerType: gearForm("app.graycard.catalog.scannerType", [
    { key: "make", label: "Make" },
    { key: "model", label: "Model", required: true },
    { key: "scannerKind", label: "Kind", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.scannerKind },
  ]),
  scanProfile: gearForm("app.graycard.catalog.scanProfile", [
    { key: "name", label: "Name", required: true },
    { key: "method", label: "Method" },
    { key: "software", label: "Software" },
    { key: "resolution", label: "Resolution DPI" },
  ]),
} satisfies Readonly<Record<GearCatalogKind, AnyGearFormMetadata>>;

export const GEAR_INSTANCE_FORM_META = {
  camera: gearForm(
    "app.graycard.instance.camera",
    [
      { key: "nickname", label: "Nickname (e.g. “black M6”)" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "cameraType", field: "type" },
  ),
  chemistry: gearForm(
    "app.graycard.instance.chemistry",
    [
      { key: "nickname", label: "Nickname" },
      { key: "componentName", label: "Kit bath / component" },
      { key: "dilution", label: "Dilution" },
      { key: "status", label: "Status", control: "enum", options: LEXICON_ENUM_OPTIONS.consumableStatus },
      { key: "acquiredAt", label: "Acquired", control: "date" },
      { key: "openedAt", label: "Opened", control: "datetime" },
      { key: "mixedAt", label: "Mixed", control: "datetime" },
      { key: "expiresAt", label: "Expires", control: "date" },
      { key: "replenishedAt", label: "Replenished", control: "datetime" },
      { key: "exhaustedAt", label: "Exhausted", control: "datetime" },
      { key: "discardedAt", label: "Discarded", control: "datetime" },
      { key: "rollsProcessed", label: "Rolls processed", control: "integer" },
      { key: "sessionsUsed", label: "Sessions used", control: "integer" },
      { key: "maxRollsRecommended", label: "Maximum recommended rolls", control: "integer" },
    ],
    { catalogKind: "chemistryType", field: "type" },
  ),
  enlarger: gearForm(
    "app.graycard.instance.enlarger",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "enlargerType", field: "type" },
  ),
  enlargingLens: gearForm(
    "app.graycard.instance.enlargingLens",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "enlargingLensType", field: "type" },
  ),
  filmRoll: gearForm(
    "app.graycard.instance.filmRoll",
    [
      { key: "label", label: "Label (e.g. “Roll 12”)" },
      { key: "serialNumber", label: "Serial" },
      { key: "format", label: "Format", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.format },
      { key: "status", label: "Status", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.status },
      { key: "camera", label: "Camera", control: "at-uri", targetKind: "camera" },
      { key: "shotAtIso", label: "Shot at ISO (push/pull)", control: "integer" },
      { key: "exposuresTotal", label: "Total frames", control: "integer" },
      { key: "emulsionBatch", label: "Emulsion batch" },
      { key: "expiresAt", label: "Expires", control: "date" },
      { key: "manufacturedAt", label: "Manufactured", control: "date" },
      { key: "loadedAt", label: "Loaded", control: "datetime" },
      { key: "partialAt", label: "First exposed", control: "datetime" },
      { key: "exposedAt", label: "Fully exposed", control: "datetime" },
      { key: "unloadedAt", label: "Unloaded", control: "datetime" },
      { key: "sentToLabAt", label: "Sent to lab", control: "datetime" },
      { key: "developmentStartedAt", label: "Development started", control: "datetime" },
      { key: "developedAt", label: "Developed", control: "datetime" },
      {
        key: "developmentLocation",
        label: "Development location",
        control: "enum",
        options: LEXICON_ENUM_OPTIONS.developmentLocation,
      },
      { key: "receivedFromLabAt", label: "Received from lab", control: "datetime" },
      { key: "scannedAt", label: "Scanned", control: "datetime" },
      { key: "archivedAt", label: "Archived", control: "datetime" },
    ],
    { catalogKind: "filmStock", field: "stock" },
  ),
  filmStockpile: gearForm(
    "app.graycard.instance.filmStockpile",
    [
      { key: "quantity", label: "How many rolls in reserve", required: true, control: "integer" },
      { key: "format", label: "Format", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.format },
      { key: "storage", label: "Storage", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.storage },
      { key: "storageLocation", label: "Storage location", control: "at-uri", targetKind: "storageLocation" },
      { key: "emulsionBatch", label: "Emulsion batch" },
      { key: "expiresAt", label: "Expires", control: "date" },
    ],
    { catalogKind: "filmStock", field: "stock" },
  ),
  filter: gearForm(
    "app.graycard.instance.filter",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
      { key: "threadSize", label: "Thread size (mm)", control: "integer" },
    ],
    { catalogKind: "filterType", field: "type" },
  ),
  intermediate: gearForm("app.graycard.instance.intermediate", [
    { key: "label", label: "Label" },
    { key: "kind", label: "Kind", required: true, control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.kind },
    { key: "frameIndex", label: "Frame index", control: "integer" },
    { key: "filmRoll", label: "Film roll", control: "at-uri", targetKind: "filmRoll" },
  ]),
  labAccount: gearForm(
    "app.graycard.instance.labAccount",
    [
      { key: "nickname", label: "Nickname" },
      { key: "accountId", label: "Account ID" },
    ],
    { catalogKind: "lab", field: "lab" },
  ),
  lens: gearForm(
    "app.graycard.instance.lens",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "lensType", field: "type" },
  ),
  lightSource: gearForm(
    "app.graycard.instance.lightSource",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "lightSourceType", field: "type" },
  ),
  printer: gearForm(
    "app.graycard.instance.printer",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "printerType", field: "type" },
  ),
  scanner: gearForm(
    "app.graycard.instance.scanner",
    [
      { key: "nickname", label: "Nickname" },
      { key: "serialNumber", label: "Serial number" },
    ],
    { catalogKind: "scannerType", field: "type" },
  ),
  storageLocation: gearForm("app.graycard.instance.storageLocation", [
    { key: "name", label: "Name", required: true },
    { key: "storage", label: "Storage", control: "enum", options: GEAR_FIELD_ENUM_OPTIONS.storage },
  ]),
} satisfies Readonly<Record<GearInstanceKind, AnyGearFormMetadata>>;

const CAMERA_TECHNICAL_FIELDS = {
  autofocusSystem: "Autofocus system",
  batteryTypes: "Battery types",
  cropFactor: "Crop factor",
  dimensions: "Dimensions",
  effectiveMegapixels: "Effective megapixels",
  exposureCompensationMin: "Exposure compensation minimum",
  exposureCompensationMax: "Exposure compensation maximum",
  flashSyncSpeed: "Flash sync speed",
  meteringModes: "Metering modes",
  rawFormats: "RAW formats",
  storageMedia: "Storage media",
  viewfinderCoverage: "Viewfinder coverage",
  viewfinderMagnification: "Viewfinder magnification",
} satisfies RecordFieldLabels<"app.graycard.catalog.cameraType">;

const LENS_TECHNICAL_FIELDS = {
  closestFocus: "Closest focusing distance",
  diaphragmBladeCount: "Diaphragm blades",
  dimensions: "Dimensions",
  filterThreadDiameter: "Filter thread diameter",
  imageCircleDiameter: "Image circle diameter",
  maxReproductionRatio: "Maximum reproduction ratio",
  mounts: "Available mounts",
  stabilizationStops: "Stabilization",
} satisfies RecordFieldLabels<"app.graycard.catalog.lensType">;

const FILM_TECHNICAL_FIELDS = {
  aka: "Also sold as",
  colorBalanceKelvin: "Color balance (K)",
  discontinued: "Discontinued",
  dxNumber: "DX number",
  exposureLatitude: "Exposure latitude",
  grainRms: "RMS granularity",
  granularityMeasurements: "Granularity measurements",
  reciprocityPoints: "Reciprocity corrections",
  recommendedRecipes: "Recommended recipes",
  releasedYear: "Released",
  resolvingPowerTests: "Resolving power",
  spectralRangeMaxNm: "Spectral range maximum",
  spectralRangeMinNm: "Spectral range minimum",
  spectralSamples: "Spectral response samples",
} satisfies RecordFieldLabels<"app.graycard.catalog.filmStock">;

const CHEMISTRY_TECHNICAL_FIELDS = {
  capacity: "Capacity",
  compatibleFilmTypes: "Compatible film types",
  compatibleMaterials: "Compatible materials",
  compatibleProcesses: "Compatible processes",
  dilutions: "Supported dilutions",
  kitBathSequence: "Kit bath sequence",
  minimumConcentratePerRoll: "Minimum concentrate per roll",
  mixingInstructions: "Mixing instructions",
  recommendedRecipes: "Recommended recipes",
  sdsDocuments: "Safety data sheets",
  shelfLives: "Shelf lives",
  technicalDocuments: "Technical documents",
  temperatureRanges: "Temperature ranges",
} satisfies RecordFieldLabels<"app.graycard.catalog.chemistryType">;

// Every generated record type must have display metadata. Adding a record to
// the lexicon generator without adding it here is therefore a type error.
export const RECORD_SCHEMA_META = {
  "app.graycard.artifact": meta("app.graycard.artifact", "Artifact", "Artifact"),
  "app.graycard.catalog.cameraType": meta("app.graycard.catalog.cameraType", "Camera", "Cameras", {
    fields: CAMERA_TECHNICAL_FIELDS,
  }),
  "app.graycard.catalog.chemistryType": meta("app.graycard.catalog.chemistryType", "Chemistry", "Chemistry", {
    fields: CHEMISTRY_TECHNICAL_FIELDS,
  }),
  "app.graycard.catalog.devRecipe": meta("app.graycard.catalog.devRecipe", "Dev recipe", "Dev recipe"),
  "app.graycard.catalog.enlargerType": meta("app.graycard.catalog.enlargerType", "Enlarger", "Enlargers"),
  "app.graycard.catalog.enlargingLensType": meta(
    "app.graycard.catalog.enlargingLensType",
    "Enlarging lens",
    "Enlarging lenses",
  ),
  "app.graycard.catalog.filmStock": meta("app.graycard.catalog.filmStock", "Film stock", "Film stocks", {
    fields: FILM_TECHNICAL_FIELDS,
  }),
  "app.graycard.catalog.filterType": meta("app.graycard.catalog.filterType", "Filter", "Filters"),
  "app.graycard.catalog.lab": meta("app.graycard.catalog.lab", "Lab", "Labs"),
  "app.graycard.catalog.lensType": meta("app.graycard.catalog.lensType", "Lens", "Lenses", {
    fields: LENS_TECHNICAL_FIELDS,
  }),
  "app.graycard.catalog.lightSourceType": meta("app.graycard.catalog.lightSourceType", "Light source", "Light sources"),
  "app.graycard.catalog.meterType": meta("app.graycard.catalog.meterType", "Meter type", "Meter type"),
  "app.graycard.catalog.paperType": meta("app.graycard.catalog.paperType", "Paper", "Papers"),
  "app.graycard.catalog.printerType": meta("app.graycard.catalog.printerType", "Printer", "Printers"),
  "app.graycard.catalog.scannerType": meta("app.graycard.catalog.scannerType", "Scanner", "Scanners"),
  "app.graycard.catalog.scanProfile": meta("app.graycard.catalog.scanProfile", "Scan profile", "Scan profiles"),
  "app.graycard.edit.recipe": meta("app.graycard.edit.recipe", "Recipe", "Recipe"),
  "app.graycard.gallery.defaults": meta("app.graycard.gallery.defaults", "Defaults", "Defaults", {
    collection: "Gallery defaults",
  }),
  "app.graycard.instance.camera": meta("app.graycard.instance.camera", "Camera", "Cameras"),
  "app.graycard.instance.chemistry": meta("app.graycard.instance.chemistry", "Chemistry", "Chemistry"),
  "app.graycard.instance.enlarger": meta("app.graycard.instance.enlarger", "Enlarger", "Darkroom"),
  "app.graycard.instance.enlargingLens": meta(
    "app.graycard.instance.enlargingLens",
    "Enlarging lens",
    "Enlarging lenses",
  ),
  "app.graycard.instance.exposure": meta("app.graycard.instance.exposure", "Exposure", "Exposures"),
  "app.graycard.instance.filmRoll": meta("app.graycard.instance.filmRoll", "Roll", "Rolls"),
  "app.graycard.instance.filmStockpile": meta(
    "app.graycard.instance.filmStockpile",
    "Film in reserve",
    "Film in reserve",
  ),
  "app.graycard.instance.filter": meta("app.graycard.instance.filter", "Filter", "Filters"),
  "app.graycard.instance.intermediate": meta("app.graycard.instance.intermediate", "Intermediate", "Intermediates"),
  "app.graycard.instance.labAccount": meta("app.graycard.instance.labAccount", "Lab", "Labs"),
  "app.graycard.instance.lens": meta("app.graycard.instance.lens", "Lens", "Lenses"),
  "app.graycard.instance.lightSource": meta("app.graycard.instance.lightSource", "Light source", "Light sources"),
  "app.graycard.instance.meter": meta("app.graycard.instance.meter", "Meter", "Meter"),
  "app.graycard.instance.printer": meta("app.graycard.instance.printer", "Printer", "Printers"),
  "app.graycard.instance.scanner": meta("app.graycard.instance.scanner", "Scanner", "Scanners"),
  "app.graycard.instance.storageLocation": meta("app.graycard.instance.storageLocation", "Storage location", "Storage"),
  "app.graycard.meter.calibration": meta("app.graycard.meter.calibration", "Calibration", "Calibration"),
  "app.graycard.meter.reading": meta("app.graycard.meter.reading", "Reading", "Reading"),
  "app.graycard.photo.capture": meta("app.graycard.photo.capture", "Capture", "Capture", {
    collection: "Photo gear",
  }),
  "app.graycard.photo.workflow": meta("app.graycard.photo.workflow", "Workflow", "Workflow", {
    collection: "Photo workflow",
  }),
  "app.graycard.process.developSession": meta(
    "app.graycard.process.developSession",
    "Develop session",
    "Develop session",
    { collection: "Development" },
  ),
  "app.graycard.process.digitizeSession": meta(
    "app.graycard.process.digitizeSession",
    "Digitize session",
    "Digitize session",
    { collection: "Scanning" },
  ),
  "app.graycard.process.editSession": meta("app.graycard.process.editSession", "Edit session", "Edit session"),
  "app.graycard.process.maintenanceSession": meta(
    "app.graycard.process.maintenanceSession",
    "Maintenance session",
    "Maintenance session",
    { collection: "Maintenance" },
  ),
  "app.graycard.process.printSession": meta("app.graycard.process.printSession", "Print session", "Print session", {
    collection: "Printing",
  }),
  "app.graycard.process.renderSession": meta(
    "app.graycard.process.renderSession",
    "Render session",
    "Render sessions",
    {
      collection: "Rendering",
    },
  ),
  "app.graycard.rule.batch": meta("app.graycard.rule.batch", "Batch", "Batch", {
    collection: "Batch rule",
  }),
  "app.graycard.scene.edge": meta("app.graycard.scene.edge", "Edge", "Edge", {
    collection: "Scene relation",
  }),
  "app.graycard.scene.graph": meta("app.graycard.scene.graph", "Graph", "Graph", {
    collection: "Scene",
  }),
  "app.graycard.scene.node": meta("app.graycard.scene.node", "Node", "Node", {
    collection: "Scene node",
  }),
  "app.graycard.scene.ontology": meta("app.graycard.scene.ontology", "Ontology", "Ontology"),
  "app.graycard.scene.region": meta("app.graycard.scene.region", "Region", "Region", {
    collection: "Scene region",
  }),
  "app.graycard.session.capture": meta("app.graycard.session.capture", "Capture", "Capture", {
    collection: "Shoot",
  }),
  "app.graycard.setup": meta("app.graycard.setup", "Setup", "Setup"),
  "app.graycard.workflow.run": meta("app.graycard.workflow.run", "Run", "Run", {
    collection: "Workflow run",
  }),
  "app.graycard.workflow.stage": meta("app.graycard.workflow.stage", "Stage", "Stage", {
    collection: "Workflow stage",
  }),
  "app.graycard.workflow.template": meta("app.graycard.workflow.template", "Template", "Template", {
    collection: "Workflow template",
  }),
} satisfies RecordSchemaMetadataMap;

const kindMetadata: Record<string, RecordSchemaMetadata<RecordNsid>> = {};
for (const metadata of Object.values(RECORD_SCHEMA_META)) {
  // Duplicate tails such as photo.capture and session.capture have the same
  // generic kind label; collection-specific wording remains on the NSID entry.
  kindMetadata[metadata.kind] ??= metadata as RecordSchemaMetadata<RecordNsid>;
}
export const KIND_METADATA: Readonly<Record<string, RecordSchemaMetadata<RecordNsid>>> = Object.freeze(kindMetadata);

const LEGACY_TECHNICAL_FIELD_LABELS = {
  shelfLife: "Shelf life",
  spectralRangeNm: "Spectral range",
  spectralResponse: "Spectral response",
  storageTemperatureRange: "Storage temperature",
} as const;

export const TECHNICAL_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(
    {},
    ...Object.values(RECORD_SCHEMA_META).map((metadata) => metadata.fields || {}),
    LEGACY_TECHNICAL_FIELD_LABELS,
  ),
);

export const EXTERNAL_COLLECTION_LABELS = Object.freeze({
  "social.grain.gallery": "Gallery",
  "social.grain.gallery.item": "Gallery photo",
  "social.grain.photo": "Photo",
  "social.grain.photo.exif": "EXIF",
});

export const GEAR_GROUPS = [
  { kind: "camera", icon: "camera" },
  { kind: "lens", icon: "camera" },
  { kind: "filmRoll", icon: "film" },
  { kind: "chemistry", icon: "package" },
  { kind: "scanner", icon: "image" },
  { kind: "enlarger", icon: "wrench" },
  { kind: "labAccount", icon: "users" },
  { kind: "storageLocation", icon: "package" },
] as const satisfies ReadonlyArray<{ kind: RecordKind; icon: string }>;

export const ACRONYM_LABELS = Object.freeze({
  iso: "ISO",
  exif: "EXIF",
  cla: "CLA",
  id: "ID",
  url: "URL",
  rc: "RC",
  fb: "FB",
  hdf: "HDF",
  did: "DID",
  uri: "URI",
  cid: "CID",
  raw: "RAW",
  ttl: "TTL",
  gm: "GM",
  oss: "OSS",
});

export const ENUM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  c41: "C-41",
  e6: "E-6",
  ecn2: "ECN-2",
  bw: "Black & white",
  ra4: "RA-4",
  "reversal-bw": "Reversal B&W",
  monobath: "Monobath",
  "color-negative": "Colour negative",
  "color-slide": "Colour slide",
  "bw-negative": "B&W negative",
  "bw-slide": "B&W slide",
  "motion-picture": "Motion picture",
  "chromogenic-bw": "Chromogenic B&W (C-41)",
  135: "135 (35mm)",
  "half-frame": "Half-frame",
  "70mm": "70mm",
  aps: "APS (IX240)",
  "16mm-still": "16mm (still)",
  minox: "Minox",
  disc: "Disc",
  "9x12cm": "9×12 cm",
  "13x18cm": "13×18 cm",
  "6.5x9cm": "6.5×9 cm",
  "11x14": "11×14 in",
  "ultra-large": "Ultra-large",
  "polaroid-spectra": "Polaroid Spectra",
  "peel-apart": "Peel-apart",
  "instant-8x10": "Instant 8×10",
  super8: "Super 8",
  regular8: "Regular 8",
  "16mm-cine": "16mm (cine)",
  "35mm-cine": "35mm (cine)",
  "65mm": "65mm",
  "aps-h-digital": "APS-H (digital)",
  "micro-four-thirds-digital": "Micro Four Thirds (digital)",
  "one-inch-digital": "1-inch (digital)",
  "foveon-digital": "Foveon (digital)",
  "cool-dark": "Cool & dark",
  "dry-cabinet": "Dry cabinet",
  developing: "Developing",
  scanned: "Scanned",
  "reloadable-metal": "Reloadable (metal)",
  "reloadable-plastic": "Reloadable (plastic)",
  "120-spool": "120 spool",
  "bulk-loaded": "Bulk-loaded",
  fiber: "Fibre (FB)",
  "resin-coated": "Resin-coated (RC)",
  baryta: "Baryta",
  satin: "Satin",
  luster: "Luster",
  pearl: "Pearl",
  "semi-matte": "Semi-matte",
  textured: "Textured",
  "pre-soak": "Pre-soak",
  "reversal-bath": "Reversal bath",
  "wash-aid": "Wash aid (hypo clear)",
  hardener: "Hardener",
  "final-rinse": "Final rinse",
  "dip-and-dunk": "Dip & dunk",
  "roller-transport": "Roller transport",
  "nd-variable": "Variable ND",
  "gradient-color": "Colour gradient",
  "ir-pass": "IR pass",
  "ir-cut": "IR cut",
  "uv-pass": "UV pass",
  "split-diopter": "Split dioptre",
  mist: "Mist",
  "soft-focus": "Soft focus",
  "center-spot": "Centre spot",
  prism: "Prism",
  night: "Night (light-pollution)",
  didymium: "Didymium",
  creative: "Creative",
  action: "Action",
  portrait: "Portrait",
  landscape: "Landscape",
  unknown: "Unknown",
  "cold-cathode": "Cold cathode",
  "dichroic-color": "Dichroic (colour)",
  "point-source": "Point source",
  "uv-led": "UV LED",
  "uv-fluorescent": "UV fluorescent",
  "metal-halide": "Metal halide",
  "mercury-vapor": "Mercury vapour",
  "laser-c-print": "Laser C-print",
  pigment: "Pigment",
  dye: "Dye",
  "variable-contrast": "Variable contrast",
  graded: "Graded",
  "alt-process": "Alt-process",
  "6x4.5": "6×4.5",
  "6x6": "6×6",
  "6x7": "6×7",
  "6x9": "6×9",
  "silver-gelatin": "Silver gelatin",
  "platinum-palladium": "Platinum / palladium",
  "van-dyke": "Van Dyke brown",
  "gum-bichromate": "Gum bichromate",
  "wet-plate-collodion": "Wet-plate collodion",
  "dye-transfer": "Dye transfer",
  "dye-destruction": "Dye destruction (Cibachrome)",
  "dye-sublimation": "Dye sublimation",
  kallitype: "Kallitype",
  bromoil: "Bromoil",
  albumen: "Albumen",
  photogravure: "Photogravure",
  lith: "Lith",
  cla: "CLA (clean, lube, adjust)",
  "sensor-clean": "Sensor clean",
  "shutter-service": "Shutter service",
  "fungus-clean": "Fungus clean",
  calibration: "Calibration",
  "direct-digital": "Direct digital",
  "tethered-capture": "Tethered capture",
  "file-import": "File import",
  "lab-dip-and-dunk": "Lab dip & dunk",
  "lab-roller": "Lab roller",
  "software-auto": "Software (auto)",
  "software-manual": "Software (manual)",
  "at-lab": "At lab",
  "dedicated-film": "Dedicated film",
  "lab-minilab": "Lab minilab",
  "dslr-copy-stand": "DSLR copy stand",
  "mirrorless-copy-stand": "Mirrorless copy stand",
  "full-frame-digital": "Full-frame (digital)",
  "aps-c-digital": "APS-C (digital)",
  "medium-format-digital": "Medium format (digital)",
  "instax-mini": "Instax mini",
  "instax-wide": "Instax wide",
  "instax-square": "Instax square",
  "polaroid-600": "Polaroid 600",
  "polaroid-i-type": "Polaroid i-Type",
  "polaroid-sx70": "Polaroid SX-70",
  "first-developer": "First developer",
  "color-developer": "Colour developer",
  "wetting-agent": "Wetting agent",
  "liquid-concentrate": "Liquid concentrate",
  "liquid-ready": "Liquid (ready to use)",
  uv: "UV",
  skylight: "Skylight",
  protection: "Protection",
  nd: "ND",
  "graduated-nd": "Graduated ND",
  "polarizer-circular": "Polariser (circular)",
  "polarizer-linear": "Polariser (linear)",
  color: "Colour",
  contrast: "Contrast",
  warming: "Warming",
  cooling: "Cooling",
  infrared: "Infrared",
  "close-up": "Close-up",
  diffusion: "Diffusion",
  "black-mist": "Black mist",
  star: "Star",
  matrix: "Matrix",
  "center-weighted": "Center-weighted",
  spot: "Spot",
  partial: "Partial",
  average: "Average",
  "multi-spot": "Multi-spot",
  "highlight-weighted": "Highlight-weighted",
  "aperture-priority": "Aperture priority",
  "shutter-priority": "Shutter priority",
  program: "Program",
  bulb: "Bulb",
});
