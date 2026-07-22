// sceneEditor.js: draw regions (box or polygon) + typed nodes on a photo,
// render any imported region (bbox / rotated / polygon / point / mask), and
// persist as app.graycard.scene.{graph,region,node,edge}. Types are any
// Wikidata entity (live search) or free text. Prior terms appear first.

import { NS, saveRecord, deleteRecord } from "../graycard.js";
import { listRecords, blobUrl } from "../grain.js";
import { el } from "./dom.js";
import { searchConcepts, refineConceptRanking } from "../data/wikidata.js";
import { SPATIAL_SEED } from "../ontology.js";

// How many Wikidata senses to offer when grounding a scene term. wbsearchentities
// caps at 50; 25 is deep enough to reach the ordinary-noun sense of an ambiguous
// word without making the menu unscannable.
const WD_SEARCH_LIMIT = 25;

const SCALE = 1_000_000;
const SVGNS = "http://www.w3.org/2000/svg";

let seq = 0;
const localId = () => `t${++seq}`;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const asType = (t) => (t?.id ? { id: t.id, label: t.label || t.id } : { id: "object", label: "object" });
const sc = (n) => Math.round(n * SCALE);
const un = (n) => (n || 0) / SCALE;

function svg(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// region record <-> editor shape
function regionToShape(rv) {
  if (!rv) return null;
  const k = rv.kind;
  if (k === "bbox" && rv.bbox) return { kind: "bbox", x: un(rv.bbox.x), y: un(rv.bbox.y), w: un(rv.bbox.w), h: un(rv.bbox.h) };
  if (k === "polygon" && rv.geometry?.points) return { kind: "polygon", points: rv.geometry.points.map(([x, y]) => [un(x), un(y)]) };
  if (k === "point" && rv.geometry?.point) return { kind: "point", x: un(rv.geometry.point[0]), y: un(rv.geometry.point[1]) };
  return { kind: k, display: true, maskBlob: rv.maskBlob || null, box: rv.bbox ? { x: un(rv.bbox.x), y: un(rv.bbox.y) } : null };
}
function shapeToRegion(shape, photoUri, now) {
  if (shape.kind === "bbox") return { photo: photoUri, kind: "bbox", bbox: { x: sc(shape.x), y: sc(shape.y), w: sc(shape.w), h: sc(shape.h) }, createdAt: now };
  if (shape.kind === "polygon") return { photo: photoUri, kind: "polygon", geometry: { points: shape.points.map(([x, y]) => [sc(x), sc(y)]) }, format: "graycard-polygon", createdAt: now };
  if (shape.kind === "point") return { photo: photoUri, kind: "point", geometry: { point: [sc(shape.x), sc(shape.y)] }, createdAt: now };
  return null;
}
const shapeTopLeft = (s) =>
  s.kind === "bbox" ? [s.x, s.y]
    : s.kind === "polygon" ? [Math.min(...s.points.map((p) => p[0])), Math.min(...s.points.map((p) => p[1]))]
    : s.kind === "point" ? [s.x, s.y]
    : [s.box?.x ?? 0.02, s.box?.y ?? 0.02];

let recentCache = null;
async function loadRecentTerms(agent, did) {
  if (recentCache) return recentCache;
  const tally = (recs) => {
    const m = new Map();
    for (const r of recs) { const t = r.value?.type; if (!t?.id) continue; const e = m.get(t.id) || { id: t.id, label: t.label || t.id, n: 0 }; e.n++; m.set(t.id, e); }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 12).map(({ id, label }) => ({ id, label }));
  };
  try {
    const [nodes, edges] = await Promise.all([listRecords(agent, did, NS.scene.node), listRecords(agent, did, NS.scene.edge)]);
    recentCache = { nodes: tally(nodes), edges: tally(edges) };
  } catch { recentCache = { nodes: [], edges: [] }; }
  return recentCache;
}

