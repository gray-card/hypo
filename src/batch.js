// Persistence compatibility facade for conditional batch edits.

import {
  evaluateCondition as evaluateDomainCondition,
  previewBatch as previewDomainBatch,
  previewPhotoChanges as previewDomainPhotoChanges,
  readField as readDomainField,
  renderTemplate as renderDomainTemplate,
} from "@hypo/domain";
import { exifValueToForm, projectCaptureToExif, resolvePhotoCapture, savePhotoCapture } from "./graycard.js";
import { saveExif, savePhotoAlt } from "./grain.js";

const domainAdapters = { exifValueToForm, projectCaptureToExif, resolvePhotoCapture };

export { RULE_PRESETS, isEmpty } from "@hypo/domain";

export function readField(ctx, path) {
  return readDomainField(ctx, path, domainAdapters);
}

export function evaluateCondition(ctx, condition) {
  return evaluateDomainCondition(ctx, condition, domainAdapters);
}

export function renderTemplate(template, ctx) {
  return renderDomainTemplate(template, ctx, domainAdapters);
}

export function previewPhotoChanges(ctx, actions, store) {
  return previewDomainPhotoChanges(ctx, actions, store, domainAdapters);
}

export function previewBatch(detail, store, rule) {
  return previewDomainBatch(detail, store, rule, domainAdapters);
}

export async function applyBatch(agent, did, detail, store, rule, onProgress) {
  const preview = previewBatch(detail, store, rule);
  const total = preview.matched.length;
  let done = 0;
  for (const item of preview.matched) {
    const photo = detail.photos[item.index - 1];
    if (!photo) continue;
    done += 1;
    onProgress?.(done, total, item.index);
    if (item.changes.some((change) => change.kind === "alt") && photo.photo?.value) {
      const photoCid = await savePhotoAlt(agent, did, photo.photo, item.alt);
      if (photoCid) photo.photo.cid = photoCid;
    }
    if (item.changes.some((change) => change.kind.startsWith("capture."))) {
      const captureSaved = await savePhotoCapture(
        agent,
        did,
        photo.photo.uri,
        {
          camera: item.captureRefs.camera || undefined,
          lens: item.captureRefs.lens || undefined,
          filmRoll: item.captureRefs.filmRoll || undefined,
        },
        store.photoCaptureByPhoto.get(photo.photo.uri) || null,
      );
      if (captureSaved) store.photoCaptureByPhoto.set(photo.photo.uri, captureSaved);
    }
    if (item.changes.some((change) => change.kind.startsWith("exif."))) {
      photo.exif = await saveExif(agent, did, photo.photo.uri, photo.exif, item.exifForm);
    }
  }
  return preview;
}
