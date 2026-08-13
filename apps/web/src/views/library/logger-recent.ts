import { el } from "@hypo/ui";
import type { LoggerPendingWrite, LoggerRecord } from "./logger-types.ts";

export function renderRecentExposures(
  host: HTMLElement,
  stored: readonly LoggerRecord[],
  queued: readonly LoggerPendingWrite[],
): void {
  const records = [
    ...stored.map((exposure) => ({ ...exposure, pending: false })),
    ...queued.map((write) => ({ uri: write.tempUri || "", value: write.record, pending: true, id: write.id })),
  ] as (LoggerRecord & { pending: boolean })[];
  const perFrame = new Map<number, number>();
  for (const record of records) {
    const frameNumber = record.value.frameNumber as number | undefined;
    if (frameNumber != null) perFrame.set(frameNumber, (perFrame.get(frameNumber) || 0) + 1);
  }
  const rows = records
    .sort(
      (left, right) =>
        (right.value.frameNumber ?? 0) - (left.value.frameNumber ?? 0) ||
        (left.value.frameExposureIndex ?? 0) - (right.value.frameExposureIndex ?? 0) ||
        (right.value.createdAt || "").localeCompare(left.value.createdAt || ""),
    )
    .slice(0, 10);
  host.replaceChildren(
    el("div", { class: "logger-recent-h muted small" }, `Recent (${stored.length + queued.length})`),
    ...rows.map((record) => {
      const frameNumber = record.value.frameNumber as number | undefined;
      const multiple = frameNumber != null && (perFrame.get(frameNumber) || 0) > 1;
      return el("div", { class: `logger-recent-row${record.pending ? " pending" : ""}` }, [
        el(
          "span",
          { class: "frame-num" },
          frameNumber != null
            ? `#${frameNumber}${record.value.frameExposureIndex ? `.${record.value.frameExposureIndex}` : ""}`
            : "•",
        ),
        multiple
          ? el("span", { class: "me-badge", title: "Multiple exposure" }, `ME ×${perFrame.get(frameNumber)}`)
          : null,
        el(
          "span",
          { class: "muted small" },
          [record.value.aperture ? `ƒ/${record.value.aperture}` : "", record.value.shutterSpeed || ""]
            .filter(Boolean)
            .join("  "),
        ),
        record.pending ? el("span", { class: "pending-dot", title: "Queued offline" }, "○") : null,
      ]);
    }),
  );
}
