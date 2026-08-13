type GearKind = "camera" | "lens" | "filter";
type ExifGearKind = Exclude<GearKind, "filter">;

export interface PublicPlacemark {
  name?: string | null;
  locality?: string | null;
  administrativeArea?: string | null;
}

export interface PublicLocation {
  latitude?: number | null;
  longitude?: number | null;
  placemark?: PublicPlacemark | null;
}

export interface CoarseLocationCell {
  key: string;
  lat: number;
  lon: number;
  label: string;
}

interface ValueRecord<Value> {
  uri?: string;
  value: Value;
}

interface GearTypeValue {
  make?: string | null;
  model?: string | null;
}

interface FilmStockValue extends GearTypeValue {
  iso?: number | null;
}

interface GearInstanceValue {
  type?: string | null;
}

interface ExposureValue {
  photo?: string | null;
  camera?: string | null;
  lens?: string | null;
  filter?: string | null;
  roll?: string | null;
  shoot?: string | null;
  aperture?: string | null;
  shutterSpeed?: string | null;
  shotAtIso?: number | null;
  takenAt?: string | null;
  createdAt?: string | null;
  location?: PublicLocation | null;
}

interface IndexedValue {
  stock?: string | null;
  iso?: number | null;
}

interface IndexEntry {
  item?: { value?: IndexedValue };
}

interface UriLookup {
  get(uri: string): IndexEntry | undefined;
}

export interface ProfileFilterStore {
  byUri?: UriLookup;
  catalog?: {
    cameraType?: readonly ValueRecord<GearTypeValue>[];
    lensType?: readonly ValueRecord<GearTypeValue>[];
    filterType?: readonly ValueRecord<GearTypeValue>[];
    filmStock?: readonly ValueRecord<FilmStockValue>[];
  };
  instance?: {
    camera?: readonly ValueRecord<GearInstanceValue>[];
    lens?: readonly ValueRecord<GearInstanceValue>[];
    filter?: readonly ValueRecord<GearInstanceValue>[];
    exposure?: readonly ValueRecord<ExposureValue>[];
  };
}

interface CaptureValue {
  photo?: string | null;
  camera?: string | null;
  lens?: string | null;
  filmRoll?: string | null;
  shoot?: string | null;
  location?: PublicLocation | null;
}

interface ExifValue {
  photo?: string | null;
  make?: string | null;
  model?: string | null;
  lensMake?: string | null;
  lensModel?: string | null;
  fNumber?: number | null;
  exposureTime?: number | null;
  iSO?: number | null;
  dateTimeOriginal?: string | null;
}

interface GalleryItemValue {
  gallery: string;
  item: string;
}

interface ShootValue {
  places?: readonly PublicLocation[];
}

interface GalleryDefaultsValue {
  gallery?: string | null;
  location?: PublicLocation | null;
}

export interface ProfileIndexInput {
  store?: ProfileFilterStore;
  captures?: readonly ValueRecord<CaptureValue>[];
  galleryItems?: readonly ValueRecord<GalleryItemValue>[];
  exif?: readonly ValueRecord<ExifValue>[];
  shoots?: readonly (ValueRecord<ShootValue> & { uri: string })[];
  galleryDefaults?: readonly ValueRecord<GalleryDefaultsValue>[];
}

export interface PhotoFacetMetadata {
  cameras: Set<string>;
  cameraTypes: Set<string>;
  lenses: Set<string>;
  lensTypes: Set<string>;
  filters: Set<string>;
  filterTypes: Set<string>;
  films: Set<string>;
  shoots: Set<string>;
  apertures: Set<string>;
  shutters: Set<string>;
  isos: Set<string>;
  date: string | null;
  cell: string | null;
  cellLabel: string | null;
  cellLat: number | null;
  cellLon: number | null;
}

export interface PhotoIndex {
  meta: Map<string, PhotoFacetMetadata>;
  galleryPhotos: Map<string, string[]>;
}

