export interface BatchValueRecord<Value extends object = Record<string, unknown>> {
  uri?: string;
  cid?: string;
  value?: Value;
  [key: string]: unknown;
}

export interface BatchExifValue extends Record<string, unknown> {}

export interface BatchContext {
  gallery?: BatchValueRecord<{ title?: string; description?: string; [key: string]: unknown }> | null;
  photo?: BatchValueRecord<{ alt?: string; [key: string]: unknown }> | null;
  exif?: BatchValueRecord<BatchExifValue> | null;
  photoCapture?: BatchValueRecord | null;
  galleryDefaults?: BatchValueRecord | null;
  index?: unknown;
}

export interface CaptureReferences {
  camera: string | null;
  lens: string | null;
  filmRoll: string | null;
  shoot: string | null;
  medium: string | null;
}

export type ExifForm = Record<string, string>;

export interface BatchDomainAdapters<Store = unknown> {
  exifValueToForm(value: BatchExifValue | undefined): ExifForm;
  resolvePhotoCapture(
    capture: BatchValueRecord | null | undefined,
    defaults: BatchValueRecord | null | undefined,
  ): CaptureReferences;
  projectCaptureToExif(form: ExifForm, refs: CaptureReferences, store: Store, options: { mode: string }): ExifForm;
}

export interface BatchBooleanCondition {
  operator: string;
  operands?: readonly BatchCondition[];
}

export interface BatchComparisonCondition {
  field: string;
  op: string;
  value?: unknown;
  pattern?: string;
  flags?: string;
  operator?: undefined;
}

export type BatchCondition = BatchBooleanCondition | BatchComparisonCondition;

export interface BatchAction {
  op: string;
  field?: string;
  value?: unknown;
  pattern?: string;
  flags?: string;
  mode?: string;
  ref?: string;
}

export interface BatchRule {
  id?: string;
  name?: string;
  when?: BatchCondition | null;
  actions: readonly BatchAction[];
}

export interface BatchChange {
  kind: string;
  from?: unknown;
  to?: unknown;
}

export interface PhotoChangePreview {
  changes: BatchChange[];
  alt: string;
  exifForm: ExifForm;
  captureRefs: CaptureReferences;
}

function nestedValue(value: object | undefined, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function readField<Store>(context: BatchContext, path: string, adapters: BatchDomainAdapters<Store>): unknown {
  const [root, ...rest] = path.split(".");
  if (root === "gallery") return nestedValue(context.gallery?.value, rest) ?? "";
  if (root === "photo") return nestedValue(context.photo?.value, rest) ?? "";
  if (root === "exif") {
    const key = rest[0];
    return key ? (adapters.exifValueToForm(context.exif?.value)[key] ?? "") : "";
  }
  if (root === "gear" || root === "capture") {
    const key = rest[0] as keyof CaptureReferences | undefined;
    const refs = adapters.resolvePhotoCapture(context.photoCapture, context.galleryDefaults);
    return key ? (refs[key] ?? "") : "";
  }
  if (root === "index") return context.index;
  return "";
}

export function isEmpty(value: unknown): boolean {
  return value == null || String(value).trim() === "";
}

export function evaluateCondition<Store>(
  context: BatchContext,
  condition: BatchCondition | null | undefined,
  adapters: BatchDomainAdapters<Store>,
): boolean {
  if (!condition) return true;
  if ("operator" in condition && condition.operator) {
    const operands = condition.operands || [];
    if (condition.operator === "and") return operands.every((operand) => evaluateCondition(context, operand, adapters));
    if (condition.operator === "or") return operands.some((operand) => evaluateCondition(context, operand, adapters));
    if (condition.operator === "not") return !evaluateCondition(context, operands[0], adapters);
    return false;
  }
  if (!("field" in condition)) return false;
  const stringValue = String(readField(context, condition.field, adapters) ?? "");
  const comparisonValue = condition.value;
  switch (condition.op) {
    case "empty":
    case "notExists":
      return isEmpty(stringValue);
    case "notEmpty":
    case "exists":
      return !isEmpty(stringValue);
    case "eq":
      return stringValue === String(comparisonValue ?? "");
    case "neq":
      return stringValue !== String(comparisonValue ?? "");
    case "contains":
      return stringValue.includes(String(comparisonValue ?? ""));
    case "startsWith":
      return stringValue.startsWith(String(comparisonValue ?? ""));
    case "endsWith":
      return stringValue.endsWith(String(comparisonValue ?? ""));
    case "matches":
      return new RegExp(condition.pattern ?? String(comparisonValue ?? ""), condition.flags || "i").test(stringValue);
    case "gt":
      return parseFloat(stringValue) > parseFloat(String(comparisonValue));
    case "gte":
      return parseFloat(stringValue) >= parseFloat(String(comparisonValue));
    case "lt":
      return parseFloat(stringValue) < parseFloat(String(comparisonValue));
    case "lte":
      return parseFloat(stringValue) <= parseFloat(String(comparisonValue));
    case "in":
      return Array.isArray(comparisonValue) && comparisonValue.map(String).includes(stringValue);
    default:
      return false;
  }
}

export function renderTemplate<Store>(
  template: unknown,
  context: BatchContext,
  adapters: BatchDomainAdapters<Store>,
): string {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = readField(context, path, adapters);
    return value == null ? "" : String(value);
  });
}

