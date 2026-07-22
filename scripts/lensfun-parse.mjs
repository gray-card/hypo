// lensfun-parse.mjs: pure parsing of the lensfun XML database into lens/camera
// records. No filesystem or network here, so it is fully unit-testable. The CLI
// (build-catalog.mjs) handles reading files, Wikidata, and writing JSON.

export const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

// -- xml helpers --------------------------------------------------------------

// grab the canonical (non-localized) value of a tag. lensfun repeats <model> /
// <maker> with a `lang="…"` attribute for translations. The english/default
// entry carries no lang attribute and is the one we want.
export function canonicalTag(block, tag) {
  const tags = [...block.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`, "g"))];
  if (!tags.length) return null;
  const plain = tags.find((m) => !/\blang\s*=/.test(m[1] || ""));
  return norm((plain || tags[0])[2]);
}

export function allTags(block, tag) {
  return [...block.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) => norm(m[1]));
}

export function parseLensSpecs(model) {
  const f = model.match(/(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?\s*mm/i);
  const a = model.match(/(?:f\/|F)(\d+(?:\.\d+)?)/);
  const focalLengthMin = f ? parseFloat(f[1]) : null;
  const focalLengthMax = f ? (f[2] ? parseFloat(f[2]) : focalLengthMin) : null;
  const maxAperture = a ? parseFloat(a[1]) : null;
  const lensTypeKind =
    focalLengthMin && focalLengthMax && focalLengthMin !== focalLengthMax ? "zoom" : "prime";
  return { focalLengthMin, focalLengthMax, maxAperture, lensTypeKind };
}

const MOUNT_ALIAS = {
  "Nikon F AF": "Nikon F", "Nikon F AI-S": "Nikon F", "Canon EF-S": "Canon EF", "Sony E-mount": "Sony E",
};
export const mapMount = (m) => (m ? MOUNT_ALIAS[m] || m : null);

// strip a leading maker prefix and corporate suffixes so labels read cleanly.
export const cleanMaker = (m) =>
  norm((m || "").replace(/\b(Corporation|Company|Corp\.?|Inc\.?|Co\.?|AG|GmbH|Ltd\.?)\b/gi, ""));

export function stripMakerPrefix(model, maker) {
  if (!maker) return model;
  const re = new RegExp(`^${maker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
  return norm(model.replace(re, "")) || model;
}

// non-body generic markers lensfun ships so lenses can calibrate to a format.
export const isGenericCamera = (maker, model) =>
  /^generic$/i.test(maker) ||
  /film:\s*full frame|crop-factor|^generic\b/i.test(model);

// -- exif model code -> human-friendly camera name ----------------------------

const ROMAN = { 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X" };
const roman = (n) => ROMAN[n] || String(n);

const CAMERA_NAME_OVERRIDES = { "Sony|ILCE-QX1": "QX1", "Nikon|Df": "Df" };

export function prettyCameraModel(make, model) {
  const key = `${make}|${model}`;
  if (CAMERA_NAME_OVERRIDES[key]) return CAMERA_NAME_OVERRIDES[key];

  const mk = make.toLowerCase();
  let m = model.trim();

  if (mk.includes("sony")) {
    const a = m.match(/^ILC[EA]-(\d+)([RSC]*)(?:M(\d+))?([A-Z]*)$/);
    if (a) return `A${a[1]}${a[2]}${a[3] ? ` ${roman(+a[3])}` : ""}${a[4] || ""}`.trim();
    m = m.replace(/^(DSC|DSLR|SLT)-/, "");
    return m.replace(/M(\d+)([A-Z]*)$/, (_s, n, suf) => ` ${roman(+n)}${suf || ""}`);
  }
  if (mk.includes("panasonic")) {
    m = m.replace(/^(DC|DMC)-/, "");
    return m.replace(/M[K]?(\d+)([A-Z]*)$/, (_s, n, suf) => ` ${roman(+n)}${suf || ""}`);
  }
  if (mk.includes("nikon")) {
    const z = m.match(/^Z\s?(\d+)(?:_(\d+))?$/);
    if (z) return `Z${z[1]}${z[2] ? ` ${roman(+z[2])}` : ""}`;
    return m;
  }
  if (/olympus|^om\b|om system|om digital/.test(mk)) {
    return m.replace(/Mark([IVX]+)/, "Mark $1").replace(/([A-Za-z0-9])Mark/, "$1 Mark");
  }
  m = m.replace(/\s+Digital Camera$/i, "");
  if (mk.includes("canon")) {
    return m.replace(/^DIGITAL\s+/, "").replace(/([0-9])m(\d+)$/, (_s, d, n) => `${d} Mark ${roman(+n)}`);
  }
  return m;
}

export function cropToFormat(crop) {
  if (!isFinite(crop)) return "other";
  if (crop < 1) return "medium-format-digital";
  if (crop <= 1.05) return "full-frame-digital";
  if (crop <= 1.7) return "aps-c-digital";
  return "other";
}

// -- record extraction from one xml string ------------------------------------

// parse every <lens> in an xml string into normalized lens records.
export function parseLenses(xml) {
  const out = [];
  for (const [, block] of xml.matchAll(/<lens>([\s\S]*?)<\/lens>/g)) {
    const model = canonicalTag(block, "model");
    const maker = cleanMaker(canonicalTag(block, "maker"));
    if (!model || /film:/i.test(model)) continue;
    const mounts = [...new Set(allTags(block, "mount").map(mapMount).filter(Boolean))];
    out.push({
      make: maker || model.split(" ")[0], model,
      mount: mounts[0] || null, mounts,
      ...parseLensSpecs(model), wikidata: null,
    });
  }
  return out;
}

// parse every <camera> in an xml string into normalized camera records.
export function parseCameras(xml) {
  const out = [];
  for (const [, block] of xml.matchAll(/<camera>([\s\S]*?)<\/camera>/g)) {
    const rawModel = canonicalTag(block, "model");
    const maker = cleanMaker(canonicalTag(block, "maker"));
    if (!rawModel || isGenericCamera(maker, rawModel)) continue;
    const exifModel = stripMakerPrefix(rawModel, maker);
    const model = prettyCameraModel(maker, exifModel);
    const crop = parseFloat(canonicalTag(block, "cropfactor") || "1");
    out.push({
      make: maker, model, exifModel, category: "digital",
      format: cropToFormat(crop), cropFactor: crop,
      mount: mapMount(canonicalTag(block, "mount")), wikidata: null,
    });
  }
  return out;
}

// build the full deduped, sorted catalog from a set of xml strings.
export function buildCatalog(xmls) {
  const lensesByKey = new Map();
  const camerasByKey = new Map();
  for (const xml of xmls) {
    for (const lens of parseLenses(xml)) {
      const key = `${lens.make}|${lens.model}`.toLowerCase();
      if (!lensesByKey.has(key)) lensesByKey.set(key, lens);
    }
    for (const cam of parseCameras(xml)) {
      const key = `${cam.make}|${cam.model}`.toLowerCase();
      if (!camerasByKey.has(key)) camerasByKey.set(key, cam);
    }
  }
  const byLabel = (a, b) => (a.make + a.model).localeCompare(b.make + b.model);
  return {
    lenses: [...lensesByKey.values()].sort(byLabel),
    cameras: [...camerasByKey.values()].sort(byLabel),
  };
}
