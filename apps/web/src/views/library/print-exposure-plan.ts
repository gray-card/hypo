import { el, field, openModal, toast } from "@hypo/ui";
import { exposurePlanSnapshot, validateExposurePlan, type ExposurePlanValue } from "@hypo/domain";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

const NSID = "app.graycard.print.exposurePlan";
const REGION_NSID = "app.graycard.scene.region";
const NODE_NSID = "app.graycard.scene.node";
const SVGNS = "http://www.w3.org/2000/svg";
type Point = { x: number; y: number };
type Selection = {
  kind: string;
  combine?: string;
  points: Point[];
  width?: number;
  feather?: number;
  opacity?: number;
  sourceRegion?: string;
};
type Exposure = {
  id: string;
  label?: string;
  action: "base" | "dodge" | "burn";
  durationMs: number;
  grade?: string;
  filtration?: { cyan?: number; magenta?: number; yellow?: number };
  baseId?: string;
  startOffsetMs?: number;
  targetNode?: string;
  targetLabel?: string;
  selections?: Selection[];
  toolNote?: string;
  notes?: string;
};

const point = (x: number, y: number): Point => ({
  x: Math.max(0, Math.min(10000, Math.round(x))),
  y: Math.max(0, Math.min(10000, Math.round(y))),
});
const seconds = (ms: number) => String(Math.round(ms / 100) / 10);
const millis = (raw: string) => Math.round(Number(raw) * 1000);
const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};

export function sceneRegionSelection(value: LibraryValue): Selection | null {
  const scale = 10000 / 1_000_000;
  if (value.kind === "polygon" && Array.isArray(value.geometry?.points)) {
    const points = value.geometry.points.map(([x, y]: [number, number]) => point(x * scale, y * scale));
    return points.length >= 3 ? { kind: "polygon", combine: "add", points, opacity: 10000 } : null;
  }
  if (value.kind === "bbox" && value.bbox) {
    const { x, y, w, h } = value.bbox;
    return {
      kind: "polygon",
      combine: "add",
      opacity: 10000,
      points: [
        point(x * scale, y * scale),
        point((x + w) * scale, y * scale),
        point((x + w) * scale, (y + h) * scale),
        point(x * scale, (y + h) * scale),
      ],
    };
  }
  return null;
}

