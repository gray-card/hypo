import { KNOWN_VALUES } from "@hypo/lexicon";

export type WorkflowStageKind = "capture" | "develop" | "digitize" | "digital" | "print" | "edit" | "output" | "other";
export type WorkflowRunStatus = "planned" | "ready" | "in-progress" | "blocked" | "completed" | "failed" | "cancelled";
export type WorkflowStageStatus = WorkflowRunStatus | "skipped";
export type WorkflowSessionScope = "per-stage" | "per-subject" | "per-batch" | "per-run" | "shared" | "none";

export const STAGE_PROCESS_KIND: Partial<Record<WorkflowStageKind, string>> = {
  develop: "developSession",
  digitize: "digitizeSession",
  digital: "renderSession",
  print: "printSession",
  edit: "editSession",
};

export const STAGE_VARIANTS: Record<WorkflowStageKind, string> = {
  capture: KNOWN_VALUES["app.graycard.workflow.stage/defs/captureStage/properties/$type"][0],
  develop: KNOWN_VALUES["app.graycard.workflow.stage/defs/developStage/properties/$type"][0],
  digitize: KNOWN_VALUES["app.graycard.workflow.stage/defs/digitizeStage/properties/$type"][0],
  digital: KNOWN_VALUES["app.graycard.workflow.stage/defs/digitalStage/properties/$type"][0],
  print: KNOWN_VALUES["app.graycard.workflow.stage/defs/printStage/properties/$type"][0],
  edit: KNOWN_VALUES["app.graycard.workflow.stage/defs/editStage/properties/$type"][0],
  output: KNOWN_VALUES["app.graycard.workflow.stage/defs/outputStage/properties/$type"][0],
  other: KNOWN_VALUES["app.graycard.workflow.stage/defs/otherStage/properties/$type"][0],
};

export const STAGE_LABELS: Record<string, string> = {
  capture: "Capture",
  develop: "Develop",
  digitize: "Digitize",
  digital: "Render/export",
  print: "Print",
  edit: "Edit",
  output: "Output",
  other: "Other",
};

export const MEDIUMS = ["digital", "film", "instant", "alt-process", "scan-of-negative", "scan-of-print", "other"];

export interface WorkflowEndpoint {
  kind: string;
}

export interface WorkflowStagePayload {
  $type?: string;
  input: WorkflowEndpoint;
  output?: WorkflowEndpoint;
  target?: { service: string; ref: string };
  kind?: string;
  templateStepId?: string;
  occurrence?: number;
  optional?: boolean;
  status?: WorkflowStageStatus;
  processDefaults?: WorkflowProcessDefaults;
  inputs?: readonly WorkflowArtifactRef[];
  outputs?: readonly WorkflowArtifactRef[];
  inputBindings?: readonly WorkflowArtifactBinding[];
  outputBindings?: readonly WorkflowArtifactBinding[];
  plannedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  skippedAt?: string;
  cancelledAt?: string;
  [key: string]: unknown;
}

const DEFAULT_IO: Record<string, { input: WorkflowEndpoint; output?: WorkflowEndpoint }> = {
  capture: { input: { kind: "scene" }, output: { kind: "film-roll-latent" } },
  develop: { input: { kind: "film-roll-latent" }, output: { kind: "film-negative" } },
  digitize: { input: { kind: "film-negative" }, output: { kind: "digital-raster" } },
  digital: { input: { kind: "digital-raw" }, output: { kind: "digital-raster" } },
  print: { input: { kind: "film-negative" }, output: { kind: "physical-print" } },
  edit: { input: { kind: "digital-raster" }, output: { kind: "digital-raster" } },
  output: { input: { kind: "digital-raster" } },
  other: { input: { kind: "other" }, output: { kind: "other" } },
};

export function defaultStagePayload(kind: string, photoUri?: string | null): WorkflowStagePayload {
  const stageKind = Object.prototype.hasOwnProperty.call(STAGE_VARIANTS, kind) ? (kind as WorkflowStageKind) : "other";
  const base = DEFAULT_IO[stageKind];
  const payload: WorkflowStagePayload = {
    $type: STAGE_VARIANTS[stageKind],
    input: base.input,
    ...(base.output ? { output: base.output } : {}),
  };
  if (stageKind === "output" && photoUri) payload.target = { service: "social.grain", ref: photoUri };
  if (stageKind === "other") payload.kind = kind === "other" ? "custom" : kind;
  return payload;
}

