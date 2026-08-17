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
  readonly existing?: LibraryRecord | null;
}

const sessionFinishedAt = (value: LibraryValue) => String(value.finishedAt || value.createdAt || "");

function developmentSessionsAfterSave(
  services: ActivityServices,
  session: LibraryValue,
  existing: LibraryRecord | null,
): LibraryRecord[] {
  const current = [...(services.getStore().developSessions || [])];
  const virtual: LibraryRecord = { uri: existing?.uri || "pending:development", value: session };
  if (!existing) return [...current, virtual];
  const index = current.findIndex((candidate) => candidate.uri === existing.uri);
  if (index < 0) return [...current, virtual];
  current.splice(index, 1, virtual);
  return current;
}

function applyDerivedRollDevelopment(
  roll: LibraryRecord,
  sessions: readonly LibraryRecord[],
  previousSessions: readonly LibraryRecord[],
  now: string,
): LibraryValue {
  const next: LibraryValue = { ...roll.value, updatedAt: now };
  const ordered = [...sessions].sort((left, right) =>
    sessionFinishedAt(left.value).localeCompare(sessionFinishedAt(right.value)),
  );
  const previous = [...previousSessions].sort((left, right) =>
    sessionFinishedAt(left.value).localeCompare(sessionFinishedAt(right.value)),
  );
  if (!ordered.length) {
    const previousStart = previous
      .map((record) => record.value.startedAt)
      .filter(Boolean)
      .sort()[0];
    const previousFinish = previous
      .map((record) => sessionFinishedAt(record.value))
      .filter(Boolean)
      .sort()[0];
    const previousLatest = previous.at(-1)?.value;
    const previousDeveloper = previous
      .map((record) => primaryDeveloperForSteps(Array.isArray(record.value.steps) ? record.value.steps : []))
      .filter(Boolean)
      .at(-1);
    if (!previousStart || next.developmentStartedAt === previousStart) delete next.developmentStartedAt;
    if (!previousFinish || next.developedAt === previousFinish) delete next.developedAt;
    if (!previousDeveloper || next.developedWith === previousDeveloper) delete next.developedWith;
    if (!previousLatest?.lab || next.lab === previousLatest.lab) delete next.lab;
    const previousLocation =
      previousLatest?.developmentLocation || (previousLatest?.lab || previousLatest?.labService ? "lab" : "home");
    if (!previousLatest || next.developmentLocation === previousLocation) delete next.developmentLocation;
    if (["at-lab", "developing", "developed"].includes(String(next.status))) next.status = "exposed";
    return next;
  }

  const firstStart = ordered
    .map((record) => record.value.startedAt)
    .filter(Boolean)
    .sort()[0];
  const firstFinish = ordered
    .map((record) => sessionFinishedAt(record.value))
    .filter(Boolean)
    .sort()[0];
  const latest = ordered.at(-1)!.value;
  const latestDeveloper = [...ordered]
    .reverse()
    .map((record) => primaryDeveloperForSteps(Array.isArray(record.value.steps) ? record.value.steps : []))
    .find(Boolean);
  if (firstStart) next.developmentStartedAt = firstStart;
  if (firstFinish) next.developedAt = firstFinish;
  if (latestDeveloper) next.developedWith = latestDeveloper;
  else delete next.developedWith;
  if (latest.lab) next.lab = latest.lab;
  else delete next.lab;
  next.developmentLocation = latest.developmentLocation || (latest.lab || latest.labService ? "lab" : "home");
  if (!DEVELOPED_OR_LATER.has(String(next.status))) next.status = "developed";
  return next;
}

