import { assertConsumableLifecycle } from "@hypo/domain";
import { checkList, dateTimeRange, el, field, openModal, toast } from "@hypo/ui";
import { createCatalogSelect, createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";
import { renderDarkroomActivity } from "./maintenance-darkroom.ts";
import { openFrameLinker } from "./scanning-linker.ts";

const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";

export interface ScanSessionOptions {
  readonly selectedRoll?: string;
  readonly selectedRolls?: readonly string[];
  readonly existing?: LibraryRecord | null;
  readonly initial?: LibraryValue;
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
  renderDarkroomActivity(body, services, render, {
    kinds: ["digitize"],
    limit: 5,
    title: "Recent digitization sessions",
    showAllLink: true,
  });
}

export function openScanSession(
  onDone: (() => void) | undefined,
  services: ActivityServices,
  options: ScanSessionOptions = {},
) {
  const existing = options.existing || null;
  const value = existing?.value || options.initial || {};
  const selectedRolls =
    options.selectedRolls || value.filmRolls || (options.selectedRoll ? [options.selectedRoll] : []);
  const rolls = services.getStore().instance.filmRoll || [];
  const rollSearch = el("input", {
    type: "search",
    class: "search-input",
    placeholder: "Search rolls by label, stock, or status…",
    "aria-label": "Search rolls for this digitization",
  });
  const rollList = checkList(
    rolls.map((roll) => ({
      value: roll.uri,
      label: `${services.instanceLabel("filmRoll", roll.value)} · ${services.enumLabel(roll.value.status || "unknown")}`,
    })),
    {
      selected: selectedRolls,
      className: "check-list scan-roll-list",
      emptyMessage: el("p", { class: "muted small" }, "No film rolls are in your setup yet."),
    },
  );
  const selectionSummary = el("p", { class: "muted small", role: "status", "aria-live": "polite" });
  const updateSelectionSummary = () => {
    const count = rollList.getSelected().length;
    selectionSummary.textContent = count
      ? `${count} roll${count === 1 ? "" : "s"} linked to this digitization.`
      : "No rolls selected. You can still record a print, file, or untracked negative scan.";
  };
  rollList.inputs.forEach((input) => input.addEventListener("change", updateSelectionSummary));
  rollSearch.addEventListener("input", () => {
    const query = rollSearch.value.trim().toLocaleLowerCase();
    rollList.node.querySelectorAll<HTMLElement>(".check-row").forEach((row) => {
      row.classList.toggle("hidden", Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query));
    });
  });
  updateSelectionSummary();

  const scannerSelect = createInstanceSelect("scanner", value.scanner || "", services);
  const cameraSelect = createInstanceSelect("camera", value.camera || "", services);
  const lensSelect = createInstanceSelect("lens", value.lens || "", services);
  const profileSelect = createCatalogSelect("scanProfile", value.scanProfile || "", services);
  const methodSelect = el(
    "select",
    { class: "select" },
    DIGITIZE_METHODS.map(([value, label]) => el("option", { value }, label)),
  );
  methodSelect.value = String(value.method || "dedicated-film-scanner");
  const softwareInput = el("input", {
    type: "text",
    value: value.software || "",
    placeholder: "e.g. SilverFast, VueScan, Negative Lab Pro",
  });
  const driverInput = el("input", { type: "text", value: value.driver || "", placeholder: "Optional driver" });
  const dpiInput = el("input", {
    type: "number",
    min: "0",
    value: value.resolution?.value ? String(value.resolution.value / (value.resolution.scale || 1)) : "",
    placeholder: "e.g. 3200",
  });
  const bitDepthInput = el("input", { type: "number", min: "1", value: value.bitDepth || "", placeholder: "e.g. 16" });
  const colorProfileInput = el("input", {
    type: "text",
    value: value.colorProfile || "",
    placeholder: "e.g. Adobe RGB",
  });
  const formatInput = el("input", { type: "text", value: value.fileFormat || "", placeholder: "e.g. TIFF, DNG, JPEG" });
  const inversionSelect = el(
    "select",
    {},
    [
      ["", "Not recorded"],
      ["none", "None"],
      ["hardware", "Scanner hardware"],
      ["software-auto", "Software, automatic"],
      ["software-manual", "Software, manual"],
      ["preset", "Preset"],
      ["other", "Other"],
    ].map(([optionValue, label]) => el("option", { value: optionValue }, label)),
  );
  inversionSelect.value = String(value.inversionMethod || "");
  const labServiceInput = el("input", {
    type: "text",
    value: value.labService || "",
    placeholder: "Lab or service name",
  });
  const timing = dateTimeRange({
    startLabel: "Started",
    endLabel: "Finished",
    startValue: existing ? String(value.startedAt || "") : "",
    endValue: existing ? String(value.finishedAt || "") : new Date().toISOString(),
    chronologyMessage: "Finished time must be later than start time.",
  });
  const unknownTime = el("input", { type: "checkbox" });
  unknownTime.checked = Boolean(existing && !value.startedAt && !value.finishedAt);
  const updateTimeState = () => {
    timing.setDisabled(unknownTime.checked);
  };
  unknownTime.addEventListener("change", updateTimeState);
  updateTimeState();
  const notesInput = el("textarea", { rows: "3", placeholder: "Optional scan notes" }, value.notes || "");
  return openModal(
    existing ? "Edit digitization session" : options.initial ? "Repeat digitization setup" : "Log digitization session",
    [
      el(
        "p",
        { class: "muted small" },
        "Link every roll in the batch, then record the shared scanner or camera-copy setup. Process details remain optional.",
      ),
      el("h3", { class: "modal-sub" }, "Essentials"),
      rollSearch,
      selectionSummary,
      rollList.node,
      field("Method", methodSelect),
      timing.node,
      el("label", { class: "row small", style: "gap:8px" }, [unknownTime, el("span", {}, "Exact time is unknown")]),
      el("details", { class: "process-disclosure", open: Boolean(options.initial || existing) }, [
        el("summary", {}, "Process details"),
        el("div", { class: "process-entry-grid" }, [
          field("Scanner", scannerSelect),
          field("Camera (copy stand)", cameraSelect),
          field("Lens (copy stand)", lensSelect),
          field("Scan profile", profileSelect),
          field("Software", softwareInput),
          field("Driver", driverInput),
          field("Resolution (dpi)", dpiInput),
          field("Bit depth", bitDepthInput),
          field("Color profile", colorProfileInput),
          field("File format", formatInput),
          field("Inversion", inversionSelect),
          field("Lab service", labServiceInput),
        ]),
      ]),
      field("Notes", notesInput),
    ],
    async () => {
      const now = new Date().toISOString();
      const interval = unknownTime.checked ? {} : timing.read();
      const startedAt = interval.start;
      const finishedAt = interval.end;
      const record: LibraryValue = {
        method: methodSelect.value,
        createdAt: existing ? value.createdAt || now : now,
        provenance: value.provenance || { source: "manual", assertedAt: now },
      };
      if (Array.isArray(value.fieldProvenance)) record.fieldProvenance = value.fieldProvenance;
      if (existing) record.updatedAt = now;
      if (startedAt) record.startedAt = startedAt;
      if (finishedAt) record.finishedAt = finishedAt;
      if (scannerSelect.value) record.scanner = scannerSelect.value;
      if (cameraSelect.value) record.camera = cameraSelect.value;
      if (lensSelect.value) record.lens = lensSelect.value;
      if (profileSelect.value) record.scanProfile = profileSelect.value;
      if (softwareInput.value.trim()) record.software = softwareInput.value.trim();
      if (driverInput.value.trim()) record.driver = driverInput.value.trim();
      if (colorProfileInput.value.trim()) record.colorProfile = colorProfileInput.value.trim();
      if (formatInput.value.trim()) record.fileFormat = formatInput.value.trim();
      if (inversionSelect.value) record.inversionMethod = inversionSelect.value;
      if (labServiceInput.value.trim()) record.labService = labServiceInput.value.trim();
      if (notesInput.value.trim()) record.notes = notesInput.value.trim();
      const dpi = Number.parseInt(dpiInput.value, 10);
      if (Number.isFinite(dpi)) record.resolution = { unit: "dpi", value: dpi, scale: 1 };
      const bitDepth = Number.parseInt(bitDepthInput.value, 10);
      if (Number.isFinite(bitDepth)) record.bitDepth = bitDepth;
      const rollUris = rollList.getSelected();
      if (rollUris.length) record.filmRolls = rollUris;

      const prospectiveSessions = [
        ...(services.getStore().digitizeSessions || []).filter((candidate) => candidate.uri !== existing?.uri),
        { uri: existing?.uri || "pending:digitization", value: record },
      ];
      const affectedRolls = new Set([...(existing?.value.filmRolls || []), ...rollUris]);
      const rollUpdates = (services.getStore().instance.filmRoll || [])
        .filter((roll) => affectedRolls.has(roll.uri))
        .map((roll) => {
          const related = prospectiveSessions.filter((session) => session.value.filmRolls?.includes(roll.uri));
          const completions = related
            .map((session) => session.value.finishedAt)
            .filter(Boolean)
            .sort();
          const latest = completions.at(-1);
          const next: LibraryValue = { ...roll.value, updatedAt: now };
          if (latest) next.scannedAt = latest;
          else delete next.scannedAt;
          if (latest && next.status !== "archived") next.status = "scanned";
          else if (next.status === "scanned") {
            const developed = (services.getStore().developSessions || []).some((session) =>
              session.value.filmRolls?.includes(roll.uri),
            );
            if (developed) next.status = "developed";
            else if (next.exposedAt) next.status = "exposed";
          }
          assertConsumableLifecycle(FILM_ROLL_COLLECTION, next);
          return { roll, next };
        });
      const sessionUri = await services.saveRecord(services.collections.digitizeSession, record, existing);
      for (const { roll, next } of rollUpdates) {
        await services.saveRecord(services.collections.filmRoll, next, roll);
      }
      await services.advanceWorkflowStage?.("digitize", rollUris, sessionUri);
      await services.reloadStore();
      toast(existing ? "Updated digitization session" : "Logged digitization session", "ok");
      onDone?.();
    },
    { saveLabel: existing ? "Save changes" : "Log digitization" },
  );
}
