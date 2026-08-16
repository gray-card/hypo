import { assertConsumableLifecycle } from "@hypo/domain";
import { dateField, el, field, localInputToIso, openModal, toast } from "@hypo/ui";
import { createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";
import { openFrameLinker } from "./scanning-linker.ts";

const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";

export interface ScanSessionOptions {
  readonly selectedRoll?: string;
}

export const DIGITIZE_METHODS = [
  ["dedicated-film-scanner", "Film scanner"],
  ["flatbed-negative", "Flatbed (negative)"],
  ["dslr-copy-stand", "DSLR copy stand"],
  ["mirrorless-copy-stand", "Mirrorless copy stand"],
  ["lab-scan", "Lab scan"],
  ["smartphone", "Smartphone"],
  ["file-import", "File import"],
  ["other", "Other"],
] as const;

export function renderScanningHeader(body: HTMLElement, services: ActivityServices, render: () => void): void {
  body.append(
    el("div", { class: "card" }, [
      el("div", { class: "row between wrap" }, [
        el("div", {}, [
          el("h3", { style: "margin:0" }, "Scanning"),
          el(
            "div",
            { class: "muted small" },
            "Log a scan session and link each frame to its photo, so public photos inherit the frame's metadata.",
          ),
        ]),
        el("div", { class: "row", style: "gap:8px" }, [
          el(
            "button",
            { class: "ghost small-btn", onclick: () => openFrameLinker(render, services) },
            "Link frames → photos",
          ),
          el("button", { class: "ghost small-btn primary-btn", onclick: () => openScanSession(render, services) }, [
            services.icon("image", 14),
            el("span", {}, "Log scan session"),
          ]),
        ]),
      ]),
    ]),
  );
}

export function openScanSession(
  onDone: (() => void) | undefined,
  services: ActivityServices,
  options: ScanSessionOptions = {},
) {
  const rollSelect = createInstanceSelect("filmRoll", options.selectedRoll || "", services);
  const scannerSelect = createInstanceSelect("scanner", "", services);
  const methodSelect = el(
    "select",
    { class: "select" },
    DIGITIZE_METHODS.map(([value, label]) => el("option", { value }, label)),
  );
  const softwareInput = el("input", { type: "text", placeholder: "e.g. SilverFast, VueScan, Negative Lab Pro" });
  const dpiInput = el("input", { type: "number", min: "0", placeholder: "e.g. 3200" });
  const formatInput = el("input", { type: "text", placeholder: "e.g. TIFF, DNG, JPEG" });
  const completed = dateField("Scanned", new Date().toISOString());
  const notesInput = el("textarea", { rows: "3", placeholder: "Optional scan notes" });
  return openModal(
    "Log scan session",
    [
      el(
        "p",
        { class: "muted small" },
        "Associate a completed scan with its roll and scanner. Only the roll, scanner, method, and date are needed.",
      ),
      field("Roll", rollSelect),
      field("Scanner", scannerSelect),
      field("Method", methodSelect),
      completed.wrap,
      field("Software", softwareInput),
      field("Resolution (dpi)", dpiInput),
      field("File format", formatInput),
      field("Notes", notesInput),
    ],
    async () => {
      const now = new Date().toISOString();
      const finishedAt = localInputToIso(completed.input.value) || now;
      const record: LibraryValue = {
        method: methodSelect.value,
        createdAt: now,
        startedAt: finishedAt,
        finishedAt,
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (scannerSelect.value) record.scanner = scannerSelect.value;
      if (softwareInput.value.trim()) record.software = softwareInput.value.trim();
      if (formatInput.value.trim()) record.fileFormat = formatInput.value.trim();
      if (notesInput.value.trim()) record.notes = notesInput.value.trim();
      const dpi = Number.parseInt(dpiInput.value, 10);
      if (Number.isFinite(dpi)) record.resolution = { unit: "dpi", value: dpi, scale: 1 };
      if (rollSelect.value) record.filmRolls = [rollSelect.value];
      let rollUpdate: { roll: LibraryRecord; next: LibraryValue } | null = null;
      if (rollSelect.value) {
        const roll = (services.getStore().instance.filmRoll || []).find(
          (candidate) => candidate.uri === rollSelect.value,
        ) as LibraryRecord | undefined;
        if (roll) {
          const next = {
            ...roll.value,
            status: roll.value.status === "archived" ? "archived" : "scanned",
            scannedAt: roll.value.scannedAt || finishedAt,
            updatedAt: now,
          };
          assertConsumableLifecycle(FILM_ROLL_COLLECTION, next);
          rollUpdate = { roll, next };
        }
      }
      const sessionUri = await services.saveRecord(services.collections.digitizeSession, record, null);
      if (rollUpdate) {
        await services.saveRecord(services.collections.filmRoll, rollUpdate.next, rollUpdate.roll);
      }
      await services.advanceWorkflowStage?.("digitize", rollSelect.value ? [rollSelect.value] : [], sessionUri);
      await services.reloadStore();
      toast("Logged scan session", "ok");
      onDone?.();
    },
    { saveLabel: "Log scan" },
  );
}