export async function saveCompletedDevelopmentRecords(
  services: ActivityServices,
  session: LibraryValue,
  developmentLocation = "home",
  existing: LibraryRecord | null = null,
): Promise<string> {
  const store = services.getStore();
  const rolls = store.instance.filmRoll || [];
  const chemistry = store.instance.chemistry || [];
  const rollUris = Array.isArray(session.filmRolls) ? session.filmRolls.map(String) : [];
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const primaryDeveloper = primaryDeveloperForSteps(steps);
  if (!primaryDeveloper && !session.lab && developmentLocation !== "lab")
    throw new Error("A completed home development needs a linked developer stage");
  const finishedAt = String(session.finishedAt || session.createdAt || new Date().toISOString());
  const now = new Date().toISOString();
  session.developmentLocation = developmentLocation;

  const previousRollUris = new Set(
    existing && Array.isArray(existing.value.filmRolls) ? existing.value.filmRolls.map(String) : [],
  );
  const impactedRollUris = new Set([...rollUris, ...previousRollUris]);
  const sessionsAfter = developmentSessionsAfterSave(services, session, existing);
  const sessionsBefore = services.getStore().developSessions || [];
  const rollUpdates = [...impactedRollUris].map((uri) => {
    const roll = rolls.find((candidate) => candidate.uri === uri) as LibraryRecord | undefined;
    if (!roll) throw new Error(`Could not find selected roll ${uri}`);
    const relatedAfter = sessionsAfter.filter((candidate) => candidate.value.filmRolls?.includes(uri));
    const relatedBefore = sessionsBefore.filter((candidate) => candidate.value.filmRolls?.includes(uri));
    const next = applyDerivedRollDevelopment(roll, relatedAfter, relatedBefore, now);
    assertConsumableLifecycle(FILM_ROLL_COLLECTION, next);
    return { roll, next };
  });
  const oldChemistryUris = new Set(existing ? chemistryUrisForDevelopment(existing.value) : []);
  const newChemistryUris = new Set(chemistryUrisForDevelopment(session));
  const impactedChemistryUris = new Set([...oldChemistryUris, ...newChemistryUris]);
  const oldRollCount = existing && Array.isArray(existing.value.filmRolls) ? existing.value.filmRolls.length : 0;
  const chemistryUpdates = [...impactedChemistryUris].map((uri) => {
    const record = chemistry.find((candidate) => candidate.uri === uri) as LibraryRecord | undefined;
    if (!record) throw new Error(`Could not find linked chemistry ${uri}`);
    const oldIncluded = oldChemistryUris.has(uri);
    const newIncluded = newChemistryUris.has(uri);
    const rollDelta = (newIncluded ? rollUris.length : 0) - (oldIncluded ? oldRollCount : 0);
    const sessionDelta = Number(newIncluded) - Number(oldIncluded);
    const next: LibraryValue = {
      ...record.value,
      rollsProcessed: Math.max(0, (Number(record.value.rollsProcessed) || 0) + rollDelta),
      sessionsUsed: Math.max(0, (Number(record.value.sessionsUsed) || 0) + sessionDelta),
      updatedAt: now,
    };
    const latestKnownUse = sessionsAfter
      .filter((candidate) => chemistryUrisForDevelopment(candidate.value).includes(uri))
      .map((candidate) => sessionFinishedAt(candidate.value))
      .filter(Boolean)
      .sort()
      .at(-1);
    const previousLastUsed = Date.parse(String(record.value.lastUsedAt || ""));
    const oldFinished = Date.parse(existing ? sessionFinishedAt(existing.value) : "");
    const existingLastBelongsToEditedSession =
      Boolean(existing) &&
      Number.isFinite(previousLastUsed) &&
      Number.isFinite(oldFinished) &&
      previousLastUsed === oldFinished;
    if (latestKnownUse && (!Number.isFinite(previousLastUsed) || existingLastBelongsToEditedSession)) {
      next.lastUsedAt = latestKnownUse;
    } else if (newIncluded && (!Number.isFinite(previousLastUsed) || Date.parse(finishedAt) > previousLastUsed)) {
      next.lastUsedAt = finishedAt;
    } else if (!latestKnownUse && existingLastBelongsToEditedSession) {
      delete next.lastUsedAt;
    }
    return { record, next };
  });

  const sessionUri = await services.saveRecord(services.collections.developSession, session, existing);
  for (const { roll, next } of rollUpdates) {
    await services.saveRecord(services.collections.filmRoll, next, roll);
  }
  for (const { record, next } of chemistryUpdates) {
    await services.saveRecord(services.collections.chemistry, next, record);
  }
  return sessionUri;
}

