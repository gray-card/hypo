// App compatibility boundary for the reusable lazy-thumbnail primitive.
import { lazyThumbnail } from "@hypo/ui/lazy-thumb";
import { blobUrl } from "../grain.js";

export function imageAlt(value, fallback = "") {
  const label = typeof value === "string" ? value.trim() : "";
  return label || fallback;
}

// `alt` names content-bearing thumbnails; the empty default keeps existing
// layout-only thumbnails out of the accessibility tree.
export function lazyThumb(agent, did, blobRef, cls = "thumb", alt = "") {
  return lazyThumbnail(() => (blobRef ? blobUrl(agent, did, blobRef) : Promise.resolve(null)), {
    className: cls,
    alt: imageAlt(alt),
  });
}
