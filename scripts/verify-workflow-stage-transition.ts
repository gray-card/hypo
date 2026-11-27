import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPanproto } from "@hypo/schema-runtime";
import { NS, validateRecord } from "@hypo/lexicon";
import { decodeWorkflowStage, encodeWorkflowStage } from "@hypo/lexicon/workflow-stage";
import projection from "../lenses/workflow-stage-record-v4/projection-lexicon.json";

const [, , lensPath, fixturePath] = process.argv;
const lens = JSON.parse(readFileSync(lensPath, "utf8"));
const records = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>[];
const panproto = await loadPanproto();
const root = `${NS.workflow.stage}:body`;
using schema = panproto.parseSchemaBundle("atproto", [projection]);
using chain = panproto.compileLensDocument(lens, root);
using transform = chain.instantiate(schema);

for (const legacy of records) {
  const candidate = encodeWorkflowStage(legacy);
  const stage = candidate.stage as Record<string, unknown>;
  const view = transform.getJson({ input: legacy.input, output: legacy.output }, root).view as {
    stage: Record<string, unknown>;
  };
  assert.deepEqual(view.stage, { input: stage.input, output: stage.output });
  assert.equal(candidate.$type, NS.workflow.stage);
  assert.equal(stage.$type, String(legacy.$type).replace("workflow#", "workflow.stage#"));
  const validation = validateRecord(NS.workflow.stage, candidate);
  assert.ok(validation.success, JSON.stringify(validation));
  assert.deepEqual(decodeWorkflowStage(candidate), legacy);
}
console.log(`Verified ${records.length} workflow-stage record transitions with Panproto.`);