const normalizeGear = (value: string | null | undefined): string =>
  (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function gearKeys(make: string | null | undefined, model: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (model) keys.add(normalizeGear(model));
  if (make && model) keys.add(normalizeGear(make) + normalizeGear(model));
  return keys;
}

function formatAperture(scaled: number): string {
  const aperture = scaled / 1e6;
  return Number.isInteger(aperture) ? String(aperture) : String(+aperture.toFixed(1));
}

function formatShutter(scaled: number): string | null {
  const seconds = scaled / 1e6;
  if (seconds <= 0) return null;
  return seconds < 1 ? `1/${Math.round(1 / seconds)}` : `${+seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

/** Public locations use a roughly five-kilometre cell to avoid exposing precise positions. */
export const CELL_DEG = 0.05;

export function coarseCell(location: PublicLocation | null | undefined): CoarseLocationCell | null {
  if (!location || location.latitude == null || location.longitude == null) return null;
  const latitude = location.latitude / 1e7;
  const longitude = location.longitude / 1e7;
  const latitudeIndex = Math.round(latitude / CELL_DEG);
  const longitudeIndex = Math.round(longitude / CELL_DEG);
  const placemark = location.placemark;
  return {
    key: `${latitudeIndex},${longitudeIndex}`,
    lat: latitudeIndex * CELL_DEG,
    lon: longitudeIndex * CELL_DEG,
    label:
      placemark?.name ||
      placemark?.locality ||
      placemark?.administrativeArea ||
      `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
  };
}

function catalogForKind(store: ProfileFilterStore | undefined, kind: GearKind): readonly ValueRecord<GearTypeValue>[] {
  if (kind === "camera") return store?.catalog?.cameraType || [];
  if (kind === "lens") return store?.catalog?.lensType || [];
  return store?.catalog?.filterType || [];
}

function instancesForKind(
  store: ProfileFilterStore | undefined,
  kind: GearKind,
): readonly ValueRecord<GearInstanceValue>[] {
  if (kind === "camera") return store?.instance?.camera || [];
  if (kind === "lens") return store?.instance?.lens || [];
  return store?.instance?.filter || [];
}

function buildGearResolver(store: ProfileFilterStore | undefined) {
  const typeByKey: Record<ExifGearKind, Map<string, Set<string>>> = {
    camera: new Map(),
    lens: new Map(),
  };
  const instancesByType: Record<GearKind, Map<string, string[]>> = {
    camera: new Map(),
    lens: new Map(),
    filter: new Map(),
  };
  const typeOf: Record<GearKind, Map<string, string>> = {
    camera: new Map(),
    lens: new Map(),
    filter: new Map(),
  };

  for (const kind of ["camera", "lens", "filter"] as const) {
    if (kind !== "filter") {
      for (const typeRecord of catalogForKind(store, kind)) {
        if (!typeRecord.uri) continue;
        for (const key of gearKeys(typeRecord.value.make, typeRecord.value.model)) {
          if (!typeByKey[kind].has(key)) typeByKey[kind].set(key, new Set());
          typeByKey[kind].get(key)?.add(typeRecord.uri);
        }
      }
    }
    for (const instance of instancesForKind(store, kind)) {
      const typeUri = instance.value.type;
      if (!instance.uri || !typeUri) continue;
      typeOf[kind].set(instance.uri, typeUri);
      if (!instancesByType[kind].has(typeUri)) instancesByType[kind].set(typeUri, []);
      instancesByType[kind].get(typeUri)?.push(instance.uri);
    }
  }

  return {
    resolveTypes: (kind: ExifGearKind, make?: string | null, model?: string | null): string[] => {
      const types = new Set<string>();
      for (const key of gearKeys(make, model)) {
        for (const typeUri of typeByKey[kind].get(key) || []) types.add(typeUri);
      }
      return [...types];
    },
    instancesOfType: (kind: GearKind, typeUri: string): string[] => instancesByType[kind].get(typeUri) || [],
    typeOf: (kind: GearKind, uri: string): string | null => typeOf[kind].get(uri) || null,
  };
}

function createPhotoMetadata(): PhotoFacetMetadata {
  return {
    cameras: new Set(),
    cameraTypes: new Set(),
    lenses: new Set(),
    lensTypes: new Set(),
    filters: new Set(),
    filterTypes: new Set(),
    films: new Set(),
    shoots: new Set(),
    apertures: new Set(),
    shutters: new Set(),
    isos: new Set(),
    date: null,
    cell: null,
    cellLabel: null,
    cellLat: null,
    cellLon: null,
  };
}

function gearSets(metadata: PhotoFacetMetadata, kind: GearKind): [Set<string>, Set<string>] {
  if (kind === "camera") return [metadata.cameras, metadata.cameraTypes];
  if (kind === "lens") return [metadata.lenses, metadata.lensTypes];
  return [metadata.filters, metadata.filterTypes];
}

type LocationSource = "exposure" | "capture" | "gallery" | "shoot";

