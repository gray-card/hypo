import { describe, it, expect } from "vitest";
import { buildPhotoIndex, emptyFilterState, filterIsEmpty, photoMatches, coarseCell } from "../src/profileFilter.js";

const f2Type = "at://did/app.graycard.catalog.cameraType/f2";
const lens50Type = "at://did/app.graycard.catalog.lensType/l50";
const stockUri = "at://did/app.graycard.catalog.filmStock/trix";
const rollUri = "at://did/app.graycard.instance.filmRoll/r1";
const camA = "at://did/app.graycard.instance.camera/A"; // two F2 bodies -> model is ambiguous
const camB = "at://did/app.graycard.instance.camera/B";
const lensX = "at://did/app.graycard.instance.lens/X"; // one 50mm -> unambiguous

const pG = "at://did/social.grain.photo/pG"; // graycard exposure (source of truth) + EXIF
const pE = "at://did/social.grain.photo/pE"; // EXIF only

function fixture() {
  const byUri = new Map([[rollUri, { item: { value: { stock: stockUri } } }]]);
  const store = {
    byUri,
    catalog: {
      cameraType: [{ uri: f2Type, value: { make: "Nikon", model: "F2" } }],
      lensType: [{ uri: lens50Type, value: { make: "Nikon", model: "Nikkor 50mm f/1.4 AI" } }],
      filmStock: [{ uri: stockUri, value: { brand: "Kodak", name: "Tri-X 400" } }],
    },
    instance: {
      camera: [{ uri: camA, value: { type: f2Type } }, { uri: camB, value: { type: f2Type } }],
      lens: [{ uri: lensX, value: { type: lens50Type } }],
      exposure: [{ uri: "e1", value: { photo: pG, camera: camA, aperture: "8", takenAt: "2026-06-10T12:00:00Z" } }],
    },
  };
  const exif = [
    { value: { photo: pG, make: "Nikon", model: "F2", fNumber: 16000000 } }, // graycard already covers pG's camera+aperture
    { value: { photo: pE, make: "Nikon", model: "F2", lensMake: "Nikon", lensModel: "Nikkor 50mm f/1.4 AI", fNumber: 5600000, exposureTime: 2000, dateTimeOriginal: "2026-06-13T18:24:00Z" } },
  ];
  const galleryItems = [{ value: { gallery: "at://g1", item: pG } }, { value: { gallery: "at://g1", item: pE } }];
  return { store, captures: [], galleryItems, exif };
}

describe("buildPhotoIndex — graycard is truth; EXIF fills gaps; instance vs model", () => {
  const idx = buildPhotoIndex(fixture());

  it("uses graycard for a facet and ignores EXIF there", () => {
    const m = idx.meta.get(pG);
    expect([...m.cameras]).toEqual([camA]);       // graycard body
    expect([...m.cameraTypes]).toEqual([f2Type]); // and its model
    expect([...m.apertures]).toEqual(["8"]);      // graycard "8", NOT EXIF f/16
  });

  it("EXIF-only + duplicated model: attributes the MODEL but not a specific body", () => {
    const m = idx.meta.get(pE);
    expect(m.cameras.size).toBe(0);               // two F2s -> can't pick one
    expect([...m.cameraTypes]).toEqual([f2Type]); // but the model is known
  });

  it("EXIF-only + single owned copy: resolves to that instance (and model)", () => {
    const m = idx.meta.get(pE);
    expect([...m.lenses]).toEqual([lensX]);
    expect([...m.lensTypes]).toEqual([lens50Type]);
  });

  it("EXIF fills aperture/shutter/date when graycard is absent", () => {
    const m = idx.meta.get(pE);
    expect([...m.apertures]).toEqual(["5.6"]);
    expect([...m.shutters]).toEqual(["1/500"]);
    expect(m.date).toBe("2026-06-13T18:24:00Z");
  });
});

describe("photoMatches — instance filters are exact, model filters are model-level", () => {
  const idx = buildPhotoIndex(fixture());

  it("no filter matches everything", () => {
    const s = emptyFilterState();
    expect(filterIsEmpty(s)).toBe(true);
    expect(photoMatches(idx.meta.get(pG), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pE), s)).toBe(true);
  });

  it("filtering by a specific body matches only graycard-tagged photos", () => {
    const s = emptyFilterState(); s.camera.add(camA);
    expect(photoMatches(idx.meta.get(pG), s)).toBe(true);  // tagged camA
    expect(photoMatches(idx.meta.get(pE), s)).toBe(false); // EXIF F2 not pinned to a body
  });

  it("filtering by the camera MODEL matches graycard AND EXIF photos of that model", () => {
    const s = emptyFilterState(); s.cameraType.add(f2Type);
    expect(photoMatches(idx.meta.get(pG), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pE), s)).toBe(true);
  });

  it("filtering by the (single-copy) lens matches the EXIF-only photo", () => {
    const s = emptyFilterState(); s.lens.add(lensX);
    expect(photoMatches(idx.meta.get(pE), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pG), s)).toBe(false);
  });

  it("model + all its bodies selected together still matches EXIF-only photos (OR within a kind)", () => {
    const s = emptyFilterState(); s.cameraType.add(f2Type); s.camera.add(camA); s.camera.add(camB);
    expect(photoMatches(idx.meta.get(pE), s)).toBe(true);  // via the model
    expect(photoMatches(idx.meta.get(pG), s)).toBe(true);  // via body or model
  });

  it("aperture facet respects graycard-vs-EXIF per photo", () => {
    const s = emptyFilterState(); s.aperture.add("8");
    expect(photoMatches(idx.meta.get(pG), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pE), s)).toBe(false);
  });
});

