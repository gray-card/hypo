// presets.js: seed catalogs for type autocomplete.
//
// Factual name/attribute reference lists compiled from general knowledge
// (camera makes/models, currently-available film stocks, common darkroom
// chemistry). Facts like a camera model name or a film's box speed are not
// copyrightable. Nothing here is derived from a licensed database. Users get
// incremental match-as-you-type suggestions and may enter anything freely.

import { getDefaultCatalogClient } from "@hypo/catalog";
import { CURATED_MOUNT_NAMES, GEAR_FIELD_ENUM_OPTIONS, LEXICON_ENUM_OPTIONS } from "@hypo/lexicon";

// lensfun (CC-BY-SA) plus the curated non-lensfun additions (e.g. Nikon's
// manual-focus line), deduped at build time so a lens never appears twice.
const ALL_LENSES = [];

export const ENUMS = {
  format: LEXICON_ENUM_OPTIONS.captureFormat,
  process: LEXICON_ENUM_OPTIONS.filmProcess,
  filmType: LEXICON_ENUM_OPTIONS.filmType,
  category: LEXICON_ENUM_OPTIONS.cameraCategory,
  roles: LEXICON_ENUM_OPTIONS.chemistryRole,
  form: LEXICON_ENUM_OPTIONS.developerForm,
  scannerKind: LEXICON_ENUM_OPTIONS.scannerKind,
  base: LEXICON_ENUM_OPTIONS.paperBase,
  surface: LEXICON_ENUM_OPTIONS.paperSurface,
  lensTypeKind: LEXICON_ENUM_OPTIONS.lensTypeKind,
  filterKind: LEXICON_ENUM_OPTIONS.filterKind,
  meteringMode: LEXICON_ENUM_OPTIONS.meteringMode,
  exposureProgram: LEXICON_ENUM_OPTIONS.exposureProgram,
  stopFraction: LEXICON_ENUM_OPTIONS.stopFraction,
  printProcess: LEXICON_ENUM_OPTIONS.printProcess,
  medium: LEXICON_ENUM_OPTIONS.paperMedium,
  contrast: LEXICON_ENUM_OPTIONS.paperContrast,
  tone: LEXICON_ENUM_OPTIONS.paperTone,
  maxFormat: LEXICON_ENUM_OPTIONS.negativeFormat,
  coversFormat: LEXICON_ENUM_OPTIONS.negativeFormat,
  headType: LEXICON_ENUM_OPTIONS.headType,
  printerTechnology: LEXICON_ENUM_OPTIONS.printerTechnology,
  inkType: LEXICON_ENUM_OPTIONS.inkType,
  lightTechnology: LEXICON_ENUM_OPTIONS.lightTechnology,
  mount: CURATED_MOUNT_NAMES,
  storage: LEXICON_ENUM_OPTIONS.storage,
  rollStatus: LEXICON_ENUM_OPTIONS.rollStatus,
  cassetteType: LEXICON_ENUM_OPTIONS.cassetteType,
  artifactKind: LEXICON_ENUM_OPTIONS.artifactKind,
};

export const MANUFACTURERS = [
  "Kodak",
  "Ilford",
  "Fujifilm",
  "Harman",
  "Kentmere",
  "Cinestill",
  "Foma",
  "Adox",
  "Rollei",
  "Lomography",
  "Japan Camera Hunter",
  "Kosmo Foto",
  "Bergger",
  "Washi",
  "CatLABS",
  "Flic Film",
  "Nikon",
  "Canon",
  "Leica",
  "Hasselblad",
  "Pentax",
  "Olympus",
  "OM System",
  "Minolta",
  "Konica",
  "Konica Minolta",
  "Contax",
  "Zeiss",
  "Zeiss Ikon",
  "Voigtländer",
  "Mamiya",
  "Bronica",
  "Rolleiflex",
  "Yashica",
  "Fujica",
  "Sony",
  "Ricoh",
  "Sigma",
  "Panasonic",
  "Polaroid",
  "Instax",
  "Phase One",
  "Praktica",
  "Exakta",
  "Zenit",
  "FED",
  "Kiev",
  "Chinon",
  "Cosina",
  "Petri",
  "Argus",
  "Epson",
  "Plustek",
  "Noritsu",
  "Valoi",
  "Negative Supply",
  "Tetenal",
  "Bellini",
  "Photographers' Formulary",
  "Moersch",
  "Paterson",
  "TTArtisan",
  "7Artisans",
  "Tamron",
  "Tokina",
  "Samyang",
  "Intrepid",
  "Chamonix",
]
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort((a, b) => a.localeCompare(b));

