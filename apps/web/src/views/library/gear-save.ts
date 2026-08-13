import { countTypeReferences, TYPE_KEY } from "./gear-config.ts";
import type { GearRecord, GearServices, GearValue } from "./gear-types.ts";

const ASSET_KEYS = ["image", "datasheet"] as const;
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export async function resolveGearTypeForSave(
  typeKind: string,
  typeRecord: GearValue,
  wikidata: string | null,
  kind: string,
  existing: GearRecord | null,
  services: GearServices,
): Promise<string> {
  const now = new Date().toISOString();
  const all = services.getStore().catalog[typeKind] || [];
  const label = services.catalogLabel(typeKind, typeRecord).toLowerCase().trim();
  const match = all.find((item) => services.catalogLabel(typeKind, item.value).toLowerCase().trim() === label);
  const oldUri = existing?.value[TYPE_KEY[kind]] || null;
  const oldItem = oldUri ? all.find((item) => item.uri === oldUri) : null;
  const oldSharedByOthers = oldUri
    ? countTypeReferences(services.getStore(), typeKind, oldUri, existing?.uri) > 0
    : false;

  if (match) {
    if (oldUri && oldUri !== match.uri && !oldSharedByOthers) await services.deleteRecord(oldUri);
    if (typeKind === "lab") {
      return services.saveRecord(
        services.collections.catalog[typeKind],
        { ...match.value, ...typeRecord, updatedAt: now },
        match,
      );
    }
    const submitted = { ...typeRecord };
    delete submitted.createdAt;
    delete submitted.updatedAt;
    if (Object.entries(submitted).some(([key, value]) => !sameValue(value, match.value[key]))) {
      const merged: GearValue = { ...match.value, ...submitted, updatedAt: now };
      for (const key of ASSET_KEYS) if (key in submitted && submitted[key] === undefined) delete merged[key];
      return services.saveRecord(services.collections.catalog[typeKind], merged, match);
    }
    return match.uri;
  }

  if (oldItem && !oldSharedByOthers) {
    const merged: GearValue = { ...oldItem.value, ...typeRecord, updatedAt: now };
    if (wikidata && !merged.links) merged.links = { externalIds: [{ scheme: "wikidata", value: wikidata }] };
    return services.saveRecord(services.collections.catalog[typeKind], merged, oldItem);
  }

  const record: GearValue = { ...typeRecord, createdAt: typeRecord.createdAt || now };
  if (wikidata) record.links = { externalIds: [{ scheme: "wikidata", value: wikidata }] };
  return services.saveRecord(services.collections.catalog[typeKind], record, null);
}