function createTermInput({ placeholder, recent = [], seed = [], initial = null }) {
  let selected = initial?.id ? { id: initial.id, label: initial.label || initial.id } : null, debounce;
  let searchToken = 0;   // guards against a slower earlier query landing last
  const input = el("input", { type: "text", placeholder, autocomplete: "off", value: initial?.label || "" });
  const menu = el("div", { class: "term-menu hidden" });
  const node = el("div", { class: "term-input" }, [input, menu]);
  const hide = () => menu.classList.add("hidden");
  const opt = (term, sub) => el("div", {
    class: "term-opt", onmousedown: (e) => { e.preventDefault(); selected = { id: term.id, label: term.label }; input.value = term.label; hide(); },
  }, [el("span", {}, term.label), sub ? el("span", { class: "term-sub muted small" }, sub) : null]);
  function renderMenu(sections) {
    menu.replaceChildren(); let any = false;
    for (const [title, items] of sections) {
      if (!items?.length) continue; any = true;
      menu.append(el("div", { class: "term-section" }, title));
      for (const it of items) menu.append(opt(it, it.description || (String(it.id).startsWith("Q") ? it.id : "")));
    }
    menu.classList.toggle("hidden", !any);
  }
  const showDefault = () => renderMenu([["Recent", recent], ["Spatial", seed]]);
  input.addEventListener("focus", showDefault);
  input.addEventListener("blur", () => setTimeout(hide, 150));
  let idx = -1;
  input.addEventListener("keydown", (e) => {
    const list = [...menu.querySelectorAll(".term-opt")];
    if (e.key === "ArrowDown" && list.length) { e.preventDefault(); idx = (idx + 1) % list.length; list.forEach((o, i) => o.classList.toggle("active", i === idx)); }
    else if (e.key === "ArrowUp" && list.length) { e.preventDefault(); idx = (idx - 1 + list.length) % list.length; list.forEach((o, i) => o.classList.toggle("active", i === idx)); }
    else if (e.key === "Enter" && idx >= 0 && list[idx]) { e.preventDefault(); list[idx].dispatchEvent(new MouseEvent("mousedown")); }
  });
  input.addEventListener("input", () => {
    selected = null; idx = -1; const q = input.value.trim(); clearTimeout(debounce);
    if (q.length < 2) { showDefault(); return; }
    const local = [...recent, ...seed].filter((t) => t.label.toLowerCase().includes(q.toLowerCase()));
    renderMenu([["Your terms", local]]);
    // Ask for a deep list of senses. A short word ("post", "trunk", "bat") is
    // dominated by proper nouns — a surname, a town, an album — so the common
    // noun a photographer actually means can sit well below the first handful.
    const mine = ++searchToken;
    debounce = setTimeout(async () => {
      const wd = await searchConcepts(q, WD_SEARCH_LIMIT);
      if (mine !== searchToken) return;
      renderMenu([["Your terms", local], ["Wikidata", wd]]);            // paint at once
      const refined = await refineConceptRanking(wd, q);                 // then ask what they ARE
      // do not reshuffle under someone already arrowing through the list
      if (mine !== searchToken || idx >= 0) return;
      renderMenu([["Your terms", local], ["Wikidata", refined]]);
    }, 240);
  });
  return { node, getTerm() { return selected || (input.value.trim() ? { id: input.value.trim(), label: input.value.trim() } : null); } };
}

async function loadScene(agent, did, photoUri) {
  const graph = (await listRecords(agent, did, NS.scene.graph)).find((r) => r.value.subject === photoUri) || null;
  const tags = [], edges = [];
  if (graph) {
    const regionByUri = new Map((await listRecords(agent, did, NS.scene.region)).filter((r) => r.value.photo === photoUri).map((r) => [r.uri, r]));
    const nodeByUri = new Map();
    for (const n of (await listRecords(agent, did, NS.scene.node)).filter((r) => r.value.scene === graph.uri)) {
      const region = n.value.region ? regionByUri.get(n.value.region) : null;
      const tag = {
        id: localId(), nodeUri: n.uri, nodeCid: n.cid, nodeValue: n.value,
        regionUri: n.value.region || null, regionCid: region?.cid || null, regionValue: region?.value || null,
        type: asType(n.value.type), label: n.value.label || "",
        shape: region ? regionToShape(region.value) : null, _dirty: false,
      };
      tags.push(tag); nodeByUri.set(n.uri, tag);
    }
    for (const e of (await listRecords(agent, did, NS.scene.edge)).filter((r) => r.value.scene === graph.uri)) {
      edges.push({ id: localId(), edgeUri: e.uri, from: nodeByUri.get(e.value.from)?.id || null, to: nodeByUri.get(e.value.to)?.id || null, type: asType(e.value.type) });
    }
  }
  return { graph, graphUri: graph?.uri || null, tags, edges };
}

const rkeyOf = (uri) => uri.split("/").pop();

