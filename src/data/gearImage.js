// gearImage.js: resolve the display image for a gear instance: the user's
// own uploaded photo if present, else the catalog type's Wikidata/Commons
// stock image.

import { blobUrl } from "../grain.js";
import { catalogImageUrl } from "./catalogImage.js";

const TYPE_OF_INSTANCE = {
  camera: "cameraType", lens: "lensType", filter: "filterType", developer: "developerType",
  scanner: "scannerType", chemistry: "chemistryType", filmRoll: "filmStock",
  filmStockpile: "filmStock",
};

export async function instanceImageUrl(agent, did, store, kind, value) {
  if (value?.image) {
    try { return await blobUrl(agent, did, value.image); } catch { return null; }
  }
  const tk = TYPE_OF_INSTANCE[kind];
  const typeUri = (kind === "filmRoll" || kind === "filmStockpile") ? value?.stock : value?.type;
  const typeVal = typeUri ? store.byUri.get(typeUri)?.item?.value : null;
  // the type's own image (link or uploaded file), else a curated manufacturer
  // product shot, else the Wikidata stock image.
  return (tk && typeVal)
    ? catalogImageUrl(tk, typeVal, { blobUrl: (b) => blobUrl(agent, did, b) })
    : null;
}

// attach a thumbnail element that (re)loads when `getValue()` changes.
export function gearThumb(agent, did, store, kind, getValue) {
  const thumb = document.createElement("div");
  thumb.className = "type-thumb";
  thumb.setAttribute("aria-hidden", "true");
  const refresh = () => {
    thumb.classList.remove("has-img");
    thumb.style.backgroundImage = "";
    const v = getValue();
    if (!v) return;
    instanceImageUrl(agent, did, store, kind, v).then((url) => {
      if (url) { thumb.style.backgroundImage = `url("${url}")`; thumb.classList.add("has-img"); }
    }).catch(() => {});
  };
  return { thumb, refresh };
}
