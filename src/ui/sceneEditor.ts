// sceneEditor.ts: draw regions (box or polygon) + typed nodes on a photo,
// render any imported region (bbox / rotated / polygon / point / mask), and
// persist as app.graycard.scene.{graph,region,node,edge}. Types are any
// Wikidata entity (live search) or free text. Prior terms appear first.

import { NS, saveRecord, deleteRecord } from "../graycard.js";
import { listRecords, blobUrl, recordStore } from "../grain.js";
import { PublicRepoClient } from "@hypo/pds";
import { renderOn, type RecordStore } from "@hypo/store";
import { el } from "./dom.js";
import { searchConcepts, refineConceptRanking } from "../data/wikidata.js";
import { SPATIAL_SEED } from "../ontology.js";
import { publicBlobUrl, resolvePds } from "../profile.js";

// How many Wikidata senses to offer when grounding a scene term. wbsearchentities
// caps at 50; 25 is deep enough to reach the ordinary-noun sense of an ambiguous
// word without making the menu unscannable.
const WD_SEARCH_LIMIT = 25;

const SCALE = 1_000_000;
const SVGNS = "http://www.w3.org/2000/svg";

type Agent = unknown;
type JsonObject = Record<string, unknown>;
type Point = [number, number];
type Mode = "box" | "polygon" | "edit";
type Corner = "tl" | "tr" | "bl" | "br";

interface Term {
  id: string;
  label: string;
  description?: string;
}

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BboxShape extends Bbox {
  kind: "bbox";
}

interface PolygonShape {
  kind: "polygon";
  points: Point[];
}

interface PointShape {
  kind: "point";
  x: number;
  y: number;
}

interface ImportedShape {
  kind:
    | "whole"
    | "rotated-bbox"
    | "multipolygon"
    | "mask"
    | "rle-mask"
    | "keypoints"
    | "contour"
    | "cuboid"
    | "depth-plane"
    | "other";
  display: true;
  maskBlob: unknown | null;
  box: Pick<Bbox, "x" | "y"> | null;
}

type Shape = BboxShape | PolygonShape | PointShape | ImportedShape;

interface RegionValue extends JsonObject {
  kind: string;
  bbox?: Bbox;
  geometry?: {
    points?: Point[];
    point?: Point;
  };
  maskBlob?: unknown;
  createdAt?: string;
}

interface GraphValue extends JsonObject {
  subject?: string;
}

interface NodeValue extends JsonObject {
  scene?: string;
  region?: string;
  type?: Partial<Term>;
  label?: string;
}

interface EdgeValue extends JsonObject {
  scene?: string;
  from: string;
  to: string;
  type?: Partial<Term>;
}

interface RecordEnvelope<Value extends JsonObject> {
  uri: string;
  cid?: string | null;
  value: Value;
}

interface SceneTag {
  id: string;
  nodeUri: string | null;
  nodeCid?: string | null;
  nodeValue?: NodeValue;
  regionUri: string | null;
  regionCid?: string | null;
  regionValue?: RegionValue | null;
  type: Term;
  label: string;
  shape: Shape | null;
  _dirty?: boolean;
  _deleted?: boolean;
  _editing?: boolean;
  _syncGeom?: (() => void) | null;
}

interface SceneEdge {
  id: string;
  edgeUri: string | null;
  from: string | null;
  to: string | null;
  type: Term;
  _deleted?: boolean;
}

interface SceneState {
  graph: RecordEnvelope<GraphValue> | null;
  graphUri: string | null;
  tags: SceneTag[];
  edges: SceneEdge[];
}

interface RecentTerms {
  nodes: Term[];
  edges: Term[];
}

interface TermInputOptions {
  placeholder: string;
  recent?: Term[];
  seed?: readonly Term[];
  initial?: Partial<Term> | null;
}

interface SceneContext {
  agent: Agent;
  did: string;
}

interface ScenePhoto {
  uri: string;
  idx?: number;
  value?: { photo?: unknown } | null;
}

type ProgressCallback = (message: string) => void;
type AnalyzeCallback = (onProgress: ProgressCallback) => Promise<unknown>;

interface SceneEditorOptions {
  onAnalyze?: AnalyzeCallback | null;
  signals?: Pick<RecordStore, "collection">;
}

interface DragState {
  tagId: string;
  kind: "move" | "resize";
  corner: Corner | null;
  startPos: Point;
  startShape: BboxShape;
  moved: boolean;
}

let seq = 0;
const localId = () => `t${++seq}`;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const asType = (t?: Partial<Term> | null): Term =>
  t?.id ? { id: t.id, label: t.label || t.id } : { id: "object", label: "object" };
const sc = (n: number) => Math.round(n * SCALE);
const un = (n?: number | null) => (n || 0) / SCALE;

const errorMessage = (error: unknown) => {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : undefined;
  return String(message || error);
};

