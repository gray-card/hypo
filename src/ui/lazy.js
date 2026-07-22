// lazy.js: load a blob thumbnail only when it scrolls into view.
import { el } from "./dom.js";
import { blobUrl } from "../grain.js";

let io;
function obs() {
  if (!io) io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); e.target._load?.(); }
  }, { rootMargin: "250px" });
  return io;
}

export function lazyThumb(agent, did, blobRef, cls = "thumb") {
  const node = el("div", { class: cls });
  if (!blobRef) return node;
  node._load = async () => {
    try { const u = await blobUrl(agent, did, blobRef); if (u) node.replaceChildren(el("img", { src: u, alt: "" })); }
    catch { /* ignore */ }
  };
  obs().observe(node);
  return node;
}
