// labels.js: the single place that turns internal identifiers into the
// human-friendly names users actually see. Nothing camelCase, kebab, or an
// AT-URI collection id should ever reach the DOM without passing through here.

// -- gear categories (instance kinds) ----------------------------------------
// singular is used on "Add a …" buttons. Plural on section headings.

const KIND = {
  // instances (the user's own gear)
  camera: { one: "Camera", many: "Cameras" },
  lens: { one: "Lens", many: "Lenses" },
  filter: { one: "Filter", many: "Filters" },
  exposure: { one: "Exposure", many: "Exposures" },
  filmRoll: { one: "Roll", many: "Rolls" },
  filmStockpile: { one: "Film in reserve", many: "Film in reserve" },
  developer: { one: "Developer", many: "Developers" },
  chemistry: { one: "Chemistry", many: "Chemistry" },
  scanner: { one: "Scanner", many: "Scanners" },
  enlarger: { one: "Enlarger", many: "Darkroom" },
  labAccount: { one: "Lab", many: "Labs" },
  storageLocation: { one: "Storage location", many: "Storage" },
  intermediate: { one: "Intermediate", many: "Intermediates" },
  // catalog (types, normally hidden but labelled for completeness)
  cameraType: { one: "Camera", many: "Cameras" },
  lensType: { one: "Lens", many: "Lenses" },
  filmStock: { one: "Film stock", many: "Film stocks" },
  filterType: { one: "Filter", many: "Filters" },
  developerType: { one: "Developer", many: "Developers" },
  chemistryType: { one: "Chemistry", many: "Chemistry" },
  scannerType: { one: "Scanner", many: "Scanners" },
  lab: { one: "Lab", many: "Labs" },
  scanProfile: { one: "Scan profile", many: "Scan profiles" },
  paperType: { one: "Paper", many: "Papers" },
  // print / darkroom gear (type + instance share a display label)
  printer: { one: "Printer", many: "Printers" },
  lightSource: { one: "Light source", many: "Light sources" },
  enlargingLens: { one: "Enlarging lens", many: "Enlarging lenses" },
  enlargerType: { one: "Enlarger", many: "Enlargers" },
  printerType: { one: "Printer", many: "Printers" },
  lightSourceType: { one: "Light source", many: "Light sources" },
  enlargingLensType: { one: "Enlarging lens", many: "Enlarging lenses" },
};

export function kindLabel(kind) {
  return KIND[kind]?.one || humanize(kind);
}
export function kindLabelPlural(kind) {
  return KIND[kind]?.many || humanize(kind);
}

// The order + grouping the Setup view presents gear in. Each group maps to one
// instance kind. Empty groups can be hidden.
export const GEAR_GROUPS = [
  { kind: "camera", icon: "camera" },
  { kind: "lens", icon: "camera" },
  { kind: "filmRoll", icon: "film" },
  { kind: "developer", icon: "package" },
  { kind: "chemistry", icon: "package" },
  { kind: "scanner", icon: "image" },
  { kind: "enlarger", icon: "wrench" },
  { kind: "labAccount", icon: "users" },
  { kind: "storageLocation", icon: "package" },
];

// -- enum values (process codes, roles, statuses, formats, …) -----------------

