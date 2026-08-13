// Persistence and runtime helpers for app.graycard.workflow.* records.

import {
  assertWorkflowTopology,
  normalizeWorkflowTemplate,
  plannedStagesFromTemplate,
  templateFromSteps,
} from "@hypo/domain";
import { NS, saveRecord, saveWorkflowTemplate } from "./graycard.js";
import { parseAtUri } from "./grain.js";

export {
  MEDIUMS,
  STAGE_LABELS,
  STAGE_PROCESS_KIND,
  STAGE_VARIANTS,
  applyTemplateDefaults,
  defaultStagePayload,
  describeStage,
  getRunForPhoto,
  normalizeWorkflowTemplate,
  plannedStagesFromTemplate,
  stepsFromTemplate,
  templateFromSteps,
} from "@hypo/domain";

const SUCCESS_STATES = new Set(["completed", "skipped"]);
const STOPPED_STATES = new Set(["blocked", "failed", "cancelled"]);

function recordValue(record) {
  return record?.value || record || {};
}

function stageKind(stage) {
  const value = recordValue(stage);
  const variant = String(value.$type || "")
    .split("#")[1]
    ?.replace(/Stage$/, "");
  return variant === "other" ? String(value.kind || "other") : variant || String(value.kind || "other");
}

function artifactRef(value, fallbackKind = "other") {
  if (typeof value === "string") return { kind: fallbackKind, ref: value };
  if (!value || typeof value !== "object") return { kind: fallbackKind };
  return { ...value, kind: value.kind || fallbackKind };
}

function templateRecord(template) {
  return template?.value ? template : { value: template || {} };
}

function allowedContextDefaults(kind, defaults = {}) {
  const shared = ["method", "params"];
  const byKind = {
    capture: ["camera", "lens", "filmRoll"],
    develop: ["filmRoll", "chemistry", "lab", "recipe"],
    digitize: ["filmRoll", "scanner", "scanProfile", "lab", "camera"],
    digital: ["recipe"],
    edit: ["recipe"],
    print: ["printer", "enlarger", "enlargingLens", "paper", "lightSource", "filters", "recipe"],
  };
  const keys = new Set([...(byKind[kind] || []), ...shared]);
  return Object.fromEntries(
    Object.entries(defaults).filter(([key, value]) => keys.has(key) && value != null && value !== ""),
  );
}

function applyRuntimeContext(value, kind, defaults = {}) {
  const next = {
    ...value,
    processDefaults: {
      ...(value.processDefaults || {}),
      ...allowedContextDefaults(kind, defaults),
    },
  };
  if (!Object.keys(next.processDefaults).length) delete next.processDefaults;
  if (kind === "capture") {
    for (const key of ["camera", "lens", "filmRoll", "shoot"]) if (defaults[key]) next[key] = defaults[key];
  }
  return next;
}

function occurrenceCount(step, requested) {
  const minimum = step.optional ? 0 : (step.cardinality?.min ?? 1);
  const maximum = step.cardinality?.max;
  const count = requested === undefined ? minimum : Number(requested);
  if (!Number.isInteger(count) || count < minimum || (maximum !== undefined && count > maximum)) {
    const range = maximum === undefined ? `${minimum} or more` : `${minimum}–${maximum}`;
    throw new Error(`${step.label || step.kind || step.id} must occur ${range} times`);
  }
  return count;
}

function bindRootSubjects(value, step, connections, subjects) {
  const incomingPorts = new Set(
    connections.filter((connection) => connection.toStep === step.id).map((connection) => connection.toPort),
  );
  const inputBindings = (value.inputBindings || []).map((binding) => {
    if (incomingPorts.has(binding.port)) return binding;
    const accepted = step.inputs?.find((port) => port.id === binding.port)?.artifactKinds || [binding.artifact?.kind];
    const subject = subjects.find((candidate) => accepted.includes(candidate.kind));
    return subject ? { ...binding, artifact: { ...subject } } : binding;
  });
  if (!inputBindings.length) return value;
  return {
    ...value,
    inputBindings,
    input: inputBindings[0].artifact,
  };
}

function connectionPairs(connection, stageEntries) {
  const from = stageEntries.filter((entry) => entry.templateStepId === connection.fromStep);
  const to = stageEntries.filter((entry) => entry.templateStepId === connection.toStep);
  if (!from.length || !to.length) return [];
  if (from.length === to.length) return from.map((source, index) => [source, to[index]]);
  if (from.length === 1) return to.map((target) => [from[0], target]);
  if (to.length === 1) return from.map((source) => [source, to[0]]);
  const length = Math.max(from.length, to.length);
  return Array.from({ length }, (_, index) => [from[index % from.length], to[index % to.length]]);
}

