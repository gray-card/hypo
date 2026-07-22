// workflow.js: build and save app.graycard.workflow.* records

import { NS, saveRecord, resolvePhotoCapture, saveWorkflowTemplate } from "./graycard.js";
import { parseAtUri } from "./grain.js";

export const STAGE_PROCESS_KIND = {
  capture: "captureSession",
  develop: "developSession",
  digitize: "digitizeSession",
  digital: "digitalSession",
  print: "printSession",
  edit: "editSession",
};

export const STAGE_VARIANTS = {
  capture: "app.graycard.workflow#captureStage",
  develop: "app.graycard.workflow#developStage",
  digitize: "app.graycard.workflow#digitizeStage",
  digital: "app.graycard.workflow#digitalStage",
  print: "app.graycard.workflow#printStage",
  edit: "app.graycard.workflow#editStage",
  output: "app.graycard.workflow#outputStage",
  other: "app.graycard.workflow#otherStage",
};

export const STAGE_LABELS = {
  capture: "Capture",
  develop: "Develop",
  digitize: "Digitize",
  digital: "Digital process",
  print: "Print",
  edit: "Edit",
  output: "Output",
  other: "Other",
};

export const MEDIUMS = [
  "digital", "film", "instant", "alt-process", "scan-of-negative", "scan-of-print", "other",
];

const DEFAULT_IO = {
  capture: { input: { kind: "scene" }, output: { kind: "film-roll-latent" } },
  develop: { input: { kind: "film-roll-latent" }, output: { kind: "film-negative" } },
  digitize: { input: { kind: "film-negative" }, output: { kind: "digital-raster" } },
  digital: { input: { kind: "digital-raw" }, output: { kind: "digital-raster" } },
  print: { input: { kind: "film-negative" }, output: { kind: "physical-print" } },
  edit: { input: { kind: "digital-raster" }, output: { kind: "digital-raster" } },
  output: { input: { kind: "digital-raster" } },
  other: { input: { kind: "other" }, output: { kind: "other" } },
};

export function defaultStagePayload(kind, photoUri) {
  const base = DEFAULT_IO[kind] || {};
  const payload = {
    $type: STAGE_VARIANTS[kind],
    input: base.input || { kind: "scene" },
    ...base.output ? { output: base.output } : {},
  };
  if (kind === "output" && photoUri) {
    payload.target = { service: "social.grain", ref: photoUri };
  }
  if (kind === "other") payload.kind = "custom";
  return payload;
}

export async function createProcessSession(agent, did, processKind, fields = {}) {
  const collection = NS.process[processKind];
  if (!collection) throw new Error(`Unknown process: ${processKind}`);
  return saveRecord(agent, did, collection, {
    createdAt: new Date().toISOString(),
    ...fields,
  }, null);
}

export async function saveWorkflowRun(agent, did, { photo, medium, stages, branches, label, existing }) {
  const value = {
    photo,
    medium: medium || "digital",
    stages,
    ...(branches?.length ? { branches } : {}),
    label,
    createdAt: existing?.value?.createdAt || new Date().toISOString(),
  };
  return saveRecord(agent, did, NS.workflow.run, value, existing);
}

export async function saveWorkflowStage(agent, did, payload, existing) {
  return saveRecord(agent, did, NS.workflow.stage, payload, existing);
}

export async function linkPhotoWorkflow(agent, did, photoUri, runUri, existing) {
  return saveRecord(agent, did, NS.photo.workflow, {
    photo: photoUri,
    run: runUri,
    createdAt: existing?.value?.createdAt || new Date().toISOString(),
  }, existing);
}

export function describeStage(stageRec) {
  const v = stageRec.value;
  const t = v.$type?.split("#")[1]?.replace("Stage", "") || "?";
  return STAGE_LABELS[t] || t;
}

