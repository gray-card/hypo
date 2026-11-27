const collection = "app.graycard.workflow.stage";
const legacyPrefix = "app.graycard.workflow#";
export const legacyWorkflowStageTypes = {
  capture: `${legacyPrefix}captureStage`,
  develop: `${legacyPrefix}developStage`,
  digitize: `${legacyPrefix}digitizeStage`,
  digital: `${legacyPrefix}digitalStage`,
  print: `${legacyPrefix}printStage`,
  edit: `${legacyPrefix}editStage`,
  output: `${legacyPrefix}outputStage`,
  other: `${legacyPrefix}otherStage`,
} as const;
const stageTypes = new Set(Object.values(legacyWorkflowStageTypes).map((type) => type.slice(legacyPrefix.length)));

type RecordValue = Record<string, unknown>;

/** Keep the stage variant in the record body and use the collection as its repository type. */
export function encodeWorkflowStage(value: RecordValue): RecordValue {
  if (typeof value.$type !== "string" || !value.$type.startsWith(legacyPrefix)) return value;
  const variant = value.$type.slice(legacyPrefix.length);
  if (!stageTypes.has(variant)) return value;
  return { $type: collection, stage: { ...value, $type: `${collection}#${variant}` } };
}

/** The workflow runtime and previously exported bundles use the flat stage shape. */
export function decodeWorkflowStage(value: RecordValue): RecordValue {
  const stage = value.stage as RecordValue | undefined;
  const prefix = `${collection}#`;
  if (value.$type !== collection || typeof stage?.$type !== "string" || !stage.$type.startsWith(prefix)) return value;
  const variant = stage.$type.slice(prefix.length);
  if (!stageTypes.has(variant)) return value;
  return { ...stage, $type: `${legacyPrefix}${variant}` };
}