async function persist(agent, did, photoUri, state) {
  const now = () => new Date().toISOString();
  if (!state.graphUri && state.tags.some((t) => !t._deleted)) state.graphUri = await saveRecord(agent, did, NS.scene.graph, { subject: photoUri, ontologies: [], createdAt: now() }, null);
  for (const t of state.tags) if (t._deleted) { if (t.nodeUri) await deleteRecord(agent, did, t.nodeUri); if (t.regionUri) await deleteRecord(agent, did, t.regionUri); }
  const nodeUriById = new Map();
  for (const t of state.tags) {
    if (t._deleted) continue;
    // existing node: update in place if edited (keeps its AT-URI so edges stay valid)
    if (t.nodeUri) {
      nodeUriById.set(t.id, t.nodeUri);
      if (!t._dirty) continue;
      let regionUri = t.regionUri;
      if (t.shape) {
        const geom = shapeToRegion(t.shape, photoUri, t.regionValue?.createdAt || now());
        if (regionUri) {
          await saveRecord(agent, did, NS.scene.region, { ...t.regionValue, ...geom, updatedAt: now() },
            { uri: regionUri, rkey: rkeyOf(regionUri), cid: t.regionCid });
        } else {
          regionUri = await saveRecord(agent, did, NS.scene.region, geom, null);
          t.regionUri = regionUri;
        }
      } else if (regionUri) {
        await deleteRecord(agent, did, regionUri); regionUri = null; t.regionUri = null;
      }
      await saveRecord(agent, did, NS.scene.node,
        { ...t.nodeValue, scene: state.graphUri, type: { id: t.type.id, label: t.type.label }, label: t.label || undefined, region: regionUri || undefined, updatedAt: now() },
        { uri: t.nodeUri, rkey: rkeyOf(t.nodeUri), cid: t.nodeCid });
      t._dirty = false;
      continue;
    }
    // new node: create region + node
    let regionUri;
    const rv = t.shape ? shapeToRegion(t.shape, photoUri, now()) : null;
    if (rv) regionUri = await saveRecord(agent, did, NS.scene.region, rv, null);
    const nodeUri = await saveRecord(agent, did, NS.scene.node, { scene: state.graphUri, type: { id: t.type.id, label: t.type.label }, label: t.label || undefined, region: regionUri || undefined, createdAt: now() }, null);
    t.nodeUri = nodeUri; t.regionUri = regionUri || null; nodeUriById.set(t.id, nodeUri);
  }
  for (const e of state.edges) {
    if (e._deleted) { if (e.edgeUri) await deleteRecord(agent, did, e.edgeUri); continue; }
    if (e.edgeUri) {
      // guard: if an endpoint node was removed, delete the edge rather than leave it dangling
      if (!nodeUriById.has(e.from) || !nodeUriById.has(e.to)) { await deleteRecord(agent, did, e.edgeUri); e._deleted = true; }
      continue;
    }
    const from = nodeUriById.get(e.from), to = nodeUriById.get(e.to);
    if (from && to) e.edgeUri = await saveRecord(agent, did, NS.scene.edge, { scene: state.graphUri, type: { id: e.type.id, label: e.type.label }, from, to, createdAt: now() }, null);
  }
  state.tags = state.tags.filter((t) => !t._deleted);
  state.edges = state.edges.filter((e) => !e._deleted);
  recentCache = null;
}

