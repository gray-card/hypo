import { checkList, el, field, openModal, toast } from "@hypo/ui";
import { createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

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
    const label =
      kind === "develop"
        ? labName
          ? `${(record.value.process || "bw").toUpperCase()} · ${labName}`
          : record.value.notes?.split(".")[0] || `${(record.value.process || "bw").toUpperCase()} development`
        : `Scan · ${services.enumLabel(record.value.method || "")}${record.value.software ? ` · ${record.value.software}` : ""}`;
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