export interface WorkflowRecord<Value> {
  uri: string;
  value: Value;
  [key: string]: unknown;
}

export interface StageRecordValue {
  $type?: string;
  templateStepId?: string;
  occurrence?: number;
  optional?: boolean;
  status?: WorkflowStageStatus;
  processDefaults?: WorkflowProcessDefaults;
  input?: WorkflowArtifactRef;
  inputs?: readonly WorkflowArtifactRef[];
  output?: WorkflowArtifactRef;
  outputs?: readonly WorkflowArtifactRef[];
  inputBindings?: readonly WorkflowArtifactBinding[];
  outputBindings?: readonly WorkflowArtifactBinding[];
  plannedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  skippedAt?: string;
  cancelledAt?: string;
  [key: string]: unknown;
}

export type WorkflowStageRecord = WorkflowRecord<StageRecordValue>;

export function describeStage(stageRecord: { value: StageRecordValue }): string {
  const kind = stageRecord.value.$type?.split("#")[1]?.replace("Stage", "") || "?";
  return STAGE_LABELS[kind] || kind;
}

export interface WorkflowLinkValue {
  run: string;
  [key: string]: unknown;
}

export interface WorkflowStageLink {
  stage: string;
  position: number;
  templateStepId?: string;
  occurrence?: number;
}

export interface WorkflowBranchLink {
  fromStage: string;
  toStage: string;
  label: string;
  templateConnectionId?: string;
  fromPort?: string;
  toPort?: string;
  artifactKind?: string;
}

export interface WorkflowRunValue {
  photo?: string;
  subjects?: readonly WorkflowArtifactRef[];
  products?: readonly WorkflowArtifactRef[];
  medium?: string;
  template?: string;
  templateRevision?: string;
  templateName?: string;
  topology?: "graph" | "legacy-linear";
  status?: WorkflowRunStatus;
  stages?: readonly WorkflowStageLink[];
  branches?: readonly WorkflowBranchLink[];
  plannedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  [key: string]: unknown;
}

export interface WorkflowLookupStore {
  photoWorkflowByPhoto: ReadonlyMap<string, WorkflowRecord<WorkflowLinkValue>>;
  workflowRuns: readonly WorkflowRecord<WorkflowRunValue>[];
  workflowStages: readonly WorkflowStageRecord[];
}

export interface ResolvedWorkflowRun {
  link: WorkflowRecord<WorkflowLinkValue>;
  run: WorkflowRecord<WorkflowRunValue> | null;
  stages: WorkflowStageRecord[];
}

export function getRunForPhoto(store: WorkflowLookupStore, photoUri: string): ResolvedWorkflowRun | null {
  const link = store.photoWorkflowByPhoto.get(photoUri);
  if (!link) return null;
  const run = store.workflowRuns.find((record) => record.uri === link.value.run);
  if (!run) return { link, run: null, stages: [] };
  const stages = (run.value.stages || [])
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((stageLink) => store.workflowStages.find((stage) => stage.uri === stageLink.stage))
    .filter((stage): stage is WorkflowStageRecord => Boolean(stage));
  return { link, run, stages };
}

export interface WorkflowCardinality {
  min?: number;
  max?: number;
}

export interface WorkflowPort {
  id: string;
  label?: string;
  artifactKinds: readonly string[];
  cardinality?: WorkflowCardinality;
  external?: boolean;
  description?: string;
}

export interface WorkflowProcessDefaults {
  camera?: string;
  lens?: string;
  filmRoll?: string;
  chemistry?: string;
  scanner?: string;
  scanProfile?: string;
  lab?: string;
  printer?: string;
  enlarger?: string;
  enlargingLens?: string;
  paper?: string;
  lightSource?: string;
  filters?: readonly string[];
  recipe?: string;
  method?: string;
  params?: unknown;
  [key: string]: unknown;
}

export interface WorkflowArtifactRef {
  kind: string;
  ref?: string;
  label?: string;
  [key: string]: unknown;
}

export interface WorkflowArtifactBinding {
  port: string;
  artifact: WorkflowArtifactRef;
}