function runtimeBranches(connections, stageEntries) {
  return connections.flatMap((connection) =>
    connectionPairs(connection, stageEntries).map(([from, to], index) => ({
      fromStage: from.uri,
      toStage: to.uri,
      label: connection.label || connection.id || `flow ${index + 1}`,
      ...(connection.id ? { templateConnectionId: connection.id } : {}),
      ...(connection.fromPort ? { fromPort: connection.fromPort } : {}),
      ...(connection.toPort ? { toPort: connection.toPort } : {}),
      ...(connection.artifactKind ? { artifactKind: connection.artifactKind } : {}),
    })),
  );
}

function stageRecordsForRun(store, run) {
  const byUri = new Map((store?.workflowStages || []).map((stage) => [stage.uri, stage]));
  return (recordValue(run).stages || [])
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((link) => byUri.get(link.stage))
    .filter(Boolean);
}

function predecessorMap(run, stages) {
  const value = recordValue(run);
  const indexByUri = new Map(stages.map((stage, index) => [stage.uri, index]));
  const incoming = new Map(stages.map((stage) => [stage.uri, []]));
  const branches = Array.isArray(value.branches) ? value.branches : [];
  const completeGraph =
    value.topology === "graph" ||
    branches.some((branch) => branch.templateConnectionId || branch.fromPort || branch.toPort);
  for (const branch of branches) {
    if (incoming.has(branch.toStage) && indexByUri.has(branch.fromStage))
      incoming.get(branch.toStage).push(branch.fromStage);
  }
  if (!completeGraph) {
    for (let index = 1; index < stages.length; index += 1) {
      const target = stages[index].uri;
      if (!incoming.get(target).length) incoming.get(target).push(stages[index - 1].uri);
    }
  }
  return incoming;
}

function actionableStages(run, stages) {
  const byUri = new Map(stages.map((stage) => [stage.uri, stage]));
  const incoming = predecessorMap(run, stages);
  return stages.filter((stage) => {
    const status = String(stage.value.status || "planned");
    if (SUCCESS_STATES.has(status) || STOPPED_STATES.has(status)) return false;
    return (incoming.get(stage.uri) || []).every((uri) => SUCCESS_STATES.has(String(byUri.get(uri)?.value?.status)));
  });
}

function runMatchesSubject(run, subject) {
  const value = recordValue(run);
  const ref = typeof subject === "string" ? subject : subject?.ref;
  if (!ref) return false;
  return value.photo === ref || [...(value.subjects || []), ...(value.products || [])].some((item) => item.ref === ref);
}

export async function createProcessSession(agent, did, processKind, fields = {}) {
  const collection = NS.process[processKind];
  if (!collection) throw new Error(`Unknown process: ${processKind}`);
  return saveRecord(agent, did, collection, { createdAt: new Date().toISOString(), ...fields }, null);
}

export async function saveWorkflowRun(agent, did, input) {
  const existing = input.existing || null;
  const value = {
    ...(existing?.value || {}),
    ...(input.value || {}),
    ...(input.photo ? { photo: input.photo } : {}),
    medium: input.medium || input.value?.medium || existing?.value?.medium || "digital",
    stages: input.stages || input.value?.stages || existing?.value?.stages || [],
    ...(input.subjects?.length ? { subjects: input.subjects } : {}),
    ...(input.products?.length ? { products: input.products } : {}),
    ...(input.branches?.length ? { branches: input.branches } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.template ? { template: input.template } : {}),
    ...(input.templateRevision ? { templateRevision: input.templateRevision } : {}),
    ...(input.templateName ? { templateName: input.templateName } : {}),
    ...(input.topology ? { topology: input.topology } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.plannedAt ? { plannedAt: input.plannedAt } : {}),
    createdAt: existing?.value?.createdAt || input.value?.createdAt || new Date().toISOString(),
  };
  return saveRecord(agent, did, NS.workflow.run, value, existing);
}

export function saveWorkflowStage(agent, did, payload, existing) {
  return saveRecord(agent, did, NS.workflow.stage, payload, existing || null);
}

export function linkPhotoWorkflow(agent, did, photoUri, runUri, existing) {
  return saveRecord(
    agent,
    did,
    NS.photo.workflow,
    { photo: photoUri, run: runUri, createdAt: existing?.value?.createdAt || new Date().toISOString() },
    existing || null,
  );
}

export function saveTemplate(agent, did, payload, existing) {
  return saveWorkflowTemplate(agent, did, payload, existing);
}