export function renderDarkroomActivity(body: HTMLElement, services: ActivityServices, render?: () => void): void {
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
            onclick: () =>
              kind === "develop"
                ? openDevelopmentSession(
                    record,
                    async () => {
                      await services.reloadStore();
                      render?.();
                    },
                    services,
                  )
                : services.inspect(record),
            title: kind === "develop" ? "Edit development session" : "Inspect scan session",
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
  const existing = options.existing || null;
  const value = existing?.value || {};
  const rolls = services.getStore().instance.filmRoll || [];
  const chemistry = services.getStore().instance.chemistry || [];
  const processSelect = el(
    "select",
    { "data-key": "process" },
    ["bw", "monobath", "c41", "e6", "ecn2", "reversal-bw", "other"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );
  processSelect.value = String(value.process || "bw");
  const started = dateField("Session started (optional)", value.startedAt || "");
  const completed = dateField("Session finished", value.finishedAt || new Date().toISOString());
  const locationSelect = el("select", { "data-key": "developmentLocation" }, [
    el("option", { value: "home" }, "Home darkroom"),
    el("option", { value: "other" }, "Other"),
  ]);
  locationSelect.value = String(value.developmentLocation || "home");
  const tankTypeSelect = el(
    "select",
    { "data-key": "tankType" },
    ["tank", "tray", "rotary", "dip-and-dunk", "roller-transport", "other"].map((value) =>
      el("option", { value }, services.enumLabel(value)),
    ),
  );
  tankTypeSelect.value = String(value.tankType || "tank");
  const pushPullSelect = el(
    "select",
    { "data-key": "pushPull" },
    ["0", "+1", "+2", "+3", "-1", "-2", "-3"].map((value) =>
      el("option", { value }, value === "0" ? "None" : `${value} stop${Math.abs(Number(value)) === 1 ? "" : "s"}`),
    ),
  );
  const pushPullValue = Number(value.pushPull?.value) / Number(value.pushPull?.scale || 1);
  pushPullSelect.value = Number.isFinite(pushPullValue) ? String(pushPullValue) : "0";
  const notesInput = el(
    "textarea",
    {
      rows: "3",
      placeholder: "Optional session notes",
      "data-key": "notes",
    },
    String(value.notes || ""),
  );
  const rollList = checkList(
    rolls.map((roll) => ({ value: roll.uri, label: services.instanceLabel("filmRoll", roll.value) })),
    {
      selected: options.selectedRolls || (Array.isArray(value.filmRolls) ? value.filmRolls : []),
      emptyMessage: el("p", { class: "muted small" }, "No rolls yet — add one in the Film tab first."),
    },
  );
  const stageEditor = createDevelopmentStepEditor(services, Array.isArray(value.steps) ? value.steps : []);

  return openModal(
    existing ? "Edit development" : "Log completed development",
    [
      el(
        "p",
        { class: "muted small" },
        existing
          ? "Update the rolls, timing, chemistry, and ordered stages for this development. The existing record is replaced in place."
          : "Record a development you already completed. This creates the same session record as the timer without starting a live timer.",
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
        createdAt: value.createdAt || new Date().toISOString(),
        provenance: value.provenance || { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (existing) session.updatedAt = new Date().toISOString();
      if (pushPull) session.pushPull = { unit: "stop", value: pushPull, scale: 1 };

      const sessionUri = await saveCompletedDevelopmentRecords(services, session, locationSelect.value, existing);
      await services.advanceWorkflowStage?.("develop", rollUris, sessionUri);
      await services.reloadStore();
      toast(
        `${existing ? "Updated" : "Logged"} development for ${rollUris.length} roll${rollUris.length === 1 ? "" : "s"}`,
        "ok",
      );
      onDone?.();
    },
    { saveLabel: existing ? "Save changes" : "Log development" },
  );
}

export function openLabDevelopment(
  onDone: (() => void) | undefined,
  services: ActivityServices,
  existing: LibraryRecord | null = null,
) {
  const value = existing?.value || {};
  const labs = services.getStore().instance.labAccount || [];
  const rolls = services.getStore().instance.filmRoll || [];
  const labSelect = createInstanceSelect("labAccount", String(value.lab || ""), services);
  const labNameInput = el("input", {
    type: "text",
    value: value.labService || "",
    placeholder: "Only needed when the lab is not in your setup",
    maxlength: "128",
  });
  const processSelect = el(
    "select",
    {},
    ["c41", "e6", "bw", "ecn2", "reversal-bw"].map((process) =>
      el("option", { value: process }, services.enumLabel(process)),
    ),
  );
  processSelect.value = String(value.process || "c41");
  const pushSelect = el(
    "select",
    {},
    ["0", "+1", "+2", "+3", "-1", "-2"].map((stops) =>
      el("option", { value: stops }, stops === "0" ? "None" : `${stops} stop${Math.abs(+stops) === 1 ? "" : "s"}`),
    ),
  );
  const pushValue = Number(value.pushPull?.value) / Number(value.pushPull?.scale || 1);
  pushSelect.value = Number.isFinite(pushValue) ? String(pushValue) : "0";
  const dateInput = el("input", {
    type: "date",
    class: "date-input",
    value: String(value.finishedAt || new Date().toISOString()).slice(0, 10),
  });
  const notesInput = el("input", {
    type: "text",
    value: value.notes || "",
    placeholder: "e.g. dev + scan, pushed for the concert",
  });
  const rollList = checkList(
    rolls.map((roll) => ({
      value: roll.uri,
      label: services.instanceLabel("filmRoll", roll.value),
    })),
    {
      selected: Array.isArray(value.filmRolls) ? value.filmRolls : [],
      emptyMessage: el("p", { class: "muted small" }, "No rolls yet — add one in the Film tab first."),
    },
  );

  return openModal(
    existing ? "Edit lab development" : "Log lab development",
    [
      labs.length
        ? null
        : el("p", { class: "muted small" }, "Tip: add the lab under Setup → Scanning first, or enter its name below."),
      field("Lab", labSelect),
      field("Lab name (if not listed)", labNameInput),
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
        : labNameInput.value.trim() || undefined;
      const push = Number.parseInt(pushSelect.value, 10) || 0;
      const rollUris = rollList.getSelected();
      const record: LibraryValue = {
        process: processSelect.value,
        lab: labUri,
        labService: labName,
        developmentLocation: "lab",
        filmRolls: rollUris.length ? rollUris : undefined,
        startedAt: when,
        finishedAt: when,
        notes: notesInput.value.trim() || undefined,
        createdAt: value.createdAt || new Date().toISOString(),
        provenance: value.provenance || { source: "manual", assertedAt: new Date().toISOString() },
      };
      if (existing) record.updatedAt = new Date().toISOString();
      if (push) record.pushPull = { unit: "stop", value: push, scale: 1 };
      const sessionUri = await saveCompletedDevelopmentRecords(services, record, "lab", existing);
      await services.advanceWorkflowStage?.("develop", rollUris, sessionUri);
      await services.reloadStore();
      toast(`${existing ? "Updated" : "Logged"} lab development${labName ? ` at ${labName}` : ""}`, "ok");
      onDone?.();
    },
    { saveLabel: existing ? "Save changes" : "Log development" },
  );
}

export function openDevelopmentSession(
  record: LibraryRecord,
  onDone: (() => void) | undefined,
  services: ActivityServices,
) {
  if (record.value.lab || record.value.labService) {
    return openLabDevelopment(onDone, services, record);
  }
  return openManualDevelopment(onDone, services, { existing: record });
}