export interface WorkflowStageDefaults {
  input?: WorkflowArtifactRef;
  inputs?: readonly WorkflowArtifactRef[];
  output?: WorkflowArtifactRef;
  outputs?: readonly WorkflowArtifactRef[];
  inputBindings?: readonly WorkflowArtifactBinding[];
  outputBindings?: readonly WorkflowArtifactBinding[];
  target?: { service: string; ref?: string; label?: string };
  recipe?: string;
  notes?: string;
  params?: unknown;
  [key: string]: unknown;
}

export interface WorkflowTemplateStep {
  id: string;
  kind: string;
  label?: string;
  description?: string;
  optional?: boolean;
  cardinality?: WorkflowCardinality;
  sessionScope?: WorkflowSessionScope | string;
  inputs?: readonly WorkflowPort[];
  outputs?: readonly WorkflowPort[];
  processDefaults?: WorkflowProcessDefaults;
  stageDefaults?: WorkflowStageDefaults;
  /** Compatibility aliases accepted by the in-progress workflow editor. */
  processFields?: WorkflowProcessDefaults;
  fields?: WorkflowProcessDefaults;
  defaults?: WorkflowProcessDefaults;
  stageFields?: WorkflowStageDefaults;
}

export interface WorkflowTemplateConnection {
  id: string;
  fromStep: string;
  fromPort: string;
  toStep: string;
  toPort: string;
  artifactKind?: string;
  label?: string;
}

export interface WorkflowStageDefault {
  kind: string;
  fields?: Record<string, unknown>;
}

export interface WorkflowTemplateValue {
  name?: string;
  medium?: string;
  steps?: readonly WorkflowTemplateStep[];
  connections?: readonly WorkflowTemplateConnection[];
  stageKinds?: readonly string[];
  stageDefaults?: readonly WorkflowStageDefault[];
  defaultCamera?: unknown;
  defaultLens?: unknown;
  defaultFilmRoll?: unknown;
  defaultChemistry?: unknown;
  defaultScanner?: unknown;
  defaultScanProfile?: unknown;
  defaultLab?: unknown;
  [key: string]: unknown;
}

export interface WorkflowTemplateRecord {
  value: WorkflowTemplateValue;
}

export interface WorkflowStep {
  id?: string;
  kind: string;
  label?: string;
  description?: string;
  optional?: boolean;
  cardinality?: WorkflowCardinality;
  sessionScope?: WorkflowSessionScope | string;
  inputs?: readonly WorkflowPort[];
  outputs?: readonly WorkflowPort[];
  processFields: Record<string, unknown>;
  stageFields: Record<string, unknown>;
  configured: boolean;
}

function clonePort(port: WorkflowPort): WorkflowPort {
  return {
    ...port,
    artifactKinds: [...port.artifactKinds],
    ...(port.cardinality ? { cardinality: { ...port.cardinality } } : {}),
  };
}

function defaultPorts(kind: string, medium?: string): { inputs: WorkflowPort[]; outputs: WorkflowPort[] } {
  const io = DEFAULT_IO[kind] || DEFAULT_IO.other;
  const inputKind = io.input.kind;
  let outputKind = io.output?.kind;
  if (kind === "capture" && medium === "digital") outputKind = "digital-raw";
  if (kind === "capture" && medium === "instant") outputKind = "instant-print";
  return {
    inputs: [{ id: "input", artifactKinds: [inputKind], cardinality: { min: 1, max: 1 }, external: true }],
    outputs: outputKind
      ? [{ id: "output", artifactKinds: [outputKind], cardinality: { min: 1, max: 1 }, external: true }]
      : [],
  };
}

function stableStepIds(kinds: readonly string[]): string[] {
  const occurrences = new Map<string, number>();
  const used = new Set<string>();
  return kinds.map((kind, index) => {
    const base =
      kind
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `step-${index + 1}`;
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    let id = `${base}-${occurrence}`;
    while (used.has(id)) id = `${base}-${occurrence}-${index + 1}`;
    used.add(id);
    return id;
  });
}

function legacyDefaultsForKinds(
  kinds: readonly string[],
  defaults: readonly WorkflowStageDefault[],
): Array<WorkflowStageDefault | undefined> {
  const byKind = new Map<string, WorkflowStageDefault[]>();
  for (const entry of defaults) {
    const entries = byKind.get(entry.kind) || [];
    entries.push(entry);
    byKind.set(entry.kind, entries);
  }
  const occurrence = new Map<string, number>();
  return kinds.map((kind) => {
    const entries = byKind.get(kind) || [];
    const index = occurrence.get(kind) || 0;
    occurrence.set(kind, index + 1);
    if (entries.length === 1) return entries[0];
    return entries[index];
  });
}

