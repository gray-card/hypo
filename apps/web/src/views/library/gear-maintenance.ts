import { el, field, inputField, openModal } from "@hypo/ui";
import type { GearServices } from "./gear-types.ts";

const MAINTENANCE_KINDS = ["cla", "sensor-clean", "shutter-service", "fungus-clean", "calibration", "other"];

export function openGearMaintenance(subjectUri: string, onDone: (() => void) | undefined, services: GearServices) {
  const kind = el(
    "select",
    {},
    MAINTENANCE_KINDS.map((value) => el("option", { value }, services.enumLabel(value))),
  );
  const { wrap: performedWrap, input: performedAt } = inputField(
    "Performed at (ISO 8601)",
    "performedAt",
    "",
    "2026-07-01T14:30:00Z",
  );
  const { wrap: countWrap, input: shutterCountAfter } = inputField(
    "Shutter count after (optional)",
    "shutterCountAfter",
  );
  const { wrap: notesWrap, input: notes } = inputField("Notes", "notes");
  const history = services.getStore().maintenanceBySubject?.get(subjectUri) || [];
  const historyNodes: Node[] = history.length
    ? [
        el("h3", { class: "modal-sub" }, "Service history"),
        ...history
          .slice()
          .sort((left, right) =>
            (right.value.performedAt || right.value.createdAt).localeCompare(
              left.value.performedAt || left.value.createdAt,
            ),
          )
          .map((entry) =>
            el("div", { class: "gear-row small" }, [
              el("b", {}, services.enumLabel(entry.value.kind)),
              el(
                "span",
                { class: "muted" },
                `${entry.value.performedAt ? ` · ${entry.value.performedAt.slice(0, 10)}` : ""}${entry.value.shutterCountAfter ? ` · ${entry.value.shutterCountAfter} frames` : ""}${entry.value.notes ? ` · ${entry.value.notes}` : ""}`,
              ),
            ]),
          ),
        el("h3", { class: "modal-sub" }, "Log new"),
      ]
    : [];
  return openModal(
    "Maintenance",
    [...historyNodes, field("Kind *", kind), performedWrap, countWrap, notesWrap],
    async () => {
      const record: Record<string, unknown> = {
        subject: subjectUri,
        kind: kind.value,
        createdAt: new Date().toISOString(),
      };
      if (performedAt.value.trim()) record.performedAt = new Date(performedAt.value.trim()).toISOString();
      const shutterCount = Number.parseInt(shutterCountAfter.value, 10);
      if (Number.isFinite(shutterCount)) record.shutterCountAfter = shutterCount;
      if (notes.value.trim()) record.notes = notes.value.trim();
      await services.saveRecord(services.collections.maintenanceSession, record, null);
      onDone?.();
    },
  );
}
