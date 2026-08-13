import { selectEffectiveShootGear, selectShootGearInheritance } from "@hypo/store";
import type { ShootGearKind, ShootRecord, ShootStore, ShootValue } from "./shoots-types.ts";

export function shootExposureRecords(shootUri: string, store: ShootStore): ShootRecord[] {
  return (store.instance.exposure || []).filter((exposure) => exposure.value.shoot === shootUri);
}

export function shootExposures(shootUri: string, store: ShootStore): ShootValue[] {
  return shootExposureRecords(shootUri, store).map((exposure) => exposure.value);
}

export function inheritedShootGear(shootUri: string, kind: ShootGearKind, store: ShootStore): readonly string[] {
  const emptyShoot: ShootRecord = { uri: shootUri, value: {} };
  return selectShootGearInheritance(emptyShoot, shootExposureRecords(shootUri, store))[kind].inherited;
}

export function effectiveShootGearUris(shoot: ShootRecord, kind: ShootGearKind, store: ShootStore): readonly string[] {
  return selectEffectiveShootGear(shoot, shootExposureRecords(shoot.uri, store), kind);
}

export function inheritedShootLocations(shootUri: string, store: ShootStore): ShootValue[] {
  return shootExposures(shootUri, store)
    .map((exposure) => exposure.location)
    .filter(Boolean);
}

export function resolveShootGear(
  kind: ShootGearKind,
  uris: readonly string[],
  store: ShootStore,
): readonly ShootRecord[] {
  const all = store.instance[kind] || [];
  const picked = uris.map((uri) => all.find((item) => item.uri === uri)).filter(Boolean) as ShootRecord[];
  return picked.length ? picked : all;
}