const ENUM = {
  // film / print processes
  c41: "C-41", e6: "E-6", ecn2: "ECN-2", bw: "Black & white", ra4: "RA-4",
  "reversal-bw": "Reversal B&W", monobath: "Monobath",
  // film types
  "color-negative": "Colour negative", "color-slide": "Colour slide",
  "bw-negative": "B&W negative", "bw-slide": "B&W slide", "motion-picture": "Motion picture",
  "chromogenic-bw": "Chromogenic B&W (C-41)",
  // formats
  "135": "135 (35mm)", "half-frame": "Half-frame", "70mm": "70mm", aps: "APS (IX240)",
  "16mm-still": "16mm (still)", minox: "Minox", disc: "Disc",
  "9x12cm": "9×12 cm", "13x18cm": "13×18 cm", "6.5x9cm": "6.5×9 cm", "11x14": "11×14 in", "ultra-large": "Ultra-large",
  "polaroid-spectra": "Polaroid Spectra", "peel-apart": "Peel-apart", "instant-8x10": "Instant 8×10",
  super8: "Super 8", regular8: "Regular 8", "16mm-cine": "16mm (cine)", "35mm-cine": "35mm (cine)", "65mm": "65mm",
  "aps-h-digital": "APS-H (digital)", "micro-four-thirds-digital": "Micro Four Thirds (digital)",
  "one-inch-digital": "1-inch (digital)", "foveon-digital": "Foveon (digital)",
  // storage / roll status / cassette
  "cool-dark": "Cool & dark", "dry-cabinet": "Dry cabinet", developing: "Developing", scanned: "Scanned",
  "reloadable-metal": "Reloadable (metal)", "reloadable-plastic": "Reloadable (plastic)", "120-spool": "120 spool", "bulk-loaded": "Bulk-loaded",
  // paper base + surface
  fiber: "Fibre (FB)", "resin-coated": "Resin-coated (RC)", baryta: "Baryta",
  satin: "Satin", luster: "Luster", pearl: "Pearl", "semi-matte": "Semi-matte", textured: "Textured",
  // chemistry roles (added)
  "pre-soak": "Pre-soak", "reversal-bath": "Reversal bath", "wash-aid": "Wash aid (hypo clear)",
  hardener: "Hardener", "final-rinse": "Final rinse",
  // tanks (unified)
  "dip-and-dunk": "Dip & dunk", "roller-transport": "Roller transport",
  // filter kinds (added)
  "nd-variable": "Variable ND", "gradient-color": "Colour gradient", "ir-pass": "IR pass",
  "ir-cut": "IR cut", "uv-pass": "UV pass", "split-diopter": "Split dioptre", mist: "Mist",
  "soft-focus": "Soft focus", "center-spot": "Centre spot", prism: "Prism", night: "Night (light-pollution)", didymium: "Didymium",
  // exposure programs (added)
  creative: "Creative", action: "Action", portrait: "Portrait", landscape: "Landscape", unknown: "Unknown",
  // print gear + paper attributes
  "cold-cathode": "Cold cathode", "dichroic-color": "Dichroic (colour)", "point-source": "Point source",
  "uv-led": "UV LED", "uv-fluorescent": "UV fluorescent", "metal-halide": "Metal halide", "mercury-vapor": "Mercury vapour",
  "laser-c-print": "Laser C-print", pigment: "Pigment", dye: "Dye", "variable-contrast": "Variable contrast",
  graded: "Graded", "alt-process": "Alt-process",
  "6x4.5": "6×4.5", "6x6": "6×6", "6x7": "6×7", "6x9": "6×9",
  // print processes
  "silver-gelatin": "Silver gelatin", "platinum-palladium": "Platinum / palladium", "van-dyke": "Van Dyke brown",
  "gum-bichromate": "Gum bichromate", "wet-plate-collodion": "Wet-plate collodion", "dye-transfer": "Dye transfer",
  "dye-destruction": "Dye destruction (Cibachrome)", "dye-sublimation": "Dye sublimation", kallitype: "Kallitype",
  bromoil: "Bromoil", albumen: "Albumen", photogravure: "Photogravure", lith: "Lith",
  // maintenance kinds
  cla: "CLA (clean, lube, adjust)", "sensor-clean": "Sensor clean",
  "shutter-service": "Shutter service", "fungus-clean": "Fungus clean",
  calibration: "Calibration",
  // digitize methods
  "direct-digital": "Direct digital", "tethered-capture": "Tethered capture",
  "file-import": "File import",
  // tanks / inversion
  "lab-dip-and-dunk": "Lab dip & dunk", "lab-roller": "Lab roller",
  "software-auto": "Software (auto)", "software-manual": "Software (manual)",
  // roll status
  "at-lab": "At lab",
  // scanner kinds
  "dedicated-film": "Dedicated film", "lab-minilab": "Lab minilab",
  "dslr-copy-stand": "DSLR copy stand", "mirrorless-copy-stand": "Mirrorless copy stand",
  // camera category / formats
  "full-frame-digital": "Full-frame (digital)", "aps-c-digital": "APS-C (digital)",
  "medium-format-digital": "Medium format (digital)", "half-frame": "Half-frame",
  "instax-mini": "Instax mini", "instax-wide": "Instax wide", "instax-square": "Instax square",
  "polaroid-600": "Polaroid 600", "polaroid-i-type": "Polaroid i-Type", "polaroid-sx70": "Polaroid SX-70",
  // chemistry roles / forms
  "first-developer": "First developer", "color-developer": "Colour developer",
  "wetting-agent": "Wetting agent", "liquid-concentrate": "Liquid concentrate",
  "liquid-ready": "Liquid (ready to use)",
  // filter kinds
  uv: "UV", skylight: "Skylight", protection: "Protection", nd: "ND",
  "graduated-nd": "Graduated ND", "polarizer-circular": "Polariser (circular)",
  "polarizer-linear": "Polariser (linear)", color: "Colour", contrast: "Contrast",
  warming: "Warming", cooling: "Cooling", infrared: "Infrared", "close-up": "Close-up",
  diffusion: "Diffusion", "black-mist": "Black mist", star: "Star",
  // metering modes
  matrix: "Matrix", "center-weighted": "Center-weighted", spot: "Spot",
  partial: "Partial", average: "Average", "multi-spot": "Multi-spot",
  "highlight-weighted": "Highlight-weighted",
  // exposure programs
  "aperture-priority": "Aperture priority", "shutter-priority": "Shutter priority",
  program: "Program", bulb: "Bulb",
};