// `aka` lists other names the SAME emulsion is sold under (a rebrand). Both names
// stay as their own entries — a photographer may hold a box under either label —
// but each points at the other so clients can treat them as one film.
const film = (brand, name, iso, filmType, process, aka) => ({
  brand,
  name,
  iso,
  filmType,
  process,
  ...(aka ? { aka } : {}),
});
const developerRoles = (process, form) => {
  if (process === "monobath") return ["film-developer", "fixer"];
  if (form !== "kit") return ["film-developer"];
  if (process === "e6") return ["first-developer", "color-developer", "bleach", "fixer", "stabilizer"];
  if (process === "c41") return ["color-developer", "bleach", "fixer", "stabilizer"];
  if (process === "ecn2") return ["color-developer", "bleach", "fixer"];
  return ["film-developer"];
};
const dev = (brand, name, process, form, defaultDilution, datasheetUrl) => ({
  brand,
  name,
  roles: developerRoles(process, form),
  productKind: form === "kit" ? "process-kit" : "single-chemical",
  process,
  form,
  defaultDilution,
  ...(datasheetUrl ? { datasheetUrl } : {}),
});
const chem = (brand, name, roles, form, datasheetUrl) => ({
  brand,
  name,
  roles: Array.isArray(roles) ? roles : [roles],
  productKind: form === "kit" ? "multi-part-chemical" : "single-chemical",
  form,
  ...(datasheetUrl ? { datasheetUrl } : {}),
});
const scan = (make, model, scannerKind) => ({ make, model, scannerKind });
const paper = (brand, name, surface) => ({ brand, name, surface });
const filt = (make, name, filterKind, threadDiameterMm) => ({ make, name, filterKind, threadDiameterMm });

// mount is carried so the "add gear" form can autofill it from the model, the
// same way lensfun cameras/lenses do. Groups are split by mount where a make's
// bodies span several mounts (e.g. Canon FD manual vs EF autofocus).
const fc = (make, format, mount, models) => models.map((model) => ({ make, model, category: "film", format, mount }));
const dc = (make, format, mount, models) =>
  models.map((model) => ({ make, model, category: "digital", format, mount }));
const ic = (make, format, models) =>
  models.map((model) => ({ make, model, category: "instant", format, mount: "fixed" }));

