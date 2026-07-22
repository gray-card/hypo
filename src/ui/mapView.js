// mapView.js: MapLibre GL maps, loaded lazily so the ~230KB library never lands
// in the main bundle. Two entry points — a location picker (for the gallery and
// photo editors) and a coarse density heatmap (for the public profile). Tiles
// come from OpenFreeMap: tokenless, no usage limits, works on static hosting.

import { el, busyWait, toast } from "./dom.js";

const POSITRON = "https://tiles.openfreemap.org/styles/positron";

// cache the dynamic import so we only pull maplibre-gl (and its CSS) once.
let maplibrePromise = null;
export function loadMaplibre() {
  if (!maplibrePromise) {
    maplibrePromise = Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([mod]) => mod.default || mod)
      // Do NOT cache a rejection: a transient network blip (or a stale chunk that
      // a reload would fix) would otherwise pin every later map click to the same
      // failure for the life of the page. Clearing it lets a retry recover.
      .catch((err) => { maplibrePromise = null; throw err; });
  }
  return maplibrePromise;
}

// resolve any css color (hex, rgb, hsl, named, oklch, …) to an "rgb(r, g, b)"
// string by rasterising a single pixel. maplibre's style spec only parses css
// color 3, so modern values like oklch() — which our theme's --accent uses — must
// be converted first, or paint layers that reference the accent silently fail to
// add (this is what broke the profile map's location filter).
export function cssColorToRgb(value, fallback = "#e8763a") {
  try {
    const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!cx) return fallback;
    cx.fillStyle = fallback;   // retained when `value` is missing or unparseable
    if (value) cx.fillStyle = value;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

// read a themed color so the map's accents track the app's palette, normalised to
// an rgb() string maplibre can parse.
function accentColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return cssColorToRgb(v || "#e8763a");
}

// geoLocation <-> lng/lat helpers (geoLocation stores degrees × 1e7).
const toGeo = (lng, lat) => ({ latitude: Math.round(lat * 1e7), longitude: Math.round(lng * 1e7) });
const toLngLat = (loc) => [loc.longitude / 1e7, loc.latitude / 1e7];

