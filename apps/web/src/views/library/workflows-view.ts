import { confirmModal, createOrderedStepEditor, el, field, inputField, openModal, toast } from "@hypo/ui";
import {
  applyTemplateDefaults,
  stepsFromTemplate,
  templateFromSteps,
  validateWorkflowTopology,
  type WorkflowStep,
  type WorkflowTemplateConnection,
} from "@hypo/domain";
import { renderDarkroomActivity } from "./maintenance-darkroom.ts";
import { createCatalogSelect, createChemistrySelect, createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";
import { renderRollBoard } from "./workflows-board.ts";

function templateSteps(value: LibraryValue): WorkflowStep[] {
  return applyTemplateDefaults(stepsFromTemplate({ value }), { value });
}

function firstStepField(steps: readonly WorkflowStep[], kind: string, key: string): unknown {
  return steps.find((step) => step.kind === kind)?.processFields[key];
}

function stepSummary(step: WorkflowStep, services: ActivityServices): string | undefined {
  const labels: string[] = [];
  if (step.label) labels.push(step.label);
  if (step.optional) labels.push("optional");
  if (step.cardinality && ((step.cardinality.max || 1) > 1 || step.cardinality.max === undefined)) {
    labels.push(`${step.cardinality?.min ?? 1}–${step.cardinality?.max ?? "many"} times`);
  }
  if (step.sessionScope && step.sessionScope !== "per-stage") labels.push(step.sessionScope.replaceAll("-", " "));
  for (const value of Object.values(step.processFields)) {
    if (typeof value !== "string" || !value) continue;
    const linked = services.getStore().byUri.get(value)?.item;
    if (linked) labels.push(linked.value.nickname || linked.value.name || linked.value.model || value);
  }
  return labels.length ? labels.join(" · ") : undefined;
}

function openTemplateStepConfig(
  step: WorkflowStep,
  replace: (step: WorkflowStep) => void,
  services: ActivityServices,
): void {
  const nodes: HTMLElement[] = [];
  const readers: Array<() => [string, unknown]> = [];
  const stageReaders: Array<() => [string, unknown]> = [];
  const label = inputField("Step name", "stepLabel", step.label || "");
  const description = inputField("What happens in this step", "stepDescription", step.description || "");
  const optional = el("input", { type: "checkbox", id: "workflow-step-optional" });
  optional.checked = Boolean(step.optional);
  const min = el("input", {
    type: "number",
    min: "0",
    step: "1",
    value: String(step.cardinality?.min ?? (step.optional ? 0 : 1)),
  });
  const max = el("input", {
    type: "number",
    min: "0",
    step: "1",
    value: step.cardinality?.max === undefined ? "" : String(step.cardinality.max),
    placeholder: "No limit",
  });
  optional.addEventListener("change", () => {
    if (optional.checked && (min.value === "" || Number(min.value) > 0)) min.value = "0";
    else if (!optional.checked && (min.value === "" || Number(min.value) < 1)) min.value = "1";
  });
  const sessionScope = el(
    "select",
    {},
    [
      ["per-stage", "Separate session for each step"],
      ["per-subject", "One session per photo or roll"],
      ["per-batch", "Share across a batch"],
      ["per-run", "Share across this workflow run"],
      ["shared", "Reuse one shared session"],
      ["none", "No process session"],
    ].map(([value, text]) => el("option", { value }, text)),
  );
  sessionScope.value = step.sessionScope || "per-stage";
  nodes.push(
    el(
      "p",
      { class: "muted small" },
      "These settings describe this occurrence, even when another step has the same type.",
    ),
    label.wrap,
    description.wrap,
    el("label", { class: "inline-check workflow-optional-check" }, [optional, " This step is optional"]),
    el("div", { class: "workflow-cardinality-grid" }, [field("Minimum times", min), field("Maximum times", max)]),
    field("Process-session sharing", sessionScope),
    el("h3", { class: "modal-sub" }, "Default resources"),
  );
  const addSelect = (label: string, key: string, select: HTMLSelectElement): void => {
    nodes.push(field(label, select));
    readers.push(() => [key, select.value || undefined]);
  };
  const addText = (fieldLabel: string, key: string, current: unknown): void => {
    const control = inputField(fieldLabel, `workflow-${key}`, typeof current === "string" ? current : "");
    nodes.push(control.wrap);
    readers.push(() => [key, control.input.value.trim() || undefined]);
  };
  if (step.kind === "capture") {
    addSelect("Camera", "camera", createInstanceSelect("camera", String(step.processFields.camera || ""), services));
    addSelect("Lens", "lens", createInstanceSelect("lens", String(step.processFields.lens || ""), services));
    addSelect(
      "Film roll",
      "filmRoll",
      createInstanceSelect("filmRoll", String(step.processFields.filmRoll || ""), services),
    );
  } else if (step.kind === "develop") {
    addSelect(
      "Developer chemistry",
      "chemistry",
      createChemistrySelect(
        String(step.processFields.chemistry || ""),
        ["film-developer", "first-developer", "color-developer"],
        services,
      ),
    );
    addSelect("Lab", "lab", createCatalogSelect("lab", String(step.processFields.lab || ""), services));
  } else if (step.kind === "digitize") {
    addSelect(
      "Scanner",
      "scanner",
      createInstanceSelect("scanner", String(step.processFields.scanner || ""), services),
    );
    addSelect(
      "Scan profile",
      "scanProfile",
      createCatalogSelect("scanProfile", String(step.processFields.scanProfile || ""), services),
    );
  } else if (step.kind === "print") {
    addSelect(
      "Printer",
      "printer",
      createInstanceSelect("printer", String(step.processFields.printer || ""), services),
    );
    addSelect(
      "Enlarger",
      "enlarger",
      createInstanceSelect("enlarger", String(step.processFields.enlarger || ""), services),
    );
    addSelect(
      "Enlarging lens",
      "enlargingLens",
      createInstanceSelect("enlargingLens", String(step.processFields.enlargingLens || ""), services),
    );
    addSelect("Paper", "paper", createCatalogSelect("paperType", String(step.processFields.paper || ""), services));
    addSelect(
      "Light source",
      "lightSource",
      createInstanceSelect("lightSource", String(step.processFields.lightSource || ""), services),
    );
    const filters = el(
      "select",
      { multiple: true, size: "4", "aria-label": "Print filters" },
      (services.getStore().instance.filter || []).map((record) =>
        el("option", { value: record.uri }, services.instanceLabel("filter", record.value)),
      ),
    );
    const selectedFilters = new Set(Array.isArray(step.processFields.filters) ? step.processFields.filters : []);
    for (const option of filters.options) option.selected = selectedFilters.has(option.value);
    nodes.push(field("Filters (choose any)", filters));
    addText("Recipe AT-URI", "recipe", step.processFields.recipe);
    readers.push(() => ["filters", [...filters.selectedOptions].map((option) => option.value)]);
  } else if (step.kind === "edit" || step.kind === "digital") {
    addText("Method or software", "method", step.processFields.method);
    addText("Recipe AT-URI", "recipe", step.processFields.recipe);
  } else if (step.kind === "output") {
    const service = inputField(
      "Target service",
      "targetService",
      String((step.stageFields.target as LibraryValue)?.service || ""),
    );
    const targetLabel = inputField(
      "Target label",
      "targetLabel",
      String((step.stageFields.target as LibraryValue)?.label || ""),
    );
    const targetRef = inputField(
      "Target AT-URI",
      "targetRef",
      String((step.stageFields.target as LibraryValue)?.ref || ""),
    );
    nodes.push(service.wrap, targetLabel.wrap, targetRef.wrap);
    stageReaders.push(() => [
      "target",
      {
        service: service.input.value.trim(),
        ...(targetLabel.input.value.trim() ? { label: targetLabel.input.value.trim() } : {}),
        ...(targetRef.input.value.trim() ? { ref: targetRef.input.value.trim() } : {}),
      },
    ]);
  } else if (step.kind === "other") {
    const operation = inputField("Custom operation name *", "customOperation", String(step.stageFields.kind || ""));
    nodes.push(operation.wrap);
    stageReaders.push(() => ["kind", operation.input.value.trim()]);
  } else {
    nodes.push(
      el(
        "p",
        { class: "muted" },
        "This step has no template defaults yet. It can still be ordered, repeated, and configured when the workflow is applied.",
      ),
    );
  }
  const notes = inputField("Step notes", "workflowStepNotes", String(step.stageFields.notes || ""));
  const params = el("textarea", {
    rows: "3",
    placeholder: '{ "key": "value" }',
    "aria-label": "Stage-specific parameters as JSON",
  });
  params.value = step.stageFields.params === undefined ? "" : JSON.stringify(step.stageFields.params, null, 2);
  const portsText = (ports: WorkflowStep["inputs"]): string =>
    (ports || []).map((port) => `${port.id}: ${port.artifactKinds.join(", ")}`).join("\n");
  const inputPorts = el("textarea", { rows: "3", "aria-label": "Input ports", placeholder: "input: film-negative" });
  inputPorts.value = portsText(step.inputs);
  const outputPorts = el("textarea", {
    rows: "3",
    "aria-label": "Output ports",
    placeholder: "master: digital-raster\nproof: physical-print",
  });
  outputPorts.value = portsText(step.outputs);
  nodes.push(
    notes.wrap,
    el("details", { class: "workflow-advanced-flow" }, [
      el("summary", {}, "Advanced flow and parameters"),
      el(
        "p",
        { class: "muted small" },
        "Use one port per line as “port-id: artifact-kind, another-kind”. Multiple ports support composites, masks, proofs, and parallel outputs.",
      ),
      field("Input ports", inputPorts),
      field("Output ports", outputPorts),
      field("Stage-specific parameters (JSON)", params),
    ]),
  );
  openModal(`Configure: ${services.stageLabels[step.kind] || step.kind}`, nodes, async () => {
    const processFields = { ...step.processFields };
    for (const read of readers) {
      const [key, value] = read();
      if (value && (!Array.isArray(value) || value.length)) processFields[key] = value;
      else delete processFields[key];
    }
    const minimum = min.value === "" ? undefined : Number(min.value);
    const maximum = max.value === "" ? undefined : Number(max.value);
    if (minimum !== undefined && (!Number.isInteger(minimum) || minimum < 0))
      throw new Error("Minimum must be a whole number of zero or more");
    if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0))
      throw new Error("Maximum must be a whole number of zero or more");
    if (minimum !== undefined && maximum !== undefined && maximum < minimum)
      throw new Error("Maximum cannot be less than minimum");
    const parsePorts = (source: string, direction: string) =>
      source
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const separator = line.indexOf(":");
          if (separator < 1) throw new Error(`${direction} port line ${index + 1} needs “port-id: artifact-kind”`);
          const id = line.slice(0, separator).trim();
          const artifactKinds = line
            .slice(separator + 1)
            .split(",")
            .map((kind) => kind.trim())
            .filter(Boolean);
          if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
            throw new Error(`${direction} port ID “${id}” must use lowercase letters, numbers, and hyphens`);
          if (!artifactKinds.length) throw new Error(`${direction} port “${id}” needs at least one artifact kind`);
          return { id, artifactKinds };
        });
    const stageFields = { ...step.stageFields };
    for (const read of stageReaders) {
      const [key, value] = read();
      if (value && (typeof value !== "object" || Object.values(value).some(Boolean))) stageFields[key] = value;
      else delete stageFields[key];
    }
    if (step.kind === "other" && !stageFields.kind) throw new Error("Custom operation name is required");
    if (notes.input.value.trim()) stageFields.notes = notes.input.value.trim();
    else delete stageFields.notes;
    if (params.value.trim()) {
      try {
        stageFields.params = JSON.parse(params.value);
      } catch {
        throw new Error("Stage-specific parameters must be valid JSON");
      }
    } else delete stageFields.params;
    const inputs = parsePorts(inputPorts.value, "Input");
    const outputs = parsePorts(outputPorts.value, "Output");
    replace({
      ...step,
      label: label.input.value.trim() || undefined,
      description: description.input.value.trim() || undefined,
      optional: optional.checked,
      cardinality: { min: optional.checked ? 0 : minimum, ...(maximum === undefined ? {} : { max: maximum }) },
      sessionScope: sessionScope.value,
      processFields,
      stageFields,
      inputs: inputs.length ? inputs : undefined,
      outputs: outputs.length ? outputs : undefined,
      configured: Boolean(Object.keys(processFields).length || Object.keys(stageFields).length),
    });
  });
}