describe("location — precedence, fallbacks, and ~5km coarsening", () => {
  const nyc = { latitude: 407128000, longitude: -740060000, placemark: { name: "Manhattan" } };
  const la = { latitude: 340522000, longitude: -1182437000 };
  const paris = { latitude: 488566000, longitude: 23522000 };
  const berlin = { latitude: 525200000, longitude: 134050000 };

  const shootUri = "at://did/app.graycard.session.capture/s1";
  const galleryUri = "at://did/social.grain.gallery/g1";
  const pExp = "at://did/social.grain.photo/pExp";  // exposure has GPS
  const pCap = "at://did/social.grain.photo/pCap";  // only a manual per-photo location
  const pGal = "at://did/social.grain.photo/pGal";  // only a gallery default
  const pSho = "at://did/social.grain.photo/pSho";  // only a shoot place

  const idx = buildPhotoIndex({
    store: { catalog: {}, instance: {
      exposure: [{ uri: "e1", value: { photo: pExp, location: nyc, shoot: shootUri } }],
    } },
    captures: [
      { value: { photo: pCap, location: la } },
      { value: { photo: pSho, shoot: shootUri } },   // linked to a shoot, no GPS of its own
    ],
    galleryItems: [
      { value: { gallery: galleryUri, item: pGal } },
      { value: { gallery: galleryUri, item: pExp } },
    ],
    galleryDefaults: [{ value: { gallery: galleryUri, location: paris } }],
    shoots: [{ uri: shootUri, value: { places: [berlin] } }],
  });

  it("coarseCell snaps to a ~0.05° grid and keeps a label", () => {
    const c = coarseCell(nyc);
    expect(c.key).toBe("814,-1480");
    expect(c.lat).toBeCloseTo(40.7, 5);
    expect(c.label).toBe("Manhattan");
  });

  it("per-frame exposure GPS wins over the gallery default it also belongs to", () => {
    expect(idx.meta.get(pExp).cell).toBe(coarseCell(nyc).key);   // NYC, not Paris
  });

  it("a manual per-photo capture location resolves when there's no exposure GPS", () => {
    expect(idx.meta.get(pCap).cell).toBe(coarseCell(la).key);
  });

  it("a photo with only a gallery membership inherits the gallery default", () => {
    expect(idx.meta.get(pGal).cell).toBe(coarseCell(paris).key);
  });

  it("a photo with only a shoot inherits the shoot's place", () => {
    expect(idx.meta.get(pSho).cell).toBe(coarseCell(berlin).key);
  });

  it("filters by a coarse cell", () => {
    const s = emptyFilterState(); s.cell.add(coarseCell(paris).key);
    expect(photoMatches(idx.meta.get(pGal), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pExp), s)).toBe(false);
  });
});

describe("ISO facet — film stock box speed (graycard) with EXIF fallback", () => {
  const stock = "at://did/app.graycard.catalog.filmStock/trix400";
  const roll = "at://did/app.graycard.instance.filmRoll/r1";
  const pCap = "at://did/social.grain.photo/pCap";   // graycard: roll -> stock iso 400
  const pExif = "at://did/social.grain.photo/pExif"; // no film -> EXIF iSO fallback (200)
  const idx = buildPhotoIndex({
    store: {
      byUri: new Map([
        [roll, { item: { value: { stock } } }],
        [stock, { item: { value: { brand: "Kodak", name: "Tri-X 400", iso: 400 } } }],
      ]),
      catalog: { filmStock: [{ uri: stock, value: { brand: "Kodak", name: "Tri-X 400", iso: 400 } }] },
      instance: {},
    },
    captures: [{ value: { photo: pCap, filmRoll: roll } }],
    exif: [{ value: { photo: pExif, iSO: 200000000 } }],
  });

  it("derives ISO from the film stock's box speed", () => {
    expect([...idx.meta.get(pCap).isos]).toEqual(["400"]);
  });

  it("falls back to EXIF iSO (scaled by 1e6) when graycard has no film", () => {
    expect([...idx.meta.get(pExif).isos]).toEqual(["200"]);
  });

  it("filters photos by ISO", () => {
    const s = emptyFilterState();
    s.iso.add("400");
    expect(photoMatches(idx.meta.get(pCap), s)).toBe(true);
    expect(photoMatches(idx.meta.get(pExif), s)).toBe(false);
  });
});