function svg<Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[Tag] {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// region record <-> editor shape
function regionToShape(rv?: RegionValue | null): Shape | null {
  if (!rv) return null;
  const k = rv.kind;
  if (k === "bbox" && rv.bbox)
    return { kind: "bbox", x: un(rv.bbox.x), y: un(rv.bbox.y), w: un(rv.bbox.w), h: un(rv.bbox.h) };
  if (k === "polygon" && rv.geometry?.points)
    return { kind: "polygon", points: rv.geometry.points.map(([x, y]) => [un(x), un(y)]) };
  if (k === "point" && rv.geometry?.point)
    return { kind: "point", x: un(rv.geometry.point[0]), y: un(rv.geometry.point[1]) };
  return {
    kind: k as ImportedShape["kind"],
    display: true,
    maskBlob: rv.maskBlob || null,
    box: rv.bbox ? { x: un(rv.bbox.x), y: un(rv.bbox.y) } : null,
  };
}
function shapeToRegion(shape: Shape, photoUri: string, now: string): RegionValue | null {
  if (shape.kind === "bbox")
    return {
      photo: photoUri,
      kind: "bbox",
      bbox: { x: sc(shape.x), y: sc(shape.y), w: sc(shape.w), h: sc(shape.h) },
      createdAt: now,
    };
  if (shape.kind === "polygon")
    return {
      photo: photoUri,
      kind: "polygon",
      geometry: { points: shape.points.map(([x, y]) => [sc(x), sc(y)]) },
      format: "graycard-polygon",
      createdAt: now,
    };
  if (shape.kind === "point")
    return { photo: photoUri, kind: "point", geometry: { point: [sc(shape.x), sc(shape.y)] }, createdAt: now };
  return null;
}
const shapeTopLeft = (s: Shape): Point =>
  s.kind === "bbox"
    ? [s.x, s.y]
    : s.kind === "polygon"
      ? [Math.min(...s.points.map((p) => p[0])), Math.min(...s.points.map((p) => p[1]))]
      : s.kind === "point"
        ? [s.x, s.y]
        : [s.box?.x ?? 0.02, s.box?.y ?? 0.02];

let recentCache: RecentTerms | null = null;
async function loadRecentTerms(agent: Agent, did: string): Promise<RecentTerms> {
  if (recentCache) return recentCache;
  const tally = (recs: Array<RecordEnvelope<NodeValue | EdgeValue>>): Term[] => {
    const m = new Map<string, Term & { n: number }>();
    for (const r of recs) {
      const t = r.value?.type;
      if (!t?.id) continue;
      const e = m.get(t.id) || { id: t.id, label: t.label || t.id, n: 0 };
      e.n++;
      m.set(t.id, e);
    }
    return [...m.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 12)
      .map(({ id, label }) => ({ id, label }));
  };
  try {
    const [nodes, edges] = await Promise.all([
      listRecords(agent, did, NS.scene.node),
      listRecords(agent, did, NS.scene.edge),
    ]);
    recentCache = { nodes: tally(nodes), edges: tally(edges) };
  } catch {
    recentCache = { nodes: [], edges: [] };
  }
  return recentCache;
}

function createTermInput({ placeholder, recent = [], seed = [], initial = null }: TermInputOptions) {
  let selected = initial?.id ? { id: initial.id, label: initial.label || initial.id } : null,
    debounce: ReturnType<typeof setTimeout> | undefined;
  let searchToken = 0; // guards against a slower earlier query landing last
  const input = el("input", { type: "text", placeholder, autocomplete: "off", value: initial?.label || "" });
  const menu = el("div", { class: "term-menu hidden" });
  const node = el("div", { class: "term-input" }, [input, menu]);
  const hide = () => menu.classList.add("hidden");
  const opt = (term: Term, sub?: string) =>
    el(
      "div",
      {
        class: "term-opt",
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          selected = { id: term.id, label: term.label };
          input.value = term.label;
          hide();
        },
      },
      [el("span", {}, term.label), sub ? el("span", { class: "term-sub muted small" }, sub) : null],
    );
  function renderMenu(sections: ReadonlyArray<readonly [string, readonly Term[]]>) {
    menu.replaceChildren();
    let any = false;
    for (const [title, items] of sections) {
      if (!items?.length) continue;
      any = true;
      menu.append(el("div", { class: "term-section" }, title));
      for (const it of items) menu.append(opt(it, it.description || (String(it.id).startsWith("Q") ? it.id : "")));
    }
    menu.classList.toggle("hidden", !any);
  }
  const showDefault = () =>
    renderMenu([
      ["Recent", recent],
      ["Spatial", seed],
    ]);
  input.addEventListener("focus", showDefault);
  input.addEventListener("blur", () => setTimeout(hide, 150));
  let idx = -1;
  input.addEventListener("keydown", (e) => {
    const list = [...menu.querySelectorAll(".term-opt")];
    if (e.key === "ArrowDown" && list.length) {
      e.preventDefault();
      idx = (idx + 1) % list.length;
      list.forEach((o, i) => o.classList.toggle("active", i === idx));
    } else if (e.key === "ArrowUp" && list.length) {
      e.preventDefault();
      idx = (idx - 1 + list.length) % list.length;
      list.forEach((o, i) => o.classList.toggle("active", i === idx));
    } else if (e.key === "Enter" && idx >= 0 && list[idx]) {
      e.preventDefault();
      list[idx].dispatchEvent(new MouseEvent("mousedown"));
    }
  });
  input.addEventListener("input", () => {
    selected = null;
    idx = -1;
    const q = input.value.trim();
    if (debounce !== undefined) clearTimeout(debounce);
    if (q.length < 2) {
      showDefault();
      return;
    }
    const local = [...recent, ...seed].filter((t) => t.label.toLowerCase().includes(q.toLowerCase()));
    renderMenu([["Your terms", local]]);
    // Ask for a deep list of senses. A short word ("post", "trunk", "bat") is
    // dominated by proper nouns — a surname, a town, an album — so the common
    // noun a photographer actually means can sit well below the first handful.
    const mine = ++searchToken;
    debounce = setTimeout(async () => {
      const wd = await searchConcepts(q, WD_SEARCH_LIMIT);
      if (mine !== searchToken) return;
      renderMenu([
        ["Your terms", local],
        ["Wikidata", wd],
      ]); // paint at once
      const refined = await refineConceptRanking(wd, q); // then ask what they ARE
      // do not reshuffle under someone already arrowing through the list
      if (mine !== searchToken || idx >= 0) return;
      renderMenu([
        ["Your terms", local],
        ["Wikidata", refined],
      ]);
    }, 240);
  });
  return {
    node,
    getTerm() {
      return selected || (input.value.trim() ? { id: input.value.trim(), label: input.value.trim() } : null);
    },
  };
}

