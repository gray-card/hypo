import { el } from "@hypo/ui";
import type { LoggerMeasure, LoggerMeterReadingValue, LoggerRecord } from "./logger-types.ts";

export interface MeterReadingFieldOptions {
  load(): Promise<readonly LoggerRecord[]>;
  pendingCount(): number;
  filmStockLabel?(stockUri: string): string;
}

export interface MeterReadingField {
  select: HTMLSelectElement;
  status: HTMLParagraphElement;
  populate(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function measureValue(measure: LoggerMeasure | undefined): number | null {
  return measure?.value != null ? measure.value / (measure.scale || 1) : null;
}

function secondsLabel(seconds: number): string {
  if (seconds >= 1) return `${Number(seconds.toFixed(2))}s`;
  const reciprocal = 1 / seconds;
  return Number.isFinite(reciprocal) ? `1/${Math.round(reciprocal)}` : `${seconds}s`;
}

function modelLabel(model: string): string {
  return model.startsWith("power:") ? `power ${model.slice("power:".length)}` : model;
}

export function readingLabel(
  reading: LoggerRecord,
  filmStockLabel: MeterReadingFieldOptions["filmStockLabel"],
): string {
  const value = reading.value as LoggerMeterReadingValue;
  const realEv = measureValue(value.ev100);
  const metered = measureValue(value.reciprocity?.meteredSeconds);
  const corrected = measureValue(value.shutterSeconds);
  const correction = value.reciprocity?.applied && metered != null && corrected != null;
  const stock = value.reciprocity?.filmStock
    ? filmStockLabel?.(value.reciprocity.filmStock) || value.reciprocity.filmStock.split("/").pop()
    : null;
  const time = value.takenAt || value.createdAt;
  const when = time ? new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return [
    realEv != null ? `EV ${Number(realEv.toFixed(1))}` : "Meter reading",
    correction ? `${secondsLabel(metered)} → ${secondsLabel(corrected)}` : null,
    stock,
    value.reciprocity?.model ? modelLabel(value.reciprocity.model) : null,
    value.subject,
    when,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function createMeterReadingField(options: MeterReadingFieldOptions): MeterReadingField {
  const select = el("select", { id: "logger-meter-reading", class: "logger-select" }, [
    el("option", { value: "" }, "No meter reading"),
  ]);
  const status = el("p", { class: "logger-reading-status", role: "status", "aria-live": "polite" });
  const populate = async () => {
    status.textContent = "Loading saved meter readings…";
    try {
      const readings = (await options.load())
        .map((reading) => ({ ...reading, value: reading.value || {} }))
        .sort((left, right) =>
          (right.value.takenAt || right.value.createdAt || "").localeCompare(
            left.value.takenAt || left.value.createdAt || "",
          ),
        );
      select.replaceChildren(
        el("option", { value: "" }, "No meter reading"),
        ...readings.map((reading) =>
          el("option", { value: reading.uri }, readingLabel(reading, options.filmStockLabel)),
        ),
      );
      const queued = options.pendingCount();
      status.textContent = readings.length
        ? `${readings.length} saved reading${readings.length === 1 ? "" : "s"}${queued ? ` · ${queued} waiting to sync` : ""}`
        : queued
          ? `${queued} reading${queued === 1 ? " is" : "s are"} waiting to sync before attachment.`
          : "No saved readings yet.";
    } catch (error) {
      status.textContent = `Saved readings unavailable: ${errorMessage(error)}`;
    }
  };
  return { select, status, populate };
}