// A modal map where the user drops a single pin. Resolves to a geoLocation on
// save, `null` if they cleared it, or `undefined` if they cancelled (so callers
// can tell "remove the location" apart from "leave it unchanged").
export async function openLocationPicker(initial = null) {
  const loading = el("div", { class: "modal-overlay" }, [
    el("div", { class: "card modal", role: "status", "aria-busy": "true", "aria-label": "Loading map" }, [
      busyWait("Loading map…"),
    ]),
  ]);
  document.body.append(loading);
  let maplibregl;
  try {
    maplibregl = await loadMaplibre();
  } catch {
    // The map library is a lazy chunk; if it fails to load (offline, or a stale
    // bundle after a deploy) the picker used to reject silently, so "Set on map"
    // looked dead. Tell the user, and return undefined so the caller treats it as
    // a cancel rather than an unhandled rejection.
    toast("Couldn't load the map. Check your connection, or reload the page.", "err", 5000);
    return undefined;
  } finally {
    loading.remove();
  }
  return new Promise((resolve) => {
    let picked = initial ? { latitude: initial.latitude, longitude: initial.longitude } : null;
    let placemark = initial?.placemark || null;
    let settled = false;
    const result = () => (picked ? { ...picked, ...(placemark ? { placemark } : {}) } : picked);
    const finish = (val) => { if (settled) return; settled = true; try { map.remove(); } catch { /* already gone */ } overlay.remove(); document.removeEventListener("keydown", onKey); resolve(val); };

    const mapDiv = el("div", { class: "map-canvas" });
    const hint = el("p", { class: "muted small" }, "Search for a place, tap the map to drop a pin, drag to fine-tune, or use your current location. Published locations are rounded to a ~5 km area.");
    const useMe = el("button", { type: "button", class: "ghost small-btn" }, "Use my location");
    const clearBtn = el("button", { type: "button", class: "ghost small-btn" }, "Clear pin");
    const saveBtn = el("button", {}, "Save location");
    const cancelBtn = el("button", { class: "ghost" }, "Cancel");

    // geocoder search (OpenStreetMap Nominatim; tokenless, no key needed).
    const searchInput = el("input", { type: "search", class: "input", placeholder: "Search a place or address…", "aria-label": "Search for a place" });
    const searchBtn = el("button", { type: "button", class: "ghost small-btn" }, "Search");
    const searchStatus = el("span", { class: "muted small" });
    const runSearch = async () => {
      const q = searchInput.value.trim();
      if (!q) return;
      searchBtn.disabled = true; searchStatus.textContent = "Searching…";
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const hits = res.ok ? await res.json() : [];
        if (!hits.length) { searchStatus.textContent = "No match found."; return; }
        const hit = hits[0];
        const lng = parseFloat(hit.lon), lat = parseFloat(hit.lat);
        placemark = placemarkFromNominatim(hit);
        map.flyTo({ center: [lng, lat], zoom: 13 });
        place(lng, lat, placemark);
        searchStatus.textContent = hit.display_name || "";
      } catch {
        searchStatus.textContent = "Search unavailable.";
      } finally {
        searchBtn.disabled = false;
      }
    };
    searchBtn.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "card modal map-modal", role: "dialog", "aria-modal": "true", "aria-label": "Set location" }, [
      el("h2", {}, "Set location"),
      hint,
      el("div", { class: "row", style: "gap:8px;margin-bottom:6px" }, [searchInput, searchBtn]),
      searchStatus,
      el("div", { class: "row", style: "gap:8px;margin:8px 0" }, [useMe, clearBtn]),
      mapDiv,
      el("div", { class: "row modal-actions" }, [saveBtn, cancelBtn]),
    ]);
    overlay.append(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(undefined); });
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); finish(undefined); } };
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);

    const map = new maplibregl.Map({
      container: mapDiv, style: POSITRON,
      center: initial ? toLngLat(initial) : [0, 25], zoom: initial ? 11 : 1.2,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let marker = null;
    // `pm` carries a placemark from search; a manual click/drag clears it since
    // the address no longer matches the pin.
    const place = (lng, lat, pm = null) => {
      picked = toGeo(lng, lat);
      placemark = pm;
      if (!marker) {
        marker = new maplibregl.Marker({ color: accentColor(), draggable: true }).setLngLat([lng, lat]).addTo(map);
        marker.on("dragend", () => { const p = marker.getLngLat(); picked = toGeo(p.lng, p.lat); placemark = null; });
      } else marker.setLngLat([lng, lat]);
    };
    if (initial) place(...toLngLat(initial), placemark);
    map.on("click", (e) => place(e.lngLat.lng, e.lngLat.lat));
    // the modal animates in; give the map its final size once laid out.
    setTimeout(() => map.resize(), 60);

    useMe.addEventListener("click", () => {
      if (!navigator.geolocation) return;
      useMe.disabled = true; useMe.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => { const { longitude, latitude } = p.coords; map.flyTo({ center: [longitude, latitude], zoom: 13 }); place(longitude, latitude); useMe.disabled = false; useMe.textContent = "Use my location"; },
        () => { useMe.disabled = false; useMe.textContent = "Location unavailable"; },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
    clearBtn.addEventListener("click", () => { if (marker) { marker.remove(); marker = null; } picked = null; placemark = null; });
    saveBtn.addEventListener("click", () => finish(result()));
    cancelBtn.addEventListener("click", () => finish(undefined));
  });
}

// Map an OSM Nominatim result to our #placemark shape (dropping empty fields).
function placemarkFromNominatim(hit) {
  const a = hit.address || {};
  const pm = {
    name: hit.name || a.amenity || a.road || a.building || undefined,
    locality: a.city || a.town || a.village || a.hamlet || undefined,
    subLocality: a.suburb || a.neighbourhood || undefined,
    administrativeArea: a.state || a.region || undefined,
    postalCode: a.postcode || undefined,
    country: a.country || undefined,
    isoCountryCode: a.country_code ? a.country_code.toUpperCase() : undefined,
  };
  for (const k of Object.keys(pm)) if (pm[k] == null) delete pm[k];
  return Object.keys(pm).length ? pm : null;
}

// A labelled "set location on a map" control, shared by the gallery/photo/shoot
// editors and the lab form. `get()` returns the geoLocation, `null` if cleared,
// or `undefined` if unchanged from an initially-empty state (so callers only
// write when there's actually something to write).
export function locationField(initial) {
  let loc = initial
    ? { latitude: initial.latitude, longitude: initial.longitude, ...(initial.placemark ? { placemark: initial.placemark } : {}) }
    : null;
  const label = el("span", { class: "muted small" });
  const render = () => {
    label.textContent = loc
      ? (loc.placemark?.name || loc.placemark?.locality
          ? [loc.placemark.name, loc.placemark.locality].filter(Boolean).join(", ")
          : `${(loc.latitude / 1e7).toFixed(4)}, ${(loc.longitude / 1e7).toFixed(4)}`)
      : "None set";
  };
  render();
  const btn = el("button", {
    type: "button", class: "ghost small-btn",
    onclick: async () => {
      const r = await openLocationPicker(loc);
      if (r === undefined) return;              // cancelled — leave as-is
      loc = r; render();                        // geoLocation, or null when cleared
    },
  }, "Set on map");
  return {
    node: el("div", { class: "row", style: "gap:10px;align-items:center" }, [btn, label]),
    get: () => loc || undefined,
  };
}

// Mount (or update) a coarse density heatmap into `node`, persisting the map
// instance across re-renders via `state` so filter toggles don't rebuild it.
// `cells`: [{ key, lat, lon, count, label }]. `selected`: a Set of active keys.
// `onToggle(key)` fires when a cell is clicked.
export async function mountHeatmap(node, state, cells, selected, onToggle) {
  const accent = accentColor();
  const data = {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { key: c.key, count: c.count, label: c.label, sel: selected.has(c.key) ? 1 : 0 },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };

  if (state.map) {                                  // already built: refresh data only (no re-fit, so unrelated filter changes don't jump the view)
    state.map.getSource("cells")?.setData(data);
    state.map.resize();
    return;
  }

  node.replaceChildren(busyWait("Loading map…"));
  let maplibregl;
  try { maplibregl = await loadMaplibre(); }
  catch {
    node.replaceChildren(el("p", { class: "muted small" }, "Couldn't load map."));
    throw new Error("maplibre load failed");
  }
  node.replaceChildren();

  const map = new maplibregl.Map({ container: node, style: POSITRON, center: [0, 25], zoom: 1.1, attributionControl: true });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  // the container may still be laying out; nudge the map to its real size so tile
  // loading (and the `load` event) kicks off.
  setTimeout(() => map.resize(), 60);
  const build = () => {
    if (map.getSource("cells")) return;                 // guard against firing twice
    map.addSource("cells", { type: "geojson", data });
    const maxCount = Math.max(1, ...cells.map((c) => c.count));
    map.addLayer({
      id: "cells-heat", type: "heatmap", source: "cells",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0, maxCount, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 3],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 12, 40],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.85, 14, 0.35],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)", 0.2, "rgba(120,160,255,0.5)", 0.45, "rgba(90,210,180,0.7)",
          0.7, "rgba(245,200,70,0.85)", 1, accent,
        ],
      },
    });
    // clickable dots, emphasised when selected, so cells stay usable when zoomed in.
    map.addLayer({
      id: "cells-dot", type: "circle", source: "cells",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 5, maxCount, 13],
        "circle-color": accent,
        "circle-opacity": ["case", ["==", ["get", "sel"], 1], 0.95, 0.55],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 3, 1],
      },
    });
    fit(map, cells, maplibregl);
    map.on("click", "cells-dot", (e) => onToggle(e.features[0].properties.key));
    map.on("mouseenter", "cells-dot", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "cells-dot", () => { map.getCanvas().style.cursor = ""; });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    map.on("mousemove", "cells-dot", (e) => {
      const p = e.features[0].properties;
      popup.setLngLat(e.lngLat).setHTML(`<strong>${p.label}</strong><br>${p.count} photo${p.count === "1" ? "" : "s"}`).addTo(map);
    });
    map.on("mouseleave", "cells-dot", () => popup.remove());
  };
  // `load` fires once the style is fully applied and the map is ready for custom
  // sources/layers. (Adding on the earlier `style.load` risks the layers being
  // dropped as the style finishes applying.)
  if (map.isStyleLoaded()) build(); else map.on("load", build);
}

function fit(map, cells, maplibregl) {
  if (!cells.length) return;
  if (cells.length === 1) { map.easeTo({ center: [cells[0].lon, cells[0].lat], zoom: 9 }); return; }
  const b = new maplibregl.LngLatBounds();
  for (const c of cells) b.extend([c.lon, c.lat]);
  map.fitBounds(b, { padding: 48, maxZoom: 11, duration: 0 });
}
