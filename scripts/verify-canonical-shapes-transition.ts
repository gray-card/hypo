import { readFileSync } from "node:fs";

import { validateRecord } from "../packages/lexicon/src/generated.ts";
import { createCanonicalShapeTransforms } from "../src/canonicalShapePanproto.ts";
import {
  migrateFilmRollValue,
  migrateFilmStockValue,
  migrateWorkflowRunValue,
  migrateWorkflowStageValue,
  migrateWorkflowTemplateValue,
} from "../src/legacyShapeMigration.ts";

const [, , , fixturePath] = process.argv;
if (!fixturePath) throw new Error("usage: verify-canonical-shapes-transition <lens> <fixtures>");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  records: Array<{ kind: string; value: Record<string, unknown> }>;
};
const transforms = await createCanonicalShapeTransforms();
try {
  for (const record of fixture.records) {
    let collection: string;
    let value: Record<string, unknown>;
    if (record.kind === "filmStock") {
      const projection = transforms.filmStock(record.value);
      collection = "app.graycard.catalog.filmStock";
      value = migrateFilmStockValue(record.value, projection.formats as unknown[]);
      if ("format" in value) throw new Error("film stock migration retained format");
    } else if (record.kind === "workflowRun") {
      const projection = transforms.workflowRun(record.value);
      collection = "app.graycard.workflow.run";
      value = migrateWorkflowRunValue(record.value, projection.products as unknown[]);
      if ("photo" in value) throw new Error("workflow run migration retained photo");
    } else if (record.kind === "workflowTemplate") {
      transforms.workflowTemplate(record.value);
      collection = "app.graycard.workflow.template";
      value = migrateWorkflowTemplateValue(record.value);
      if ("stageKinds" in value || "defaultCamera" in value) {
        throw new Error("workflow template migration retained a legacy mirror");
      }
    } else if (record.kind === "filmRoll") {
      transforms.filmRoll(record.value);
      const migrated = migrateFilmRollValue(record.value);
      collection = "app.graycard.instance.filmRoll";
      value = migrated.roll;
      if ("quantity" in value || migrated.stockpile?.quantity !== 3) {
        throw new Error("film roll migration did not preserve the reserve count");
      }
      const stockpileValidation = validateRecord("app.graycard.instance.filmStockpile", migrated.stockpile!);
      if (!stockpileValidation.success) throw new Error(JSON.stringify(stockpileValidation.issues));
    } else {
      transforms.workflowStage(record.value);
      collection = "app.graycard.workflow.stage";
      value = migrateWorkflowStageValue(record.value);
      if ("session" in value || "photo" in value) throw new Error("workflow stage retained a legacy alias");
    }
    const validation = validateRecord(collection, value);
    if (!validation.success) throw new Error(`${record.kind}: ${JSON.stringify(validation.issues)}`);
  }
} finally {
  transforms.dispose();
}
console.log(`Verified ${fixture.records.length} canonical-shape migrations with Panproto.`);