export function buildPhotoIndex({
  store,
  captures = [],
  galleryItems = [],
  exif = [],
  shoots = [],
  galleryDefaults = [],
}: ProfileIndexInput): PhotoIndex {
  const gear = buildGearResolver(store);
  const meta = new Map<string, PhotoFacetMetadata>();
  const ensure = (photoUri: string): PhotoFacetMetadata => {
    const existing = meta.get(photoUri);
    if (existing) return existing;
    const created = createPhotoMetadata();
    meta.set(photoUri, created);
    return created;
  };
  const stockOfRoll = (rollUri: string): string | null => store?.byUri?.get(rollUri)?.item?.value?.stock || null;
  const isoOfStock = (stockUri: string): number | null => store?.byUri?.get(stockUri)?.item?.value?.iso ?? null;
  const locationByPhoto = new Map<string, { location: PublicLocation; source: LocationSource }>();
  const shootOfPhoto = new Map<string, string>();
  const locationRank: Record<LocationSource, number> = { exposure: 3, capture: 2, gallery: 1, shoot: 0 };
  const offerLocation = (
    photoUri: string,
    location: PublicLocation | null | undefined,
    source: LocationSource,
  ): void => {
    if (!location || location.latitude == null) return;
    const current = locationByPhoto.get(photoUri);
    if (!current || locationRank[source] > locationRank[current.source]) {
      locationByPhoto.set(photoUri, { location, source });
    }
  };
  const addGraycardGear = (metadata: PhotoFacetMetadata, kind: GearKind, uri: string): void => {
    const [instanceSet, typeSet] = gearSets(metadata, kind);
    instanceSet.add(uri);
    const typeUri = gear.typeOf(kind, uri);
    if (typeUri) typeSet.add(typeUri);
  };

  for (const capture of captures) {
    const value = capture.value;
    if (!value.photo) continue;
    const metadata = ensure(value.photo);
    if (value.camera) addGraycardGear(metadata, "camera", value.camera);
    if (value.lens) addGraycardGear(metadata, "lens", value.lens);
    if (value.filmRoll) {
      const stockUri = stockOfRoll(value.filmRoll);
      if (stockUri) {
        metadata.films.add(stockUri);
        const iso = isoOfStock(stockUri);
        if (iso != null) metadata.isos.add(String(iso));
      }
    }
    if (value.shoot) {
      metadata.shoots.add(value.shoot);
      shootOfPhoto.set(value.photo, value.shoot);
    }
    offerLocation(value.photo, value.location, "capture");
  }

  for (const exposure of store?.instance?.exposure || []) {
    const value = exposure.value;
    if (!value.photo) continue;
    const metadata = ensure(value.photo);
    if (value.camera) addGraycardGear(metadata, "camera", value.camera);
    if (value.lens) addGraycardGear(metadata, "lens", value.lens);
    if (value.filter) addGraycardGear(metadata, "filter", value.filter);
    if (value.roll) {
      const stockUri = stockOfRoll(value.roll);
      if (stockUri) {
        metadata.films.add(stockUri);
        const iso = isoOfStock(stockUri);
        if (iso != null) metadata.isos.add(String(iso));
      }
    }
    if (value.shoot) {
      metadata.shoots.add(value.shoot);
      shootOfPhoto.set(value.photo, value.shoot);
    }
    if (value.aperture) metadata.apertures.add(value.aperture);
    if (value.shutterSpeed) metadata.shutters.add(value.shutterSpeed);
    if (value.shotAtIso != null) metadata.isos.add(String(value.shotAtIso));
    const date = value.takenAt || value.createdAt;
    if (date && (!metadata.date || date < metadata.date)) metadata.date = date;
    offerLocation(value.photo, value.location, "exposure");
  }

  const addExifGear = (
    metadata: PhotoFacetMetadata,
    kind: ExifGearKind,
    make?: string | null,
    model?: string | null,
  ): void => {
    const [instanceSet, typeSet] = gearSets(metadata, kind);
    if (instanceSet.size || typeSet.size) return;
    for (const typeUri of gear.resolveTypes(kind, make, model)) {
      typeSet.add(typeUri);
      const instances = gear.instancesOfType(kind, typeUri);
      if (instances.length === 1) instanceSet.add(instances[0]);
    }
  };

  for (const exifRecord of exif) {
    const value = exifRecord.value;
    if (!value.photo) continue;
    const metadata = ensure(value.photo);
    if (value.make || value.model) addExifGear(metadata, "camera", value.make, value.model);
    if (value.lensMake || value.lensModel) addExifGear(metadata, "lens", value.lensMake, value.lensModel);
    if (metadata.apertures.size === 0 && value.fNumber != null) metadata.apertures.add(formatAperture(value.fNumber));
    if (metadata.shutters.size === 0 && value.exposureTime != null) {
      const shutter = formatShutter(value.exposureTime);
      if (shutter) metadata.shutters.add(shutter);
    }
    if (metadata.isos.size === 0 && value.iSO != null) metadata.isos.add(String(Math.round(value.iSO / 1e6)));
    if (!metadata.date && value.dateTimeOriginal) metadata.date = value.dateTimeOriginal;
  }

  const galleryPhotos = new Map<string, string[]>();
  const galleryOfPhoto = new Map<string, string>();
  for (const item of galleryItems) {
    const galleryUri = item.value.gallery;
    if (!galleryPhotos.has(galleryUri)) galleryPhotos.set(galleryUri, []);
    galleryPhotos.get(galleryUri)?.push(item.value.item);
    if (!galleryOfPhoto.has(item.value.item)) galleryOfPhoto.set(item.value.item, galleryUri);
  }

  const galleryDefaultLocation = new Map<string, PublicLocation>();
  for (const defaults of galleryDefaults) {
    if (defaults.value.gallery && defaults.value.location) {
      galleryDefaultLocation.set(defaults.value.gallery, defaults.value.location);
    }
  }
  const shootPlace = new Map<string, PublicLocation>();
  for (const shoot of shoots) {
    const places = shoot.value.places || [];
    if (places.length && places[0]?.latitude != null) shootPlace.set(shoot.uri, places[0]);
  }
  for (const [photoUri, galleryUri] of galleryOfPhoto) {
    offerLocation(photoUri, galleryDefaultLocation.get(galleryUri), "gallery");
  }
  for (const [photoUri, shootUri] of shootOfPhoto) offerLocation(photoUri, shootPlace.get(shootUri), "shoot");
  for (const [photoUri, { location }] of locationByPhoto) {
    const cell = coarseCell(location);
    if (!cell) continue;
    const metadata = ensure(photoUri);
    metadata.cell = cell.key;
    metadata.cellLabel = cell.label;
    metadata.cellLat = cell.lat;
    metadata.cellLon = cell.lon;
  }

  return { meta, galleryPhotos };
}