export function enumLabel(value) {
  if (value == null || value === "") return "";
  if (ENUM[value]) return ENUM[value];
  // already display-ready (proper noun, acronym, or spaced), e.g. mount names
  // "Nikon F", "Canon EF", "Micro Four Thirds": don't mangle the casing.
  if (/\s/.test(value) || /[A-Z]/.test(value.slice(1))) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return humanize(value);
}

// -- collections (AT-URI ids) -------------------------------------------------
// used by the advanced/inspector + bundle views so even power tools read nicely.

const COLLECTION = {
  "social.grain.gallery": "Gallery", "social.grain.gallery.item": "Gallery photo",
  "social.grain.photo": "Photo", "social.grain.photo.exif": "EXIF",
  "app.graycard.photo.capture": "Photo gear", "app.graycard.photo.workflow": "Photo workflow",
  "app.graycard.gallery.defaults": "Gallery defaults",
  "app.graycard.scene.graph": "Scene", "app.graycard.scene.node": "Scene node",
  "app.graycard.scene.edge": "Scene relation", "app.graycard.scene.region": "Scene region",
  "app.graycard.workflow.template": "Workflow template", "app.graycard.workflow.run": "Workflow run",
  "app.graycard.workflow.stage": "Workflow stage", "app.graycard.session.capture": "Shoot",
  "app.graycard.rule.batch": "Batch rule",
  "app.graycard.process.developSession": "Development", "app.graycard.process.digitizeSession": "Scanning",
  "app.graycard.process.maintenanceSession": "Maintenance", "app.graycard.process.printSession": "Printing",
};

export function collectionLabel(collection) {
  if (COLLECTION[collection]) return COLLECTION[collection];
  // app.graycard.catalog.cameraType -> "Camera". instance.camera -> "Camera"
  const tail = collection.split(".").pop();
  return kindLabel(tail);
}

// -- generic fallback ---------------------------------------------------------

const ACRONYMS = {
  iso: "ISO", exif: "EXIF", cla: "CLA", id: "ID", url: "URL", rc: "RC",
  fb: "FB", hdf: "HDF", did: "DID", uri: "URI", cid: "CID", raw: "RAW",
  ttl: "TTL", gm: "GM", oss: "OSS",
};

// split camelCase / kebab / snake into a sentence-cased phrase, fixing acronyms.
export function humanize(id) {
  if (id == null) return "";
  const words = String(id)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .split(/\s+/);
  return words
    .map((w, i) => {
      const low = w.toLowerCase();
      if (ACRONYMS[low]) return ACRONYMS[low];
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : low;
    })
    .join(" ") || "";
}