export function openWorkflowTemplate(
  existing: LibraryRecord | null,
  onDone: (() => void) | undefined,
  services: ActivityServices,
) {
  const value = existing?.value || {};
  const { wrap: nameWrap, input: nameInput } = inputField("Name *", "name", value.name || "");
  const mediumSelect = el(
    "select",
    {},
    services.mediums.map((medium) => el("option", { value: medium }, medium)),
  );
  mediumSelect.value = value.medium || "film";
  const initialSteps = templateSteps(value);
  let stepIdSeed = 0;
  const nextStepId = (kind: string): string => {
    const used = new Set(
      stepEditor
        ?.getItems?.()
        .map((step) => step.id)
        .filter(Boolean) || initialSteps.map((step) => step.id),
    );
    let id: string;
    do {
      stepIdSeed += 1;
      id = `${kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "step"}-${Date.now().toString(36)}-${stepIdSeed}`;
    } while (used.has(id));
    return id;
  };
  // Only explicit edges are authored topology. A legacy template gets a fresh
  // inferred linear graph when saved, so reordering it cannot keep stale edges.
  let connections: WorkflowTemplateConnection[] = Array.isArray(value.connections)
    ? (value.connections as WorkflowTemplateConnection[]).map((connection) => ({ ...connection }))
    : [];
  let topologyTouched = false;
  const connectionHost = el("div", { class: "workflow-connections" });
  const connectionStatus = el("p", { class: "status", role: "status", "aria-live": "polite" });
  let renderConnections = (): void => {};
  const stepEditor = createOrderedStepEditor<WorkflowStep>({
    label: "Template steps",
    items: initialSteps,
    options: Object.entries(services.stageLabels).map(([kind, label]) => ({ kind, label })),
    getKind: (step) => step.kind,
    configured: (step) => step.configured,
    summary: (step) => stepSummary(step, services),
    create: (kind) => ({ id: nextStepId(kind), kind, processFields: {}, stageFields: {}, configured: false }),
    clone: (step) => ({
      ...step,
      id: nextStepId(step.kind),
      inputs: step.inputs?.map((port) => ({ ...port, artifactKinds: [...port.artifactKinds] })),
      outputs: step.outputs?.map((port) => ({ ...port, artifactKinds: [...port.artifactKinds] })),
      processFields: { ...step.processFields },
      stageFields: { ...step.stageFields },
    }),
    onConfigure: (step, _index, replace) => openTemplateStepConfig(step, replace, services),
    onChange: (steps) => {
      const validIds = new Set(steps.map((step) => step.id).filter(Boolean));
      connections = connections.filter(
        (connection) => validIds.has(connection.fromStep) && validIds.has(connection.toStep),
      );
      renderConnections();
    },
    emptyText: "Add the first step in this workflow.",
  });
  const defaultArtifacts: Record<string, { input: string; output?: string }> = {
    capture: { input: "scene", output: mediumSelect.value === "digital" ? "digital-raw" : "film-roll-latent" },
    develop: { input: "film-roll-latent", output: "film-negative" },
    digitize: { input: "film-negative", output: "digital-raster" },
    digital: { input: "digital-raw", output: "digital-raster" },
    edit: { input: "digital-raster", output: "digital-raster" },
    print: { input: "film-negative", output: "physical-print" },
    output: { input: "digital-raster" },
    other: { input: "other", output: "other" },
  };
  const portsFor = (step: WorkflowStep, direction: "inputs" | "outputs") => {
    const explicit = step[direction];
    if (explicit?.length) return explicit;
    const artifact = defaultArtifacts[step.kind]?.[direction === "inputs" ? "input" : "output"];
    return artifact ? [{ id: direction === "inputs" ? "input" : "output", artifactKinds: [artifact] }] : [];
  };
  const endpointSelect = (direction: "inputs" | "outputs", label: string): HTMLSelectElement =>
    el(
      "select",
      { "aria-label": label },
      stepEditor
        .getItems()
        .flatMap((step, index) =>
          portsFor(step, direction).map((port) =>
            el(
              "option",
              { value: `${step.id}|${port.id}` },
              `${index + 1}. ${step.label || services.stageLabels[step.kind] || step.kind} · ${port.id}`,
            ),
          ),
        ),
    );
  renderConnections = () => {
    connectionHost.replaceChildren();
    const steps = stepEditor.getItems();
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const outgoing = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const connection of connections) {
      outgoing.set(connection.fromStep, (outgoing.get(connection.fromStep) || 0) + 1);
      incoming.set(connection.toStep, (incoming.get(connection.toStep) || 0) + 1);
      const from = stepById.get(connection.fromStep);
      const to = stepById.get(connection.toStep);
      connectionHost.append(
        el("div", { class: "workflow-connection-row" }, [
          el(
            "span",
            {},
            `${from?.label || services.stageLabels[from?.kind || ""] || from?.kind || "Missing step"} → ${to?.label || services.stageLabels[to?.kind || ""] || to?.kind || "Missing step"}${connection.artifactKind ? ` · ${connection.artifactKind}` : ""}`,
          ),
          el(
            "button",
            {
              type: "button",
              class: "ghost small-btn danger",
              "aria-label": `Remove connection from ${from?.label || from?.kind} to ${to?.label || to?.kind}`,
              onclick: () => {
                topologyTouched = true;
                connections = connections.filter((candidate) => candidate.id !== connection.id);
                renderConnections();
                connectionStatus.textContent = "Removed workflow connection.";
              },
            },
            "Remove",
          ),
        ]),
      );
    }
    if (!connections.length) connectionHost.append(el("p", { class: "muted small" }, "No explicit connections yet."));
    const sources = endpointSelect("outputs", "Connection source step and port");
    const targets = endpointSelect("inputs", "Connection destination step and port");
    const add = el(
      "button",
      {
        type: "button",
        class: "ghost small-btn",
        disabled: !sources.options.length || !targets.options.length,
        onclick: () => {
          const [fromStep, fromPort] = sources.value.split("|");
          const [toStep, toPort] = targets.value.split("|");
          if (fromStep === toStep) {
            connectionStatus.className = "status err";
            connectionStatus.textContent = "A step cannot connect to itself.";
            return;
          }
          const from = stepEditor.getItems().find((step) => step.id === fromStep);
          const to = stepEditor.getItems().find((step) => step.id === toStep);
          const fromKinds = portsFor(from!, "outputs").find((port) => port.id === fromPort)?.artifactKinds || [];
          const toKinds = portsFor(to!, "inputs").find((port) => port.id === toPort)?.artifactKinds || [];
          const artifactKind = fromKinds.find((kind) => toKinds.includes(kind));
          if (!artifactKind) {
            connectionStatus.className = "status err";
            connectionStatus.textContent = "Those ports do not carry the same kind of artifact.";
            return;
          }
          connections.push({
            id: `flow-${Date.now().toString(36)}-${connections.length + 1}`,
            fromStep,
            fromPort,
            toStep,
            toPort,
            artifactKind,
          });
          const fromCount = connections.filter(
            (connection) => connection.fromStep === fromStep && connection.fromPort === fromPort,
          ).length;
          const toCount = connections.filter(
            (connection) => connection.toStep === toStep && connection.toPort === toPort,
          ).length;
          if (fromCount > 1 || toCount > 1) {
            stepEditor.replace(
              stepEditor.getItems().map((step) => {
                if (step.id === fromStep && fromCount > 1) {
                  return {
                    ...step,
                    outputs: portsFor(step, "outputs").map((port) =>
                      port.id === fromPort
                        ? { ...port, cardinality: { ...(port.cardinality || {}), max: fromCount } }
                        : port,
                    ),
                  };
                }
                if (step.id === toStep && toCount > 1) {
                  return {
                    ...step,
                    inputs: portsFor(step, "inputs").map((port) =>
                      port.id === toPort
                        ? { ...port, cardinality: { ...(port.cardinality || {}), max: toCount } }
                        : port,
                    ),
                  };
                }
                return step;
              }),
            );
            // replace() rerenders the connection controls through onChange;
            // append this connection after that stale-pruning pass.
            if (!connections.some((connection) => connection.fromStep === fromStep && connection.toStep === toStep)) {
              connections.push({
                id: `flow-${Date.now().toString(36)}-${connections.length + 1}`,
                fromStep,
                fromPort,
                toStep,
                toPort,
                artifactKind,
              });
            }
          }
          topologyTouched = true;
          renderConnections();
          connectionStatus.className = "status ok";
          connectionStatus.textContent = "Added workflow connection.";
        },
      },
      "Connect",
    );
    connectionHost.append(el("div", { class: "workflow-connection-add" }, [sources, targets, add]));
    const branchCount = [...outgoing.values()].filter((count) => count > 1).length;
    const joinCount = [...incoming.values()].filter((count) => count > 1).length;
    if (branchCount || joinCount) {
      connectionHost.append(
        el(
          "p",
          { class: "muted small workflow-topology-summary" },
          `${branchCount} branch${branchCount === 1 ? "" : "es"} · ${joinCount} join${joinCount === 1 ? "" : "s"}`,
        ),
      );
    }
  };
  renderConnections();
  const notes = inputField("Notes", "notes", value.notes || "");
  return openModal(
    existing ? "Edit workflow template" : "New workflow template",
    [
      nameWrap,
      field("Medium *", mediumSelect),
      el(
        "p",
        { class: "muted small" },
        "Build the sequence in working order. Repeated steps keep their own settings, which supports test strips, multiple baths, edits, prints, and exports.",
      ),
      stepEditor.node,
      el("h3", { class: "modal-sub" }, "Artifact flow, branches, and joins"),
      el(
        "p",
        { class: "muted small" },
        "Connect a step's output to the next input. Connect one output to several steps for a branch, or several outputs to one step for a join.",
      ),
      connectionHost,
      connectionStatus,
      notes.wrap,
    ],
    async () => {
      const name = nameInput.value.trim();
      if (!name) throw new Error("Name is required");
      const steps = stepEditor.getItems();
      if (!steps.length) throw new Error("Add at least one step");
      const record: LibraryValue = templateFromSteps(name, mediumSelect.value, steps, {
        connections:
          connections.length || topologyTouched || Array.isArray(value.connections) ? connections : undefined,
        defaultCamera: firstStepField(steps, "capture", "camera"),
        defaultLens: firstStepField(steps, "capture", "lens"),
        defaultFilmRoll: firstStepField(steps, "capture", "filmRoll"),
        defaultChemistry: firstStepField(steps, "develop", "chemistry"),
        defaultScanner: firstStepField(steps, "digitize", "scanner"),
        defaultScanProfile: firstStepField(steps, "digitize", "scanProfile"),
        defaultLab: firstStepField(steps, "develop", "lab"),
        notes: notes.input.value.trim() || undefined,
      });
      record.createdAt = value.createdAt || record.createdAt;
      record.updatedAt = new Date().toISOString();
      const topologyIssues = validateWorkflowTopology({ value: record });
      if (topologyIssues.length) throw new Error(topologyIssues[0].message);
      await services.saveWorkflowTemplate(record, existing);
      await services.reloadStore();
      onDone?.();
    },
  );
}