type FilterFacet =
  | "camera"
  | "cameraType"
  | "lens"
  | "lensType"
  | "filter"
  | "filterType"
  | "film"
  | "shoot"
  | "aperture"
  | "shutter"
  | "iso"
  | "cell";

const FILTER_FACETS: readonly FilterFacet[] = [
  "camera",
  "cameraType",
  "lens",
  "lensType",
  "filter",
  "filterType",
  "film",
  "shoot",
  "aperture",
  "shutter",
  "iso",
  "cell",
];

export type PhotoFilterState = { from: string | null; to: string | null } & Record<FilterFacet, Set<string>>;

export function emptyFilterState(): PhotoFilterState {
  const state = { from: null, to: null } as PhotoFilterState;
  for (const facet of FILTER_FACETS) state[facet] = new Set();
  return state;
}

export function filterIsEmpty(state: PhotoFilterState): boolean {
  return !state.from && !state.to && FILTER_FACETS.every((facet) => !state[facet] || state[facet].size === 0);
}

const GEAR_PAIRS = [
  ["camera", "cameraType", "cameras", "cameraTypes"],
  ["lens", "lensType", "lenses", "lensTypes"],
  ["filter", "filterType", "filters", "filterTypes"],
] as const;

const SIMPLE_FACETS = [
  ["film", "films"],
  ["shoot", "shoots"],
  ["aperture", "apertures"],
  ["shutter", "shutters"],
  ["iso", "isos"],
] as const;

export function photoMatches(metadata: PhotoFacetMetadata | null | undefined, state: PhotoFilterState): boolean {
  if (filterIsEmpty(state)) return true;
  if (!metadata) return false;
  for (const [instanceKey, typeKey, metaInstanceKey, metaTypeKey] of GEAR_PAIRS) {
    const selectedInstances = state[instanceKey];
    const selectedTypes = state[typeKey];
    if ((!selectedInstances || !selectedInstances.size) && (!selectedTypes || !selectedTypes.size)) continue;
    const byInstance =
      selectedInstances &&
      selectedInstances.size &&
      [...selectedInstances].some((uri) => metadata[metaInstanceKey].has(uri));
    const byType =
      selectedTypes && selectedTypes.size && [...selectedTypes].some((uri) => metadata[metaTypeKey].has(uri));
    if (!byInstance && !byType) return false;
  }
  for (const [filterKey, metadataKey] of SIMPLE_FACETS) {
    const selected = state[filterKey];
    if (!selected || !selected.size) continue;
    if (![...selected].some((value) => metadata[metadataKey].has(value))) return false;
  }
  if (state.cell && state.cell.size && !(metadata.cell && state.cell.has(metadata.cell))) return false;
  const day = metadata.date ? metadata.date.slice(0, 10) : null;
  if (state.from && (!day || day < state.from)) return false;
  if (state.to && (!day || day > state.to)) return false;
  return true;
}