async function loadSceneCollection<Value extends JsonObject>(
  agent: Agent,
  did: string,
  collection: string,
  signals: Pick<RecordStore, "collection">,
  publicClient: () => Promise<PublicRepoClient>,
): Promise<Array<RecordEnvelope<Value>>> {
  try {
    return (await listRecords(agent, did, collection)) as Array<RecordEnvelope<Value>>;
  } catch (primaryError) {
    const cached = [...signals.collection(collection).value.values()] as unknown as Array<RecordEnvelope<Value>>;
    try {
      return (await (await publicClient()).listAll({ repo: did, collection, limit: 100 })) as Array<
        RecordEnvelope<Value>
      >;
    } catch {
      if (cached.length) return cached;
      throw primaryError;
    }
  }
}

async function loadScene(
  agent: Agent,
  did: string,
  photoUri: string,
  signals: Pick<RecordStore, "collection">,
): Promise<SceneState> {
  let publicClientPromise: Promise<PublicRepoClient> | undefined;
  const publicClient = () => (publicClientPromise ??= resolvePds(did).then((pds) => new PublicRepoClient(pds)));
  const graphRecords = await loadSceneCollection<GraphValue>(agent, did, NS.scene.graph, signals, publicClient);
  const graph = graphRecords.find((record) => record.value.subject === photoUri);
  if (!graph) return sceneStateFromRecords(photoUri, graphRecords, [], [], []);
  const [regionRecords, nodeRecords, edgeRecords] = await Promise.all([
    loadSceneCollection<RegionValue>(agent, did, NS.scene.region, signals, publicClient),
    loadSceneCollection<NodeValue>(agent, did, NS.scene.node, signals, publicClient),
    loadSceneCollection<EdgeValue>(agent, did, NS.scene.edge, signals, publicClient),
  ]);
  return sceneStateFromRecords(photoUri, graphRecords, regionRecords, nodeRecords, edgeRecords);
}

async function sceneImageUrl(agent: Agent, did: string, blob: unknown): Promise<string | null> {
  try {
    const url = publicBlobUrl(await resolvePds(did), did, blob);
    if (url) return url;
  } catch {
    // Fall through to the authenticated blob reader for non-public/local PDSs.
  }
  return blobUrl(agent, did, blob);
}

function sceneStateFromRecords(
  photoUri: string,
  graphRecords: readonly RecordEnvelope<GraphValue>[],
  regionRecords: readonly RecordEnvelope<RegionValue>[],
  nodeRecords: readonly RecordEnvelope<NodeValue>[],
  edgeRecords: readonly RecordEnvelope<EdgeValue>[],
): SceneState {
  const graph = graphRecords.find((r) => r.value.subject === photoUri) || null;
  const tags: SceneTag[] = [],
    edges: SceneEdge[] = [];
  if (graph) {
    const regionByUri = new Map(
      regionRecords.filter((r) => r.value.photo === photoUri).map((r) => [r.uri, r] as const),
    );
    const nodeByUri = new Map<string, SceneTag>();
    for (const n of nodeRecords.filter((r) => r.value.scene === graph.uri)) {
      const region = n.value.region ? regionByUri.get(n.value.region) : null;
      const tag: SceneTag = {
        id: localId(),
        nodeUri: n.uri,
        nodeCid: n.cid,
        nodeValue: n.value,
        regionUri: n.value.region || null,
        regionCid: region?.cid || null,
        regionValue: region?.value || null,
        type: asType(n.value.type),
        label: n.value.label || "",
        shape: region ? regionToShape(region.value) : null,
        _dirty: false,
      };
      tags.push(tag);
      nodeByUri.set(n.uri, tag);
    }
    for (const e of edgeRecords.filter((r) => r.value.scene === graph.uri)) {
      edges.push({
        id: localId(),
        edgeUri: e.uri,
        from: nodeByUri.get(e.value.from)?.id || null,
        to: nodeByUri.get(e.value.to)?.id || null,
        type: asType(e.value.type),
      });
    }
  }
  return { graph, graphUri: graph?.uri || null, tags, edges };
}

interface SceneRecordSignals {
  graphs: ReturnType<RecordStore["collection"]>["value"];
  regions: ReturnType<RecordStore["collection"]>["value"];
  nodes: ReturnType<RecordStore["collection"]>["value"];
  edges: ReturnType<RecordStore["collection"]>["value"];
}

export function renderSceneRecordsOn(
  signals: Pick<RecordStore, "collection">,
  render: (records: SceneRecordSignals) => void,
): () => void {
  return renderOn(
    () => ({
      graphs: signals.collection(NS.scene.graph).value,
      regions: signals.collection(NS.scene.region).value,
      nodes: signals.collection(NS.scene.node).value,
      edges: signals.collection(NS.scene.edge).value,
    }),
    render,
  );
}

