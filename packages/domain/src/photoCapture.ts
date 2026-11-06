interface PhotoCaptureValue {
  camera?: string | null;
  filmBack?: string | null;
  lens?: string | null;
  filmRoll?: string | null;
  filters?: readonly (string | null | undefined)[] | null;
  shoot?: string | null;
  medium?: string | null;
}

type CaptureRecord = { value?: PhotoCaptureValue } | null | undefined;

/** Resolve photo overrides against the defaults of the gallery being viewed. */
export function resolvePhotoCapture(capture: CaptureRecord, defaults: CaptureRecord) {
  const c = capture?.value || {};
  const d = defaults?.value || {};
  const filters = Array.isArray(c.filters) ? c.filters : Array.isArray(d.filters) ? d.filters : [];
  return {
    camera: c.camera || d.camera || null,
    filmBack: c.filmBack || d.filmBack || null,
    lens: c.lens || d.lens || null,
    filters: [...new Set(filters.filter((filter): filter is string => Boolean(filter)))],
    filmRoll: c.filmRoll || d.filmRoll || null,
    shoot: c.shoot || d.shoot || null,
    medium: c.medium || null,
  };
}
