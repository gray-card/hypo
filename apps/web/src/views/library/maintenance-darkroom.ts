import { assertConsumableLifecycle } from "@hypo/domain";
import { checkList, dateField, el, field, localInputToIso, openModal, toast } from "@hypo/ui";
import {
  chemistryUrisForDevelopment,
  createDevelopmentStepEditor,
  primaryDeveloperForSteps,
  validateDevelopmentChronology,
} from "./development-step-editor.ts";
import { createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";
const DEVELOPED_OR_LATER = new Set(["developed", "scanned", "archived"]);

export function formatDevelopmentTime(totalSeconds: unknown): string | null {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

interface DevelopmentLabelServices {
  getStore(): { readonly byUri?: ReadonlyMap<string, { readonly item: LibraryRecord }> };
  instanceLabel(kind: string, value: LibraryValue | undefined): string;
  enumLabel(value: string): string;
}

export function formatDevelopmentStages(
  value: LibraryValue,
  services: DevelopmentLabelServices,
  limit = 4,
): string | null {
  const stages = Array.isArray(value.steps) ? value.steps : [];
  if (!stages.length) return null;
  const labels = stages.slice(0, limit).map((step: LibraryValue) => {
    const chemistryUri = Array.isArray(step.chemistries) ? step.chemistries[0] : undefined;
    const chemistry = chemistryUri
      ? services.instanceLabel("chemistry", services.getStore().byUri?.get(chemistryUri)?.item.value)
      : undefined;
    return [
      step.name || chemistry || services.enumLabel(String(step.kind || step.roles?.[0] || "Stage")),
      formatDevelopmentTime(step.actualTimeSeconds ?? step.timeSeconds),
    ]
      .filter(Boolean)
      .join(" ");
  });
  if (stages.length > limit) labels.push(`+${stages.length - limit} more`);
  return labels.join(" → ");
}

export function formatAgitation(value: LibraryValue): string | null {
  const scheme = value.agitationScheme as LibraryValue | undefined;
  const method = value.agitationMethod
    ? String(value.agitationMethod)
        .replaceAll("-", " ")
        .replace(/^./, (character) => character.toUpperCase())
    : null;
  if (!scheme) return method;
  const parts: string[] = [];
  if (scheme.note || method) parts.push(String(scheme.note || method));
  if (scheme.continuous) parts.push("continuous");
  if (scheme.initialSec) parts.push(`first ${scheme.initialSec}s`);
  if (scheme.everySec) parts.push(`every ${scheme.everySec}s${scheme.forSec ? ` for ${scheme.forSec}s` : ""}`);
  if (scheme.inversions) parts.push(`${scheme.inversions} inversions`);
  return parts.join(" · ") || method;
}

export function primaryDevelopmentStep(value: LibraryValue): LibraryValue | undefined {
  const steps = Array.isArray(value.steps) ? value.steps : [];
  return steps.find((step: LibraryValue) =>
    (Array.isArray(step.roles) ? step.roles : []).some((role: string) =>
      ["film-developer", "first-developer", "color-developer"].includes(role),
    ),
  );
}

export interface ManualDevelopmentOptions {
  readonly selectedRolls?: readonly string[];
}

export async function saveCompletedDevelopmentRecords(
  services: ActivityServices,
  session: LibraryValue,
  developmentLocation = "home",
): Promise<string> {
  const store = services.getStore();
  const rolls = store.instance.filmRoll || [];
  const chemistry = store.instance.chemistry || [];
  const rollUris = Array.isArray(session.filmRolls) ? session.filmRolls.map(String) : [];
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const primaryDeveloper = primaryDeveloperForSteps(steps);
  if (!primaryDeveloper && !session.lab) throw new Error("A completed home development needs a linked developer stage");
  const finishedAt = String(session.finishedAt || session.createdAt || new Date().toISOString());
  const startedAt = String(session.startedAt || finishedAt);
  const now = new Date().toISOString();

  const rollUpdates = rollUris.map((uri) => {
    const roll = rolls.find((candidate) => candidate.uri === uri) as LibraryRecord | undefined;
    if (!roll) throw new Error(`Could not find selected roll ${uri}`);
    const next: LibraryValue = {
      ...roll.value,
      status: DEVELOPED_OR_LATER.has(String(roll.value.status)) ? roll.value.status : "developed",
      developmentStartedAt: roll.value.developmentStartedAt || startedAt,
      developedAt: roll.value.developedAt || finishedAt,
      developmentLocation,
      updatedAt: now,
    };
    if (primaryDeveloper) next.developedWith = primaryDeveloper;
    assertConsumableLifecycle(FILM_ROLL_COLLECTION, next);
    return { roll, next };
  });
  const chemistryUpdates = chemistryUrisForDevelopment(session).map((uri) => {
    const record = chemistry.find((candidate) => candidate.uri === uri) as LibraryRecord | undefined;
    if (!record) throw new Error(`Could not find linked chemistry ${uri}`);
    const previousLastUsed = Date.parse(String(record.value.lastUsedAt || ""));
    return {
      record,
      next: {
        ...record.value,
        rollsProcessed: Math.max(0, Number(record.value.rollsProcessed) || 0) + rollUris.length,
        sessionsUsed: Math.max(0, Number(record.value.sessionsUsed) || 0) + 1,
        lastUsedAt:
          Number.isFinite(previousLastUsed) && previousLastUsed > Date.parse(finishedAt)
            ? record.value.lastUsedAt
            : finishedAt,
        updatedAt: now,
      },
    };
  });

  const sessionUri = await services.saveRecord(services.collections.developSession, session, null);
  for (const { roll, next } of rollUpdates) {
    await services.saveRecord(services.collections.filmRoll, next, roll);
  }
  for (const { record, next } of chemistryUpdates) {
    await services.saveRecord(services.collections.chemistry, next, record);
  }
  return sessionUri;
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
    const primaryStep = kind === "develop" ? primaryDevelopmentStep(record.value) : undefined;
    const primaryChemistry = Array.isArray(primaryStep?.chemistries) ? primaryStep.chemistries[0] : undefined;
    const chemistryName = primaryChemistry
      ? services.instanceLabel("chemistry", services.getStore().byUri.get(primaryChemistry)?.item.value)
      : undefined;
    const stageSummary = kind === "develop" ? formatDevelopmentStages(record.value, services) : null;
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
              formatDevelopmentTime(primaryStep?.actualTimeSeconds),
              primaryStep ? formatAgitation(primaryStep) : null,
              stageSummary,
            ]
              .filter(Boolean)
              .join(" · ") || `${(record.value.process || "bw").toUpperCase()} development`
        : ["Scan", scannerName, services.enumLabel(record.value.method || ""), record.value.software]
            .filter(Boolean)
            .join(" · ");
    list.append(
      el("li", {}, [
        el(
          "button",
          {
            type: "button",
            class: "gear-row row between development-activity-row",
            onclick: () => services.inspect(record),
            title: `Inspect ${kind === "develop" ? "development" : "scan"} session`,
          },
          [
            el("div", {}, [
              el("strong", {}, kind === "develop" ? (labName ? "Lab developed" : "Developed") : "Scanned"),
              el("div", { class: "muted small" }, label),
            ]),
            el("span", { class: "muted small mono" }, when),
          ],
        ),
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
  const processSelect = el(
    "select",
    { "data-key": "process" },
    ["bw", "monobath", "c41", "e6", "ecn2", "reversal-bw", "other"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );
  const started = dateField("Session started (optional)", "");
  const completed = dateField("Session finished", new Date().toISOString());
  const locationSelect = el("select", { "data-key": "developmentLocation" }, [
    el("option", { value: "home" }, "Home darkroom"),
    el("option", { value: "other" }, "Other"),
  ]);
  const tankTypeSelect = el(
    "select",
    { "data-key": "tankType" },
    ["tank", "tray", "rotary", "dip-and-dunk", "roller-transport", "other"].map((value) =>
      el("option", { value }, services.enumLabel(value)),
    ),
  );
  const pushPullSelect = el(
    "select",
    { "data-key": "pushPull" },
    ["0", "+1", "+2", "+3", "-1", "-2", "-3"].map((value) =>
      el("option", { value }, value === "0" ? "None" : `${value} stop${Math.abs(Number(value)) === 1 ? "" : "s"}`),
    ),
  );
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
  const stageEditor = createDevelopmentStepEditor(services);

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
      el("h3", { class: "modal-sub" }, "Rolls and session"),
      rollList.node,
      field("Process", processSelect),
      field("Tank or processor", tankTypeSelect),
      field("Push / pull", pushPullSelect),
      field("Development location", locationSelect),
      started.wrap,
      completed.wrap,
      el("h3", { class: "modal-sub" }, "Ordered process stages"),
      stageEditor.node,
      field("Notes", notesInput),
    ],
    async () => {
      const rollUris = rollList.getSelected();
      if (!rollUris.length) throw new Error("Select at least one roll");
      const steps = stageEditor.read();
      const primaryDeveloper = primaryDeveloperForSteps(steps);
      if (!primaryDeveloper) {
        throw new Error("Link tracked chemistry to at least one developer stage");
      }
      const finishedAt = localInputToIso(completed.input.value) || new Date().toISOString();
      const primaryStep = steps.find((step) => {
        const roles = Array.isArray(step.roles) ? step.roles : [];
        return roles.some((role) => ["film-developer", "first-developer", "color-developer"].includes(role));
      })!;
      const explicitStartedAt = localInputToIso(started.input.value) || undefined;
      const earliestStepStart = steps.map((step) => step.startedAt).find(Boolean);
      const primaryDuration = primaryStep.actualTimeSeconds;
      const startedAt =
        explicitStartedAt ||
        earliestStepStart ||
        (primaryDuration
          ? new Date(new Date(finishedAt).getTime() - Number(primaryDuration) * 1000).toISOString()
          : finishedAt);
      validateDevelopmentChronology(steps, startedAt, finishedAt);
      const pushPull = Number.parseInt(pushPullSelect.value, 10) || 0;
      const session: LibraryValue = {
        filmRolls: rollUris,
        process: processSelect.value,
        steps,
        tankType: tankTypeSelect.value,
        startedAt,
        finishedAt,
        notes: notesInput.value.trim() || undefined,
        createdAt: new Date().toISOString(),
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (pushPull) session.pushPull = { unit: "stop", value: pushPull, scale: 1 };

      const sessionUri = await saveCompletedDevelopmentRecords(services, session, locationSelect.value);
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