export function previewPhotoChanges<Store>(
  context: BatchContext,
  actions: readonly BatchAction[],
  store: Store,
  adapters: BatchDomainAdapters<Store>,
): PhotoChangePreview {
  const changes: BatchChange[] = [];
  let alt = context.photo?.value?.alt ?? "";
  let exifForm = adapters.exifValueToForm(context.exif?.value);
  let captureRefs = adapters.resolvePhotoCapture(context.photoCapture, context.galleryDefaults);
  let galleryDescription = context.gallery?.value?.description ?? "";

  for (const action of actions) {
    if (action.op === "setGalleryDescription") {
      const next = renderTemplate(action.value, context, adapters);
      if (action.mode === "ifEmpty" && !isEmpty(galleryDescription)) continue;
      if (galleryDescription !== next) {
        changes.push({ kind: "gallery.description", to: next });
        galleryDescription = next;
      }
      continue;
    }
    if (action.op === "setAlt") {
      const next = renderTemplate(action.value, context, adapters);
      if (action.mode === "ifEmpty" && !isEmpty(alt)) continue;
      if (alt !== next) {
        changes.push({ kind: "alt", from: alt, to: next });
        alt = next;
      }
      continue;
    }
    if (action.op === "setExif") {
      const field = action.field ?? "undefined";
      if (action.mode === "ifEmpty" && !isEmpty(exifForm[field])) continue;
      const next = renderTemplate(action.value, context, adapters);
      if (exifForm[field] !== next) {
        changes.push({ kind: `exif.${field}`, from: exifForm[field] ?? "", to: next });
        exifForm[field] = next;
      }
      continue;
    }
    if (action.op === "associateCamera" && action.ref) {
      captureRefs = { ...captureRefs, camera: action.ref };
      changes.push({ kind: "capture.camera", to: action.ref });
    }
    if (action.op === "associateLens" && action.ref) {
      captureRefs = { ...captureRefs, lens: action.ref };
      changes.push({ kind: "capture.lens", to: action.ref });
    }
    if (action.op === "projectCaptureToExif") {
      const nextForm = adapters.projectCaptureToExif(exifForm, captureRefs, store, {
        mode: action.mode || "fill",
      });
      for (const [key, value] of Object.entries(nextForm)) {
        if ((exifForm[key] ?? "") !== (value ?? "")) {
          changes.push({ kind: `exif.${key}`, from: exifForm[key] ?? "", to: value ?? "" });
        }
      }
      exifForm = nextForm;
    }
  }
  return { changes, alt, exifForm, captureRefs };
}

export interface BatchPhotoDetail {
  gallery: NonNullable<BatchContext["gallery"]> & { uri: string };
  photos: readonly {
    photo: BatchValueRecord<{ alt?: string; [key: string]: unknown }> & { uri: string };
    exif?: BatchValueRecord<BatchExifValue> | null;
  }[];
}

export interface BatchLookupStore {
  photoCaptureByPhoto: ReadonlyMap<string, BatchValueRecord>;
  galleryDefaultsByGallery: ReadonlyMap<string, BatchValueRecord>;
}

export interface MatchedPhotoPreview extends PhotoChangePreview {
  index: number;
  photoUri: string;
}

export function previewBatch<Store extends BatchLookupStore>(
  detail: BatchPhotoDetail,
  store: Store,
  rule: BatchRule,
  adapters: BatchDomainAdapters<Store>,
): { matched: MatchedPhotoPreview[]; galleryDescriptionChange: null } {
  const matched: MatchedPhotoPreview[] = [];
  for (let index = 0; index < detail.photos.length; index += 1) {
    const photo = detail.photos[index];
    const photoUri = photo.photo.uri;
    const context: BatchContext = {
      index: index + 1,
      gallery: detail.gallery,
      photo: photo.photo,
      exif: photo.exif,
      photoCapture: store.photoCaptureByPhoto.get(photoUri) || null,
      galleryDefaults: store.galleryDefaultsByGallery.get(detail.gallery.uri) || null,
    };
    if (!evaluateCondition(context, rule.when, adapters)) continue;
    const preview = previewPhotoChanges(context, rule.actions, store, adapters);
    if (preview.changes.length) matched.push({ index: index + 1, photoUri, ...preview });
  }
  return { matched, galleryDescriptionChange: null };
}

export const RULE_PRESETS: BatchRule[] = [
  {
    id: "fill-focal",
    name: "Fill missing focal length from capture instances",
    when: { field: "exif.focalLengthIn35mmFormat", op: "empty" },
    actions: [{ op: "projectCaptureToExif", mode: "fill" }],
  },
  {
    id: "empty-alt",
    name: "Set empty alt from gallery title + frame",
    when: { field: "alt", op: "empty" },
    actions: [{ op: "setAlt", value: "{{gallery.title}} #{{index}}", mode: "ifEmpty" }],
  },
];
