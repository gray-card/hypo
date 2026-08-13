import { openShotLoggerView } from "./logger.ts";
import { effectiveShootGearUris, resolveShootGear, shootExposureRecords } from "./shoots-selectors.ts";
import type { ShootGearKind, ShootRecord, ShootServices } from "./shoots-types.ts";

export function openShootLogger(shoot: ShootRecord, services: ShootServices, onClose?: () => void) {
  const store = services.getStore();
  const gearFor = (kind: ShootGearKind) => resolveShootGear(kind, effectiveShootGearUris(shoot, kind, store), store);
  return openShotLoggerView({
    shoot,
    store,
    gear: {
      camera: gearFor("camera"),
      lens: gearFor("lens"),
      filter: gearFor("filter"),
      filmRoll: gearFor("filmRoll"),
    },
    sticky: services.loadSticky(shoot.uri),
    persistSticky: (state) => services.saveSticky(shoot.uri, state),
    framesForRoll: services.framesForRoll,
    pendingExposures: services.pendingExposures,
    subscribePendingAcknowledgements: services.subscribePendingAcknowledgements,
    pendingMeterReadingCount: services.pendingMeterReadingCount,
    enqueueExposure: services.enqueueExposure,
    flush: services.flushOutbox,
    isOnline: services.isOnline,
    reloadStore: services.loadStore,
    onStoreReloaded: services.setStore,
    onClose,
    loadMeterReadings: services.loadMeterReadings,
    instanceLabel: services.instanceLabel,
    filmStockLabel: services.filmStockLabel,
    enumLabel: services.enumLabel,
    meteringModes: services.meteringModes,
    icon: services.icon,
    stopFractions: services.stopFractions,
    buildApertureOptions: services.buildApertureOptions,
    buildShutterOptions: services.buildShutterOptions,
    usesExactApertureSteps: services.usesExactApertureSteps,
    usesExactShutterSteps: services.usesExactShutterSteps,
  });
}

export function effectiveShootGear(
  shoot: ShootRecord,
  kind: ShootGearKind,
  services: ShootServices,
): readonly string[] {
  return effectiveShootGearUris(shoot, kind, services.getStore());
}

export function currentShootExposureRecords(shootUri: string, services: ShootServices): readonly ShootRecord[] {
  return shootExposureRecords(shootUri, services.getStore());
}
