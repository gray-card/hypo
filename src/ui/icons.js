// icons.js: self-hosted inline SVG icons (stroke, currentColor). No CDN.
const NS = "http://www.w3.org/2000/svg";

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  check: '<polyline points="4 12 9 17 20 6"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/>',
  trash: '<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="17" y1="17" x2="19" y2="19"/><line x1="19" y1="5" x2="17" y2="7"/><line x1="7" y1="17" x2="5" y2="19"/>',
  moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
  camera: '<path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><polyline points="4 18 9 13 13 16 17 12 20 15"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  layers: '<polygon points="12 3 21 8 12 13 3 8 12 3"/><polyline points="3 13 12 18 21 13"/>',
  book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z"/><line x1="9" y1="8" x2="15" y2="8"/>',
  package: '<polygon points="12 3 21 7.5 21 16.5 12 21 3 16.5 3 7.5 12 3"/><polyline points="3 7.5 12 12 21 7.5"/><line x1="12" y1="12" x2="12" y2="21"/>',
  wrench: '<path d="M15.5 6.5a4 4 0 0 0-5.3 5.3L4 18l2 2 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.7 2.7-2-2 2.7-2.7z"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5a3.3 3.3 0 0 1 0 6.6"/><path d="M17.5 20a5.5 5.5 0 0 0-2.5-4.6"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="8.2" y1="11" x2="15.8" y2="7"/><line x1="8.2" y1="13" x2="15.8" y2="17"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.6 5"/><polyline points="20 4 20 11 13 11"/>',
  code: '<polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/>',
  command: '<path d="M9 4a2 2 0 1 0 2 2v12a2 2 0 1 0-2-2h6a2 2 0 1 0-2 2V6a2 2 0 1 0 2 2H9z"/>',
  undo: '<polyline points="9 7 4 12 9 17"/><path d="M4 12h11a5 5 0 0 1 0 10h-2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="17" y2="20"/><rect x="4.2" y="5.8" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="4.2" y="9.1" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="4.2" y="12.4" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="4.2" y="15.7" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="18.2" y="5.8" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="18.2" y="9.1" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="18.2" y="12.4" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/><rect x="18.2" y="15.7" width="1.6" height="2" rx="0.2" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 11 11 8.5 15.5 13 13 15.5 8.5"/>',
  upload: '<path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><path d="M5 4h14"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><line x1="6" y1="9.5" x2="6" y2="9.5"/><line x1="9" y1="9.5" x2="9" y2="9.5"/><line x1="12" y1="9.5" x2="12" y2="9.5"/><line x1="15" y1="9.5" x2="15" y2="9.5"/><line x1="18" y1="9.5" x2="18" y2="9.5"/><line x1="7.5" y1="14.5" x2="16.5" y2="14.5"/>',
  "map-pin": '<path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  sparkles: '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7L12 3.5z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"/>',
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || "";
  return svg;
}

// button with an icon and a (mobile-collapsible) label
export function iconBtn(name, label, { onclick, cls = "ghost", labelClass = "iconbtn-label", title } = {}) {
  const b = document.createElement("button");
  b.className = cls + " iconbtn";
  if (title || label) { b.title = title || label; b.setAttribute("aria-label", title || label); }
  if (onclick) b.addEventListener("click", onclick);
  b.append(icon(name));
  if (label) { const s = document.createElement("span"); s.className = labelClass; s.textContent = label; b.append(s); }
  return b;
}