/**
 * Normalize either the rich step representation or the legacy
 * stageKinds/stageDefaults representation into UI-ready steps.
 */
export function stepsFromTemplate(template: WorkflowTemplateRecord): WorkflowStep[] {
  const value = template.value;
  if (value.steps) {
    return value.steps.map((step) => {
      const ports = defaultPorts(step.kind, value.medium);
      const processFields = { ...(step.processDefaults || step.processFields || step.fields || step.defaults || {}) };
      const stageFields = { ...(step.stageDefaults || step.stageFields || {}) };
      return {
        id: step.id,
        kind: step.kind,
        label: step.label,
        description: step.description,
        optional: step.optional,
        cardinality: step.cardinality ? { ...step.cardinality } : undefined,
        sessionScope: step.sessionScope,
        inputs: (step.inputs || ports.inputs).map(clonePort),
        outputs: (step.outputs || ports.outputs).map(clonePort),
        processFields,
        stageFields,
        configured: Object.keys(processFields).length > 0 || Object.keys(stageFields).length > 0,
      };
    });
  }

  const kinds = value.stageKinds || [];
  const ids = stableStepIds(kinds);
  const defaults = legacyDefaultsForKinds(kinds, value.stageDefaults || []);
  return kinds.map((kind, index) => {
    const processFields = defaults[index]?.fields ? { ...defaults[index]!.fields } : {};
    const ports = defaultPorts(kind, value.medium);
    return {
      id: ids[index],
      kind,
      optional: false,
      cardinality: { min: 1, max: 1 },
      sessionScope: "per-stage",
      inputs: ports.inputs,
      outputs: ports.outputs,
      processFields,
      stageFields: {},
      configured: Object.keys(processFields).length > 0,
    };
  });
}

export function applyTemplateDefaults(
  steps: readonly WorkflowStep[],
  template: WorkflowTemplateRecord,
): WorkflowStep[] {
  const value = template.value;
  return steps.map((step) => {
    const processFields = { ...step.processFields };
    if (step.kind === "develop" && !processFields.chemistry && value.defaultChemistry) {
      processFields.chemistry = value.defaultChemistry;
    }
    if (step.kind === "digitize" && !processFields.scanner && value.defaultScanner) {
      processFields.scanner = value.defaultScanner;
    }
    if (step.kind === "capture") {
      if (!processFields.camera && value.defaultCamera) processFields.camera = value.defaultCamera;
      if (!processFields.lens && value.defaultLens) processFields.lens = value.defaultLens;
      if (!processFields.filmRoll && value.defaultFilmRoll) processFields.filmRoll = value.defaultFilmRoll;
    }
    return { ...step, processFields };
  });
}

function commonArtifactKind(from: WorkflowPort, to: WorkflowPort): string | undefined {
  return from.artifactKinds.find((kind) => to.artifactKinds.includes(kind));
}

function inferredConnections(steps: readonly WorkflowStep[]): WorkflowTemplateConnection[] {
  const connections: WorkflowTemplateConnection[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const from = steps[index];
    const to = steps[index + 1];
    const fromPort = from.outputs?.[0];
    const toPort = to.inputs?.[0];
    if (!from.id || !to.id || !fromPort || !toPort) continue;
    const artifactKind = commonArtifactKind(fromPort, toPort);
    if (!artifactKind) continue;
    connections.push({
      id: `flow-${index + 1}`,
      fromStep: from.id,
      fromPort: fromPort.id,
      toStep: to.id,
      toPort: toPort.id,
      artifactKind,
    });
  }
  return connections;
}

export interface NormalizedWorkflowTemplate {
  steps: WorkflowStep[];
  connections: WorkflowTemplateConnection[];
  source: "rich" | "legacy";
}

/** Convert a legacy template into the rich graph view without mutating it. */
export function normalizeWorkflowTemplate(template: WorkflowTemplateRecord): NormalizedWorkflowTemplate {
  const steps = stepsFromTemplate(template);
  const source = template.value.steps ? "rich" : "legacy";
  return {
    steps,
    connections: template.value.connections
      ? template.value.connections.map((connection) => ({ ...connection }))
      : inferredConnections(steps),
    source,
  };
}