const rkeyOf = (uri: string) => uri.split("/").pop();

async function persist(agent: Agent, did: string, photoUri: string, state: SceneState): Promise<void> {
  const now = () => new Date().toISOString();
  if (!state.graphUri && state.tags.some((t) => !t._deleted))
    state.graphUri = await saveRecord(
      agent,
      did,
      NS.scene.graph,
      { subject: photoUri, ontologies: [], createdAt: now() },
      null,
    );
  for (const t of state.tags)
    if (t._deleted) {
      if (t.nodeUri) await deleteRecord(agent, did, t.nodeUri);
      if (t.regionUri) await deleteRecord(agent, did, t.regionUri);
    }
  const nodeUriById = new Map<string, string>();
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
          await saveRecord(
            agent,
            did,
            NS.scene.region,
            { ...t.regionValue, ...geom, updatedAt: now() },
            { uri: regionUri, rkey: rkeyOf(regionUri), cid: t.regionCid },
          );
        } else {
          regionUri = await saveRecord(agent, did, NS.scene.region, geom, null);
          t.regionUri = regionUri;
        }
      } else if (regionUri) {
        await deleteRecord(agent, did, regionUri);
        regionUri = null;
        t.regionUri = null;
      }
      await saveRecord(
        agent,
        did,
        NS.scene.node,
        {
          ...t.nodeValue,
          scene: state.graphUri,
          type: { id: t.type.id, label: t.type.label },
          label: t.label || undefined,
          region: regionUri || undefined,
          updatedAt: now(),
        },
        { uri: t.nodeUri, rkey: rkeyOf(t.nodeUri), cid: t.nodeCid },
      );
      t._dirty = false;
      continue;
    }
    // new node: create region + node
    let regionUri: string | undefined;
    const rv = t.shape ? shapeToRegion(t.shape, photoUri, now()) : null;
    if (rv) regionUri = await saveRecord(agent, did, NS.scene.region, rv, null);
    const nodeUri = await saveRecord(
      agent,
      did,
      NS.scene.node,
      {
        scene: state.graphUri,
        type: { id: t.type.id, label: t.type.label },
        label: t.label || undefined,
        region: regionUri || undefined,
        createdAt: now(),
      },
      null,
    );
    t.nodeUri = nodeUri;
    t.regionUri = regionUri || null;
    nodeUriById.set(t.id, nodeUri);
  }
  for (const e of state.edges) {
    if (e._deleted) {
      if (e.edgeUri) await deleteRecord(agent, did, e.edgeUri);
      continue;
    }
    if (e.edgeUri) {
      // guard: if an endpoint node was removed, delete the edge rather than leave it dangling
      if (!e.from || !e.to || !nodeUriById.has(e.from) || !nodeUriById.has(e.to)) {
        await deleteRecord(agent, did, e.edgeUri);
        e._deleted = true;
      }
      continue;
    }
    const from = e.from ? nodeUriById.get(e.from) : undefined,
      to = e.to ? nodeUriById.get(e.to) : undefined;
    if (from && to)
      e.edgeUri = await saveRecord(
        agent,
        did,
        NS.scene.edge,
        { scene: state.graphUri, type: { id: e.type.id, label: e.type.label }, from, to, createdAt: now() },
        null,
      );
  }
  state.tags = state.tags.filter((t) => !t._deleted);
  state.edges = state.edges.filter((e) => !e._deleted);
  recentCache = null;
}

