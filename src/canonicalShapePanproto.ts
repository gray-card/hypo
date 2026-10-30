import type { LensHandle, ProtolensChainHandle } from "@panproto/core";
import { loadPanproto } from "@hypo/schema-runtime";
import type { RepoRecord } from "@hypo/pds";

import captureStageLens from "../lenses/canonical-shapes-v3/capture-stage-lens.json";
import captureStageProjection from "../lenses/canonical-shapes-v3/capture-stage-projection.json";
import filmRollLens from "../lenses/canonical-shapes-v3/film-roll-lens.json";
import filmRollProjection from "../lenses/canonical-shapes-v3/film-roll-projection.json";
import filmStockLens from "../lenses/canonical-shapes-v3/film-stock-lens.json";
import filmStockProjection from "../lenses/canonical-shapes-v3/film-stock-projection.json";
import outputStageLens from "../lenses/canonical-shapes-v3/output-stage-lens.json";
import outputStageProjection from "../lenses/canonical-shapes-v3/output-stage-projection.json";
import templateLens from "../lenses/canonical-shapes-v3/template-lens.json";
import templateProjection from "../lenses/canonical-shapes-v3/template-projection.json";
import workflowRunLens from "../lenses/canonical-shapes-v3/workflow-run-lens.json";
import workflowRunProjection from "../lenses/canonical-shapes-v3/workflow-run-projection.json";

const ROOTS = {
  filmStock: "app.graycard.catalog.filmStock:body",
  filmRoll: "app.graycard.instance.filmRoll:body",
  workflowTemplate: "app.graycard.workflow.template:body",
  workflowRun: "app.graycard.workflow.run:body",
  captureStage: "app.graycard.workflow.stage:body",
  outputStage: "app.graycard.workflow.stage:body",
} as const;

function dispose(value: { [Symbol.dispose]?: () => void } | undefined): void {
  value?.[Symbol.dispose]?.();
}

export interface CanonicalShapeTransforms {
  filmStock(value: RepoRecord): RepoRecord;
  filmRoll(value: RepoRecord): RepoRecord;
  workflowTemplate(value: RepoRecord): RepoRecord;
  workflowRun(value: RepoRecord): RepoRecord;
  workflowStage(value: RepoRecord): RepoRecord;
  dispose(): void;
}

/** Compile every canonical-shape value transform from its reviewed Panproto lens. */
export async function createCanonicalShapeTransforms(): Promise<CanonicalShapeTransforms> {
  const panproto = await loadPanproto();
  const schemas = [
    panproto.parseSchemaBundle("atproto", [filmStockProjection]),
    panproto.parseSchemaBundle("atproto", [filmRollProjection]),
    panproto.parseSchemaBundle("atproto", [templateProjection]),
    panproto.parseSchemaBundle("atproto", [workflowRunProjection]),
    panproto.parseSchemaBundle("atproto", [captureStageProjection]),
    panproto.parseSchemaBundle("atproto", [outputStageProjection]),
  ];
  const specifications = [
    ["filmStock", filmStockLens, ROOTS.filmStock, schemas[0]],
    ["filmRoll", filmRollLens, ROOTS.filmRoll, schemas[1]],
    ["workflowTemplate", templateLens, ROOTS.workflowTemplate, schemas[2]],
    ["workflowRun", workflowRunLens, ROOTS.workflowRun, schemas[3]],
    ["captureStage", captureStageLens, ROOTS.captureStage, schemas[4]],
    ["outputStage", outputStageLens, ROOTS.outputStage, schemas[5]],
  ] as const;
  const chains = new Map<string, ProtolensChainHandle>();
  const lenses = new Map<string, LensHandle>();
  try {
    for (const [name, document, root, schema] of specifications) {
      const chain = panproto.compileLensDocument(document, root);
      // rename_field is structural and Panproto 0.70.1 does not expose it in
      // fieldTransforms(); compute_field transforms must remain observable.
      if (name !== "captureStage" && !(chain.fieldTransforms()[root]?.length >= 1)) {
        throw new Error(`Panproto did not compile the ${name} canonical-shape transform`);
      }
      chains.set(name, chain);
      lenses.set(name, chain.instantiate(schema));
    }
    const project = (name: string, root: string, value: RepoRecord): RepoRecord =>
      lenses.get(name)!.getJson(value, root).view as RepoRecord;
    return {
      filmStock: (value) => project("filmStock", ROOTS.filmStock, value),
      filmRoll: (value) => project("filmRoll", ROOTS.filmRoll, value),
      workflowTemplate: (value) => project("workflowTemplate", ROOTS.workflowTemplate, value),
      workflowRun: (value) => project("workflowRun", ROOTS.workflowRun, value),
      workflowStage(value) {
        return value.$type === "app.graycard.workflow#captureStage"
          ? project("captureStage", ROOTS.captureStage, value)
          : project("outputStage", ROOTS.outputStage, value);
      },
      dispose() {
        for (const lens of lenses.values()) dispose(lens);
        for (const chain of chains.values()) dispose(chain);
        for (const schema of schemas) dispose(schema);
      },
    };
  } catch (error) {
    for (const lens of lenses.values()) dispose(lens);
    for (const chain of chains.values()) dispose(chain);
    for (const schema of schemas) dispose(schema);
    throw error;
  }
}