export function renderWorkflowsView(body: HTMLElement, services: ActivityServices, render: () => void): void {
  const card = el("div", { class: "card" });
  card.append(
    el("div", { class: "row between" }, [
      el("h2", {}, "Workflow templates"),
      el(
        "button",
        { class: "ghost small-btn", onclick: () => openWorkflowTemplate(null, render, services) },
        "+ Template",
      ),
    ]),
  );
  card.append(
    el(
      "p",
      { class: "muted small" },
      "Reusable plans with gear, chemistry, artifact flow, optional steps, repetition, branches, and joins. Start one when you load a roll, begin a shoot, or work on a gallery.",
    ),
  );
  const list = el("ul", { class: "gear-list" });
  for (const template of services.getStore().workflowTemplates || []) {
    const stages = templateSteps(template.value)
      .map((step) => services.stageLabels[step.kind] || step.kind)
      .join(" → ");
    list.append(
      el("li", { class: "gear-row row between" }, [
        el("div", {}, [
          el("strong", {}, template.value.name),
          el(
            "div",
            { class: "muted small" },
            `${services.enumLabel(template.value.medium)} · ${stages || "(no stages)"}`,
          ),
        ]),
        el("div", { class: "row" }, [
          services.isAdvanced()
            ? el(
                "button",
                {
                  class: "ghost small-btn",
                  title: "Inspect record",
                  "aria-label": "Inspect record",
                  onclick: () => services.inspect(template),
                },
                "{ }",
              )
            : null,
          el(
            "button",
            { class: "ghost small-btn", onclick: () => openWorkflowTemplate(template, render, services) },
            "Edit",
          ),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              onclick: async () => {
                if (!(await confirmModal(`Delete template "${template.value.name}"?`))) return;
                const snapshot = template.value;
                await services.deleteRecord(template.uri);
                await services.reloadStore();
                render();
                toast("Deleted template", "ok", 6000, {
                  label: "Undo",
                  fn: async () => {
                    await services.saveRecord(services.collections.workflowTemplate, snapshot, null);
                    await services.reloadStore();
                    render();
                  },
                });
              },
            },
            "Delete",
          ),
        ]),
      ]),
    );
  }
  if (!services.getStore().workflowTemplates?.length) list.append(el("li", { class: "muted" }, "No templates yet."));
  card.append(list);
  body.append(card);
  const activeRuns = (services.getStore().workflowRuns || []).filter(
    (run) => !["completed", "failed", "cancelled"].includes(String(run.value.status || "planned")),
  );
  if (activeRuns.length) {
    const runList = el("ul", { class: "gear-list workflow-run-list" });
    for (const run of activeRuns) {
      const stagesByUri = new Map((services.getStore().workflowStages || []).map((stage) => [stage.uri, stage]));
      const stages = (run.value.stages || [])
        .slice()
        .sort((left: LibraryValue, right: LibraryValue) => left.position - right.position)
        .map((link: LibraryValue) => stagesByUri.get(link.stage))
        .filter((stage: LibraryRecord | undefined): stage is LibraryRecord => Boolean(stage));
      const done = stages.filter((stage: LibraryRecord) =>
        ["completed", "skipped"].includes(String(stage.value.status)),
      ).length;
      const actions = services.workflowActions?.(run) || [];
      const subject = (run.value.subjects || [])[0];
      const subjectRecord = subject?.ref ? services.getStore().byUri.get(subject.ref)?.item : undefined;
      const subjectLabel =
        subject?.label ||
        subjectRecord?.value?.label ||
        subjectRecord?.value?.nickname ||
        (subject?.kind ? services.enumLabel(subject.kind) : "Unlabelled subject");
      runList.append(
        el("li", { class: "gear-row row between workflow-run-row" }, [
          el("div", { class: "workflow-run-identity" }, [
            el("strong", {}, run.value.templateName || run.value.label || "Workflow"),
            el(
              "div",
              { class: "muted small" },
              `${subjectLabel} · ${done}/${stages.length} complete · ${services.enumLabel(run.value.status || "planned")}`,
            ),
          ]),
          el("div", { class: "row wrap workflow-run-actions" }, [
            ...actions.flatMap((stage) => {
              const variant =
                String(stage.value.$type || "")
                  .split("#")[1]
                  ?.replace(/Stage$/, "") || "other";
              const kind = variant === "other" ? String(stage.value.kind || "other") : variant;
              const label = services.stageLabels[kind] || kind;
              return [
                el(
                  "button",
                  {
                    type: "button",
                    class: "ghost small-btn primary-btn",
                    onclick: () => services.openWorkflowStageLogger?.(run, stage, render),
                  },
                  `${stage.value.status === "in-progress" ? "Continue" : "Log"} ${label}`,
                ),
                stage.value.optional
                  ? el(
                      "button",
                      {
                        type: "button",
                        class: "ghost small-btn",
                        onclick: () => services.skipWorkflowStage?.(run, stage, render),
                      },
                      `Skip ${label}`,
                    )
                  : null,
              ];
            }),
            el(
              "button",
              {
                type: "button",
                class: "ghost small-btn danger",
                onclick: async () => {
                  if (!(await confirmModal(`Cancel workflow "${run.value.templateName || "Workflow"}"?`))) return;
                  await services.cancelWorkflowRun?.(run, render);
                },
              },
              "Cancel",
            ),
          ]),
        ]),
      );
    }
    body.append(
      el("div", { class: "card" }, [
        el("h2", {}, "Active workflows"),
        el(
          "p",
          { class: "muted small" },
          "Log the next real step here. Completing one step unlocks every branch whose inputs are ready.",
        ),
        runList,
      ]),
    );
  }
  renderRollBoard(body, services);
  renderDarkroomActivity(body, services, render);
}