export async function openSceneEditor(ctx, photo, { onAnalyze } = {}) {
  const photoUri = photo.uri;
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal scene-modal" });
  const status = el("span", { class: "status" });

  const stage = el("div", { class: "scene-stage" }, el("div", { class: "muted small" }, "Loading image…"));
  const shapeSvg = svg("svg", { class: "scene-svg", viewBox: "0 0 1 1", preserveAspectRatio: "none" });
  const labelLayer = el("div", { class: "scene-labels" });
  const drawLayer = el("div", { class: "scene-draw hidden" }, [shapeSvg, labelLayer]);
  const tagList = el("div", { class: "scene-tags" });
  const pending = el("div", { class: "scene-pending hidden" });
  const edgeBox = el("div", { class: "scene-edges" });

  let state = { graph: null, graphUri: null, tags: [], edges: [] };
  let recent = { nodes: [], edges: [] };
  let mode = "box";             // "box" | "polygon" | "edit"
  let pendingShape = null;      // shape being drawn
  let polyPoints = null;        // in-progress polygon
  let selId = null;             // selected tag id (edit mode)
  let attachToId = null;        // regionless tag waiting for a drawn shape
  let drag = null;              // active move/resize drag
  let imgWrap = null;           // the image wrapper (set once the image loads)

  function labelChip(t, lx, ly) {
    return el("div", { class: "scene-box-label", style: `left:${lx * 100}%;top:${ly * 100}%` }, t.type.label + (t.label ? ` · ${t.label}` : ""));
  }

  // resize handles for the selected bbox. Drawn AFTER every shape (see
  // renderRegions) so an overlapping box painted later cannot cover them and
  // steal their clicks — that was why resize appeared dead while move worked.
  function drawHandles(t) {
    const s = t.shape;
    if (!s || s.kind !== "bbox") return;
    const hs = 0.02;
    for (const [hx, hy, corner] of [[s.x, s.y, "tl"], [s.x + s.w, s.y, "tr"], [s.x, s.y + s.h, "bl"], [s.x + s.w, s.y + s.h, "br"]]) {
      const h = svg("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, class: "svg-handle" });
      h.addEventListener("pointerdown", (e) => { e.stopPropagation(); startResize(t, corner, e); });
      shapeSvg.append(h);
    }
  }

  function renderRegions() {
    shapeSvg.replaceChildren();
    labelLayer.replaceChildren();
    const tags = state.tags.filter((x) => !x._deleted);
    for (const t of tags) {
      const s = t.shape; if (!s) continue;
      if (s.kind === "bbox") {
        const rect = svg("rect", { x: s.x, y: s.y, width: s.w, height: s.h, class: "svg-shape" + (mode === "edit" ? " svg-editable" : "") + (selId === t.id ? " sel" : "") });
        if (mode === "edit") rect.addEventListener("pointerdown", (e) => { e.stopPropagation(); startMove(t, e); });
        shapeSvg.append(rect);
      }
      else if (s.kind === "polygon") shapeSvg.append(svg("polygon", { points: s.points.map((p) => p.join(",")).join(" "), class: "svg-shape" }));
      else if (s.kind === "point") shapeSvg.append(svg("circle", { cx: s.x, cy: s.y, r: 0.012, class: "svg-shape svg-point" }));
      else if (s.maskBlob) { const im = svg("image", { x: 0, y: 0, width: 1, height: 1, class: "svg-mask", preserveAspectRatio: "none" }); blobUrl(ctx.agent, ctx.did, s.maskBlob).then((u) => u && im.setAttribute("href", u)).catch(() => {}); shapeSvg.append(im); }
      const [lx, ly] = shapeTopLeft(s);
      labelLayer.append(labelChip(t, lx, ly));
    }
    if (mode === "edit" && selId != null) { const sel = tags.find((t) => t.id === selId); if (sel) drawHandles(sel); }
    if (pendingShape) {
      if (pendingShape.kind === "bbox") shapeSvg.append(svg("rect", { x: pendingShape.x, y: pendingShape.y, width: pendingShape.w, height: pendingShape.h, class: "svg-shape pending" }));
      else if (pendingShape.kind === "polygon") shapeSvg.append(svg("polygon", { points: pendingShape.points.map((p) => p.join(",")).join(" "), class: "svg-shape pending" }));
    }
    if (polyPoints?.length) {
      shapeSvg.append(svg("polyline", { points: polyPoints.map((p) => p.join(",")).join(" "), class: "svg-shape pending" }));
      for (const [x, y] of polyPoints) shapeSvg.append(svg("circle", { cx: x, cy: y, r: 0.007, class: "svg-vertex" }));
    }
  }

  function nodeOptions() {
    const opts = [el("option", { value: "" }, "(none)")];
    for (const t of state.tags.filter((x) => !x._deleted)) opts.push(el("option", { value: t.id }, t.type.label + (t.label ? ` · ${t.label}` : "")));
    return el("select", {}, opts);
  }

  function tagName(t) { return t.label || t.type?.label || "object"; }

  function cancelAttach() {
    attachToId = null;
    pendingShape = null;
    polyPoints = null;
    pending.classList.add("hidden");
    pending.replaceChildren();
    updatePolyBtn();
    renderRegions();
    renderTags();
  }

  // Enter "draw for this tag" mode: next finished box/polygon becomes its region
  // (replaces an existing one when redrawing a bad or invisible model box).
  function startAttachRegion(t) {
    for (const x of state.tags) x._editing = false;
    attachToId = t.id;
    setMode("box");
    const verb = t.shape ? "Redraw" : "Draw";
    pending.replaceChildren(
      el("p", { class: "muted small", style: "margin:0" }, `${verb} a box or polygon for ${tagName(t)}.`),
      el("button", { class: "ghost small-btn", type: "button", onclick: cancelAttach }, "Cancel"),
    );
    pending.classList.remove("hidden");
    renderTags();
  }

  // After a draw finishes: attach/replace on the chosen tag, else open the new-tag form.
  function commitShape(shape) {
    if (attachToId != null) {
      const t = state.tags.find((x) => x.id === attachToId && !x._deleted);
      attachToId = null;
      pendingShape = null;
      pending.classList.add("hidden");
      pending.replaceChildren();
      if (t) {
        t.shape = shape;
        t._dirty = true;
        if (shape.kind === "bbox") { selId = t.id; setMode("edit"); }
        else setMode("box");
        renderRegions();
        renderTags();
        return;
      }
    }
    showPending(shape);
  }

  function renderTags() {
    tagList.replaceChildren();
    const live = state.tags.filter((t) => !t._deleted);
    if (!live.length) tagList.append(el("p", { class: "muted small" }, "Draw a box or polygon on the image to tag a region."));
    for (const t of live) {
      if (t._editing) { tagList.append(tagEditForm(t)); continue; }
      const attaching = attachToId === t.id;
      const regionBtn = el("button", {
        class: "ghost small-btn", type: "button",
        title: t.shape ? "Replace this region by drawing again" : "Draw a region for this object",
        onclick: () => startAttachRegion(t),
      }, attaching ? "Drawing…" : (t.shape ? "Redraw" : "Add region"));
      tagList.append(el("div", { class: "scene-tag-row row between" + (attaching ? " attaching" : "") }, [
        el("span", {}, [el("span", { class: "scene-dot" }), el("b", {}, t.type.label), t.label ? el("span", { class: "muted" }, ` · ${t.label}`) : null, el("span", { class: "muted small" }, `  ${t.shape ? t.shape.kind : "no region"}`)]),
        el("div", { class: "row", style: "gap:6px" }, [
          regionBtn,
          el("button", { class: "ghost small-btn", onclick: () => { for (const x of state.tags) x._editing = false; t._editing = true; if (t.shape?.kind === "bbox") { selId = t.id; setMode("edit"); } renderTags(); } }, "Edit"),
          el("button", { class: "ghost small-btn danger", onclick: () => { t._deleted = true; for (const e of state.edges) if (e.from === t.id || e.to === t.id) e._deleted = true; if (selId === t.id) selId = null; if (attachToId === t.id) cancelAttach(); else { renderRegions(); renderTags(); } } }, "Remove"),
        ]),
      ]));
    }
    renderEdges();
  }

  // Inline editor for one tag: change its type, its label, and (for a bbox) its
  // numeric geometry. Marks the tag dirty so persist updates the record in place.
  function tagEditForm(t) {
    const orig = { shape: t.shape, dirty: t._dirty };   // snapshot so Cancel truly reverts
    const finish = () => { t._syncGeom = null; t._editing = false; };
    const typeInput = createTermInput({ placeholder: "type (search Wikidata or type text)", recent: recent.nodes, initial: t.type });
    const labelInput = el("input", { type: "text", value: t.label || "", placeholder: "label (optional, e.g. 'the cyclist')" });
    const rows = [
      el("div", { class: "field" }, [el("span", {}, "Type"), typeInput.node]),
      el("div", { class: "field" }, [el("span", {}, "Label"), labelInput]),
    ];
    if (t.shape?.kind === "bbox") {
      const pct = (n) => Math.round((n || 0) * 1000) / 10;
      const numIn = (v) => el("input", { type: "number", value: String(pct(v)), min: "0", max: "100", step: "0.5", style: "width:72px" });
      const xi = numIn(t.shape.x), yi = numIn(t.shape.y), wi = numIn(t.shape.w), hi = numIn(t.shape.h);
      const apply = () => {
        const g = (i) => clamp01((parseFloat(i.value) || 0) / 100);
        const x = g(xi), y = g(yi);
        t.shape = { kind: "bbox", x, y, w: Math.min(g(wi), 1 - x), h: Math.min(g(hi), 1 - y) };   // keep inside the image
        t._dirty = true; renderRegions();
      };
      for (const i of [xi, yi, wi, hi]) i.addEventListener("input", apply);
      // keep the numeric fields in sync when the box is dragged/resized on the image
      t._syncGeom = () => { if (t.shape?.kind !== "bbox") return; xi.value = String(pct(t.shape.x)); yi.value = String(pct(t.shape.y)); wi.value = String(pct(t.shape.w)); hi.value = String(pct(t.shape.h)); };
      rows.push(el("div", { class: "field" }, [el("span", {}, "Box  x / y / w / h  (%)"), el("div", { class: "row wrap", style: "gap:6px" }, [xi, yi, wi, hi])]));
      rows.push(el("p", { class: "muted small" }, "Or drag the box and its corner handles on the image."));
    }
    rows.push(el("div", { class: "row", style: "gap:6px" }, [
      el("button", { class: "ghost small-btn", onclick: () => { const nt = typeInput.getTerm(); if (nt) t.type = { id: nt.id, label: nt.label }; t.label = labelInput.value.trim(); t._dirty = true; finish(); renderRegions(); renderTags(); } }, "Done"),
      el("button", { class: "ghost small-btn", onclick: () => { t.shape = orig.shape; t._dirty = orig.dirty; finish(); renderRegions(); renderTags(); } }, "Cancel"),
    ]));
    return el("div", { class: "scene-pending" }, rows);
  }

  function renderEdges() {
    edgeBox.replaceChildren();
    const live = state.tags.filter((t) => !t._deleted);
    if (live.length < 2) return;
    // An edge relates two specific node instances, not two types. Name each
    // endpoint by its instance label (falling back to its type) and disambiguate
    // instances that share a name, so an instance→instance relation never reads
    // as if it were type→type (e.g. two "log" instances become "charred log" and
    // "firewood logs", or "log #1" / "log #2" when unlabeled).
    const baseName = (t) => (t && (t.label || t.type?.label)) || "?";
    const nodeName = (t) => {
      const base = baseName(t);
      const peers = live.filter((x) => baseName(x) === base);
      return peers.length > 1 ? `${base} #${peers.indexOf(t) + 1}` : base;
    };
    edgeBox.append(el("h3", { class: "modal-sub" }, "Relations"));
    for (const e of state.edges.filter((x) => !x._deleted)) {
      const f = live.find((t) => t.id === e.from), tt = live.find((t) => t.id === e.to);
      edgeBox.append(el("div", { class: "row between scene-tag-row" }, [
        el("span", { class: "small" }, `${nodeName(f)} → ${e.type.label} → ${nodeName(tt)}`),
        el("button", { class: "ghost small-btn danger", onclick: () => { e._deleted = true; renderEdges(); } }, "Remove"),
      ]));
    }
    const fromSel = nodeOptions(), toSel = nodeOptions();
    const rel = createTermInput({ placeholder: "relation (spatial or search Wikidata)", recent: recent.edges, seed: SPATIAL_SEED });
    edgeBox.append(el("div", { class: "row wrap scene-edge-form" }, [
      fromSel, el("span", { class: "muted" }, "→"), rel.node, el("span", { class: "muted" }, "→"), toSel,
      el("button", { class: "ghost small-btn", onclick: () => { const type = rel.getTerm(); if (!fromSel.value || !toSel.value || !type || fromSel.value === toSel.value) return; state.edges.push({ id: localId(), edgeUri: null, from: fromSel.value, to: toSel.value, type }); renderEdges(); } }, "+ Relation"),
    ]));
  }

  function showPending(shape) {
    pendingShape = shape;
    renderRegions();
    const typeInput = createTermInput({ placeholder: "type: search Wikidata (e.g. person, sky)", recent: recent.nodes });
    const label = el("input", { type: "text", placeholder: "label (optional, e.g. 'the cyclist')" });
    const typeField = el("div", { class: "field" }, [el("span", {}, `Tag this ${shape.kind}`), typeInput.node]);
    const labelField = el("div", { class: "field" }, [el("span", {}, "Label"), label]);
    // Offer to ground a model-found, regionless object when the user drew freestyle.
    const orphans = state.tags.filter((t) => !t._deleted && !t.shape);
    const orphanSel = orphans.length
      ? el("select", {}, [
        el("option", { value: "" }, "New tag"),
        ...orphans.map((t) => el("option", { value: t.id }, tagName(t))),
      ])
      : null;
    const syncOrphan = () => {
      const attach = !!orphanSel?.value;
      typeField.classList.toggle("hidden", attach);
      labelField.classList.toggle("hidden", attach);
    };
    orphanSel?.addEventListener("change", syncOrphan);
    const commitNew = () => {
      if (orphanSel?.value) {
        const t = state.tags.find((x) => x.id === orphanSel.value && !x._deleted);
        if (t) {
          t.shape = pendingShape;
          t._dirty = true;
          pendingShape = null;
          pending.classList.add("hidden");
          if (t.shape.kind === "bbox") { selId = t.id; setMode("edit"); }
          renderRegions();
          renderTags();
          return;
        }
      }
      const type = typeInput.getTerm() || { id: "object", label: "object" };
      state.tags.push({ id: localId(), nodeUri: null, regionUri: null, type, label: label.value.trim(), shape: pendingShape });
      pendingShape = null;
      pending.classList.add("hidden");
      renderRegions();
      renderTags();
    };
    pending.replaceChildren(
      orphanSel ? el("div", { class: "field" }, [el("span", {}, "Apply region to"), orphanSel]) : null,
      typeField,
      labelField,
      el("div", { class: "row" }, [
        el("button", { onclick: commitNew }, orphanSel ? "Apply" : "Add tag"),
        el("button", { class: "ghost", onclick: () => { pendingShape = null; pending.classList.add("hidden"); renderRegions(); } }, "Cancel"),
      ]),
    );
    pending.classList.remove("hidden");
    if (orphanSel) orphanSel.focus();
    else typeInput.node.querySelector("input")?.focus();
  }

  function pos(iw, e) { const r = iw.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]; }

  // ---- edit mode: move / resize an existing bbox ----
  function startMove(t, e) {
    selId = t.id;
    if (t.shape?.kind === "bbox") {
      drag = { tagId: t.id, kind: "move", corner: null, startPos: pos(imgWrap, e), startShape: { ...t.shape }, moved: false };
      imgWrap.setPointerCapture(e.pointerId);
    }
    renderRegions();
  }
  function startResize(t, corner, e) {
    selId = t.id;
    drag = { tagId: t.id, kind: "resize", corner, startPos: pos(imgWrap, e), startShape: { ...t.shape }, moved: false };
    imgWrap.setPointerCapture(e.pointerId);
  }
  function applyDrag(cur) {
    const t = state.tags.find((x) => x.id === drag.tagId);
    if (!t || t.shape?.kind !== "bbox") return;
    const s0 = drag.startShape;
    const dx = cur[0] - drag.startPos[0], dy = cur[1] - drag.startPos[1];
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) drag.moved = true;
    if (drag.kind === "move") {
      t.shape = { kind: "bbox", x: Math.min(Math.max(0, s0.x + dx), 1 - s0.w), y: Math.min(Math.max(0, s0.y + dy), 1 - s0.h), w: s0.w, h: s0.h };
    } else {
      let x1 = s0.x, y1 = s0.y, x2 = s0.x + s0.w, y2 = s0.y + s0.h;
      if (drag.corner.includes("l")) x1 = clamp01(s0.x + dx);
      if (drag.corner.includes("r")) x2 = clamp01(x2 + dx);
      if (drag.corner.includes("t")) y1 = clamp01(s0.y + dy);
      if (drag.corner.includes("b")) y2 = clamp01(y2 + dy);
      t.shape = { kind: "bbox", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    t._syncGeom?.();   // keep an open Edit form's numeric fields tracking the box
    renderRegions();
  }
  function finishDrag() {
    const t = state.tags.find((x) => x.id === drag.tagId);
    if (t && drag.moved) t._dirty = true;
    t?._syncGeom?.();
    drag = null;
    renderRegions();
  }

  function wireDrawing(iw) {
    let start = null;
    iw.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (mode === "edit") { if (selId != null) { selId = null; renderRegions(); } return; } // empty click deselects (boxes stopPropagation)
      if (mode !== "box") return;
      start = pos(iw, e); iw.setPointerCapture(e.pointerId);
    });
    iw.addEventListener("pointermove", (e) => {
      if (drag) { applyDrag(pos(iw, e)); return; }
      if (!start) return;
      const [cx, cy] = pos(iw, e);
      pendingShape = { kind: "bbox", x: Math.min(start[0], cx), y: Math.min(start[1], cy), w: Math.abs(cx - start[0]), h: Math.abs(cy - start[1]) };
      renderRegions();
    });
    iw.addEventListener("pointerup", (e) => {
      if (drag) { finishDrag(); return; }
      if (mode === "polygon") { const [x, y] = pos(iw, e); (polyPoints ||= []).push([x, y]); renderRegions(); updatePolyBtn(); return; }
      if (!start) return; const s = pendingShape; start = null; pendingShape = null;
      if (s && s.w > 0.015 && s.h > 0.015) commitShape(s); else renderRegions();
    });
    iw.addEventListener("dblclick", () => { if (mode === "polygon") finishPolygon(); });
  }

  function finishPolygon() {
    if (polyPoints && polyPoints.length >= 3) { const pts = polyPoints; polyPoints = null; updatePolyBtn(); commitShape({ kind: "polygon", points: pts }); }
    else { polyPoints = null; updatePolyBtn(); renderRegions(); }
  }

  const boxBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("box") }, "▭ Box");
  const polyBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("polygon") }, "⬡ Polygon");
  const editBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("edit") }, "✥ Edit");
  const analyzeBtn = onAnalyze ? el("button", { class: "ghost small-btn", title: "Detect objects and relations from the image with the analysis model", onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    status.className = "status"; status.textContent = "Loading photo from your PDS…";
    const onProgress = (msg) => { status.className = "status"; status.textContent = msg; };
    try {
      const res = await onAnalyze(onProgress);
      if (res) { state = await loadScene(ctx.agent, ctx.did, photoUri); selId = null; renderRegions(); renderTags(); status.className = "status ok"; status.textContent = "Analyzed ✓"; }
      else { status.textContent = ""; }
    } catch (err) { status.className = "status err"; status.textContent = `Error: ${err.message || err}`; }
    finally { btn.disabled = false; }
  } }, "✨ Analyze") : null;
  const finishBtn = el("button", { class: "ghost small-btn hidden", onclick: finishPolygon }, "Finish region");
  function setMode(m) { mode = m; polyPoints = null; pendingShape = null; if (m !== "edit") selId = null; boxBtn.classList.toggle("active", m === "box"); polyBtn.classList.toggle("active", m === "polygon"); editBtn.classList.toggle("active", m === "edit"); updatePolyBtn(); renderRegions(); }
  function updatePolyBtn() { finishBtn.classList.toggle("hidden", mode !== "polygon" || !(polyPoints?.length >= 3)); }
  boxBtn.classList.add("active");

  modal.append(
    el("div", { class: "row between" }, [el("h2", {}, "Scene graph"), el("span", { class: "mono muted small" }, `#${photo.idx != null ? photo.idx + 1 : ""}`)]),
    el("p", { class: "muted small" }, "Draw a box or polygon to ground a typed node, or use Edit to move/resize a box and fix its type or label. Use Add region or Redraw when Analyze leaves a missing or misplaced box. Imported regions (masks, outlines, points from CV tools) render here too. Types are Wikidata entities or free text."),
    el("div", { class: "row wrap scene-tools" }, [boxBtn, polyBtn, editBtn, analyzeBtn, finishBtn]),
    stage, pending, tagList, edgeBox,
    el("div", { class: "row modal-actions" }, [
      el("button", { onclick: async (e) => { await withSave(e.target, status, async () => { await persist(ctx.agent, ctx.did, photoUri, state); recentCache = null; state = await loadScene(ctx.agent, ctx.did, photoUri); selId = null; renderRegions(); renderTags(); }); } }, "Save to PDS"),
      el("button", { class: "ghost", onclick: () => overlay.remove() }, "Close"),
      status,
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);

  try {
    const url = photo.value?.photo ? await blobUrl(ctx.agent, ctx.did, photo.value.photo) : null;
    imgWrap = el("div", { class: "scene-img-wrap" }, [url ? el("img", { src: url, alt: "", draggable: "false" }) : el("div", { class: "muted small" }, "(no image)"), drawLayer]);
    stage.replaceChildren(imgWrap);
    drawLayer.classList.remove("hidden");
    if (url) wireDrawing(imgWrap);
  } catch { stage.replaceChildren(el("div", { class: "muted small" }, "(image failed to load)")); }

  [recent, state] = await Promise.all([
    loadRecentTerms(ctx.agent, ctx.did),
    loadScene(ctx.agent, ctx.did, photoUri).catch((err) => { status.className = "status err"; status.textContent = `Load failed: ${err.message || err}`; return { graph: null, graphUri: null, tags: [], edges: [] }; }),
  ]);
  renderRegions();
  renderTags();
}

async function withSave(button, status, fn) {
  button.disabled = true; status.className = "status"; status.textContent = "Saving…";
  try { await fn(); status.classList.add("ok"); status.textContent = "Saved ✓"; }
  catch (err) { status.classList.add("err"); status.textContent = `Error: ${err.message || err}`; }
  finally { button.disabled = false; }
}
