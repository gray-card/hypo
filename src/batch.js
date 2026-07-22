// batch.js: conditional batch edits

import {
  exifValueToForm, projectCaptureToExif, resolvePhotoCapture, savePhotoCapture,
} from "./graycard.js";
import { saveExif, saveGallery, savePhotoAlt } from "./grain.js";

export function readField(ctx, path) {
  const [root, ...rest] = path.split(".");
  if (root === "gallery") {
    let v = ctx.gallery?.value;
    for (const k of rest) v = v?.[k];
    return v ?? "";
  }
  if (root === "photo") {
    let v = ctx.photo?.value;
    for (const k of rest) v = v?.[k];
    return v ?? "";
  }
  if (root === "exif") {
    return exifValueToForm(ctx.exif?.value)[rest[0]] ?? "";
  }
  if (root === "gear" || root === "capture") {
    const r = resolvePhotoCapture(ctx.photoCapture, ctx.galleryDefaults);
    return r[rest[0]] ?? "";
  }
  if (root === "index") return ctx.index;
  return "";
}

export function isEmpty(value) {
  return value == null || String(value).trim() === "";
}

// evaluate an app.graycard.rule.batch condition: either a #booleanGroup
// ({operator, operands}) or a #comparison ({field, op, value, pattern, flags}).
export function evaluateCondition(ctx, condition) {
  if (!condition) return true;
  if (condition.operator) {
    const ops = condition.operands || [];
    if (condition.operator === "and") return ops.every((c) => evaluateCondition(ctx, c));
    if (condition.operator === "or") return ops.some((c) => evaluateCondition(ctx, c));
    if (condition.operator === "not") return !evaluateCondition(ctx, ops[0]);
    return false;
  }
  const str = String(readField(ctx, condition.field) ?? "");
  const val = condition.value;
  switch (condition.op) {
    case "empty":
    case "notExists": return isEmpty(str);
    case "notEmpty":
    case "exists": return !isEmpty(str);
    case "eq": return str === String(val ?? "");
    case "neq": return str !== String(val ?? "");
    case "contains": return str.includes(String(val ?? ""));
    case "startsWith": return str.startsWith(String(val ?? ""));
    case "endsWith": return str.endsWith(String(val ?? ""));
    case "matches": return new RegExp(condition.pattern ?? String(val ?? ""), condition.flags || "i").test(str);
    case "gt": return parseFloat(str) > parseFloat(val);
    case "gte": return parseFloat(str) >= parseFloat(val);
    case "lt": return parseFloat(str) < parseFloat(val);
    case "lte": return parseFloat(str) <= parseFloat(val);
    case "in": return Array.isArray(val) && val.map(String).includes(str);
    default: return false;
  }
}

export function renderTemplate(template, ctx) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = readField(ctx, path);
    return v == null ? "" : String(v);
  });
}

export function previewPhotoChanges(ctx, actions, store) {
  const changes = [];
  let alt = ctx.photo?.value?.alt ?? "";
  let exifForm = exifValueToForm(ctx.exif?.value);
  let captureRefs = resolvePhotoCapture(ctx.photoCapture, ctx.galleryDefaults);
  let galleryDesc = ctx.gallery?.value?.description ?? "";

  for (const action of actions) {
    if (action.op === "setGalleryDescription") {
      const next = renderTemplate(action.value, ctx);
      if (action.mode === "ifEmpty" && !isEmpty(galleryDesc)) continue;
      if (galleryDesc !== next) { changes.push({ kind: "gallery.description", to: next }); galleryDesc = next; }
      continue;
    }
    if (action.op === "setAlt") {
      const next = renderTemplate(action.value, ctx);
      if (action.mode === "ifEmpty" && !isEmpty(alt)) continue;
      if (alt !== next) { changes.push({ kind: "alt", from: alt, to: next }); alt = next; }
      continue;
    }
    if (action.op === "setExif") {
      if (action.mode === "ifEmpty" && !isEmpty(exifForm[action.field])) continue;
      const next = renderTemplate(action.value, ctx);
      if (exifForm[action.field] !== next) {
        changes.push({ kind: `exif.${action.field}`, from: exifForm[action.field] ?? "", to: next });
        exifForm[action.field] = next;
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
      const nextForm = projectCaptureToExif(exifForm, captureRefs, store, { mode: action.mode || "fill" });
      for (const [k, v] of Object.entries(nextForm)) {
        if ((exifForm[k] ?? "") !== (v ?? "")) changes.push({ kind: `exif.${k}`, from: exifForm[k] ?? "", to: v ?? "" });
      }
      exifForm = nextForm;
    }
  }
  return { changes, alt, exifForm, captureRefs };
}

export function previewBatch(detail, store, rule) {
  const matched = [];
  for (let i = 0; i < detail.photos.length; i++) {
    const p = detail.photos[i];
    const ctx = {
      index: i + 1,
      gallery: detail.gallery,
      photo: p.photo,
      exif: p.exif,
      photoCapture: store.photoCaptureByPhoto.get(p.photo.uri) || null,
      galleryDefaults: store.galleryDefaultsByGallery.get(detail.gallery.uri) || null,
    };
    if (!evaluateCondition(ctx, rule.when)) continue;
    const preview = previewPhotoChanges(ctx, rule.actions, store);
    if (preview.changes.length) matched.push({ index: i + 1, photoUri: p.photo.uri, ...preview });
  }
  return { matched, galleryDescriptionChange: null };
}

export async function applyBatch(agent, did, detail, store, rule, onProgress) {
  const preview = previewBatch(detail, store, rule);
  const total = preview.matched.length;
  let done = 0;
  for (const item of preview.matched) {
    const p = detail.photos[item.index - 1];
    if (!p) continue;
    done++;
    onProgress?.(done, total, item.index);
    if (item.changes.some((c) => c.kind === "alt") && p.photo?.value) {
      const photoCid = await savePhotoAlt(agent, did, p.photo, item.alt);
      if (photoCid) p.photo.cid = photoCid;
    }
    if (item.changes.some((c) => c.kind.startsWith("capture."))) {
      const captureSaved = await savePhotoCapture(agent, did, p.photo.uri, {
        camera: item.captureRefs.camera || undefined,
        lens: item.captureRefs.lens || undefined,
        filmRoll: item.captureRefs.filmRoll || undefined,
      }, store.photoCaptureByPhoto.get(p.photo.uri) || null);
      if (captureSaved) store.photoCaptureByPhoto.set(p.photo.uri, captureSaved);
    }
    if (item.changes.some((c) => c.kind.startsWith("exif."))) {
      p.exif = await saveExif(agent, did, p.photo.uri, p.exif, item.exifForm);
    }
  }
  return preview;
}

export const RULE_PRESETS = [
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