export async function openSceneEditor(
  ctx: SceneContext,
  photo: ScenePhoto,
  { onAnalyze, signals = recordStore(ctx.did) }: SceneEditorOptions = {},
): Promise<void> {
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

  let state: SceneState = { graph: null, graphUri: null, tags: [], edges: [] };
  let recent: RecentTerms = { nodes: [], edges: [] };
  let mode: Mode = "box";
  let pendingShape: Shape | null = null;
  let polyPoints: Point[] | null = null;
  let selId: string | null = null;
  let attachToId: string | null = null;
  let drag: DragState | null = null;
  let imgWrap: HTMLDivElement | null = null;
  let disposeSceneSignals = () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    disposeSceneSignals();
    overlay.remove();
  };

  function labelChip(t: SceneTag, lx: number, ly: number) {
    return el(
      "div",
      { class: "scene-box-label", style: `left:${lx * 100}%;top:${ly * 100}%` },
      t.type.label + (t.label ? ` · ${t.label}` : ""),
    );
  }

  // resize handles for the selected bbox. Drawn AFTER every shape (see
  // renderRegions) so an overlapping box painted later cannot cover them and
  // steal their clicks — that was why resize appeared dead while move worked.
  function drawHandles(t: SceneTag) {
    const s = t.shape;
    if (!s || s.kind !== "bbox") return;
    const hs = 0.02;
    const handles: Array<[number, number, Corner]> = [
      [s.x, s.y, "tl"],
      [s.x + s.w, s.y, "tr"],
      [s.x, s.y + s.h, "bl"],
      [s.x + s.w, s.y + s.h, "br"],
    ];
    for (const [hx, hy, corner] of handles) {
      const h = svg("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, class: "svg-handle" });
      h.addEventListener("pointerdown", (e: PointerEvent) => {
        e.stopPropagation();
        startResize(t, corner, e);
      });
      shapeSvg.append(h);
    }
  }

  function renderRegions() {
    shapeSvg.replaceChildren();
    labelLayer.replaceChildren();
    const tags = state.tags.filter((x) => !x._deleted);
    for (const t of tags) {
      const s = t.shape;
      if (!s) continue;
      if (s.kind === "bbox") {
        const rect = svg("rect", {
          x: s.x,
          y: s.y,
          width: s.w,
          height: s.h,
          class: "svg-shape" + (mode === "edit" ? " svg-editable" : "") + (selId === t.id ? " sel" : ""),
        });
        if (mode === "edit")
          rect.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            startMove(t, e);
          });
        shapeSvg.append(rect);
      } else if (s.kind === "polygon")
        shapeSvg.append(svg("polygon", { points: s.points.map((p) => p.join(",")).join(" "), class: "svg-shape" }));
      else if (s.kind === "point")
        shapeSvg.append(svg("circle", { cx: s.x, cy: s.y, r: 0.012, class: "svg-shape svg-point" }));
      else if (s.maskBlob) {
        const im = svg("image", { x: 0, y: 0, width: 1, height: 1, class: "svg-mask", preserveAspectRatio: "none" });
        blobUrl(ctx.agent, ctx.did, s.maskBlob)
          .then((u) => u && im.setAttribute("href", u))
          .catch(() => {});
        shapeSvg.append(im);
      }
      const [lx, ly] = shapeTopLeft(s);
      labelLayer.append(labelChip(t, lx, ly));
    }
    if (mode === "edit" && selId != null) {
      const sel = tags.find((t) => t.id === selId);
      if (sel) drawHandles(sel);
    }
    if (pendingShape) {
      if (pendingShape.kind === "bbox")
        shapeSvg.append(
          svg("rect", {
            x: pendingShape.x,
            y: pendingShape.y,
            width: pendingShape.w,
            height: pendingShape.h,
            class: "svg-shape pending",
          }),
        );
      else if (pendingShape.kind === "polygon")
        shapeSvg.append(
          svg("polygon", { points: pendingShape.points.map((p) => p.join(",")).join(" "), class: "svg-shape pending" }),
        );
    }
    if (polyPoints?.length) {
      shapeSvg.append(
        svg("polyline", { points: polyPoints.map((p) => p.join(",")).join(" "), class: "svg-shape pending" }),
      );
      for (const [x, y] of polyPoints) shapeSvg.append(svg("circle", { cx: x, cy: y, r: 0.007, class: "svg-vertex" }));
    }
  }

  function nodeOptions() {
    const opts = [el("option", { value: "" }, "(none)")];
    for (const t of state.tags.filter((x) => !x._deleted))
      opts.push(el("option", { value: t.id }, t.type.label + (t.label ? ` · ${t.label}` : "")));
    return el("select", {}, opts);
  }

  function tagName(t: SceneTag) {
    return t.label || t.type?.label || "object";
  }

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
  function startAttachRegion(t: SceneTag) {
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
  function commitShape(shape: Shape) {
    if (attachToId != null) {
      const t = state.tags.find((x) => x.id === attachToId && !x._deleted);
      attachToId = null;
      pendingShape = null;
      pending.classList.add("hidden");
      pending.replaceChildren();
      if (t) {
        t.shape = shape;
        t._dirty = true;
        if (shape.kind === "bbox") {
          selId = t.id;
          setMode("edit");
        } else setMode("box");
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
    if (!live.length)
      tagList.append(el("p", { class: "muted small" }, "Draw a box or polygon on the image to tag a region."));
    for (const t of live) {
      if (t._editing) {
        tagList.append(tagEditForm(t));
        continue;
      }
      const attaching = attachToId === t.id;
      const regionBtn = el(
        "button",
        {
          class: "ghost small-btn",
          type: "button",
          title: t.shape ? "Replace this region by drawing again" : "Draw a region for this object",
          onclick: () => startAttachRegion(t),
        },
        attaching ? "Drawing…" : t.shape ? "Redraw" : "Add region",
      );
      tagList.append(
        el("div", { class: "scene-tag-row row between" + (attaching ? " attaching" : "") }, [
          el("span", {}, [
            el("span", { class: "scene-dot" }),
            el("b", {}, t.type.label),
            t.label ? el("span", { class: "muted" }, ` · ${t.label}`) : null,
            el("span", { class: "muted small" }, `  ${t.shape ? t.shape.kind : "no region"}`),
          ]),
          el("div", { class: "row", style: "gap:6px" }, [
            regionBtn,
            el(
              "button",
              {
                class: "ghost small-btn",
                onclick: () => {
                  for (const x of state.tags) x._editing = false;
                  t._editing = true;
                  if (t.shape?.kind === "bbox") {
                    selId = t.id;
                    setMode("edit");
                  }
                  renderTags();
                },
              },
              "Edit",
            ),
            el(
              "button",
              {
                class: "ghost small-btn danger",
                onclick: () => {
                  t._deleted = true;
                  for (const e of state.edges) if (e.from === t.id || e.to === t.id) e._deleted = true;
                  if (selId === t.id) selId = null;
                  if (attachToId === t.id) cancelAttach();
                  else {
                    renderRegions();
                    renderTags();
                  }
                },
              },
              "Remove",
            ),
          ]),
        ]),
      );
    }
    renderEdges();
  }

  // Inline editor for one tag: change its type, its label, and (for a bbox) its
  // numeric geometry. Marks the tag dirty so persist updates the record in place.
  function tagEditForm(t: SceneTag) {
    const orig = { shape: t.shape, dirty: t._dirty }; // snapshot so Cancel truly reverts
    const finish = () => {
      t._syncGeom = null;
      t._editing = false;
    };
    const typeInput = createTermInput({
      placeholder: "type (search Wikidata or type text)",
      recent: recent.nodes,
      initial: t.type,
    });
    const labelInput = el("input", {
      type: "text",
      value: t.label || "",
      placeholder: "label (optional, e.g. 'the cyclist')",
    });
    const rows = [
      el("div", { class: "field" }, [el("span", {}, "Type"), typeInput.node]),
      el("div", { class: "field" }, [el("span", {}, "Label"), labelInput]),
    ];
    if (t.shape?.kind === "bbox") {
      const pct = (n: number) => Math.round((n || 0) * 1000) / 10;
      const numIn = (v: number) =>
        el("input", { type: "number", value: String(pct(v)), min: "0", max: "100", step: "0.5", style: "width:72px" });
      const xi = numIn(t.shape.x),
        yi = numIn(t.shape.y),
        wi = numIn(t.shape.w),
        hi = numIn(t.shape.h);
      const apply = () => {
        const g = (i: HTMLInputElement) => clamp01((parseFloat(i.value) || 0) / 100);
        const x = g(xi),
          y = g(yi);
        t.shape = { kind: "bbox", x, y, w: Math.min(g(wi), 1 - x), h: Math.min(g(hi), 1 - y) }; // keep inside the image
        t._dirty = true;
        renderRegions();
      };
      for (const i of [xi, yi, wi, hi]) i.addEventListener("input", apply);
      // keep the numeric fields in sync when the box is dragged/resized on the image
      t._syncGeom = () => {
        if (t.shape?.kind !== "bbox") return;
        xi.value = String(pct(t.shape.x));
        yi.value = String(pct(t.shape.y));
        wi.value = String(pct(t.shape.w));
        hi.value = String(pct(t.shape.h));
      };
      rows.push(
        el("div", { class: "field" }, [
          el("span", {}, "Box  x / y / w / h  (%)"),
          el("div", { class: "row wrap", style: "gap:6px" }, [xi, yi, wi, hi]),
        ]),
      );
      rows.push(el("p", { class: "muted small" }, "Or drag the box and its corner handles on the image."));
    }
    rows.push(
      el("div", { class: "row", style: "gap:6px" }, [
        el(
          "button",
          {
            class: "ghost small-btn",
            onclick: () => {
              const nt = typeInput.getTerm();
              if (nt) t.type = { id: nt.id, label: nt.label };
              t.label = labelInput.value.trim();
              t._dirty = true;
              finish();
              renderRegions();
              renderTags();
            },
          },
          "Done",
        ),
        el(
          "button",
          {
            class: "ghost small-btn",
            onclick: () => {
              t.shape = orig.shape;
              t._dirty = orig.dirty;
              finish();
              renderRegions();
              renderTags();
            },
          },
          "Cancel",
        ),
      ]),
    );
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
    const baseName = (t?: SceneTag) => (t && (t.label || t.type?.label)) || "?";
    const nodeName = (t?: SceneTag) => {
      const base = baseName(t);
      const peers = live.filter((x) => baseName(x) === base);
      return peers.length > 1 ? `${base} #${t ? peers.indexOf(t) + 1 : 0}` : base;
    };
    edgeBox.append(el("h3", { class: "modal-sub" }, "Relations"));
    for (const e of state.edges.filter((x) => !x._deleted)) {
      const f = live.find((t) => t.id === e.from),
        tt = live.find((t) => t.id === e.to);
      edgeBox.append(
        el("div", { class: "row between scene-tag-row" }, [
          el("span", { class: "small" }, `${nodeName(f)} → ${e.type.label} → ${nodeName(tt)}`),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              onclick: () => {
                e._deleted = true;
                renderEdges();
              },
            },
            "Remove",
          ),
        ]),
      );
    }
    const fromSel = nodeOptions(),
      toSel = nodeOptions();
    const rel = createTermInput({
      placeholder: "relation (spatial or search Wikidata)",
      recent: recent.edges,
      seed: SPATIAL_SEED,
    });
    edgeBox.append(
      el("div", { class: "row wrap scene-edge-form" }, [
        fromSel,
        el("span", { class: "muted" }, "→"),
        rel.node,
        el("span", { class: "muted" }, "→"),
        toSel,
        el(
          "button",
          {
            class: "ghost small-btn",
            onclick: () => {
              const type = rel.getTerm();
              if (!fromSel.value || !toSel.value || !type || fromSel.value === toSel.value) return;
              state.edges.push({ id: localId(), edgeUri: null, from: fromSel.value, to: toSel.value, type });
              renderEdges();
            },
          },
          "+ Relation",
        ),
      ]),
    );
  }

  function showPending(shape: Shape) {
    pendingShape = shape;
    renderRegions();
    const typeInput = createTermInput({
      placeholder: "type: search Wikidata (e.g. person, sky)",
      recent: recent.nodes,
    });
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
        const shape = pendingShape;
        if (t && shape) {
          t.shape = shape;
          t._dirty = true;
          pendingShape = null;
          pending.classList.add("hidden");
          if (t.shape.kind === "bbox") {
            selId = t.id;
            setMode("edit");
          }
          renderRegions();
          renderTags();
          return;
        }
      }
      const type = typeInput.getTerm() || { id: "object", label: "object" };
      state.tags.push({
        id: localId(),
        nodeUri: null,
        regionUri: null,
        type,
        label: label.value.trim(),
        shape: pendingShape,
      });
      pendingShape = null;
      pending.classList.add("hidden");
      renderRegions();
      renderTags();
    };
    const orphanField = orphanSel
      ? el("div", { class: "field" }, [el("span", {}, "Apply region to"), orphanSel])
      : null;
    pending.replaceChildren(
      orphanField as unknown as Node,
      typeField,
      labelField,
      el("div", { class: "row" }, [
        el("button", { onclick: commitNew }, orphanSel ? "Apply" : "Add tag"),
        el(
          "button",
          {
            class: "ghost",
            onclick: () => {
              pendingShape = null;
              pending.classList.add("hidden");
              renderRegions();
            },
          },
          "Cancel",
        ),
      ]),
    );
    pending.classList.remove("hidden");
    if (orphanSel) orphanSel.focus();
    else typeInput.node.querySelector("input")?.focus();
  }

  function pos(iw: HTMLElement, e: PointerEvent): Point {
    const r = iw.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  }

  // ---- edit mode: move / resize an existing bbox ----
  function startMove(t: SceneTag, e: PointerEvent) {
    selId = t.id;
    if (t.shape?.kind === "bbox" && imgWrap) {
      drag = {
        tagId: t.id,
        kind: "move",
        corner: null,
        startPos: pos(imgWrap, e),
        startShape: { ...t.shape },
        moved: false,
      };
      imgWrap.setPointerCapture(e.pointerId);
    }
    renderRegions();
  }
  function startResize(t: SceneTag, corner: Corner, e: PointerEvent) {
    if (t.shape?.kind !== "bbox" || !imgWrap) return;
    selId = t.id;
    drag = { tagId: t.id, kind: "resize", corner, startPos: pos(imgWrap, e), startShape: { ...t.shape }, moved: false };
    imgWrap.setPointerCapture(e.pointerId);
  }
  function applyDrag(cur: Point) {
    const activeDrag = drag;
    if (!activeDrag) return;
    const t = state.tags.find((x) => x.id === activeDrag.tagId);
    if (!t || t.shape?.kind !== "bbox") return;
    const s0 = activeDrag.startShape;
    const dx = cur[0] - activeDrag.startPos[0],
      dy = cur[1] - activeDrag.startPos[1];
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) activeDrag.moved = true;
    if (activeDrag.kind === "move") {
      t.shape = {
        kind: "bbox",
        x: Math.min(Math.max(0, s0.x + dx), 1 - s0.w),
        y: Math.min(Math.max(0, s0.y + dy), 1 - s0.h),
        w: s0.w,
        h: s0.h,
      };
    } else {
      let x1 = s0.x,
        y1 = s0.y,
        x2 = s0.x + s0.w,
        y2 = s0.y + s0.h;
      const corner = activeDrag.corner;
      if (!corner) return;
      if (corner.includes("l")) x1 = clamp01(s0.x + dx);
      if (corner.includes("r")) x2 = clamp01(x2 + dx);
      if (corner.includes("t")) y1 = clamp01(s0.y + dy);
      if (corner.includes("b")) y2 = clamp01(y2 + dy);
      t.shape = { kind: "bbox", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    t._syncGeom?.(); // keep an open Edit form's numeric fields tracking the box
    renderRegions();
  }
  function finishDrag() {
    const activeDrag = drag;
    if (!activeDrag) return;
    const t = state.tags.find((x) => x.id === activeDrag.tagId);
    if (t && activeDrag.moved) t._dirty = true;
    t?._syncGeom?.();
    drag = null;
    renderRegions();
  }

  function wireDrawing(iw: HTMLDivElement) {
    let start: Point | null = null;
    iw.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (mode === "edit") {
        if (selId != null) {
          selId = null;
          renderRegions();
        }
        return;
      } // empty click deselects (boxes stopPropagation)
      if (mode !== "box") return;
      start = pos(iw, e);
      iw.setPointerCapture(e.pointerId);
    });
    iw.addEventListener("pointermove", (e) => {
      if (drag) {
        applyDrag(pos(iw, e));
        return;
      }
      if (!start) return;
      const [cx, cy] = pos(iw, e);
      pendingShape = {
        kind: "bbox",
        x: Math.min(start[0], cx),
        y: Math.min(start[1], cy),
        w: Math.abs(cx - start[0]),
        h: Math.abs(cy - start[1]),
      };
      renderRegions();
    });
    iw.addEventListener("pointerup", (e) => {
      if (drag) {
        finishDrag();
        return;
      }
      if (mode === "polygon") {
        const [x, y] = pos(iw, e);
        (polyPoints ||= []).push([x, y]);
        renderRegions();
        updatePolyBtn();
        return;
      }
      if (!start) return;
      const s = pendingShape;
      start = null;
      pendingShape = null;
      if (s?.kind === "bbox" && s.w > 0.015 && s.h > 0.015) commitShape(s);
      else renderRegions();
    });
    iw.addEventListener("dblclick", () => {
      if (mode === "polygon") finishPolygon();
    });
  }

  function finishPolygon() {
    if (polyPoints && polyPoints.length >= 3) {
      const pts = polyPoints;
      polyPoints = null;
      updatePolyBtn();
      commitShape({ kind: "polygon", points: pts });
    } else {
      polyPoints = null;
      updatePolyBtn();
      renderRegions();
    }
  }

  const boxBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("box") }, "▭ Box");
  const polyBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("polygon") }, "⬡ Polygon");
  const editBtn = el("button", { class: "ghost small-btn", onclick: () => setMode("edit") }, "✥ Edit");
  const analyzeBtn = onAnalyze
    ? el(
        "button",
        {
          class: "ghost small-btn",
          title: "Detect objects and relations from the image with the analysis model",
          onclick: async (e: MouseEvent) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            status.className = "status";
            status.textContent = "Loading photo from your PDS…";
            const onProgress = (msg: string) => {
              status.className = "status";
              status.textContent = msg;
            };
            try {
              const res = await onAnalyze(onProgress);
              if (res) {
                state = await loadScene(ctx.agent, ctx.did, photoUri, signals);
                selId = null;
                renderRegions();
                renderTags();
                status.className = "status ok";
                status.textContent = "Analyzed ✓";
              } else {
                status.textContent = "";
              }
            } catch (err: unknown) {
              status.className = "status err";
              status.textContent = `Error: ${errorMessage(err)}`;
            } finally {
              btn.disabled = false;
            }
          },
        },
        "✨ Analyze",
      )
    : null;
  const finishBtn = el("button", { class: "ghost small-btn hidden", onclick: finishPolygon }, "Finish region");
  function setMode(m: Mode) {
    mode = m;
    polyPoints = null;
    pendingShape = null;
    if (m !== "edit") selId = null;
    boxBtn.classList.toggle("active", m === "box");
    polyBtn.classList.toggle("active", m === "polygon");
    editBtn.classList.toggle("active", m === "edit");
    updatePolyBtn();
    renderRegions();
  }
  function updatePolyBtn() {
    finishBtn.classList.toggle("hidden", mode !== "polygon" || (polyPoints?.length ?? 0) < 3);
  }
  boxBtn.classList.add("active");

  modal.append(
    el("div", { class: "row between" }, [
      el("h2", {}, "Scene graph"),
      el("span", { class: "mono muted small" }, `#${photo.idx != null ? photo.idx + 1 : ""}`),
    ]),
    el(
      "p",
      { class: "muted small" },
      "Draw a box or polygon to ground a typed node, or use Edit to move/resize a box and fix its type or label. Use Add region or Redraw when Analyze leaves a missing or misplaced box. Imported regions (masks, outlines, points from CV tools) render here too. Types are Wikidata entities or free text.",
    ),
    el("div", { class: "row wrap scene-tools" }, [boxBtn, polyBtn, editBtn, analyzeBtn, finishBtn]),
    stage,
    pending,
    tagList,
    edgeBox,
    el("div", { class: "row modal-actions" }, [
      el(
        "button",
        {
          onclick: async (e: MouseEvent) => {
            await withSave(e.target as HTMLButtonElement, status, async () => {
              await persist(ctx.agent, ctx.did, photoUri, state);
              recentCache = null;
              state = await loadScene(ctx.agent, ctx.did, photoUri, signals);
              selId = null;
              renderRegions();
              renderTags();
            });
          },
        },
        "Save to PDS",
      ),
      el("button", { class: "ghost", onclick: close }, "Close"),
      status,
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);

  try {
    const url = photo.value?.photo ? await sceneImageUrl(ctx.agent, ctx.did, photo.value.photo) : null;
    imgWrap = el("div", { class: "scene-img-wrap" }, [
      url ? el("img", { src: url, alt: "", draggable: "false" }) : el("div", { class: "muted small" }, "(no image)"),
      drawLayer,
    ]);
    stage.replaceChildren(imgWrap);
    drawLayer.classList.remove("hidden");
    if (url) wireDrawing(imgWrap);
  } catch {
    stage.replaceChildren(el("div", { class: "muted small" }, "(image failed to load)"));
  }

  [recent, state] = await Promise.all([
    loadRecentTerms(ctx.agent, ctx.did),
    loadScene(ctx.agent, ctx.did, photoUri, signals).catch((err: unknown) => {
      status.className = "status err";
      status.textContent = `Load failed: ${errorMessage(err)}`;
      return { graph: null, graphUri: null, tags: [], edges: [] };
    }),
  ]);
  const hasLocalChanges = () =>
    Boolean(
      pendingShape ||
      polyPoints?.length ||
      state.tags.some((tag) => tag._dirty || tag._deleted || !tag.nodeUri) ||
      state.edges.some((edge) => edge._deleted || !edge.edgeUri),
    );
  const disposeSignals = renderSceneRecordsOn(signals, ({ graphs, regions, nodes, edges }) => {
    if (closed || hasLocalChanges()) return;
    if (state.graph && !graphs.size && !regions.size && !nodes.size && !edges.size) return;
    state = sceneStateFromRecords(
      photoUri,
      [...graphs.values()] as unknown as RecordEnvelope<GraphValue>[],
      [...regions.values()] as unknown as RecordEnvelope<RegionValue>[],
      [...nodes.values()] as unknown as RecordEnvelope<NodeValue>[],
      [...edges.values()] as unknown as RecordEnvelope<EdgeValue>[],
    );
    renderRegions();
    renderTags();
  });
  if (closed) disposeSignals();
  else disposeSceneSignals = disposeSignals;
}

async function withSave(button: HTMLButtonElement, status: HTMLElement, fn: () => Promise<void>): Promise<void> {
  button.disabled = true;
  status.className = "status";
  status.textContent = "Saving…";
  try {
    await fn();
    status.classList.add("ok");
    status.textContent = "Saved ✓";
  } catch (err: unknown) {
    status.classList.add("err");
    status.textContent = `Error: ${errorMessage(err)}`;
  } finally {
    button.disabled = false;
  }
}
