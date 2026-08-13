import { GEAR_CATALOG_FORM_META, GEAR_INSTANCE_FORM_META } from "@hypo/lexicon";
import type { GearStore } from "./gear-types.ts";

export type GearField = readonly [key: string, label: string, required?: boolean];

type ProjectableField = {
  readonly key: string;
  readonly label: string;
  readonly required?: true;
  readonly control?: string;
  readonly options?: readonly string[];
  readonly targetKind?: string;
};

function projectFields(fields: readonly ProjectableField[]): readonly GearField[] {
  return fields.map((field) => {
    const label = field.control === "at-uri" ? `@${field.targetKind}` : field.label;
    return field.required ? [field.key, label, true] : [field.key, label];
  });
}

export const TYPE_IDENTITY = Object.freeze(
  Object.fromEntries(
    Object.entries(GEAR_CATALOG_FORM_META).map(([kind, metadata]) => [kind, projectFields(metadata.fields)]),
  ),
) as Readonly<Record<string, readonly GearField[]>>;

const TYPE_LINK_ENTRIES = Object.entries(GEAR_INSTANCE_FORM_META).flatMap(([kind, metadata]) =>
  metadata.typeLink ? [[kind, metadata.typeLink] as const] : [],
);

export const TYPE_OF_INSTANCE = Object.freeze(
  Object.fromEntries(TYPE_LINK_ENTRIES.map(([kind, link]) => [kind, link.catalogKind])),
) as Readonly<Record<string, string>>;

export const TYPE_KEY = Object.freeze(
  Object.fromEntries(TYPE_LINK_ENTRIES.map(([kind, link]) => [kind, link.field])),
) as Readonly<Record<string, string>>;

export const INSTANCE_FIELDS = Object.freeze(
  Object.fromEntries(
    Object.entries(GEAR_INSTANCE_FORM_META).map(([kind, metadata]) => [kind, projectFields(metadata.fields)]),
  ),
) as Readonly<Record<string, readonly GearField[]>>;

export const INSTANCE_ENUM_OPTIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(GEAR_INSTANCE_FORM_META).map(([kind, metadata]) => [
      kind,
      Object.fromEntries(
        metadata.fields.flatMap((field) => (field.control === "enum" ? [[field.key, field.options] as const] : [])),
      ),
    ]),
  ),
) as Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

function collectFormFields(
  forms: Readonly<Record<string, { readonly fields: readonly ProjectableField[] }>>,
): readonly ProjectableField[] {
  return Object.values(forms).flatMap((metadata) => metadata.fields);
}

const ALL_FORM_FIELDS = [...collectFormFields(GEAR_CATALOG_FORM_META), ...collectFormFields(GEAR_INSTANCE_FORM_META)];

// Compatibility projections for the remaining DOM form code. Membership is
// determined by typed schema metadata rather than a second list of field keys.
export const DATE_ONLY = new Set(ALL_FORM_FIELDS.filter((field) => field.control === "date").map((field) => field.key));
export const ENUM_SELECT = new Set(
  ALL_FORM_FIELDS.filter((field) => field.control === "enum").map((field) => field.key),
);
export const ENUM_LIST = new Set(
  ALL_FORM_FIELDS.filter((field) => field.control === "enum-list").map((field) => field.key),
);
export const STRING_LIST = new Set(
  ALL_FORM_FIELDS.filter((field) => field.control === "string-list").map((field) => field.key),
);

export const GEAR_TABS: Readonly<Record<string, readonly string[]>> = {
  cameras: ["camera"],
  lenses: ["lens"],
  filters: ["filter"],
  film: ["filmRoll"],
  darkroom: ["chemistry", "enlarger", "enlargingLens", "lightSource", "printer", "labAccount"],
  scanning: ["scanner", "labAccount", "storageLocation"],
};

export const MAINTAINABLE = new Set(["camera", "lens", "scanner", "enlarger"]);

export function countTypeReferences(
  store: GearStore,
  typeKind: string,
  typeUri: string,
  exceptUri?: string | null,
): number {
  let count = 0;
  for (const [kind, currentTypeKind] of Object.entries(TYPE_OF_INSTANCE)) {
    if (currentTypeKind !== typeKind) continue;
    const field = TYPE_KEY[kind];
    for (const instance of store.instance[kind] || []) {
      if (instance.uri === exceptUri) continue;
      if (instance.value[field] === typeUri) count += 1;
    }
  }
  return count;
}
