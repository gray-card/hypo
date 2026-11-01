// Preview-first batch edits for workflow and process records. The allowlists
// prevent a generic rule from bypassing lifecycle or stage-transition logic.
import { evaluateCondition, renderTemplate } from "./batch.js";
import { developmentPlanSnapshot, exposurePlanSnapshot } from "@hypo/domain";

export const PROCESS_RULE_SCOPES = Object.freeze({
  "develop-session": {
    collection: "app.graycard.process.developSession",
    fields: ["developmentPlan", "recipe", "lab", "process", "developmentLocation", "tankType", "notes"],
  },
  "digitize-session": {
    collection: "app.graycard.process.digitizeSession",
    fields: [
      "scanSetup",
      "scanner",
      "camera",
      "lens",
      "scanProfile",
      "method",
      "software",
      "driver",
      "colorProfile",
      "fileFormat",
      "inversionMethod",
      "labService",
      "notes",
    ],
  },
  "print-session": {
    collection: "app.graycard.process.printSession",
    fields: ["exposurePlan", "enlarger", "enlargingLens", "printer", "lightSource", "paper", "notes"],
  },
  "workflow-stage": {
    collection: "app.graycard.workflow.stage",
    fields: [
      "processDefaults.camera",
      "processDefaults.lens",
      "processDefaults.filmBack",
      "processDefaults.filmRoll",
      "processDefaults.chemistry",
      "processDefaults.recipe",
      "processDefaults.developmentPlan",
      "processDefaults.exposurePlan",
      "processDefaults.scanner",
      "processDefaults.scanSetup",
      "processDefaults.scanProfile",
      "processDefaults.enlarger",
      "processDefaults.enlargingLens",
      "processDefaults.printer",
      "processDefaults.paper",
      "processDefaults.lightSource",
      "processDefaults.method",
      "processDefaults.lab",
      "notes",
    ],
  },
});

function valueAt(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function assign(value, path, next) {
  const parts = path.split(".");
  let target = value;
  for (const key of parts.slice(0, -1)) target = target[key] ||= {};
  if (next === undefined) delete target[parts.at(-1)];
  else target[parts.at(-1)] = next;
}

function renderedValue(value, context) {
  if (typeof value === "string") return renderTemplate(value, context);
  return structuredClone(value);
}

export function previewProcessBatch(store, rule) {
  const config = PROCESS_RULE_SCOPES[rule.scope];
  if (!config) throw new Error("Choose a development, scanning, printing, or workflow-stage scope for this rule.");
  if (!rule.actions?.length) throw new Error("Add at least one action before applying this rule.");
  for (const action of rule.actions) {
    if (!["setField", "clearField"].includes(action.op))
      throw new Error(`“${action.op}” is not a supported action for ${rule.scope} records.`);
    if (!config.fields.includes(action.field))
      throw new Error(
        `“${action.field || "(no field)"}” cannot be changed on ${rule.scope} records. Choose a supported field.`,
      );
  }
  const records = store.recordsByCollection?.[config.collection] || [];
  const changes = [];
  for (const [index, record] of records.entries()) {
    if (rule.scope === "workflow-stage" && !["planned", "ready"].includes(record.value.status)) continue;
    const context = { record, index: index + 1 };
    if (!evaluateCondition(context, rule.when)) continue;
    const next = structuredClone(record.value);
    const fields = [];
    for (const action of rule.actions) {
      const before = valueAt(next, action.field);
      if (action.op === "setField") {
        if (action.mode !== "overwrite" && before !== undefined && before !== null && before !== "") continue;
        const after = renderedValue(action.value ?? "", context);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        assign(next, action.field, after);
        fields.push({ field: action.field, before, after });
      } else if (before !== undefined) {
        assign(next, action.field, undefined);
        fields.push({ field: action.field, before, after: undefined });
      }
    }
    if (rule.scope === "digitize-session" && fields.some((change) => change.field === "scanSetup")) {
      const setup = next.scanSetup ? store.byUri?.get(next.scanSetup)?.item : null;
      if (next.scanSetup && (!setup || !Array.isArray(setup.value.components)))
        throw new Error(`Scanning setup ${next.scanSetup} is not in this library. Choose an existing setup.`);
      if (setup)
        next.setupSnapshot = {
          name: setup.value.name,
          components: structuredClone(setup.value.components),
          connections: structuredClone(setup.value.connections || []),
          settings: structuredClone(setup.value.settings || []),
        };
      else delete next.setupSnapshot;
      fields.push({ field: "setupSnapshot", before: record.value.setupSnapshot, after: next.setupSnapshot });
    }
    for (const [scope, field, snapshotField, snapshot] of [
      ["develop-session", "developmentPlan", "developmentPlanSnapshot", developmentPlanSnapshot],
      ["print-session", "exposurePlan", "exposurePlanSnapshot", exposurePlanSnapshot],
    ]) {
      if (rule.scope !== scope || !fields.some((change) => change.field === field)) continue;
      const plan = next[field] ? store.byUri?.get(next[field])?.item : null;
      if (next[field] && !plan)
        throw new Error(`The selected ${field} is not in this library. Choose an existing plan.`);
      const before = record.value[snapshotField];
      if (plan) next[snapshotField] = snapshot(plan.value);
      else delete next[snapshotField];
      fields.push({ field: snapshotField, before, after: next[snapshotField] });
    }
    if (fields.length) changes.push({ record, next, fields });
  }
  return { collection: config.collection, matched: changes };
}

export async function applyProcessBatch(store, rule, saveRecord, onProgress) {
  const preview = previewProcessBatch(store, rule);
  for (const [index, item] of preview.matched.entries()) {
    await saveRecord(preview.collection, { ...item.next, updatedAt: new Date().toISOString() }, item.record);
    onProgress?.(index + 1, preview.matched.length);
  }
  return preview;
}