export async function instantiateWorkflowTemplate(
  agent,
  did,
  {
    template,
    templateUri,
    templateCid,
    subjects = [],
    products = [],
    photo,
    linkPhoto = true,
    store,
    plannedAt = new Date().toISOString(),
    occurrences = {},
    processDefaults = {},
    stepDefaults = {},
  },
) {
  const record = templateRecord(template);
  assertWorkflowTopology(record);
  const normalized = normalizeWorkflowTemplate(record);
  const plannedByStep = new Map(
    plannedStagesFromTemplate(record, { plannedAt, photoUri: photo || null }).map((stage) => [
      stage.templateStepId,
      stage,
    ]),
  );
  const normalizedSubjects = subjects.map((subject) => artifactRef(subject));
  const normalizedProducts = products.map((product) => artifactRef(product));
  const expanded = [];
  for (const step of normalized.steps) {
    const count = occurrenceCount(step, occurrences[step.id]);
    const base = plannedByStep.get(step.id);
    if (!base) continue;
    for (let occurrence = 1; occurrence <= count; occurrence += 1) {
      const overrides = stepDefaults[step.id] || {};
      let value = {
        ...base.value,
        ...(overrides.stageDefaults || {}),
        templateStepId: step.id,
        occurrence,
        plannedAt,
        status: "planned",
        processDefaults: {
          ...(base.value.processDefaults || base.processDefaults || {}),
          ...(overrides.processDefaults || {}),
        },
      };
      value = applyRuntimeContext(value, step.kind, processDefaults);
      value = bindRootSubjects(value, step, normalized.connections, normalizedSubjects);
      expanded.push({ step, templateStepId: step.id, occurrence, value });
    }
  }
  if (!expanded.length) throw new Error("This workflow has no selected steps");

  const incomingStepIds = new Set(normalized.connections.map((connection) => connection.toStep));
  for (const entry of expanded) if (!incomingStepIds.has(entry.templateStepId)) entry.value.status = "ready";

  const stageEntries = [];
  for (let position = 0; position < expanded.length; position += 1) {
    const entry = expanded[position];
    const uri = await saveWorkflowStage(agent, did, entry.value, null);
    stageEntries.push({ ...entry, uri, position });
  }
  const branches = runtimeBranches(normalized.connections, stageEntries);
  const stageLinks = stageEntries.map((entry) => ({
    stage: entry.uri,
    position: entry.position,
    templateStepId: entry.templateStepId,
    occurrence: entry.occurrence,
  }));
  const resolvedTemplateUri = templateUri || template?.uri;
  const resolvedTemplateCid = templateCid || template?.cid;
  const runUri = await saveWorkflowRun(agent, did, {
    photo,
    medium: record.value.medium || "digital",
    subjects: normalizedSubjects,
    products: normalizedProducts,
    stages: stageLinks,
    branches,
    template: resolvedTemplateUri,
    templateRevision: resolvedTemplateCid,
    templateName: record.value.name,
    topology: "graph",
    status: "ready",
    plannedAt,
    existing: null,
  });
  if (photo && linkPhoto) {
    const existingLink = store?.photoWorkflowByPhoto?.get(photo);
    await linkPhotoWorkflow(agent, did, photo, runUri, existingLink || null);
  }
  return { runUri, stageUris: stageEntries.map((entry) => entry.uri) };
}

export function findNextActionableStage(store, subjectOrRun, { kind } = {}) {
  let run = null;
  if (subjectOrRun?.value?.stages) run = subjectOrRun;
  else if (typeof subjectOrRun === "string") {
    run = (store?.workflowRuns || []).find((candidate) => candidate.uri === subjectOrRun) || null;
  }
  if (!run) {
    const candidates = (store?.workflowRuns || [])
      .filter((candidate) => runMatchesSubject(candidate, subjectOrRun))
      .sort((left, right) =>
        String(right.value.updatedAt || right.value.createdAt || "").localeCompare(
          String(left.value.updatedAt || left.value.createdAt || ""),
        ),
      );
    run =
      candidates.find((candidate) => !["completed", "cancelled", "failed"].includes(candidate.value.status)) ||
      candidates[0] ||
      null;
  }
  if (!run) return null;
  const stages = stageRecordsForRun(store, run);
  const stage = actionableStages(run, stages).find((candidate) => !kind || stageKind(candidate) === kind);
  return stage ? { run, stage } : null;
}

export function getActionableWorkflowStages(store, runOrUri) {
  const run =
    typeof runOrUri === "string"
      ? (store?.workflowRuns || []).find((candidate) => candidate.uri === runOrUri)
      : runOrUri;
  return run ? actionableStages(run, stageRecordsForRun(store, run)) : [];
}

