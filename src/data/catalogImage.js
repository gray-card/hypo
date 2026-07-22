// catalogImage.js: resolve the display image for a CATALOG TYPE — a film stock,
// a camera model, a lens model, a developer — as opposed to an owned instance
// (that is gearImage.js). Resolution order:
//
//   1. The type record's own `image` (app.graycard.defs#assetRef): a `url` the
//      record carries, or a `file` blob its owner uploaded. Blobs need a
//      caller-supplied resolver, because an authed reader and a public profile
//      reader build blob URLs differently.
//   2. A curated manufacturer product shot, matched on brand + name. These are
//      LINKS to the manufacturer's own copy of its own photograph — we never
//      copy or redistribute the file.
//   3. Wikidata P18, via the type's QID or a name search (the original behavior,
//      and still the fallback for everything we have not curated).

import curatedFilmStocks from "./curated-film-stocks.json";
import { typeImage } from "./wikidata.js";
import { catalogLabel } from "../graycard.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const keyOf = (kind, a, b) => `${kind}::${norm(a)}::${norm(b)}`;

// brand/make + name/model -> manufacturer product-shot URL, for curated kinds.
const CURATED = new Map();
for (const s of curatedFilmStocks.stocks || []) {
  if (s.image) CURATED.set(keyOf("filmStock", s.brand, s.name), s.image);
}

// the two identity fields differ by kind: film is brand+name, gear is make+model.
function identityOf(kind, value) {
  return kind === "filmStock" || kind === "paperType" || kind === "developerType" || kind === "chemistryType"
    ? [value.brand, value.name]
    : [value.make, value.model];
}

// a curated manufacturer shot for this type, or null when we have not curated it.
export function curatedImageUrl(kind, value) {
  if (!value) return null;
  const [a, b] = identityOf(kind, value);
  return CURATED.get(keyOf(kind, a, b)) || null;
}

// Full resolution chain. `blobUrl(blob) -> Promise<string|null>` is optional and
// only needed to display an uploaded `image.file`.
export async function catalogImageUrl(kind, value, { blobUrl } = {}) {
  if (!value) return null;
  const ref = value.image;
  if (ref?.url) return ref.url;
  if (ref?.file && blobUrl) {
    try {
      const u = await blobUrl(ref.file);
      if (u) return u;
    } catch { /* fall through to the shared sources */ }
  }
  const curated = curatedImageUrl(kind, value);
  if (curated) return curated;
  try {
    return await typeImage(value, catalogLabel(kind, value));
  } catch {
    return null;
  }
}

// Resolve a type's datasheet to something linkable. Prefers the richer
// `datasheet` assetRef, falling back to the legacy flat `datasheetUrl`.
// Returns { url, kind } or null; `kind` is "url" | "record" | "file".
export function datasheetRef(value) {
  const d = value?.datasheet;
  if (d?.url) return { url: d.url, kind: "url", title: d.title || null };
  if (d?.record) return { url: null, record: d.record, kind: "record", title: d.title || null };
  if (d?.file) return { url: null, file: d.file, kind: "file", title: d.title || null };
  if (value?.datasheetUrl) return { url: value.datasheetUrl, kind: "url", title: null };
  return null;
}