export interface WorkflowTemplateExtra {
  connections?: readonly WorkflowTemplateConnection[];
  defaultCamera?: unknown;
  defaultLens?: unknown;
  defaultFilmRoll?: unknown;
  defaultChemistry?: unknown;
  defaultScanner?: unknown;
  defaultScanProfile?: unknown;
  defaultLab?: unknown;
  notes?: unknown;
}

export interface WorkflowTemplatePayload extends WorkflowTemplateExtra {
  name: string;
  medium: string;
  steps: WorkflowTemplateStep[];
  connections: WorkflowTemplateConnection[];
  stageKinds: string[];
  stageDefaults: WorkflowStageDefault[];
  createdAt: string;
}

/**
 * Serialize editable steps as the rich representation and a legacy mirror.
 * The mirror keeps older Hypo clients able to open templates from this release.
 */
export function templateFromSteps(
  name: string,
  medium: string,
  editableSteps: readonly WorkflowStep[],
  extra: WorkflowTemplateExtra = {},
): WorkflowTemplatePayload {
  const generatedIds = stableStepIds(editableSteps.map((step) => step.kind));
  const steps = editableSteps.map((step, index): WorkflowTemplateStep => {
    const ports = defaultPorts(step.kind, medium);
    const processDefaults = { ...step.processFields };
    const stageDefaults = { ...step.stageFields };
    return {
      id: step.id || generatedIds[index],
      kind: step.kind,
      ...(step.label ? { label: step.label } : {}),
      ...(step.description ? { description: step.description } : {}),
      ...(step.optional !== undefined ? { optional: step.optional } : {}),
      ...(step.cardinality ? { cardinality: { ...step.cardinality } } : {}),
      ...(step.sessionScope ? { sessionScope: step.sessionScope } : {}),
      inputs: (step.inputs || ports.inputs).map(clonePort),
      outputs: (step.outputs || ports.outputs).map(clonePort),
      ...(Object.keys(processDefaults).length ? { processDefaults } : {}),
      ...(Object.keys(stageDefaults).length ? { stageDefaults } : {}),
    };
  });
  const normalizedSteps = stepsFromTemplate({ value: { medium, steps } });
  const connections = extra.connections
    ? extra.connections.map((connection) => ({ ...connection }))
    : inferredConnections(normalizedSteps);
  return {
    name,
    medium,
    steps,
    connections,
    stageKinds: editableSteps.map((step) => step.kind),
    // Keep one marker per occurrence, including empty defaults, because the
    // legacy shape identifies occurrences only by stable array order.
    stageDefaults: editableSteps.map((step) => ({ kind: step.kind, fields: { ...step.processFields } })),
    defaultCamera: extra.defaultCamera,
    defaultLens: extra.defaultLens,
    defaultFilmRoll: extra.defaultFilmRoll,
    defaultChemistry: extra.defaultChemistry,
    defaultScanner: extra.defaultScanner,
    defaultScanProfile: extra.defaultScanProfile,
    defaultLab: extra.defaultLab,
    notes: extra.notes,
    createdAt: new Date().toISOString(),
  };
}

export interface PlannedWorkflowStage {
  templateStepId: string;
  occurrence: number;
  kind: string;
  processDefaults: Record<string, unknown>;
  value: WorkflowStagePayload;
}