export async function completeWorkflowStageAndAdvance(
  agent,
  did,
  { store, run, stage, sessionUri, completedAt = new Date().toISOString(), products = [], status = "completed" },
) {
  if (!SUCCESS_STATES.has(status)) throw new Error(`Cannot finish a workflow stage as ${status}`);
  if (status === "skipped" && !stage.value.optional) throw new Error("Only optional workflow steps can be skipped");
  const productRefs = products.map((product) => artifactRef(product));
  const outputBindings = productRefs.length
    ? productRefs.map((artifact, index) => ({
        port: stage.value.outputBindings?.[index]?.port || `output-${index + 1}`,
        artifact,
      }))
    : stage.value.outputBindings;
  const completedValue = {
    ...stage.value,
    ...(sessionUri ? { session: sessionUri } : {}),
    ...(productRefs.length ? { output: productRefs[0], outputs: productRefs, outputBindings } : {}),
    status,
    ...(status === "skipped" ? { skippedAt: completedAt } : { completedAt }),
    updatedAt: completedAt,
  };
  await saveWorkflowStage(agent, did, completedValue, stage);

  const currentStages = stageRecordsForRun(store, run).map((candidate) =>
    candidate.uri === stage.uri ? { ...candidate, value: completedValue } : candidate,
  );
  const ready = actionableStages(run, currentStages);
  for (const candidate of ready) {
    if (candidate.value.status === "ready" || candidate.uri === stage.uri) continue;
    const value = { ...candidate.value, status: "ready", updatedAt: completedAt };
    await saveWorkflowStage(agent, did, value, candidate);
    candidate.value = value;
  }
  const complete = currentStages.every((candidate) => SUCCESS_STATES.has(String(candidate.value.status)));
  const runValue = {
    ...run.value,
    ...(productRefs.length ? { products: [...(run.value.products || []), ...productRefs] } : {}),
    status: complete ? "completed" : "in-progress",
    startedAt: run.value.startedAt || completedAt,
    ...(complete ? { completedAt } : {}),
    updatedAt: completedAt,
  };
  await saveWorkflowRun(agent, did, { value: runValue, existing: run });
  return { runUri: run.uri, stageUri: stage.uri, runStatus: runValue.status };
}

export function skipWorkflowStageAndAdvance(agent, did, input) {
  return completeWorkflowStageAndAdvance(agent, did, { ...input, status: "skipped", products: [] });
}

export async function cancelWorkflowRun(agent, did, { store, run, cancelledAt = new Date().toISOString() }) {
  for (const stage of stageRecordsForRun(store, run)) {
    if (SUCCESS_STATES.has(String(stage.value.status)) || stage.value.status === "cancelled") continue;
    await saveWorkflowStage(
      agent,
      did,
      { ...stage.value, status: "cancelled", cancelledAt, updatedAt: cancelledAt },
      stage,
    );
  }
  await saveWorkflowRun(agent, did, {
    value: { ...run.value, status: "cancelled", cancelledAt, updatedAt: cancelledAt },
    existing: run,
  });
  return run.uri;
}

function editableStepTemplate(steps, medium) {
  const uniqueById = new Map();
  const occurrences = {};
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const id = step.id || `${step.kind}-${index + 1}`;
    occurrences[id] = (occurrences[id] || 0) + 1;
    if (!uniqueById.has(id)) uniqueById.set(id, { ...step, id });
  }
  const unique = [...uniqueById.values()].map((step) => ({
    ...step,
    cardinality: { min: 1, max: occurrences[step.id] },
  }));
  const payload = templateFromSteps("Ad hoc workflow", medium, unique, {
    connections: steps.find((step) => step.templateConnections)?.templateConnections,
  });
  return { payload, occurrences };
}

export async function buildWorkflowForPhoto(agent, did, photoUri, medium, steps, store) {
  const { payload, occurrences } = editableStepTemplate(steps, medium);
  const first = steps.find((step) => step.templateUri);
  const result = await instantiateWorkflowTemplate(agent, did, {
    template: { value: { ...payload, name: first?.templateName || payload.name }, uri: first?.templateUri },
    templateUri: first?.templateUri,
    subjects: [],
    products: [{ kind: "digital-raster", ref: photoUri }],
    photo: photoUri,
    linkPhoto: false,
    store,
    occurrences,
  });
  return result.runUri;
}

export async function applyWorkflowToGallery(agent, did, store, galleryUri, photos, medium, steps) {
  if (!steps.length) throw new Error("Add workflow steps first");
  for (const photo of photos) {
    const photoUri = photo.photo?.uri || photo.uri;
    if (photoUri) await buildWorkflowForPhoto(agent, did, photoUri, medium, steps, store, galleryUri);
  }
  return 0;
}

export function buildWorkflowFromSteps(agent, did, photoUri, medium, steps, store, galleryUri) {
  return buildWorkflowForPhoto(agent, did, photoUri, medium, steps, store, galleryUri);
}

export { parseAtUri };
