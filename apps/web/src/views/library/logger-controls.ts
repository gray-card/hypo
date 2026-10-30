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

export function createGearMultiChips(
  items: readonly LoggerRecord[],
  kind: LoggerGearKind,
  get: () => readonly string[],
  set: (uris: string[]) => void,
  label: ShotLoggerDependencies["instanceLabel"],
): GearChips {
  const row = el("div", { class: "chip-row" });
  const none = el("button", { class: "gear-chip-btn", type: "button" }, "None");
  const buttons = items.map((item) => ({
    item,
    baseLabel: label(kind, item.value),
    button: el("button", { class: "gear-chip-btn", type: "button" }),
  }));
  const paint = () => {
    const selected = get();
    none.classList.toggle("on", selected.length === 0);
    none.setAttribute("aria-pressed", String(selected.length === 0));
    for (const { item, baseLabel, button } of buttons) {
      const index = selected.indexOf(item.uri);
      button.classList.toggle("on", index >= 0);
      button.setAttribute("aria-pressed", String(index >= 0));
      button.textContent = index >= 0 ? `${index + 1}. ${baseLabel}` : baseLabel;
      button.title = index >= 0 ? `Stack position ${index + 1}; activate to remove` : "Activate to add to the stack";
    }
  };
  none.addEventListener("click", () => {
    set([]);
    paint();
  });
  row.append(none);
  for (const entry of buttons) {
    entry.button.addEventListener("click", () => {
      const selected = [...get()];
      const index = selected.indexOf(entry.item.uri);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(entry.item.uri);
      set(selected);
      paint();
    });
    row.append(entry.button);
  }
  paint();
  return { row, paint };
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
  const savedFilters = Array.isArray(sticky.filters) ? sticky.filters : sticky.filter ? [sticky.filter] : [];
  return {
    quick: sticky.quick !== false,
    camera: availableUri(gear.camera, sticky.camera, gear.camera[0]?.uri || null),
    filmBack: availableUri(gear.filmBack || [], sticky.filmBack),
    lens: availableUri(gear.lens, sticky.lens, gear.lens[0]?.uri || null),
    filters: [...new Set(savedFilters.filter((uri) => availableUri(gear.filter, uri)))],
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