/** Build session-less planned stage values that can be persisted before work begins. */
export function plannedStagesFromTemplate(
  template: WorkflowTemplateRecord,
  options: { plannedAt?: string; photoUri?: string | null } = {},
): PlannedWorkflowStage[] {
  const plannedAt = options.plannedAt || new Date().toISOString();
  const steps = applyTemplateDefaults(stepsFromTemplate(template), template);
  return steps.map((step, index) => {
    const templateStepId = step.id || stableStepIds(steps.map((candidate) => candidate.kind))[index];
    const stageFields = { ...step.stageFields };
    const inputBindings: WorkflowArtifactBinding[] = (step.inputs || []).flatMap((port) => {
      const kind = port.artifactKinds[0];
      return kind ? [{ port: port.id, artifact: { kind } }] : [];
    });
    const outputBindings: WorkflowArtifactBinding[] = (step.outputs || []).flatMap((port) => {
      const kind = port.artifactKinds[0];
      return kind ? [{ port: port.id, artifact: { kind } }] : [];
    });
    const inputKind = inputBindings[0]?.artifact.kind;
    const outputKind = outputBindings[0]?.artifact.kind;
    const stagePayload = { ...defaultStagePayload(step.kind, options.photoUri), ...stageFields };
    if (!stageFields.input && inputKind) stagePayload.input = { kind: inputKind };
    if (!stageFields.output && outputKind) stagePayload.output = { kind: outputKind };
    if (!stageFields.outputs && outputBindings.length) {
      stagePayload.outputs = outputBindings.map((binding) => ({ ...binding.artifact }));
    }
    if (!stageFields.inputBindings && inputBindings.length) stagePayload.inputBindings = inputBindings;
    if (!stageFields.outputBindings && outputBindings.length) stagePayload.outputBindings = outputBindings;
    if (!step.outputs?.length && !stageFields.output) delete stagePayload.output;
    return {
      templateStepId,
      occurrence: 1,
      kind: step.kind,
      processDefaults: { ...step.processFields },
      value: {
        ...stagePayload,
        templateStepId,
        occurrence: 1,
        ...(step.optional ? { optional: true } : {}),
        status: "planned",
        processDefaults: { ...step.processFields },
        plannedAt,
      },
    };
  });
}

export type WorkflowTopologyIssueCode =
  | "duplicate-step-id"
  | "duplicate-port-id"
  | "duplicate-connection-id"
  | "unknown-step"
  | "unknown-port"
  | "cycle"
  | "incompatible-artifact-kind"
  | "empty-artifact-kinds"
  | "invalid-cardinality"
  | "connection-cardinality";

export interface WorkflowTopologyIssue {
  code: WorkflowTopologyIssueCode;
  path: string;
  message: string;
}

function cardinalityIssues(
  cardinality: WorkflowCardinality | undefined,
  path: string,
  optional?: boolean,
): WorkflowTopologyIssue[] {
  if (!cardinality) return [];
  const issues: WorkflowTopologyIssue[] = [];
  const min = cardinality.min;
  const max = cardinality.max;
  if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
    issues.push({
      code: "invalid-cardinality",
      path: `${path}.min`,
      message: "Cardinality min must be a non-negative integer",
    });
  }
  if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
    issues.push({
      code: "invalid-cardinality",
      path: `${path}.max`,
      message: "Cardinality max must be a non-negative integer",
    });
  }
  if (min !== undefined && max !== undefined && max < min) {
    issues.push({ code: "invalid-cardinality", path, message: "Cardinality max must be greater than or equal to min" });
  }
  if (optional === true && min !== undefined && min > 0) {
    issues.push({ code: "invalid-cardinality", path, message: "An optional step must allow zero occurrences" });
  }
  if (optional === false && min === 0) {
    issues.push({ code: "invalid-cardinality", path, message: "A required step cannot have a zero minimum" });
  }
  return issues;
}

function duplicateIdIssues(
  values: readonly { id: string }[],
  path: string,
  code: "duplicate-step-id" | "duplicate-port-id" | "duplicate-connection-id",
): WorkflowTopologyIssue[] {
  const seen = new Set<string>();
  const issues: WorkflowTopologyIssue[] = [];
  values.forEach((value, index) => {
    if (seen.has(value.id)) issues.push({ code, path: `${path}[${index}].id`, message: `Duplicate ID ${value.id}` });
    seen.add(value.id);
  });
  return issues;
}