export function getRunForPhoto(store, photoUri) {
  const link = store.photoWorkflowByPhoto.get(photoUri);
  if (!link) return null;
  const run = store.workflowRuns.find((r) => r.uri === link.value.run);
  if (!run) return { link, run: null, stages: [] };
  const stages = (run.value.stages || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((sl) => store.workflowStages.find((s) => s.uri === sl.stage))
    .filter(Boolean);
  return { link, run, stages };
}

/** Build steps array from a saved template record. */
export function stepsFromTemplate(template) {
  const v = template.value;
  const kinds = v.stageKinds || [];
  const defaults = v.stageDefaults || [];
  return kinds.map((kind) => {
    const def = defaults.find((d) => d.kind === kind);
    return {
      kind,
      processFields: def?.fields ? { ...def.fields } : {},
      stageFields: {},
      configured: Boolean(def?.fields && Object.keys(def.fields).length),
    };
  });
}

/** Merge template-level default instance URIs into step process fields. */
export function applyTemplateDefaults(steps, template) {
  const v = template.value;
  return steps.map((step) => {
    const pf = { ...step.processFields };
    if (step.kind === "develop") {
      if (!pf.developer && !pf.chemistry && v.defaultDeveloper) {
        pf.developer = v.defaultDeveloper;
      }
    }
    if (step.kind === "digitize" && !pf.scanner && v.defaultScanner) {
      pf.scanner = v.defaultScanner;
    }
    if (step.kind === "capture") {
      if (!pf.camera && v.defaultCamera) pf.camera = v.defaultCamera;
      if (!pf.lens && v.defaultLens) pf.lens = v.defaultLens;
      if (!pf.filmRoll && v.defaultFilmRoll) pf.filmRoll = v.defaultFilmRoll;
    }
    return { ...step, processFields: pf };
  });
}

export function templateFromSteps(name, medium, steps, extra = {}) {
  return {
    name,
    medium,
    stageKinds: steps.map((s) => s.kind),
    stageDefaults: steps
      .filter((s) => s.processFields && Object.keys(s.processFields).length)
      .map((s) => ({ kind: s.kind, fields: s.processFields })),
    defaultCamera: extra.defaultCamera,
    defaultLens: extra.defaultLens,
    defaultFilmRoll: extra.defaultFilmRoll,
    defaultDeveloper: extra.defaultDeveloper,
    defaultScanner: extra.defaultScanner,
    defaultScanProfile: extra.defaultScanProfile,
    defaultLab: extra.defaultLab,
    notes: extra.notes,
    createdAt: new Date().toISOString(),
  };
}

export async function saveTemplate(agent, did, payload, existing) {
  return saveWorkflowTemplate(agent, did, payload, existing);
}

function defaultProcessFields(kind, medium) {
  switch (kind) {
    case "develop":
      return { process: "bw" };
    case "digitize":
      return { method: medium === "digital" ? "direct-digital" : "dedicated-film-scanner", createdAt: new Date().toISOString() };
    case "edit":
      return { software: "Unknown", createdAt: new Date().toISOString() };
    case "digital":
      return { createdAt: new Date().toISOString() };
    case "print":
      return { createdAt: new Date().toISOString() };
    case "capture":
      return { createdAt: new Date().toISOString() };
    default:
      return { createdAt: new Date().toISOString() };
  }
}

async function buildStagePayload(agent, did, step, photoUri, store, galleryUri, sharedSessions, medium) {
  const payload = { ...defaultStagePayload(step.kind, photoUri), ...step.stageFields };
  const processKind = STAGE_PROCESS_KIND[step.kind];

  if (processKind) {
    let sessionUri = sharedSessions?.get(step.kind);
    if (!sessionUri) {
      const fields = (step.processFields && Object.keys(step.processFields).length)
        ? step.processFields
        : defaultProcessFields(step.kind, medium);
      if (!fields.createdAt) fields.createdAt = new Date().toISOString();
      sessionUri = await createProcessSession(agent, did, processKind, fields);
      sharedSessions?.set(step.kind, sessionUri);
    }
    payload.session = sessionUri;
  }

  if (step.kind === "capture") {
    const capture = store.photoCaptureByPhoto.get(photoUri);
    const defaults = store.galleryDefaultsByGallery.get(galleryUri);
    const refs = resolvePhotoCapture(capture, defaults);
    if (refs.camera) payload.camera = refs.camera;
    if (refs.lens) payload.lens = refs.lens;
    if (refs.filmRoll) payload.filmRoll = refs.filmRoll;
    if (refs.shoot && !payload.shoot) payload.shoot = refs.shoot;
  }

  return payload;
}

export async function buildWorkflowForPhoto(agent, did, photoUri, medium, steps, store, galleryUri, sharedSessions) {
  const stageLinks = [];
  const stageInfo = [];
  for (let i = 0; i < steps.length; i++) {
    const payload = await buildStagePayload(agent, did, steps[i], photoUri, store, galleryUri, sharedSessions, medium);
    const stageUri = await saveWorkflowStage(agent, did, payload, null);
    stageLinks.push({ stage: stageUri, position: i });
    stageInfo.push({ uri: stageUri, kind: steps[i].kind });
  }

  // multi-export: when a workflow has more than one output, the extra outputs
  // are recorded as branches forking from the last processing stage.
  let branches;
  const outputs = stageInfo.filter((s) => s.kind === "output");
  const nonOutputs = stageInfo.filter((s) => s.kind !== "output");
  const fork = nonOutputs[nonOutputs.length - 1];
  if (outputs.length > 1 && fork) {
    branches = outputs.slice(1).map((o, i) => ({ fromStage: fork.uri, toStage: o.uri, label: `export ${i + 2}` }));
  }

  const runUri = await saveWorkflowRun(agent, did, {
    photo: photoUri,
    medium,
    stages: stageLinks,
    branches,
    label: null,
    existing: null,
  });
  return runUri;
}

export async function applyWorkflowToGallery(agent, did, store, galleryUri, photos, medium, steps) {
  if (!steps.length) throw new Error("Add workflow steps first");
  const sharedSessions = new Map();
  for (const p of photos) {
    const photoUri = p.photo?.uri || p.uri;
    if (!photoUri) continue;
    const existingLink = store.photoWorkflowByPhoto.get(photoUri);
    const runUri = await buildWorkflowForPhoto(
      agent, did, photoUri, medium, steps, store, galleryUri, sharedSessions,
    );
    await linkPhotoWorkflow(agent, did, photoUri, runUri, existingLink || null);
  }
  return sharedSessions.size;
}

export async function buildWorkflowFromSteps(agent, did, photoUri, medium, stepConfigs, store, galleryUri) {
  const sharedSessions = new Map();
  return buildWorkflowForPhoto(agent, did, photoUri, medium, stepConfigs, store, galleryUri, sharedSessions);
}

export { parseAtUri };
