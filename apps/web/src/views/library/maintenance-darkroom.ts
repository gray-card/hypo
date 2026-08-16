import { assertConsumableLifecycle } from "@hypo/domain";
import { checkList, dateField, el, field, localInputToIso, openModal, toast } from "@hypo/ui";
import { createChemistrySelect, createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";
const DEVELOPED_OR_LATER = new Set(["developed", "scanned", "archived"]);

export const AGITATION_METHODS = [
  ["inversion", "Inversion"],
  ["rotary", "Rotary"],
  ["swizzle-stick", "Swizzle stick"],
  ["tray-rocking", "Tray rocking"],
  ["dip-and-dunk", "Dip and dunk"],
  ["roller-transport", "Roller transport"],
  ["other", "Other"],
] as const;

function numberValue(input: HTMLInputElement): number | undefined {
  if (!input.value.trim()) return undefined;
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function agitationTankType(method: string): string {
  if (method === "rotary") return "rotary";
  if (method === "tray-rocking") return "tray";
  if (method === "dip-and-dunk") return "dip-and-dunk";
  if (method === "roller-transport") return "roller-transport";
  if (method === "other") return "other";
  return "tank";
}

export function formatDevelopmentTime(totalSeconds: unknown): string | null {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

export function formatAgitation(value: LibraryValue): string | null {
  const scheme = value.agitationScheme as LibraryValue | undefined;
  if (!scheme) return value.agitation || null;
  const parts: string[] = [];
  if (scheme.note || value.agitation) parts.push(String(scheme.note || value.agitation));
  if (scheme.continuous) parts.push("continuous");
  if (scheme.initialSec) parts.push(`first ${scheme.initialSec}s`);
  if (scheme.everySec) parts.push(`every ${scheme.everySec}s${scheme.forSec ? ` for ${scheme.forSec}s` : ""}`);
  if (scheme.inversions) parts.push(`${scheme.inversions} inversions`);
  return parts.join(" · ") || value.agitation || null;
}

export interface ManualDevelopmentOptions {
  readonly selectedRolls?: readonly string[];
}

export function renderDarkroomActivity(body: HTMLElement, services: ActivityServices): void {
  const developments = (services.getStore().developSessions || []).map((record) => ({
    record,
    kind: "develop",
    at: record.value.finishedAt || record.value.createdAt,
  }));
  const scans = (services.getStore().digitizeSessions || []).map((record) => ({
    record,
    kind: "scan",
    at: record.value.finishedAt || record.value.createdAt,
  }));
  const activity = [...developments, ...scans]
    .filter((entry) => entry.at)
    .sort((left, right) => (right.at || "").localeCompare(left.at || ""))
    .slice(0, 12);
  if (!activity.length) return;
  const list = el("ul", { class: "gear-list" });
  for (const { record, kind, at } of activity) {
    const when = new Date(at).toLocaleDateString();
    const labName = record.value.lab
      ? services.instanceLabel("labAccount", services.getStore().byUri.get(record.value.lab)?.item.value)
      : record.value.labService;
    const chemistryName = record.value.chemistry
      ? services.instanceLabel("chemistry", services.getStore().byUri.get(record.value.chemistry)?.item.value)
      : undefined;
    const scannerName = record.value.scanner
      ? services.instanceLabel("scanner", services.getStore().byUri.get(record.value.scanner)?.item.value)
      : undefined;
    const label =
      kind === "develop"
        ? labName
          ? `${(record.value.process || "bw").toUpperCase()} · ${labName}`
          : [
              (record.value.process || "bw").toUpperCase(),
              chemistryName,
              formatDevelopmentTime(record.value.actualTimeSeconds ?? record.value.timeSeconds),
              formatAgitation(record.value),
            ]
              .filter(Boolean)
              .join(" · ") || `${(record.value.process || "bw").toUpperCase()} development`
        : ["Scan", scannerName, services.enumLabel(record.value.method || ""), record.value.software]
            .filter(Boolean)
            .join(" · ");
    list.append(
      el("li", { class: "gear-row row between" }, [
        el("div", {}, [
          el("strong", {}, kind === "develop" ? (labName ? "Lab developed" : "Developed") : "Scanned"),
          el("div", { class: "muted small" }, label),
        ]),
        el("span", { class: "muted small mono" }, when),
      ]),
    );
  }
  body.append(el("div", { class: "card" }, [el("h3", {}, "Recent darkroom activity"), list]));
}

export function renderDarkroomHeader(body: HTMLElement, services: ActivityServices, render: () => void): void {
  const resume = services.activeDevelopment();
  body.append(
    el("div", { class: "card" }, [
      el("div", { class: "row between wrap" }, [
        el("div", {}, [
          el("h3", { style: "margin:0" }, "Development timer"),
          el("div", { class: "muted small" }, "Datasheet times, agitation cues, keeps running offline."),
        ]),
        el("div", { class: "row wrap", style: "gap:8px" }, [
          resume
            ? el(
                "button",
                { class: "ghost small-btn", onclick: () => services.openDevelopmentTimer({ onDone: render }) },
                `Resume (${resume.film})`,
              )
            : null,
          el("button", { class: "ghost small-btn", onclick: () => openLabDevelopment(render, services) }, [
            services.icon("package", 14),
            el("span", {}, "Log lab development"),
          ]),
          el("button", { class: "ghost small-btn", onclick: () => openManualDevelopment(render, services) }, [
            services.icon("check", 14),
            el("span", {}, "Log completed development"),
          ]),
          el(
            "button",
            {
              class: "ghost small-btn primary-btn",
              onclick: () => services.openDevelopmentTimer({ allowResume: false, onDone: render }),
            },
            [services.icon("film", 14), el("span", {}, "Start development")],
          ),
        ]),
      ]),
    ]),
  );
}

export function openManualDevelopment(
  onDone: (() => void) | undefined,
  services: ActivityServices,
  options: ManualDevelopmentOptions = {},
) {
  const rolls = services.getStore().instance.filmRoll || [];
  const chemistry = services.getStore().instance.chemistry || [];
  const chemistrySelect = createChemistrySelect("", ["film-developer", "first-developer", "color-developer"], services);
  const processSelect = el(
    "select",
    { "data-key": "process" },
    ["bw", "monobath", "c41", "e6", "ecn2", "reversal-bw", "other"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );
  const completed = dateField("Finished", new Date().toISOString());
  const locationSelect = el("select", { "data-key": "developmentLocation" }, [
    el("option", { value: "home" }, "Home darkroom"),
    el("option", { value: "other" }, "Other"),
  ]);
  const dilutionInput = el("input", { type: "text", placeholder: "e.g. 1+1", "data-key": "dilution" });
  const temperatureInput = el("input", {
    type: "number",
    min: "0",
    max: "60",
    step: "0.1",
    inputmode: "decimal",
    placeholder: "e.g. 20",
    "data-key": "actualTemperatureC",
  });
  const minutesInput = el("input", {
    type: "number",
    min: "0",
    inputmode: "numeric",
    placeholder: "min",
    "aria-label": "Development time minutes",
    "data-key": "timeMinutes",
  });
  const secondsInput = el("input", {
    type: "number",
    min: "0",
    max: "59",
    inputmode: "numeric",
    placeholder: "sec",
    "aria-label": "Development time seconds",
    "data-key": "timeSecondsRemainder",
  });
  const methodSelect = el(
    "select",
    { "data-key": "agitationMethod" },
    AGITATION_METHODS.map(([value, label]) => el("option", { value }, label)),
  );
  const initialInput = el("input", {
    type: "number",
    min: "0",
    inputmode: "numeric",
    placeholder: "e.g. 30",
    "data-key": "agitationInitialSec",
  });
  const everyInput = el("input", {
    type: "number",
    min: "0",
    inputmode: "numeric",
    placeholder: "e.g. 60",
    "data-key": "agitationEverySec",
  });
  const forInput = el("input", {
    type: "number",
    min: "0",
    inputmode: "numeric",
    placeholder: "e.g. 10",
    "data-key": "agitationForSec",
  });
  const inversionsInput = el("input", {
    type: "number",
    min: "0",
    max: "100",
    inputmode: "numeric",
    placeholder: "e.g. 4",
    "data-key": "agitationInversions",
  });
  const continuousInput = el("input", { type: "checkbox", "data-key": "agitationContinuous" });
  const agitationNoteInput = el("input", {
    type: "text",
    placeholder: "Optional detail, e.g. gentle inversions",
    "data-key": "agitationNote",
  });
  const notesInput = el("textarea", {
    rows: "3",
    placeholder: "Optional session notes",
    "data-key": "notes",
  });
  const rollList = checkList(
    rolls.map((roll) => ({ value: roll.uri, label: services.instanceLabel("filmRoll", roll.value) })),
    {
      selected: options.selectedRolls,
      emptyMessage: el("p", { class: "muted small" }, "No rolls yet — add one in the Film tab first."),
    },
  );

  return openModal(
    "Log completed development",
    [
      el(
        "p",
        { class: "muted small" },
        "Record a development you already completed. This creates the same session record as the timer without starting a live timer.",
      ),
      chemistry.length
        ? null
        : el(
            "p",
            { class: "muted small" },
            "Add your working chemistry under Setup → Darkroom before logging this session.",
          ),
      el("h3", { class: "modal-sub" }, "Rolls and chemistry"),
      rollList.node,
      field("Primary developer *", chemistrySelect),
      field("Process", processSelect),
      field("Dilution", dilutionInput),
      field("Development location", locationSelect),
      completed.wrap,
      el("h3", { class: "modal-sub" }, "Time and temperature"),
      el("div", { class: "process-entry-grid process-time-grid" }, [
        field("Minutes", minutesInput),
        field("Seconds", secondsInput),
        field("Temperature °C", temperatureInput),
      ]),
      el("h3", { class: "modal-sub" }, "Agitation"),
      field("Method", methodSelect),
      el("div", { class: "process-entry-grid agitation-schedule-grid" }, [
        field("Initial seconds", initialInput),
        field("Every seconds", everyInput),
        field("For seconds", forInput),
        field("Inversions per cycle", inversionsInput),
      ]),
      el("label", { class: "check-row" }, [continuousInput, el("span", {}, "Continuous agitation")]),
      field("Agitation detail", agitationNoteInput),
      field("Notes", notesInput),
    ],
    async () => {
      const rollUris = rollList.getSelected();
      if (!rollUris.length) throw new Error("Select at least one roll");
      if (!chemistrySelect.value) throw new Error("Primary developer is required");

      const minutes = numberValue(minutesInput) || 0;
      const remainder = numberValue(secondsInput) || 0;
      if (remainder > 59) throw new Error("Development seconds must be between 0 and 59");
      const totalSeconds = minutes * 60 + remainder;
      if (totalSeconds > 604_800) throw new Error("Development time cannot exceed 7 days");
      const actualTimeSeconds = totalSeconds > 0 ? totalSeconds : undefined;
      const finishedAt = localInputToIso(completed.input.value) || new Date().toISOString();
      const startedAt = actualTimeSeconds
        ? new Date(new Date(finishedAt).getTime() - actualTimeSeconds * 1000).toISOString()
        : finishedAt;
      const methodLabel = AGITATION_METHODS.find(([value]) => value === methodSelect.value)?.[1] || "Other";
      const methodNote = [methodLabel, agitationNoteInput.value.trim()].filter(Boolean).join(" — ");
      const initialSec = numberValue(initialInput);
      const everySec = numberValue(everyInput);
      const forSec = numberValue(forInput);
      const inversions = numberValue(inversionsInput);
      if ([initialSec, everySec, forSec].some((value) => value != null && value > 604_800)) {
        throw new Error("Agitation intervals cannot exceed 7 days");
      }
      if (inversions != null && inversions > 100) throw new Error("Inversions per cycle cannot exceed 100");
      if (everySec != null && forSec != null && forSec > everySec) {
        throw new Error("Agitation duration cannot be longer than its cycle interval");
      }
      const agitationScheme: LibraryValue = {
        initialSec,
        everySec,
        forSec,
        inversions,
        continuous: continuousInput.checked || undefined,
        note: methodNote || undefined,
      };
      const hasAgitation = Object.values(agitationScheme).some((value) => value !== undefined);
      const temperature = Number.parseFloat(temperatureInput.value);
      const session: LibraryValue = {
        chemistry: chemistrySelect.value,
        filmRolls: rollUris,
        process: processSelect.value,
        dilution: dilutionInput.value.trim() || undefined,
        tankType: agitationTankType(methodSelect.value),
        timeSeconds: actualTimeSeconds,
        actualTimeSeconds,
        agitationScheme: hasAgitation ? agitationScheme : undefined,
        startedAt,
        finishedAt,
        notes: notesInput.value.trim() || undefined,
        createdAt: new Date().toISOString(),
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (Number.isFinite(temperature)) {
        session.temperature = { unit: "celsius", value: Math.round(temperature * 1_000_000), scale: 1_000_000 };
        session.actualTemperature = session.temperature;
      }
      session.agitation = hasAgitation ? formatAgitation(session) || undefined : undefined;

      const rollUpdates = rollUris.map((uri) => {
        const roll = rolls.find((candidate) => candidate.uri === uri) as LibraryRecord | undefined;
        if (!roll) throw new Error(`Could not find selected roll ${uri}`);
        const next: LibraryValue = {
          ...roll.value,
          status: DEVELOPED_OR_LATER.has(String(roll.value.status)) ? roll.value.status : "developed",
          developedWith: chemistrySelect.value,
          developmentStartedAt: roll.value.developmentStartedAt || startedAt,
          developedAt: roll.value.developedAt || finishedAt,
          developmentLocation: locationSelect.value,
          updatedAt: new Date().toISOString(),
        };
        assertConsumableLifecycle(FILM_ROLL_COLLECTION, next);
        return { roll, next };
      });

      const sessionUri = await services.saveRecord(services.collections.developSession, session, null);
      for (const { roll, next } of rollUpdates) {
        await services.saveRecord(services.collections.filmRoll, next, roll);
      }
      await services.advanceWorkflowStage?.("develop", rollUris, sessionUri);
      await services.reloadStore();
      toast(`Logged development for ${rollUris.length} roll${rollUris.length === 1 ? "" : "s"}`, "ok");
      onDone?.();
    },
    { saveLabel: "Log development" },
  );
}

export function openLabDevelopment(onDone: (() => void) | undefined, services: ActivityServices) {
  const labs = services.getStore().instance.labAccount || [];
  const rolls = (services.getStore().instance.filmRoll || []).filter((record) => record.value.status !== "archived");
  const labSelect = createInstanceSelect("labAccount", "", services);
  const processSelect = el(
    "select",
    {},
    ["c41", "e6", "bw", "ecn2", "reversal-bw"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );
  const pushSelect = el(
    "select",
    {},
    ["0", "+1", "+2", "+3", "-1", "-2"].map((stops) =>
      el("option", { value: stops }, stops === "0" ? "None" : `${stops} stop${Math.abs(+stops) === 1 ? "" : "s"}`),
    ),
  );
  const dateInput = el("input", {
    type: "date",
    class: "date-input",
    value: new Date().toISOString().slice(0, 10),
  });
  const notesInput = el("input", { type: "text", placeholder: "e.g. dev + scan, pushed for the concert" });
  const rollList = checkList(
    rolls.map((roll) => ({
      value: roll.uri,
      label: services.instanceLabel("filmRoll", roll.value),
    })),
    { emptyMessage: el("p", { class: "muted small" }, "No rolls yet — add one in the Film tab first.") },
  );

  return openModal(
    "Log lab development",
    [
      labs.length
        ? null
        : el(
            "p",
            { class: "muted small" },
            "Tip: add the lab (e.g. Praus) under Setup → Scanning first, then pick it here.",
          ),
      field("Lab", labSelect),
      field("Process", processSelect),
      field("Push / pull", pushSelect),
      field("Date developed", dateInput),
      field("Notes", notesInput),
      el("h3", { class: "modal-sub" }, "Rolls developed"),
      rollList.node,
    ],
    async () => {
      const when = dateInput.value ? new Date(dateInput.value).toISOString() : new Date().toISOString();
      const labUri = labSelect.value || undefined;
      const labName = labUri
        ? services.instanceLabel("labAccount", services.getStore().byUri.get(labUri)?.item.value)
        : undefined;
      const push = Number.parseInt(pushSelect.value, 10) || 0;
      const rollUris = rollList.getSelected();
      const record: LibraryValue = {
        process: processSelect.value,
        lab: labUri,
        labService: labName,
        filmRolls: rollUris.length ? rollUris : undefined,
        startedAt: when,
        finishedAt: when,
        notes: notesInput.value.trim() || undefined,
        createdAt: new Date().toISOString(),
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (push) record.pushPull = { unit: "stop", value: push, scale: 1 };
      const sessionUri = await services.saveRecord(services.collections.developSession, record, null);
      await services.advanceWorkflowStage?.("develop", rollUris, sessionUri);
      for (const uri of rollUris) {
        const roll = (services.getStore().instance.filmRoll || []).find((item) => item.uri === uri) as
          LibraryRecord | undefined;
        if (!roll) continue;
        const next: LibraryValue = {
          ...roll.value,
          status: "developed",
          developedAt: roll.value.developedAt || when,
          developmentLocation: "lab",
          updatedAt: new Date().toISOString(),
        };
        if (labUri) next.lab = labUri;
        if (!next.finishedAt) next.finishedAt = when;
        await services.saveRecord(services.collections.filmRoll, next, roll);
      }
      await services.reloadStore();
      toast(`Logged lab development${labName ? ` at ${labName}` : ""}`, "ok");
      onDone?.();
    },
  );
}