/** Validate the graph rules that ATProto Lexicon syntax cannot express. */
export function validateWorkflowTopology(template: WorkflowTemplateRecord): WorkflowTopologyIssue[] {
  const value = template.value;
  if (!value.steps) return [];
  const steps = value.steps;
  const connections = value.connections || [];
  const issues: WorkflowTopologyIssue[] = [
    ...duplicateIdIssues(steps, "$.steps", "duplicate-step-id"),
    ...duplicateIdIssues(connections, "$.connections", "duplicate-connection-id"),
  ];
  const stepById = new Map(steps.map((step) => [step.id, step]));

  steps.forEach((step, stepIndex) => {
    issues.push(...cardinalityIssues(step.cardinality, `$.steps[${stepIndex}].cardinality`, step.optional));
    for (const [direction, ports] of [
      ["inputs", step.inputs || []],
      ["outputs", step.outputs || []],
    ] as const) {
      issues.push(...duplicateIdIssues(ports, `$.steps[${stepIndex}].${direction}`, "duplicate-port-id"));
      ports.forEach((port, portIndex) => {
        const path = `$.steps[${stepIndex}].${direction}[${portIndex}]`;
        issues.push(...cardinalityIssues(port.cardinality, `${path}.cardinality`));
        if (!port.artifactKinds.length) {
          issues.push({
            code: "empty-artifact-kinds",
            path: `${path}.artifactKinds`,
            message: "A port must accept at least one artifact kind",
          });
        }
      });
    }
  });

  const outgoingCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();
  const graph = new Map(steps.map((step) => [step.id, new Set<string>()]));
  connections.forEach((connection, index) => {
    const path = `$.connections[${index}]`;
    const fromStep = stepById.get(connection.fromStep);
    const toStep = stepById.get(connection.toStep);
    if (!fromStep)
      issues.push({
        code: "unknown-step",
        path: `${path}.fromStep`,
        message: `Unknown source step ${connection.fromStep}`,
      });
    if (!toStep)
      issues.push({
        code: "unknown-step",
        path: `${path}.toStep`,
        message: `Unknown target step ${connection.toStep}`,
      });
    const fromPort = fromStep?.outputs?.find((port) => port.id === connection.fromPort);
    const toPort = toStep?.inputs?.find((port) => port.id === connection.toPort);
    if (fromStep && !fromPort)
      issues.push({
        code: "unknown-port",
        path: `${path}.fromPort`,
        message: `Unknown output port ${connection.fromPort}`,
      });
    if (toStep && !toPort)
      issues.push({ code: "unknown-port", path: `${path}.toPort`, message: `Unknown input port ${connection.toPort}` });
    if (fromStep && toStep) graph.get(fromStep.id)?.add(toStep.id);
    if (!fromPort || !toPort) return;

    const compatibleKinds = fromPort.artifactKinds.filter((kind) => toPort.artifactKinds.includes(kind));
    const artifactKind = connection.artifactKind;
    if ((artifactKind && !compatibleKinds.includes(artifactKind)) || (!artifactKind && !compatibleKinds.length)) {
      issues.push({
        code: "incompatible-artifact-kind",
        path: artifactKind ? `${path}.artifactKind` : path,
        message: artifactKind
          ? `Artifact kind ${artifactKind} is not accepted by both ports`
          : "Connected ports do not share an artifact kind",
      });
    }
    const outgoingKey = `${connection.fromStep}\u0000${connection.fromPort}`;
    const incomingKey = `${connection.toStep}\u0000${connection.toPort}`;
    outgoingCounts.set(outgoingKey, (outgoingCounts.get(outgoingKey) || 0) + 1);
    incomingCounts.set(incomingKey, (incomingCounts.get(incomingKey) || 0) + 1);
  });

  steps.forEach((step, stepIndex) => {
    for (const [direction, ports, counts] of [
      ["outputs", step.outputs || [], outgoingCounts],
      ["inputs", step.inputs || [], incomingCounts],
    ] as const) {
      ports.forEach((port, portIndex) => {
        const count = counts.get(`${step.id}\u0000${port.id}`) || 0;
        if (port.cardinality?.max !== undefined && count > port.cardinality.max) {
          issues.push({
            code: "connection-cardinality",
            path: `$.steps[${stepIndex}].${direction}[${portIndex}].cardinality.max`,
            message: `${count} connections exceed the port maximum of ${port.cardinality.max}`,
          });
        }
      });
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const next of graph.get(stepId) || []) visit(next);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of steps) visit(step.id);
  if (hasCycle)
    issues.push({
      code: "cycle",
      path: "$.connections",
      message: "Workflow connections must form a directed acyclic graph",
    });
  return issues;
}

export class WorkflowTopologyValidationError extends Error {
  readonly name = "WorkflowTopologyValidationError";
  readonly issues: readonly WorkflowTopologyIssue[];

  constructor(issues: readonly WorkflowTopologyIssue[]) {
    super(`Invalid workflow topology: ${issues.map((issue) => issue.message).join("; ")}`);
    this.issues = issues;
  }
}

export function assertWorkflowTopology(template: WorkflowTemplateRecord): void {
  const issues = validateWorkflowTopology(template);
  if (issues.length) throw new WorkflowTopologyValidationError(issues);
}