export function renderRulesView(body: HTMLElement, services: ActivityServices): void {
  const findings = services.computeLintFindings();
  const checks = el("div", { class: "card" }, [
    el("div", { class: "row between" }, [
      el("h2", { style: "margin:0" }, "Checks"),
      el("span", { class: "muted small" }, findings.length ? `${findings.length} to review` : "All clear"),
    ]),
    el("p", { class: "muted small" }, "A read-only pass over your library. Nothing changes until you act on it."),
  ]);
  if (!findings.length) checks.append(el("p", { class: "muted" }, "No issues found — your metadata looks complete."));
  else {
    const list = el("ul", { class: "gear-list" });
    for (const finding of findings) {
      list.append(
        el("li", { class: "gear-row row between" }, [
          el("div", {}, [el("strong", {}, finding.title), el("div", { class: "muted small" }, finding.detail)]),
          el("span", { class: `lint-pill ${finding.severity}` }, String(finding.count)),
        ]),
      );
    }
    checks.append(list);
  }
  body.append(checks);
  const rulesCard = el("div", { class: "card" }, [el("h3", {}, "Saved batch rules")]);
  const list = el("ul", { class: "gear-list" });
  for (const rule of services.getStore().batchRules) {
    list.append(
      el("li", { class: "gear-row row between" }, [
        el("span", {}, rule.value.name),
        services.isAdvanced()
          ? el(
              "button",
              {
                class: "ghost small-btn",
                title: "Inspect record",
                "aria-label": "Inspect record",
                onclick: () => services.inspect(rule),
              },
              "{ }",
            )
          : null,
      ]),
    );
  }
  if (!services.getStore().batchRules.length)
    list.append(el("li", { class: "muted" }, "No batch rules yet — create them from a gallery's Batch edit panel."));
  rulesCard.append(list);
  body.append(rulesCard);
}
