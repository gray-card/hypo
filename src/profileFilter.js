// profileFilter.js: index a public profile's photos by the gear + settings they
// were shot with, and match photos against the active filter state. Pure and
// side-effect free, so it is unit-testable and reusable.
//
// Two levels per gear kind:
//   instance ("Cameras")     — a specific owned body/lens/filter. Populated from
//                              graycard metadata, and from EXIF only when the
//                              owned model is unambiguous (a single copy).
//   type/model ("Camera models") — the model. Populated from graycard AND from
//                              EXIF (which only ever names a model). The UI only
//                              surfaces this level for models the user owns two+
//                              copies of; otherwise the instance level suffices.

const normGear = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function gearKeys(make, model) {
  const keys = new Set();
  if (model) keys.add(normGear(model));
  if (make && model) keys.add(normGear(make) + normGear(model));
  return keys;
}
function formatAperture(scaled) {
  const a = scaled / 1e6;
  return Number.isInteger(a) ? String(a) : String(+a.toFixed(1));
}
function formatShutter(scaled) {
  const s = scaled / 1e6;
  if (s <= 0) return null;
  return s < 1 ? `1/${Math.round(1 / s)}` : `${+s.toFixed(s % 1 ? 1 : 0)}s`;
}

// public location is snapped to a coarse grid so exact spots (a home, say) never
// leak. ~0.05° ≈ 5–6 km. Returns a grid key, the cell centroid (for the heatmap),
// and a human label. `location` uses the geoLocation scaling (degrees × 1e7).
export const CELL_DEG = 0.05;
export function coarseCell(location) {
  if (!location || location.latitude == null || location.longitude == null) return null;
  const lat = location.latitude / 1e7, lon = location.longitude / 1e7;
  const gi = Math.round(lat / CELL_DEG), gj = Math.round(lon / CELL_DEG);
  const pm = location.placemark;
  return {
    key: `${gi},${gj}`,
    lat: gi * CELL_DEG, lon: gj * CELL_DEG,          // centroid for map points
    label: pm?.name || pm?.locality || pm?.administrativeArea || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
  };
}

// resolve EXIF make/model -> owned type(s) + instances, and instance -> its type.
function buildGearResolver(store) {
  const typeByKey = { camera: new Map(), lens: new Map() };            // EXIF matches models, so only camera/lens
  const instancesByType = { camera: new Map(), lens: new Map(), filter: new Map() };
  const typeOf = { camera: new Map(), lens: new Map(), filter: new Map() };
  const catKind = { camera: "cameraType", lens: "lensType", filter: "filterType" };
  for (const kind of ["camera", "lens", "filter"]) {
    if (typeByKey[kind]) {
      for (const t of (store?.catalog?.[catKind[kind]] || [])) {
        for (const k of gearKeys(t.value.make, t.value.model)) {
          if (!typeByKey[kind].has(k)) typeByKey[kind].set(k, new Set());
          typeByKey[kind].get(k).add(t.uri);
        }
      }
    }
    for (const it of (store?.instance?.[kind] || [])) {
      const ty = it.value.type; if (!ty) continue;
      typeOf[kind].set(it.uri, ty);
      if (!instancesByType[kind].has(ty)) instancesByType[kind].set(ty, []);
      instancesByType[kind].get(ty).push(it.uri);
    }
  }
  return {
    resolveTypes: (kind, make, model) => {
      const types = new Set();
      for (const k of gearKeys(make, model)) for (const ty of (typeByKey[kind]?.get(k) || [])) types.add(ty);
      return [...types];
    },
    instancesOfType: (kind, ty) => instancesByType[kind].get(ty) || [],
    typeOf: (kind, uri) => typeOf[kind].get(uri) || null,
  };
}