// Camera catalog = curated + lensfun. lensfun (the single source of truth for
// digital bodies) has almost no film/instant cameras and lacks a handful of
// older/niche digital ones, so those stay curated here. Every other digital
// body comes from lensfun and is deduped out below.
const CURATED_CAMERAS = [
  // --- Nikon film ---
  ...fc("Nikon", "35mm", "Nikon F", [
    "F",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "FM",
    "FM2",
    "FM2n",
    "FM3A",
    "FE",
    "FE2",
    "FA",
    "FG",
    "EM",
    "FM10",
    "Nikkormat FT2",
    "Nikkormat EL",
    "N80 / F80",
    "N90 / F90X",
    "F100",
  ]),
  ...fc("Nikon", "35mm", "fixed", ["L35AF", "28Ti", "35Ti"]),
  ...fc("Nikon", "35mm", "other", ["Nikonos V"]),
  // --- Canon film ---
  ...fc("Canon", "35mm", "Canon FD", [
    "F-1",
    "F-1N",
    "A-1",
    "AE-1",
    "AE-1 Program",
    "AT-1",
    "AV-1",
    "AL-1",
    "T70",
    "T90",
  ]),
  ...fc("Canon", "35mm", "Canon EF", [
    "EOS 1",
    "EOS 1N",
    "EOS 1V",
    "EOS 3",
    "EOS 5",
    "EOS 30 / 33",
    "EOS 300",
    "EOS Rebel 2000",
  ]),
  ...fc("Canon", "35mm", "fixed", ["Canonet QL17 GIII", "Sure Shot"]),
  // --- Pentax film ---
  ...fc("Pentax", "35mm", "M42", ["Spotmatic", "Spotmatic F", "ES II"]),
  ...fc("Pentax", "35mm", "Pentax K", [
    "K1000",
    "KX",
    "KM",
    "ME Super",
    "MX",
    "MG",
    "LX",
    "Super Program",
    "P30",
    "MZ-5 / ZX-5",
    "MZ-S",
    "*ist",
  ]),
  ...fc("Pentax", "120", "Pentax 645", ["645", "645N", "645NII"]),
  ...fc("Pentax", "120", "Pentax 67", ["67", "67II", "6x7"]),
  // --- Olympus film ---
  ...fc("Olympus", "35mm", "Olympus OM", ["OM-1", "OM-2", "OM-3", "OM-4", "OM-10", "OM-2000"]),
  ...fc("Olympus", "35mm", "fixed", ["XA", "XA2", "Trip 35", "35 SP", "Mju II (Stylus Epic)", "Infinity Stylus"]),
  ...fc("Olympus", "half-frame", "other", ["Pen F", "Pen FT"]),
  ...fc("Olympus", "half-frame", "fixed", ["Pen EE"]),
  // --- Minolta film ---
  ...fc("Minolta", "35mm", "Minolta MD", [
    "SRT-101",
    "SRT-102",
    "XD-11 / XD7",
    "XE",
    "X-300",
    "X-500",
    "X-700",
    "X-570",
  ]),
  ...fc("Minolta", "35mm", "Minolta A", ["Maxxum 7000", "Maxxum 9", "Maxxum 7 / Dynax 7"]),
  ...fc("Minolta", "35mm", "fixed", ["TC-1", "Hi-Matic 7s", "Hi-Matic E"]),
  // --- Konica film ---
  ...fc("Konica", "35mm", "fixed", ["Auto S2", "Auto S3", "C35", "Hexar AF", "Big Mini"]),
  ...fc("Konica", "35mm", "Leica M", ["Hexar RF"]),
  ...fc("Konica", "35mm", "Konica AR", ["FT-1"]),
  // --- Leica film ---
  ...fc("Leica", "35mm", "Leica screw (LTM)", ["III", "IIIf", "IIIg"]),
  ...fc("Leica", "35mm", "Leica M", ["M2", "M3", "M4", "M4-P", "M5", "M6", "M6 TTL", "M7", "MP", "M-A", "CL"]),
  ...fc("Leica", "35mm", "Leica R", ["R6", "R7"]),
  ...fc("Leica", "35mm", "fixed", ["Minilux"]),
  // --- medium format + rangefinder film ---
  ...fc("Hasselblad", "120", "Hasselblad V", [
    "500C",
    "500C/M",
    "501CM",
    "503CW",
    "503CX",
    "553ELX",
    "903SWC",
    "905SWC",
    "2000FCW",
  ]),
  ...fc("Hasselblad", "35mm", "other", ["XPan", "XPan II"]),
  ...fc("Mamiya", "120", "Mamiya RB/RZ", ["RB67 Pro-S", "RB67 Pro-SD", "RZ67 Pro", "RZ67 Pro II"]),
  ...fc("Mamiya", "120", "Mamiya 645", ["645 1000S", "645 Super", "645 Pro TL"]),
  ...fc("Mamiya", "120", "other", ["6 MF", "7", "7 II"]),
  ...fc("Mamiya", "120", "fixed", ["C220", "C330"]),
  ...fc("Rolleiflex", "120", "fixed", ["2.8F", "3.5F", "2.8E", "3.5E", "T"]),
  ...fc("Rolleiflex", "120", "other", ["SL66", "Hy6"]),
  ...fc("Rolleiflex", "35mm", "fixed", ["Rollei 35", "Rollei 35 S", "Rollei 35 SE"]),
  ...fc("Bronica", "120", "Bronica SQ", ["SQ-A", "SQ-Ai", "SQ-B"]),
  ...fc("Bronica", "120", "Bronica ETR", ["ETRS", "ETRSi"]),
  ...fc("Bronica", "120", "other", ["GS-1", "RF645"]),
  ...fc("Fujica", "120", "fixed", ["GW690III", "GSW690III", "GA645", "GF670"]),
  ...fc("Fujica", "35mm", "M42", ["ST701", "ST801"]),
  ...fc("Fujica", "35mm", "fixed", ["Klasse S", "Natura Classica"]),
  ...fc("Contax", "35mm", "Contax/Yashica", [
    "RTS",
    "RTS III",
    "139 Quartz",
    "159MM",
    "167MT",
    "Aria",
    "RX",
    "S2",
    "AX",
  ]),
  ...fc("Contax", "35mm", "Contax G", ["G1", "G2"]),
  ...fc("Contax", "35mm", "fixed", ["T2", "T3", "TVS"]),
  ...fc("Yashica", "35mm", "Contax/Yashica", ["FX-3 Super 2000"]),
  ...fc("Yashica", "35mm", "fixed", ["Electro 35 GSN", "T4", "T5"]),
  ...fc("Yashica", "120", "fixed", ["Mat-124G"]),
  ...fc("Voigtländer", "35mm", "Leica screw (LTM)", ["Bessa R"]),
  ...fc("Voigtländer", "35mm", "Leica M", ["Bessa R2", "Bessa R2A", "Bessa R2M", "Bessa R3A", "Bessa R4M"]),
  ...fc("Ricoh", "35mm", "fixed", ["GR1", "GR1s", "GR1v", "GR10", "GR21"]),
  // --- instant bodies (all fixed-lens) ---
  ...ic("Polaroid", "polaroid-sx70", ["SX-70", "SX-70 Sonar", "SLR 680"]),
  ...ic("Polaroid", "polaroid-600", ["600", "OneStep 2", "OneStep+"]),
  ...ic("Polaroid", "polaroid-i-type", ["Now", "Now+", "Now Gen 2", "I-2"]),
  ...ic("Fujifilm", "instax-mini", [
    "Instax Mini 11",
    "Instax Mini 12",
    "Instax Mini 40",
    "Instax Mini 90",
    "Instax Mini Evo",
  ]),
  ...ic("Fujifilm", "instax-wide", ["Instax Wide 300"]),
  ...ic("Fujifilm", "instax-square", ["Instax Square SQ1", "Instax Square SQ6", "Instax Square SQ40"]),
  // --- digital bodies verified absent from the lensfun snapshot ---
  ...dc("Canon", "full-frame-digital", "Canon EF", ["1D X Mark III"]),
  ...dc("Leica", "full-frame-digital", "Leica M", ["M9-P"]),
  ...dc("Leica", "aps-c-digital", "fixed", ["X1", "X2"]),
  ...dc("Olympus", "other", "Micro Four Thirds", ["E-M1X", "E-PL10"]),
  ...dc("Ricoh", "aps-c-digital", "fixed", ["GR II"]),
  ...dc("Ricoh", "aps-c-digital", "other", ["GXR"]),
  ...dc("Sigma", "aps-c-digital", "fixed", ["dp2 Quattro"]),
  ...dc("Phase One", "medium-format-digital", "other", ["XF IQ4 150MP", "XF IQ3 100MP"]),
];

