import { el } from "@hypo/ui";
import type {
  LoggerGear,
  LoggerGearKind,
  LoggerRecord,
  ShotLoggerDependencies,
  ShotLoggerState,
  StickyShotLoggerState,
} from "./logger-types.ts";

export interface GearChips {
  row: HTMLDivElement;
  paint(): void;
}

export function createGearChips(
  items: readonly LoggerRecord[],
  kind: LoggerGearKind,
  get: () => string | null,
  set: (uri: string | null) => void,
  label: ShotLoggerDependencies["instanceLabel"],
  allowNone = false,
): GearChips {
  const row = el("div", { class: "chip-row" });
  const options = allowNone
    ? [{ uri: null, label: "None" }, ...items.map((item) => ({ uri: item.uri, label: label(kind, item.value) }))]
    : items.map((item) => ({ uri: item.uri, label: label(kind, item.value) }));
  const paint = () => {
    for (const child of row.children) {
      const button = child as HTMLButtonElement;
      button.classList.toggle("on", button.dataset.uri === String(get()));
    }
  };
  for (const option of options) {
    const button = el("button", { class: "gear-chip-btn", type: "button" }, option.label);
    button.dataset.uri = String(option.uri);
    button.addEventListener("click", () => {
      set(option.uri);
      paint();
    });
    row.append(button);
  }
  paint();
  return { row, paint };
}

function availableUri(
  items: readonly LoggerRecord[],
  uri: string | null | undefined,
  fallback: string | null = null,
): string | null {
  return items.some((item) => item.uri === uri) ? (uri ?? null) : fallback;
}

export function createInitialShotLoggerState(gear: LoggerGear, sticky: StickyShotLoggerState): ShotLoggerState {
  return {
    quick: sticky.quick !== false,
    camera: availableUri(gear.camera, sticky.camera, gear.camera[0]?.uri || null),
    lens: availableUri(gear.lens, sticky.lens, gear.lens[0]?.uri || null),
    filter: availableUri(gear.filter, sticky.filter),
    roll: availableUri(gear.filmRoll, sticky.roll),
    lastFrame: null,
    aperture: sticky.aperture || null,
    shutter: sticky.shutter || null,
    ev: sticky.ev || "0",
    apertureStopFraction: sticky.apertureStopFraction || "1/3",
    shutterStopFraction: sticky.shutterStopFraction || "1/3",
    metering: sticky.metering || "center-weighted",
    flash: sticky.flash === true,
    gps: false,
    note: "",
  };
}