// build { meta: Map<photoUri, {…facets}>, galleryPhotos: Map<galleryUri, [photoUri]> }.
// app.graycard metadata (captures + exposures) is the source of truth; grain EXIF
// is used only to fill a facet the graycard data left empty for that photo.
export function buildPhotoIndex({ store, captures = [], galleryItems = [], exif = [], shoots = [], galleryDefaults = [] }) {
  const gear = buildGearResolver(store);
  const meta = new Map();
  const ensure = (photo) => {
    if (!meta.has(photo)) meta.set(photo, {
      cameras: new Set(), cameraTypes: new Set(),
      lenses: new Set(), lensTypes: new Set(),
      filters: new Set(), filterTypes: new Set(),
      films: new Set(), shoots: new Set(),
      apertures: new Set(), shutters: new Set(), isos: new Set(), date: null,
      cell: null, cellLabel: null, cellLat: null, cellLon: null,
    });
    return meta.get(photo);
  };
  const stockOfRoll = (rollUri) => store?.byUri?.get(rollUri)?.item?.value?.stock || null;
  const isoOfStock = (stockUri) => store?.byUri?.get(stockUri)?.item?.value?.iso ?? null;
  // per-photo location candidates, gathered in precedence order and resolved last.
  const locByPhoto = new Map();       // photo -> raw geoLocation (highest priority seen)
  const shootOfPhoto = new Map();     // photo -> shoot uri (for the shoot-place fallback)
  const LOC_RANK = { exposure: 3, capture: 2, gallery: 1, shoot: 0 };
  const offerLoc = (photo, location, src) => {
    if (!location || location.latitude == null) return;
    const cur = locByPhoto.get(photo);
    if (!cur || LOC_RANK[src] > LOC_RANK[cur.src]) locByPhoto.set(photo, { location, src });
  };
  const addGraycardGear = (m, kind, uri) => {
    const instSet = { camera: m.cameras, lens: m.lenses, filter: m.filters }[kind];
    const typeSet = { camera: m.cameraTypes, lens: m.lensTypes, filter: m.filterTypes }[kind];
    instSet.add(uri);
    const ty = gear.typeOf(kind, uri); if (ty) typeSet.add(ty);
  };

  // --- 1. graycard (authoritative) ---
  for (const c of captures) {
    const v = c.value; if (!v?.photo) continue; const m = ensure(v.photo);
    if (v.camera) addGraycardGear(m, "camera", v.camera);
    if (v.lens) addGraycardGear(m, "lens", v.lens);
    if (v.filmRoll) { const s = stockOfRoll(v.filmRoll); if (s) { m.films.add(s); const iso = isoOfStock(s); if (iso != null) m.isos.add(String(iso)); } }
    if (v.shoot) { m.shoots.add(v.shoot); shootOfPhoto.set(v.photo, v.shoot); }
    offerLoc(v.photo, v.location, "capture");        // manual per-photo location
  }
  for (const e of (store?.instance?.exposure || [])) {
    const v = e.value; if (!v?.photo) continue; const m = ensure(v.photo);
    if (v.camera) addGraycardGear(m, "camera", v.camera);
    if (v.lens) addGraycardGear(m, "lens", v.lens);
    if (v.filter) addGraycardGear(m, "filter", v.filter);
    if (v.roll) { const s = stockOfRoll(v.roll); if (s) { m.films.add(s); const iso = isoOfStock(s); if (iso != null) m.isos.add(String(iso)); } }
    if (v.shoot) { m.shoots.add(v.shoot); shootOfPhoto.set(v.photo, v.shoot); }
    if (v.aperture) m.apertures.add(v.aperture);
    if (v.shutterSpeed) m.shutters.add(v.shutterSpeed);
    if (v.shotAtIso != null) m.isos.add(String(v.shotAtIso));
    const d = v.takenAt || v.createdAt; if (d && (!m.date || d < m.date)) m.date = d;
    offerLoc(v.photo, v.location, "exposure");        // per-frame GPS (highest priority)
  }

  // --- 2. grain EXIF (fallback: only fills facets graycard left empty) ---
  const exifGear = (m, kind, instSet, typeSet, make, model) => {
    if (instSet.size || typeSet.size) return;                 // graycard already covers this facet
    for (const ty of gear.resolveTypes(kind, make, model)) {
      typeSet.add(ty);                                        // model-level always (surfaced only for duplicated models)
      const insts = gear.instancesOfType(kind, ty);
      if (insts.length === 1) instSet.add(insts[0]);          // single copy -> the instance is unambiguous
    }
  };
  for (const x of exif) {
    const v = x.value; if (!v?.photo) continue; const m = ensure(v.photo);
    if (v.make || v.model) exifGear(m, "camera", m.cameras, m.cameraTypes, v.make, v.model);
    if (v.lensMake || v.lensModel) exifGear(m, "lens", m.lenses, m.lensTypes, v.lensMake, v.lensModel);
    if (m.apertures.size === 0 && v.fNumber != null) m.apertures.add(formatAperture(v.fNumber));
    if (m.shutters.size === 0 && v.exposureTime != null) { const s = formatShutter(v.exposureTime); if (s) m.shutters.add(s); }
    if (m.isos.size === 0 && v.iSO != null) m.isos.add(String(Math.round(v.iSO / 1e6)));
    if (!m.date && v.dateTimeOriginal) m.date = v.dateTimeOriginal;
    // note: grain EXIF carries no GPS, so location stays graycard-only.
  }

  const galleryPhotos = new Map();
  const galleryOfPhoto = new Map();
  for (const it of galleryItems) {
    const g = it.value.gallery;
    if (!galleryPhotos.has(g)) galleryPhotos.set(g, []);
    galleryPhotos.get(g).push(it.value.item);
    if (!galleryOfPhoto.has(it.value.item)) galleryOfPhoto.set(it.value.item, g);
  }

  // --- 3. location resolution (precedence: exposure > capture > gallery > shoot) ---
  // fallbacks reach photos that never got per-frame GPS: a manual gallery default,
  // or the place attached to the shoot the photo belongs to.
  const galleryDefaultLoc = new Map();
  for (const d of galleryDefaults) { if (d.value?.gallery && d.value.location) galleryDefaultLoc.set(d.value.gallery, d.value.location); }
  const shootPlace = new Map();
  for (const sh of shoots) {
    const places = sh.value?.places || [];
    if (places.length && places[0]?.latitude != null) shootPlace.set(sh.uri, places[0]);
  }
  // seed lower-priority fallbacks for every photo we know a gallery/shoot for
  for (const [photo, g] of galleryOfPhoto) offerLoc(photo, galleryDefaultLoc.get(g), "gallery");
  for (const [photo, sh] of shootOfPhoto) offerLoc(photo, shootPlace.get(sh), "shoot");
  for (const [photo, { location }] of locByPhoto) {
    const cell = coarseCell(location); if (!cell) continue;
    const m = ensure(photo);
    m.cell = cell.key; m.cellLabel = cell.label; m.cellLat = cell.lat; m.cellLon = cell.lon;
  }

  return { meta, galleryPhotos };
}