export function openPrintExposurePlanEditor(
  services: ActivityServices,
  onDone: () => void,
  existing: LibraryRecord | null = null,
) {
  const initial = existing?.value || {};
  const plan: LibraryValue = {
    ...exposurePlanSnapshot({
      name: initial.name || "",
      referencePhoto: initial.referencePhoto,
      imageWidth: initial.imageWidth,
      imageHeight: initial.imageHeight,
      exposures: initial.exposures || [{ id: crypto.randomUUID(), action: "base", durationMs: 10000, grade: "2.5" }],
      testStrips: initial.testStrips || [],
      notes: initial.notes,
    }),
    createdAt: initial.createdAt || new Date().toISOString(),
  };
  let selected = 0;
  let tool: "brush" | "polygon" | "ellipse" | "linear-gradient" = "brush";
  let draft: Selection | null = null;
  let drawing = false;
  let vertexEdit: { shape: Selection; index: number } | null = null;
  let photoRequest = 0;
  let availablePhotos: readonly LibraryRecord[] = [];
  const name = el("input", { value: plan.name, maxlength: "128", placeholder: "e.g. Evening portrait, 8×10" });
  const photo = el("select", { "aria-label": "Reference photo" }, [
    el("option", { value: "" }, "Choose a photo for visual masks"),
  ]);
  const img = el("img", { alt: "Reference photograph", class: "print-plan-image" });
  const overlay = svg("svg", {
    viewBox: "0 0 10000 10000",
    preserveAspectRatio: "none",
    class: "print-plan-overlay",
    role: "img",
    "aria-label": "Exposure selections",
  });
  const canvas = el(
    "div",
    { class: "print-plan-canvas", tabindex: "0", "aria-label": "Draw an exposure selection on the reference photo" },
    [img, overlay],
  );
  const toolBar = el("div", { class: "print-plan-tools", role: "group", "aria-label": "Selection tools" });
  const stepsNode = el("div", { class: "print-plan-steps" });
  const inspector = el("div", { class: "print-plan-inspector" });
  const testStripsNode = el("div", { class: "print-plan-test-strips" });
  const regionSelect = el("select", { "aria-label": "Import scene region" }, [
    el("option", { value: "" }, "Import a scene region…"),
  ]);
  const hint = el(
    "p",
    { class: "muted small print-plan-hint" },
    "Choose a photo, select a dodge or burn, then draw a region. Polygon: click points, then press Enter.",
  );
  const exposures = () => plan.exposures as Exposure[];
  const current = () => exposures()[selected];

  const paint = () => {
    overlay.replaceChildren();
    const step = current();
    if (!step) return;
    const color = step.action === "dodge" ? "#83cbd3" : "#e5ae68";
    for (const [shapeIndex, shape] of [...(step.selections || []), ...(draft ? [draft] : [])].entries()) {
      const opacity = (shape.opacity ?? 10000) / 10000;
      let softFilter = "";
      if (shape.feather) {
        const id = `print-mask-soft-${shapeIndex}`;
        const filter = svg("filter", { id, x: "-50%", y: "-50%", width: "200%", height: "200%" });
        filter.append(svg("feGaussianBlur", { stdDeviation: Math.max(1, shape.feather / 4) }));
        const defs = svg("defs", {});
        defs.append(filter);
        overlay.append(defs);
        softFilter = `url(#${id})`;
      }
      if (shape.kind === "brush") {
        const points = shape.points.map((p) => `${p.x},${p.y}`).join(" ");
        overlay.append(
          svg("polyline", {
            points,
            fill: "none",
            stroke: color,
            "stroke-width": shape.width || 250,
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
            opacity,
            ...(softFilter ? { filter: softFilter } : {}),
          }),
        );
      } else if (shape.kind === "polygon") {
        const points = shape.points.map((p) => `${p.x},${p.y}`).join(" ");
        overlay.append(
          svg("polygon", {
            points,
            fill: color,
            "fill-opacity": opacity * 0.3,
            stroke: "none",
            ...(softFilter ? { filter: softFilter } : {}),
          }),
        );
        overlay.append(
          svg("polygon", {
            points,
            fill: "none",
            stroke: color,
            "stroke-width": 28,
            "stroke-dasharray": shape.combine === "subtract" ? "80 60" : "none",
          }),
        );
        shape.points.forEach((p, index) => {
          const handle = svg("circle", {
            cx: p.x,
            cy: p.y,
            r: 56,
            fill: color,
            class: "print-plan-vertex",
          });
          if (shape !== draft)
            handle.addEventListener("pointerdown", (event) => {
              event.stopPropagation();
              vertexEdit = { shape, index };
              overlay.setPointerCapture(event.pointerId);
            });
          overlay.append(handle);
        });
      } else if (shape.kind === "ellipse" && shape.points.length >= 2) {
        const [a, b] = shape.points;
        overlay.append(
          svg("ellipse", {
            cx: (a.x + b.x) / 2,
            cy: (a.y + b.y) / 2,
            rx: Math.abs(a.x - b.x) / 2,
            ry: Math.abs(a.y - b.y) / 2,
            fill: color,
            "fill-opacity": opacity * 0.3,
            stroke: color,
            "stroke-width": 30,
            ...(softFilter ? { filter: softFilter } : {}),
          }),
        );
      } else if (shape.kind === "linear-gradient" && shape.points.length >= 2) {
        const [a, b] = shape.points;
        const id = `print-mask-gradient-${shapeIndex}`;
        const defs = svg("defs", {});
        const gradient = svg("linearGradient", {
          id,
          gradientUnits: "userSpaceOnUse",
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
        });
        gradient.append(
          svg("stop", { offset: "0%", "stop-color": color, "stop-opacity": opacity * 0.4 }),
          svg("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }),
        );
        defs.append(gradient);
        overlay.append(defs, svg("rect", { x: 0, y: 0, width: 10000, height: 10000, fill: `url(#${id})` }));
        overlay.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, "stroke-width": 60 }));
        overlay.append(svg("circle", { cx: a.x, cy: a.y, r: 80, fill: color }));
        overlay.append(svg("circle", { cx: b.x, cy: b.y, r: 80, fill: color }));
      }
    }
  };
  const renderSteps = () => {
    stepsNode.replaceChildren(
      ...exposures().map((step, index) =>
        el(
          "button",
          {
            type: "button",
            class: `print-plan-step${index === selected ? " selected" : ""}`,
            "aria-pressed": String(index === selected),
            onclick: () => {
              selected = index;
              draft = null;
              renderSteps();
              renderInspector();
              paint();
            },
          },
          [
            el("span", { class: "print-plan-step-index" }, String(index + 1)),
            el("span", {}, [
              el(
                "strong",
                {},
                step.label || (step.action === "base" ? "Base exposure" : step.action === "dodge" ? "Dodge" : "Burn"),
              ),
              el(
                "small",
                {},
                `${seconds(step.durationMs)} s${step.grade ? ` · grade ${step.grade}` : ""}${step.targetLabel ? ` · ${step.targetLabel}` : ""}`,
              ),
            ]),
          ],
        ),
      ),
    );
  };
  const refreshRegionOptions = () => {
    regionSelect.replaceChildren(el("option", { value: "" }, "Import a scene region…"));
    if (!plan.referencePhoto) return;
    const regions = services.getStore().recordsByCollection?.[REGION_NSID] || [];
    const nodes = services.getStore().recordsByCollection?.[NODE_NSID] || [];
    for (const region of regions.filter((entry) => entry.value.photo === plan.referencePhoto)) {
      if (!sceneRegionSelection(region.value)) continue;
      const node = nodes.find((entry) => entry.value.region === region.uri);
      regionSelect.append(
        el(
          "option",
          { value: region.uri },
          node?.value.label || node?.value.type?.label || `Region ${region.uri.split("/").at(-1)}`,
        ),
      );
    }
  };
  const renderInspector = () => {
    const step = current();
    if (!step) {
      inspector.replaceChildren();
      return;
    }
    const label = el("input", { value: step.label || "", maxlength: "128", placeholder: "e.g. Hold back face" });
    label.addEventListener("input", () => {
      step.label = label.value.trim() || undefined;
      renderSteps();
    });
    const duration = el("input", {
      type: "number",
      min: "0.001",
      max: "3600",
      step: "0.1",
      value: seconds(step.durationMs),
    });
    duration.addEventListener("change", () => {
      step.durationMs = millis(duration.value);
      renderSteps();
    });
    const grade = el("input", { value: step.grade || "", maxlength: "32", placeholder: "e.g. 2.5 or 00" });
    grade.addEventListener("input", () => {
      step.grade = grade.value.trim() || undefined;
      renderSteps();
    });
    const filtration = (["cyan", "magenta", "yellow"] as const).map((channel) => {
      const input = el("input", {
        type: "number",
        min: "0",
        max: "255",
        step: "1",
        value: step.filtration?.[channel] ?? "",
        placeholder: "—",
      });
      input.addEventListener("change", () => {
        const next = { ...(step.filtration || {}) };
        if (input.value === "") delete next[channel];
        else next[channel] = Number(input.value);
        step.filtration = Object.keys(next).length ? next : undefined;
      });
      return field(channel[0].toUpperCase() + channel.slice(1), input);
    });
    const target = el("input", {
      value: step.targetLabel || "",
      maxlength: "128",
      placeholder: "e.g. sky, face, foreground",
    });
    target.addEventListener("input", () => {
      step.targetLabel = target.value.trim() || undefined;
      renderSteps();
    });
    const base = el(
      "select",
      {},
      exposures()
        .filter((candidate, index) => candidate.action === "base" && index < selected)
        .map((candidate) =>
          el(
            "option",
            { value: candidate.id },
            candidate.label || `Base exposure ${exposures().indexOf(candidate) + 1}`,
          ),
        ),
    );
    base.value = step.baseId || base.options[0]?.value || "";
    base.addEventListener("change", () => {
      step.baseId = base.value;
    });
    const offset = el("input", { type: "number", min: "0", step: "0.1", value: seconds(step.startOffsetMs || 0) });
    offset.addEventListener("change", () => {
      step.startOffsetMs = millis(offset.value);
    });
    const toolNote = el("input", {
      value: step.toolNote || "",
      maxlength: "256",
      placeholder: "e.g. move card gently to soften edge",
    });
    toolNote.addEventListener("input", () => {
      step.toolNote = toolNote.value.trim() || undefined;
    });
    const instruction = el(
      "textarea",
      { rows: "2", maxlength: "512", placeholder: "Sequence, hand movement, or other exposure instructions" },
      step.notes || "",
    );
    instruction.addEventListener("input", () => {
      step.notes = instruction.value.trim() || undefined;
    });
    const move = (delta: number) => {
      const next = selected + delta;
      if (next < 0 || next >= exposures().length) return;
      [exposures()[selected], exposures()[next]] = [exposures()[next], exposures()[selected]];
      selected = next;
      renderSteps();
      renderInspector();
      paint();
    };
    const deleteStep = () => {
      if (exposures().length === 1) return;
      const removed = exposures().splice(selected, 1)[0];
      for (const candidate of exposures()) if (candidate.baseId === removed.id) candidate.baseId = undefined;
      selected = Math.min(selected, exposures().length - 1);
      renderSteps();
      renderInspector();
      paint();
    };
    const removeShape = el(
      "button",
      {
        type: "button",
        class: "ghost small-btn",
        disabled: !step.selections?.length,
        onclick: () => {
          step.selections?.pop();
          renderInspector();
          paint();
        },
      },
      "Undo last selection",
    );
    const shapes = el(
      "div",
      { class: "print-plan-shapes" },
      (step.selections || []).map((shape, index) => {
        const operation = el(
          "select",
          { "aria-label": `Selection ${index + 1} operation` },
          ["add", "subtract", "intersect"].map((value) =>
            el("option", { value }, value[0].toUpperCase() + value.slice(1)),
          ),
        );
        operation.value = shape.combine || "add";
        operation.addEventListener("change", () => {
          shape.combine = operation.value;
          paint();
        });
        const opacity = el("input", {
          type: "range",
          min: "0",
          max: "10000",
          value: String(shape.opacity ?? 10000),
          "aria-label": `Selection ${index + 1} strength`,
        });
        opacity.addEventListener("input", () => {
          shape.opacity = Number(opacity.value);
          paint();
        });
        const feather = el("input", {
          type: "range",
          min: "0",
          max: "1500",
          value: String(shape.feather || 0),
          "aria-label": `Selection ${index + 1} feather`,
        });
        feather.addEventListener("input", () => {
          shape.feather = Number(feather.value);
          paint();
        });
        const width = el("input", {
          type: "range",
          min: "30",
          max: "1400",
          value: String(shape.width || 250),
          "aria-label": `Selection ${index + 1} brush size`,
        });
        width.addEventListener("input", () => {
          shape.width = Number(width.value);
          paint();
        });
        return el("div", { class: "print-plan-shape" }, [
          el("div", { class: "row between" }, [
            el("strong", {}, `${shape.kind.replaceAll("-", " ")} ${index + 1}`),
            el(
              "button",
              {
                type: "button",
                class: "ghost small-btn",
                onclick: () => {
                  step.selections?.splice(index, 1);
                  renderInspector();
                  paint();
                },
              },
              "Remove",
            ),
          ]),
          field("Combine", operation),
          field("Strength", opacity),
          field("Feather", feather),
          ...(shape.kind === "brush" ? [field("Brush size", width)] : []),
        ]);
      }),
    );
    const sceneNodes = services.getStore().recordsByCollection?.[NODE_NSID] || [];
    const sceneNode = el("select", {}, [
      el("option", { value: "" }, "No linked scene subject"),
      ...sceneNodes
        .filter((entry) => {
          const region = services.getStore().byUri.get(entry.value.region)?.item;
          return region?.value.photo === plan.referencePhoto;
        })
        .map((entry) =>
          el("option", { value: entry.uri }, entry.value.label || entry.value.type?.label || "Scene subject"),
        ),
    ]);
    sceneNode.value = step.targetNode || "";
    sceneNode.addEventListener("change", () => {
      step.targetNode = sceneNode.value || undefined;
      const node = sceneNodes.find((entry) => entry.uri === sceneNode.value);
      if (node && !step.targetLabel) {
        step.targetLabel = node.value.label || node.value.type?.label;
        target.value = step.targetLabel || "";
        renderSteps();
      }
    });
    inspector.replaceChildren(
      el("h3", {}, "Exposure instruction"),
      field("Name", label),
      field("Time (seconds)", duration),
      field("Contrast grade", grade),
      el("details", { class: "print-plan-filtration" }, [
        el("summary", {}, "Color-head filtration (optional)"),
        el("div", { class: "row wrap" }, filtration),
      ]),
      ...(step.action === "dodge" ? [field("During base exposure", base), field("Start at (seconds)", offset)] : []),
      ...(step.action !== "base"
        ? [
            field("Region name", target),
            field("Scene subject", sceneNode),
            field("Masking technique", toolNote),
            shapes,
            removeShape,
          ]
        : []),
      field("Instruction notes", instruction),
      el("div", { class: "row wrap" }, [
        el(
          "button",
          { type: "button", class: "ghost small-btn", onclick: () => move(-1), disabled: selected === 0 },
          "Move earlier",
        ),
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn",
            onclick: () => move(1),
            disabled: selected === exposures().length - 1,
          },
          "Move later",
        ),
        el(
          "button",
          { type: "button", class: "ghost small-btn", onclick: deleteStep, disabled: exposures().length === 1 },
          "Remove",
        ),
      ]),
    );
    regionSelect.onchange = () => {
      const region = services.getStore().byUri.get(regionSelect.value)?.item;
      const shape = region ? sceneRegionSelection(region.value) : null;
      if (shape && step.action !== "base") {
        shape.sourceRegion = region!.uri;
        (step.selections ||= []).push(shape);
        const node = sceneNodes.find((entry) => entry.value.region === region!.uri);
        if (node) {
          step.targetNode = node.uri;
          step.targetLabel ||= node.value.label || node.value.type?.label;
        }
        renderInspector();
        renderSteps();
        paint();
      }
    };
  };
  const chooseTool = (next: typeof tool) => {
    tool = next;
    draft = null;
    for (const button of toolBar.querySelectorAll<HTMLButtonElement>("button"))
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    paint();
  };
  toolBar.append(
    ...(["brush", "polygon", "ellipse", "linear-gradient"] as const).map((name) =>
      el(
        "button",
        {
          type: "button",
          class: "ghost small-btn",
          "data-tool": name,
          "aria-pressed": String(tool === name),
          onclick: () => chooseTool(name),
        },
        name === "linear-gradient" ? "Gradient" : name[0].toUpperCase() + name.slice(1),
      ),
    ),
  );
  const brushSize = el("input", { type: "range", min: "30", max: "1400", value: "250", "aria-label": "Brush size" });
  const combine = el("select", { "aria-label": "Selection operation" }, [
    el("option", { value: "add" }, "Add"),
    el("option", { value: "subtract" }, "Subtract"),
    el("option", { value: "intersect" }, "Intersect"),
  ]);
  const coords = (event: PointerEvent): Point => {
    const box = overlay.getBoundingClientRect();
    return point(((event.clientX - box.left) / box.width) * 10000, ((event.clientY - box.top) / box.height) * 10000);
  };
  const finish = () => {
    if (!draft) return;
    const min = draft.kind === "polygon" ? 3 : draft.kind === "brush" ? 1 : 2;
    if (draft.points.length >= min) (current().selections ||= []).push(draft);
    draft = null;
    drawing = false;
    renderInspector();
    paint();
  };
  overlay.addEventListener("pointerdown", (event) => {
    if (!plan.referencePhoto || !current() || current().action === "base") return;
    event.preventDefault();
    const p = coords(event);
    if (tool === "polygon") {
      if (!draft || draft.kind !== "polygon")
        draft = { kind: "polygon", combine: combine.value, points: [], opacity: 10000 };
      if (draft.points.length < 256) draft.points.push(p);
      paint();
      return;
    }
    drawing = true;
    overlay.setPointerCapture(event.pointerId);
    draft = {
      kind: tool,
      combine: combine.value,
      points: tool === "brush" ? [p] : [p, p],
      width: Number(brushSize.value),
      opacity: 10000,
    };
    paint();
  });
  overlay.addEventListener("pointermove", (event) => {
    if (vertexEdit) {
      vertexEdit.shape.points[vertexEdit.index] = coords(event);
      paint();
      return;
    }
    if (!drawing || !draft) return;
    const p = coords(event);
    if (draft.kind === "brush") {
      if (draft.points.length >= 256) draft.points = draft.points.filter((_, index) => index % 2 === 0);
      draft.points.push(p);
    } else draft.points[1] = p;
    paint();
  });
  overlay.addEventListener("pointerup", () => {
    if (vertexEdit) {
      vertexEdit = null;
      return;
    }
    if (drawing) finish();
  });
  overlay.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (draft?.kind === "polygon") finish();
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && draft?.kind === "polygon") {
      event.preventDefault();
      finish();
    }
    if (event.key === "Escape") {
      draft = null;
      paint();
    }
  });
  const showPhoto = async () => {
    const nextPhoto = photo.value || undefined;
    if (
      plan.referencePhoto &&
      nextPhoto !== plan.referencePhoto &&
      exposures().some((step) => step.selections?.length)
    ) {
      photo.value = plan.referencePhoto;
      hint.textContent =
        "Remove the current selections before changing the reference image; their coordinates belong to this photo.";
      return;
    }
    plan.referencePhoto = nextPhoto;
    const request = ++photoRequest;
    img.removeAttribute("src");
    canvas.classList.toggle("has-photo", Boolean(plan.referencePhoto));
    refreshRegionOptions();
    renderInspector();
    paint();
    if (!plan.referencePhoto) return;
    const record = availablePhotos.find((candidate) => candidate.uri === plan.referencePhoto);
    if (!record) return;
    let url: string | null | undefined;
    try {
      url = await services.blobUrl(record.value.photo);
    } catch {
      if (request === photoRequest)
        hint.textContent =
          "This reference image could not be loaded. Check your connection or choose another photo before drawing.";
      return;
    }
    if (request !== photoRequest) return;
    if (!url) {
      hint.textContent = "This photo has no displayable image. Choose another photo before drawing.";
      return;
    }
    img.onload = () => {
      plan.imageWidth = img.naturalWidth;
      plan.imageHeight = img.naturalHeight;
      canvas.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    };
    img.onerror = () => {
      hint.textContent = "The reference image could not be displayed. Try a different photo.";
    };
    img.src = url;
  };
  photo.addEventListener("change", () => {
    void showPhoto();
  });
  const add = (action: Exposure["action"]) => {
    const base = [...exposures()].reverse().find((step) => step.action === "base");
    exposures().push({
      id: crypto.randomUUID(),
      action,
      durationMs: action === "base" ? 10000 : 2000,
      ...(action === "dodge" && base ? { baseId: base.id, startOffsetMs: 0 } : {}),
    });
    selected = exposures().length - 1;
    renderSteps();
    renderInspector();
    paint();
  };
  const addActions = el("div", { class: "print-plan-add row wrap" }, [
    el("button", { type: "button", class: "ghost small-btn", onclick: () => add("base") }, "Add base exposure"),
    el("button", { type: "button", class: "ghost small-btn", onclick: () => add("dodge") }, "Add dodge"),
    el("button", { type: "button", class: "ghost small-btn", onclick: () => add("burn") }, "Add burn"),
  ]);
  const renderTestStrips = () => {
    const strips = plan.testStrips as LibraryValue[];
    testStripsNode.replaceChildren(
      ...strips.map((strip, index) => {
        const number = (label: string, key: string, divisor = 1000) => {
          const input = el("input", {
            type: "number",
            min: "0.001",
            step: "0.1",
            value: strip[key] ? String(strip[key] / divisor) : "",
          });
          input.addEventListener("change", () => {
            if (input.value) strip[key] = Math.round(Number(input.value) * divisor);
            else delete strip[key];
          });
          return field(label, input);
        };
        const grade = el("input", { value: strip.grade || "", maxlength: "32" });
        grade.addEventListener("input", () => {
          strip.grade = grade.value.trim() || undefined;
        });
        const count = el("input", { type: "number", min: "1", max: "64", step: "1", value: strip.strips || 5 });
        count.addEventListener("change", () => {
          strip.strips = Number(count.value);
        });
        const notes = el("input", { value: strip.notes || "", maxlength: "512", placeholder: "What the test showed" });
        notes.addEventListener("input", () => {
          strip.notes = notes.value.trim() || undefined;
        });
        return el("div", { class: "print-plan-shape" }, [
          el("div", { class: "row between" }, [
            el("strong", {}, `Test strip ${index + 1}`),
            el(
              "button",
              {
                type: "button",
                class: "ghost small-btn",
                onclick: () => {
                  strips.splice(index, 1);
                  renderTestStrips();
                },
              },
              "Remove",
            ),
          ]),
          field("Grade", grade),
          number("First exposure (seconds)", "baseDurationMs"),
          number("Increment (seconds)", "incrementMs"),
          field("Number of strips", count),
          number("Chosen exposure (seconds)", "chosenDurationMs"),
          field("Findings", notes),
        ]);
      }),
    );
  };
  const addTestStrip = el(
    "button",
    {
      type: "button",
      class: "ghost small-btn",
      onclick: () => {
        (plan.testStrips as LibraryValue[]).push({ baseDurationMs: 5000, incrementMs: 2000, strips: 5 });
        renderTestStrips();
      },
    },
    "Add test strip",
  );
  const notes = el(
    "textarea",
    { rows: "2", maxlength: "2000", placeholder: "Paper, aperture, test-strip findings, and other instructions" },
    plan.notes || "",
  );
  const content = el("div", { class: "print-plan-editor" }, [
    el("div", { class: "print-plan-main" }, [
      field("Plan name", name),
      field("Reference image", photo),
      el("div", { class: "print-plan-stage" }, [canvas]),
      el("div", { class: "print-plan-tool-row" }, [
        toolBar,
        field("Brush size", brushSize),
        field("Selection", combine),
      ]),
      field("Reuse a scene region", regionSelect),
      hint,
    ]),
    el("div", { class: "print-plan-rail" }, [
      el("h3", {}, "Exposure sequence"),
      el(
        "p",
        { class: "muted small" },
        "Base and burn steps run in order. Dodges run inside their selected base exposure.",
      ),
      stepsNode,
      addActions,
      inspector,
      el("details", { class: "print-plan-tests" }, [el("summary", {}, "Test strips"), testStripsNode, addTestStrip]),
      field("Plan notes", notes),
    ]),
  ]);
  const modal = openModal(
    existing ? "Edit print exposure plan" : "New print exposure plan",
    [content],
    async () => {
      plan.name = name.value.trim();
      plan.notes = notes.value.trim() || undefined;
      if (draft?.kind === "polygon") finish();
      for (const step of exposures())
        if (step.action === "dodge" && !step.baseId) throw new Error("Every dodge needs a preceding base exposure.");
      validateExposurePlan(plan as ExposurePlanValue);
      if (existing) plan.updatedAt = new Date().toISOString();
      await services.saveRecord(NSID, plan, existing);
      await services.reloadStore();
      toast(existing ? "Print exposure plan updated" : "Print exposure plan saved", "ok");
      onDone();
    },
    { wide: true, saveLabel: existing ? "Save changes" : "Save plan" },
  );
  void services
    .capturePhotos()
    .then((photos) => {
      availablePhotos = photos;
      photo.append(
        ...photos.map((record) =>
          el(
            "option",
            { value: record.uri },
            record.value.alt || record.value.name || record.uri.split("/").at(-1) || "Photo",
          ),
        ),
      );
      photo.value = plan.referencePhoto || "";
      void showPhoto();
    })
    .catch(() => {
      hint.textContent =
        "Photos could not be loaded. You can save an exposure sequence without visual selections, or retry after reconnecting.";
    });
  renderSteps();
  renderInspector();
  renderTestStrips();
  paint();
  return modal;
}