const cameraNorm = (make, model) =>
  `${make} ${model}`
    .toLowerCase()
    .replace(/\b(eos|mark|mk|lumix)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");

const ALL_CAMERAS = (() => {
  const seen = new Set();
  const out = [];
  // The compact inline records keep manual entry useful while the catalog
  // shard is loading. The fetched catalog replaces this fallback in place.
  for (const src of [CURATED_CAMERAS]) {
    for (const c of src) {
      const k = cameraNorm(c.make, c.model);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
})();

export const PRESETS = {
  filmStock: {
    primary: "name",
    label: (i) => `${i.brand} ${i.name}`,
    items: [
      film("Kodak", "Portra 160", 160, "color-negative", "c41", ["Ektacolor Pro 160"]),
      film("Kodak", "Portra 400", 400, "color-negative", "c41", ["Ektacolor Pro 400"]),
      film("Kodak", "Portra 800", 800, "color-negative", "c41", ["Ektacolor Pro 800"]),
      film("Kodak", "Ektar 100", 100, "color-negative", "c41"),
      film("Kodak", "Gold 200", 200, "color-negative", "c41"),
      film("Kodak", "ColorPlus 200", 200, "color-negative", "c41", ["Kodacolor 200"]),
      film("Kodak", "UltraMax 400", 400, "color-negative", "c41"),
      film("Kodak", "Pro Image 100", 100, "color-negative", "c41", ["Kodacolor 100"]),
      film("Kodak", "Ektachrome E100", 100, "color-slide", "e6"),
      film("Kodak", "Tri-X 400", 400, "bw-negative", "bw"),
      film("Kodak", "T-Max 100", 100, "bw-negative", "bw", ["Ektapan 100"]),
      film("Kodak", "T-Max 400", 400, "bw-negative", "bw", ["Ektapan 400"]),
      film("Kodak", "T-Max P3200", 3200, "bw-negative", "bw", ["Ektapan P3200"]),
      film("Kodak", "Double-X 5222", 250, "bw-negative", "bw"),
      film("Kodak", "Vision3 50D", 50, "color-negative", "ecn2"),
      film("Kodak", "Vision3 250D", 250, "color-negative", "ecn2"),
      film("Kodak", "Vision3 200T", 200, "color-negative", "ecn2"),
      film("Kodak", "Vision3 500T", 500, "color-negative", "ecn2"),
      film("Kodak", "Verita 200D", 200, "color-negative", "ecn2"),
      // Eastman Kodak 2025+ rebrands (same emulsions, distribution back in-house):
      // Portra -> Ektacolor Pro, T-Max -> Ektapan, Pro Image 100 -> Kodacolor 100,
      // ColorPlus 200 -> Kodacolor 200. Each is aka-linked to its former name above.
      film("Kodak", "Ektacolor Pro 160", 160, "color-negative", "c41", ["Portra 160"]),
      film("Kodak", "Ektacolor Pro 400", 400, "color-negative", "c41", ["Portra 400"]),
      film("Kodak", "Ektacolor Pro 800", 800, "color-negative", "c41", ["Portra 800"]),
      film("Kodak", "Ektapan 100", 100, "bw-negative", "bw", ["T-Max 100"]),
      film("Kodak", "Ektapan 400", 400, "bw-negative", "bw", ["T-Max 400"]),
      film("Kodak", "Ektapan P3200", 3200, "bw-negative", "bw", ["T-Max P3200"]),
      film("Kodak", "Kodacolor 100", 100, "color-negative", "c41", ["Pro Image 100"]),
      film("Kodak", "Kodacolor 200", 200, "color-negative", "c41", ["ColorPlus 200"]),
      film("Fujifilm", "Fujicolor 200", 200, "color-negative", "c41"),
      film("Fujifilm", "Provia 100F", 100, "color-slide", "e6"),
      film("Fujifilm", "Velvia 50", 50, "color-slide", "e6"),
      film("Fujifilm", "Velvia 100", 100, "color-slide", "e6"),
      film("Cinestill", "50D", 50, "color-negative", "c41"),
      film("Cinestill", "400D", 400, "color-negative", "c41"),
      film("Cinestill", "800T", 800, "color-negative", "c41"),
      film("Cinestill", "BwXX", 250, "bw-negative", "bw"),
      film("Harman", "Phoenix 200", 200, "color-negative", "c41"),
      film("Harman", "Phoenix II", 200, "color-negative", "c41"),
      film("Kentmere", "Pan 100", 100, "bw-negative", "bw"),
      film("Kentmere", "Pan 400", 400, "bw-negative", "bw"),
      film("Ilford", "HP5 Plus", 400, "bw-negative", "bw"),
      film("Ilford", "FP4 Plus", 125, "bw-negative", "bw"),
      film("Ilford", "Pan F Plus", 50, "bw-negative", "bw"),
      film("Ilford", "Delta 100", 100, "bw-negative", "bw"),
      film("Ilford", "Delta 400", 400, "bw-negative", "bw"),
      film("Ilford", "Delta 3200", 3200, "bw-negative", "bw"),
      film("Ilford", "XP2 Super", 400, "bw-negative", "c41"),
      film("Ilford", "SFX 200", 200, "bw-negative", "bw"),
      film("Ilford", "Ortho Plus", 80, "bw-negative", "bw"),
      film("Foma", "Fomapan 100 Classic", 100, "bw-negative", "bw"),
      film("Foma", "Fomapan 200 Creative", 200, "bw-negative", "bw"),
      film("Foma", "Fomapan 400 Action", 400, "bw-negative", "bw"),
      film("Foma", "Fomapan R100", 100, "bw-slide", "reversal-bw"),
      film("Rollei", "RPX 25", 25, "bw-negative", "bw"),
      film("Rollei", "RPX 100", 100, "bw-negative", "bw"),
      film("Rollei", "RPX 400", 400, "bw-negative", "bw"),
      film("Rollei", "Retro 80S", 80, "bw-negative", "bw"),
      film("Rollei", "Retro 400S", 400, "bw-negative", "bw"),
      film("Rollei", "Superpan 200", 200, "bw-negative", "bw"),
      film("Rollei", "Infrared 400", 400, "bw-negative", "bw"),
      film("Adox", "CHS 100 II", 100, "bw-negative", "bw"),
      film("Adox", "HR-50", 50, "bw-negative", "bw"),
      film("Adox", "Silvermax 100", 100, "bw-negative", "bw"),
      film("Adox", "Scala 160", 160, "bw-slide", "reversal-bw"),
      film("Bergger", "Pancro 400", 400, "bw-negative", "bw"),
      film("Japan Camera Hunter", "StreetPan 400", 400, "bw-negative", "bw"),
      film("Kosmo Foto", "Mono 100", 100, "bw-negative", "bw"),
      film("Kosmo Foto", "Agent Shadow 400", 400, "bw-negative", "bw"),
      film("Lomography", "Color Negative 100", 100, "color-negative", "c41"),
      film("Lomography", "Color Negative 400", 400, "color-negative", "c41"),
      film("Lomography", "Color Negative 800", 800, "color-negative", "c41"),
      film("Lomography", "Metropolis", 400, "color-negative", "c41"),
      film("Lomography", "Lady Grey 400", 400, "bw-negative", "bw"),
      film("Lomography", "Earl Grey 100", 100, "bw-negative", "bw"),
      film("Lomography", "Berlin Kino 400", 400, "bw-negative", "bw"),
      film("Fujifilm", "Instax Mini", 800, "color-negative", "other"),
      film("Fujifilm", "Instax Wide", 800, "color-negative", "other"),
      film("Fujifilm", "Instax Square", 800, "color-negative", "other"),
      film("Polaroid", "600 Color", 640, "color-negative", "other"),
      film("Polaroid", "i-Type Color", 640, "color-negative", "other"),
      film("Polaroid", "SX-70 Color", 160, "color-negative", "other"),
    ],
  },
  developerType: {
    primary: "name",
    label: (i) => `${i.brand} ${i.name}`,
    items: [
      dev(
        "Kodak",
        "D-76",
        "bw",
        "powder",
        "1+1",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      dev(
        "Kodak",
        "HC-110",
        "bw",
        "liquid-concentrate",
        "1+31 (dil. B)",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      dev(
        "Kodak",
        "XTOL",
        "bw",
        "powder",
        "1+1",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      dev("Kodak", "D-23", "bw", "powder", "stock"),
      dev(
        "Ilford",
        "ID-11",
        "bw",
        "powder",
        "1+1",
        "https://www.ilfordphoto.com/amfile/file/download/file/1829/product/708/",
      ),
      dev(
        "Ilford",
        "DD-X",
        "bw",
        "liquid-concentrate",
        "1+4",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      dev(
        "Ilford",
        "Ilfosol 3",
        "bw",
        "liquid-concentrate",
        "1+9",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      dev(
        "Ilford",
        "Microphen",
        "bw",
        "powder",
        "stock",
        "https://www.ilfordphoto.com/amfile/file/download/file/1829/product/708/",
      ),
      dev(
        "Ilford",
        "Perceptol",
        "bw",
        "powder",
        "1+1",
        "https://www.ilfordphoto.com/amfile/file/download/file/1829/product/708/",
      ),
      dev(
        "Adox",
        "Rodinal / Adonal",
        "bw",
        "liquid-concentrate",
        "1+25",
        "https://www.adox.de/adox-film-developer/rodinal-adonal/",
      ),
      dev("Adox", "XT-3", "bw", "powder", "1+1", "https://www.adox.de/xt3-en/"),
      dev("Adox", "FX-39 II", "bw", "liquid-concentrate", "1+9", "https://www.adox.de/adox-film-developer/adox-fx-39/"),
      dev(
        "Cinestill",
        "Df96 Monobath",
        "monobath",
        "liquid-ready",
        "stock",
        "https://cdn.shopify.com/s/files/1/0339/5113/files/Df96_instructions_Instructions_Complete.pdf",
      ),
      dev(
        "Bellini",
        "Hydrofen",
        "bw",
        "liquid-concentrate",
        "1+19",
        "https://www.bellinifoto.it/wp-content/uploads/2020/08/BWDROD.pdf",
      ),
      dev(
        "Foma",
        "Fomadon R09",
        "bw",
        "liquid-concentrate",
        "1+25",
        "https://www.foma.cz/en/catalogue-fomadon-r09-detail-421",
      ),
      dev("Foma", "Fomadon Excel", "bw", "powder", "1+1", "https://www.foma.cz/en/catalogue-fomadon-excel-detail-422"),
      dev(
        "Photographers' Formulary",
        "Pyrocat-HD",
        "bw",
        "liquid-concentrate",
        "1+1+100",
        "https://site.photoformulary.com/Catalog.pdf",
      ),
      dev(
        "Photographers' Formulary",
        "PMK Pyro",
        "bw",
        "liquid-concentrate",
        "1+2+100",
        "https://site.photoformulary.com/Catalog.pdf",
      ),
      dev("Diafine", "Diafine Two-Bath", "bw", "powder", "two-bath"),
      dev(
        "Kodak",
        "Flexicolor C-41",
        "c41",
        "kit",
        "stock",
        "https://business.kodakmoments.com/sites/default/files/wysiwyg/pro/chemistry/z131.pdf",
      ),
      dev(
        "Bellini",
        "C-41",
        "c41",
        "kit",
        "stock",
        "https://www.bellinifoto.it/wp-content/uploads/2019/07/C41_scheda-tecnica-5.pdf",
      ),
      dev(
        "Cinestill",
        "Cs41 Color Simplified",
        "c41",
        "kit",
        "stock",
        "https://cdn.shopify.com/s/files/1/0339/5113/files/CS41powder_Instructions_Complete.pdf",
      ),
      dev("Tetenal", "Colortec C-41", "c41", "kit", "stock"),
      dev("Bellini", "E-6", "e6", "kit", "stock", "https://www.bellinifoto.it/en/prodotto/kit-amateur-e6/"),
      dev(
        "Cinestill",
        "Cs6 Creative Slide E-6",
        "e6",
        "kit",
        "stock",
        "https://cinestillfilm.com/collections/tcs-temp/products/cs6-creative-slide-3-bath-kits-for-color-timing-chrome-reversal-and-e-6-film",
      ),
      dev("Cinestill", "Cs2 ECN-2", "ecn2", "kit", "stock", "https://cinestillfilm.com/collections/cs2-cine"),
      dev(
        "Kodak",
        "Ektachrome E-6",
        "e6",
        "kit",
        "stock",
        "https://business.kodakmoments.com/sites/default/files/files/resources/j83.pdf",
      ),
    ],
  },
  chemistryType: {
    primary: "name",
    label: (i) => `${i.brand} ${i.name}`,
    items: [
      chem(
        "Ilford",
        "Ilfostop",
        "stop",
        "liquid-concentrate",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      chem(
        "Kodak",
        "Indicator Stop Bath",
        "stop",
        "liquid-concentrate",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      chem(
        "Ilford",
        "Rapid Fixer",
        "fixer",
        "liquid-concentrate",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      chem(
        "Ilford",
        "Hypam",
        "fixer",
        "liquid-concentrate",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      chem(
        "Kodak",
        "Professional Fixer",
        "fixer",
        "powder",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      chem(
        "Kodak",
        "Kodafix",
        "fixer",
        "liquid-concentrate",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      chem(
        "Photographers' Formulary",
        "TF-4 Archival Fixer",
        "fixer",
        "liquid-ready",
        "https://site.photoformulary.com/Catalog.pdf",
      ),
      chem(
        "Photographers' Formulary",
        "TF-5 Archival Fixer",
        "fixer",
        "liquid-ready",
        "https://site.photoformulary.com/Catalog.pdf",
      ),
      chem(
        "Kodak",
        "Hypo Clearing Agent",
        "clearing-agent",
        "powder",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      chem(
        "Ilford",
        "Ilfotol",
        "wetting-agent",
        "liquid-concentrate",
        "https://www.ilfordphoto.com/wp/wp-content/uploads/2018/11/Film-processing-chart-301118-Final-version.pdf",
      ),
      chem(
        "Kodak",
        "Photo-Flo 200",
        "wetting-agent",
        "liquid-concentrate",
        "https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/edbwf_0.pdf",
      ),
      chem("Kodak", "C-41 Blix", ["bleach", "fixer"], "kit"),
      chem(
        "Adox",
        "Adostab II",
        "stabilizer",
        "liquid-ready",
        "https://www.adox.de/chemistry/toners-helping-aids/adostab/",
      ),
      chem("Kodak", "Selenium Toner", "toner", "liquid-concentrate"),
      chem(
        "Moersch",
        "Sepia Toner",
        "toner",
        "liquid-concentrate",
        "https://www.moersch-photochemie.de/en/product/mt5-sepia-schwefeltoner/",
      ),
    ],
  },
  cameraType: {
    primary: "model",
    label: (i) => `${i.make} ${i.model}`,
    items: ALL_CAMERAS,
  },
  scannerType: {
    primary: "model",
    label: (i) => `${i.make} ${i.model}`,
    items: [
      scan("Epson", "Perfection V600", "flatbed"),
      scan("Epson", "Perfection V800", "flatbed"),
      scan("Epson", "Perfection V850 Pro", "flatbed"),
      scan("Epson", "Perfection V550", "flatbed"),
      scan("Plustek", "OpticFilm 8100", "dedicated-film"),
      scan("Plustek", "OpticFilm 8200i", "dedicated-film"),
      scan("Plustek", "OpticFilm 120", "dedicated-film"),
      scan("Nikon", "Coolscan V ED", "dedicated-film"),
      scan("Nikon", "Super Coolscan 5000 ED", "dedicated-film"),
      scan("Nikon", "Super Coolscan 9000 ED", "dedicated-film"),
      scan("Minolta", "DiMAGE Scan Elite 5400", "dedicated-film"),
      scan("Noritsu", "HS-1800", "lab-minilab"),
      scan("Noritsu", "LS-600", "lab-minilab"),
      scan("Fujifilm", "Frontier SP-3000", "lab-minilab"),
      scan("Fujifilm", "Frontier SP-500", "lab-minilab"),
      scan("Valoi", "easy35", "mirrorless-copy-stand"),
      scan("Negative Supply", "Film Carrier MK1", "mirrorless-copy-stand"),
      scan("Kodak", "Scanza", "dedicated-film"),
    ],
  },
  paperType: {
    primary: "name",
    label: (i) => `${i.brand} ${i.name}`,
    items: [
      paper("Ilford", "Multigrade V RC Deluxe", "pearl"),
      paper("Ilford", "Multigrade V FB Classic", "fiber"),
      paper("Ilford", "Ilfobrom Galerie", "glossy"),
      paper("Ilford", "Multigrade Art 300", "matte"),
      paper("Kentmere", "VC Select RC", "pearl"),
      paper("Foma", "Fomabrom", "fiber"),
      paper("Foma", "Fomaspeed", "glossy"),
      paper("Adox", "MCC 110", "fiber"),
      paper("Adox", "MCP", "glossy"),
      paper("Bergger", "Prestige CB Art", "fiber"),
      paper("Kodak", "Endura", "glossy"),
      paper("Fujifilm", "Crystal Archive", "glossy"),
    ],
  },
  lensType: {
    primary: "model",
    label: (i) =>
      i.make && !i.model.toLowerCase().startsWith(i.make.toLowerCase()) ? `${i.make} ${i.model}` : i.model,
    items: ALL_LENSES,
  },
  filterType: {
    primary: "name",
    label: (i) => [i.make, i.name].filter(Boolean).join(" "),
    items: [
      // B&W contrast filters (Wratten numbers)
      filt("Tiffen", "Yellow #6 (K2)", "contrast"),
      filt("Tiffen", "Yellow #8 (K2)", "contrast"),
      filt("Tiffen", "Yellow-Green #11", "contrast"),
      filt("Tiffen", "Orange #21", "contrast"),
      filt("Tiffen", "Red #25", "contrast"),
      filt("Tiffen", "Red #29", "contrast"),
      filt("Tiffen", "Green #58", "contrast"),
      filt("Tiffen", "Blue #47", "contrast"),
      filt("Hoya", "Yellow (K2)", "contrast"),
      filt("Hoya", "Orange (G)", "contrast"),
      filt("Hoya", "Red 25A", "contrast"),
      filt("Hoya", "Yellow-Green (X0)", "contrast"),
      // UV / protection
      filt("B+W", "010 UV-Haze", "uv"),
      filt("Hoya", "UV(C) HMC", "uv"),
      filt("Tiffen", "UV Protector", "protection"),
      filt("Nikon", "NC (Neutral Clear)", "protection"),
      // polarizers
      filt("B+W", "Circular Polarizer", "polarizer-circular"),
      filt("Hoya", "Circular PL", "polarizer-circular"),
      filt("Tiffen", "Circular Polarizer", "polarizer-circular"),
      // neutral density
      filt("B+W", "ND 0.6 (2-stop)", "nd"),
      filt("B+W", "ND 0.9 (3-stop)", "nd"),
      filt("B+W", "ND 1.8 (6-stop)", "nd"),
      filt("B+W", "ND 3.0 (10-stop)", "nd"),
      filt("Hoya", "ProND8", "nd"),
      filt("Hoya", "ProND64", "nd"),
      filt("Hoya", "ProND1000", "nd"),
      // graduated ND / special
      filt("Lee", "0.6 ND Grad (soft)", "graduated-nd"),
      filt("Cokin", "Gradual ND8", "graduated-nd"),
      filt("Tiffen", "Black Pro-Mist 1/4", "black-mist"),
      filt("Hoya", "Infrared R72", "infrared"),
      filt("Tiffen", "81A Warming", "warming"),
      filt("Tiffen", "80A Cooling", "cooling"),
      filt("Nikon", "Close-up No. 3T", "close-up"),
    ],
  },
};

// Developers are photographic chemistry. Keep the large compact fallback list
// colocated above for reviewability, then expose one runtime catalog only.
PRESETS.chemistryType.items.unshift(...PRESETS.developerType.items);
delete PRESETS.developerType;

// Merge fetched, datasheet-backed film stocks into the compact offline seeds.
// The exported arrays are mutated in place so already-open autocomplete
// controls observe a shard that finishes loading after the modal opens.
function mergeFilmStocks(stocks) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/plus/g, "")
      .replace(/[^a-z0-9]/g, "");
  const items = PRESETS.filmStock.items;
  const byName = new Map(items.map((i) => [norm(i.name), i]));
  for (const raw of stocks || []) {
    const { catalogKind: _catalogKind, ...s } = raw;
    const key = norm(s.name);
    const existing = byName.get(key);
    if (existing) {
      // The sourced catalog is authoritative for factual fields and
      // manufacturer capitalization. Properties absent from it (for instance a
      // hand-maintained alias) remain on the compact built-in record.
      Object.assign(existing, Object.fromEntries(Object.entries(s).filter(([, value]) => value != null)));
      continue;
    }
    const added = { ...s };
    byName.set(key, added);
    items.push(added);
  }
  items.sort((a, b) => (a.brand + " " + a.name).localeCompare(b.brand + " " + b.name));
}

// Enrich the compact photographic-chemistry list with structured manufacturer
// specifications from its shard.
function mergeDarkroomProducts(products) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const items = PRESETS.chemistryType.items;
  const byIdentity = new Map(items.map((item) => [`${norm(item.brand)}\0${norm(item.name)}`, item]));
  for (const raw of products.filter((item) => item.catalogKind === "chemistryType")) {
    const { catalogKind: _catalogKind, ...spec } = raw;
    const key = `${norm(spec.brand)}\0${norm(spec.name)}`;
    const existing = byIdentity.get(key);
    if (existing) {
      for (const [field, value] of Object.entries(spec)) {
        if (value != null && existing[field] == null) existing[field] = value;
      }
      continue;
    }
    const added = { ...spec };
    byIdentity.set(key, added);
    items.push(added);
  }
}

const PRESET_DOMAINS = {
  cameraType: "cameras",
  lensType: "lenses",
  filmStock: "film-stocks",
  chemistryType: "darkroom-products",
};
const domainLoads = new Map();

function replaceUnique(target, records, identity) {
  const seen = new Set();
  const next = [];
  for (const raw of records) {
    const { catalogKind: _catalogKind, ...record } = raw;
    const key = identity(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(record);
  }
  target.splice(0, target.length, ...next);
}

function applyCatalogDomain(domain, items) {
  if (domain === "cameras") {
    const cameras = [...items, ...CURATED_CAMERAS].map((item) => ({
      ...item,
      ...(item.exifModel && cameraNorm(item.make, item.exifModel) !== cameraNorm(item.make, item.model)
        ? { alternativeNames: [...new Set([...(item.alternativeNames || []), item.exifModel])] }
        : {}),
    }));
    replaceUnique(PRESETS.cameraType.items, cameras, (item) => cameraNorm(item.make, item.model));
  } else if (domain === "lenses") {
    replaceUnique(PRESETS.lensType.items, items, (item) =>
      `${item.make || ""}\0${item.model || ""}`.trim().toLowerCase(),
    );
  } else if (domain === "film-stocks") mergeFilmStocks(items);
  else if (domain === "darkroom-products") mergeDarkroomProducts(items);
}

function loadState(domain) {
  if (!domainLoads.has(domain)) domainLoads.set(domain, { status: "idle", error: null, promise: null });
  return domainLoads.get(domain);
}

/** Return the lazy-load state used by setup forms to render progress/errors. */
export function presetCatalogStatus(kind) {
  const domain = PRESET_DOMAINS[kind];
  return domain ? { ...loadState(domain), promise: undefined } : { status: "ready", error: null };
}

/**
 * Fetch only the shards needed by the requested preset kinds. Repeated and
 * concurrent calls share one promise, while failures remain retryable.
 */
export async function loadCatalogPresets(kinds = Object.keys(PRESET_DOMAINS), options = {}) {
  const requested = Array.isArray(kinds) ? kinds : [kinds];
  const domains = [...new Set(requested.map((kind) => PRESET_DOMAINS[kind]).filter(Boolean))];
  const client = options.client || getDefaultCatalogClient();
  await Promise.all(
    domains.map(async (domain) => {
      const state = loadState(domain);
      if (state.status === "ready") return;
      if (!state.promise) {
        state.status = "loading";
        state.error = null;
        state.promise = client
          .getDomain(domain)
          .then((items) => {
            applyCatalogDomain(domain, items);
            state.status = "ready";
          })
          .catch((error) => {
            state.status = "error";
            state.error = error;
            throw error;
          })
          .finally(() => {
            state.promise = null;
          });
      }
      await state.promise;
    }),
  );
}

// Vitest exercises the legacy synchronous helpers directly. Production builds
// replace MODE and remove this fixture-only branch, so none of these JSON files
// are emitted into the application graph.
if (import.meta.env.MODE === "test") {
  const [cameras, lensfunCameras, lenses, lensfunLenses, filmStocks, darkroomProducts] = await Promise.all([
    import("./curated-cameras.json"),
    import("./lensfun-cameras.json"),
    import("./curated-lenses.json"),
    import("./lensfun-lenses.json"),
    import("./curated-film-stocks.json"),
    import("./curated-darkroom-products.json"),
  ]);
  const fixtures = {
    cameras: [...(cameras.default.cameras || []), ...(lensfunCameras.default.cameras || [])],
    lenses: [...(lenses.default.lenses || []), ...(lensfunLenses.default.lenses || [])],
    "film-stocks": filmStocks.default.stocks || [],
    "darkroom-products": [
      ...(darkroomProducts.default.developers || []).map((item) => ({
        ...item,
        roles: developerRoles(item.process, item.form),
        productKind: item.form === "kit" ? "process-kit" : "single-chemical",
        catalogKind: "chemistryType",
      })),
      ...(darkroomProducts.default.chemistries || []).map((item) => ({
        ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "role")),
        roles:
          item.roles ||
          (item.role === "blix"
            ? ["bleach", "fixer"]
            : item.role === "monobath"
              ? ["film-developer", "fixer"]
              : item.role === "developer"
                ? ["film-developer"]
                : item.role === "other" && item.name === "Hypo Clearing Agent"
                  ? ["clearing-agent"]
                  : [item.role]),
        specSources: item.specSources?.map((source) => ({
          ...source,
          fields: source.fields?.map((field) => (field === "role" ? "roles" : field)),
        })),
        productKind: item.productKind || (item.form === "kit" ? "multi-part-chemical" : "single-chemical"),
        catalogKind: "chemistryType",
      })),
    ],
  };
  for (const [domain, items] of Object.entries(fixtures)) {
    applyCatalogDomain(domain, items);
    loadState(domain).status = "ready";
  }
}

export const FIELD_ENUMS = GEAR_FIELD_ENUM_OPTIONS;