// state key -> the meta Set it filters against.
const FACET_META = {
  camera: "cameras", cameraType: "cameraTypes",
  lens: "lenses", lensType: "lensTypes",
  filter: "filters", filterType: "filterTypes",
  film: "films", shoot: "shoots",
  aperture: "apertures", shutter: "shutters", iso: "isos", cell: "cell",
};
const FACET_KEYS = Object.keys(FACET_META);

export function emptyFilterState() {
  const s = { from: null, to: null };
  for (const k of FACET_KEYS) s[k] = new Set();
  return s;
}

export function filterIsEmpty(s) {
  return !s.from && !s.to && FACET_KEYS.every((k) => !s[k] || s[k].size === 0);
}

// gear kinds where a selected instance OR a selected model both count (a model
// is the union of its owned bodies plus EXIF model-level matches).
const GEAR_PAIRS = [
  ["camera", "cameraType", "cameras", "cameraTypes"],
  ["lens", "lensType", "lenses", "lensTypes"],
  ["filter", "filterType", "filters", "filterTypes"],
];
const SIMPLE_FACETS = [["film", "films"], ["shoot", "shoots"], ["aperture", "apertures"], ["shutter", "shutters"], ["iso", "isos"]];

// does one photo (by its indexed meta) satisfy the active filters? Within a gear
// kind, instance OR model both count; other facets are OR-within / AND-across.
// A photo with no metadata only matches when no filter is active.
export function photoMatches(meta, s) {
  if (filterIsEmpty(s)) return true;
  if (!meta) return false;
  for (const [instKey, typeKey, metaInst, metaType] of GEAR_PAIRS) {
    const si = s[instKey], st = s[typeKey];
    if ((!si || !si.size) && (!st || !st.size)) continue;               // this kind isn't filtered
    const byInst = si && si.size && [...si].some((x) => meta[metaInst].has(x));
    const byType = st && st.size && [...st].some((x) => meta[metaType].has(x));
    if (!byInst && !byType) return false;
  }
  for (const [key, metaKey] of SIMPLE_FACETS) {
    const sel = s[key]; if (!sel || !sel.size) continue;
    if (![...sel].some((x) => meta[metaKey].has(x))) return false;
  }
  if (s.cell && s.cell.size && !(meta.cell && s.cell.has(meta.cell))) return false;
  const day = meta.date ? meta.date.slice(0, 10) : null;
  if (s.from && (!day || day < s.from)) return false;
  if (s.to && (!day || day > s.to)) return false;
  return true;
}
