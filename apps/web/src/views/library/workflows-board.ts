import { el } from "@hypo/ui";
import type { ActivityServices, LibraryRecord, LibraryStore } from "./maintenance-types.ts";

export const ROLL_STAGES = [
  ["loaded", "Loaded"],
  ["partial", "Partly shot"],
  ["exposed", "Shot"],
  ["at-lab", "At lab"],
  ["developing", "Developing"],
  ["developed", "Developed"],
  ["scanned", "Scanned"],
  ["archived", "Archived"],
] as const;

const ROLL_STATUS_RANK = new Map<string, number>(ROLL_STAGES.map(([status], index) => [status, index]));

export interface RollWorkflowProgress {
  readonly completed: number;
  readonly total: number;
  readonly nextAction: string | null;
  readonly stepLabels: readonly string[];
}

function stageKind(stage: LibraryRecord): string {
  return (
    String(stage.value.$type || "")
      .split("#")[1]
      ?.replace(/Stage$/, "") || String(stage.value.kind || "other")
  );
}

function sessionForStage(stage: LibraryRecord, store: LibraryStore): LibraryRecord | undefined {
  const session = stage.value.session;
  return typeof session === "string" ? store.byUri.get(session)?.item : undefined;
}

function stageTouchesRoll(stage: LibraryRecord, rollUri: string, store: LibraryStore): boolean {
  if (stage.value.filmRoll === rollUri) return true;
  if (stage.value.processDefaults?.filmRoll === rollUri) return true;
  const session = sessionForStage(stage, store);
  return Boolean(Array.isArray(session?.value?.filmRolls) && session.value.filmRolls.includes(rollUri));
}

function stageIsComplete(stage: LibraryRecord, roll: LibraryRecord, store: LibraryStore): boolean {
  const kind = stageKind(stage);
  const session = sessionForStage(stage, store);
  if (["completed", "skipped"].includes(String(stage.value.status))) return true;
  if (["planned", "ready", "in-progress", "blocked", "failed", "cancelled"].includes(String(stage.value.status))) {
    return false;
  }
  if (session?.value?.finishedAt || stage.value.temporal?.at || stage.value.completedAt) return true;
  const rollRank = ROLL_STATUS_RANK.get(String(roll.value.status || "loaded")) || 0;
  if (kind === "capture") return stage.value.filmRoll === roll.uri || rollRank >= 2;
  if (kind === "develop") return rollRank >= (ROLL_STATUS_RANK.get("developed") || 5);
  if (kind === "digitize") return rollRank >= (ROLL_STATUS_RANK.get("scanned") || 6);
  if (kind === "output") return Boolean(stage.value.target || stage.value.photo);
  return false;
}

export function workflowProgressForRoll(
  roll: LibraryRecord,
  store: LibraryStore,
  stageLabels: Readonly<Record<string, string>>,
): RollWorkflowProgress | null {
  const stagesByUri = new Map((store.workflowStages || []).map((stage) => [stage.uri, stage]));
  const candidates: Array<{ run: LibraryRecord; stages: LibraryRecord[] }> = (store.workflowRuns || [])
    .map((run) => ({
      run,
      stages: (run.value.stages || [])
        .slice()
        .sort((left: LibraryRecord["value"], right: LibraryRecord["value"]) => left.position - right.position)
        .map((link: LibraryRecord["value"]) => stagesByUri.get(link.stage))
        .filter((stage: LibraryRecord | undefined): stage is LibraryRecord => Boolean(stage)),
    }))
    .filter(
      ({ run, stages }: { run: LibraryRecord; stages: LibraryRecord[] }) =>
        (run.value.subjects || []).some((subject: LibraryRecord["value"]) => subject.ref === roll.uri) ||
        stages.some((stage: LibraryRecord) => stageTouchesRoll(stage, roll.uri, store)),
    )
    .sort((left, right) => right.stages.length - left.stages.length);
  const stages = candidates[0]?.stages;
  const run = candidates[0]?.run;
  if (!stages?.length) return null;
  const states = stages.map((stage: LibraryRecord) => ({
    stepId: typeof stage.value.templateStepId === "string" ? stage.value.templateStepId : undefined,
    label: stageLabels[stageKind(stage)] || stageKind(stage),
    complete: stageIsComplete(stage, roll, store),
  }));
  const template =
    typeof run?.value?.template === "string"
      ? store.workflowTemplates?.find((record) => record.uri === run.value.template)
      : undefined;
  const connections = template?.value?.connections;
  let next = states.filter(
    (state: { complete: boolean }, index: number) =>
      !state.complete && index === states.findIndex((candidate: { complete: boolean }) => !candidate.complete),
  );
  const branches = run?.value?.branches;
  if ((Array.isArray(branches) && branches.length) || run?.value?.topology === "graph") {
    const indexByUri = new Map(stages.map((stage, index) => [stage.uri, index]));
    const incoming = new Map<number, number[]>();
    for (const branch of branches) {
      const from = indexByUri.get(branch.fromStage);
      const to = indexByUri.get(branch.toStage);
      if (from === undefined || to === undefined) continue;
      incoming.set(to, [...(incoming.get(to) || []), from]);
    }
    next = states.filter((state, index) => {
      if (state.complete) return false;
      const dependencies = incoming.get(index);
      if (dependencies) return dependencies.every((dependency) => states[dependency]?.complete);
      return run?.value?.topology === "graph" || index === 0 || states[index - 1]?.complete;
    });
  } else if (Array.isArray(connections) && connections.length && states.every((state) => state.stepId)) {
    const completeIds = new Set(states.filter((state) => state.complete).map((state) => state.stepId));
    next = states.filter((state) => {
      if (state.complete) return false;
      const incoming = connections.filter((connection: LibraryRecord["value"]) => connection.toStep === state.stepId);
      return incoming.every((connection: LibraryRecord["value"]) => completeIds.has(connection.fromStep));
    });
  }
  return {
    completed: states.filter((state: { complete: boolean }) => state.complete).length,
    total: states.length,
    nextAction: next.length ? next.map((state) => state.label).join(" + ") : null,
    stepLabels: states.map((state: { label: string }) => state.label),
  };
}

function progressReadout(progress: RollWorkflowProgress): HTMLElement {
  const percent = Math.round((progress.completed / progress.total) * 100);
  return el("div", { class: "roll-workflow-progress" }, [
    el(
      "span",
      { class: "muted small" },
      progress.nextAction
        ? `${progress.completed}/${progress.total} · Next: ${progress.nextAction}`
        : `${progress.completed}/${progress.total} · Workflow complete`,
    ),
    el(
      "span",
      {
        class: "roll-progress-track",
        role: "progressbar",
        "aria-label": `Workflow progress: ${progress.completed} of ${progress.total} steps complete`,
        "aria-valuemin": "0",
        "aria-valuemax": String(progress.total),
        "aria-valuenow": String(progress.completed),
        title: progress.stepLabels.join(" → "),
      },
      [el("span", { class: "roll-progress-fill", style: `width:${percent}%` })],
    ),
  ]);
}

export function renderRollBoard(body: HTMLElement, services: ActivityServices): void {
  const rolls = services.getStore().instance.filmRoll || [];
  const reserve = (services.getStore().instance.filmStockpile || []).filter(
    (stockpile) => services.reserveQuantity(stockpile.value) > 0,
  );
  if (!rolls.length && !reserve.length) return;
  const reserveTotal = reserve.reduce((total, stockpile) => total + services.reserveQuantity(stockpile.value), 0);
  const byStatus = new Map<string, (typeof rolls)[number][]>(ROLL_STAGES.map(([status]) => [status, []]));
  for (const roll of rolls) {
    const status = roll.value.status || "loaded";
    (byStatus.get(status) || byStatus.get("loaded"))?.push(roll);
  }
  const board = el("div", { class: "roll-board" });
  board.append(
    el("div", { class: "roll-col" }, [
      el("div", { class: "roll-col-head" }, [
        el("span", {}, "In reserve"),
        el("b", { class: "mono small" }, String(reserveTotal)),
      ]),
      ...reserve.map((stockpile) => {
        const label = `${services.filmStockLabel(stockpile.value.stock)} ×${services.reserveQuantity(stockpile.value)}`;
        return el("div", { class: "roll-chip", title: label }, label);
      }),
    ]),
  );
  for (const [status, label] of ROLL_STAGES) {
    const column = byStatus.get(status) || [];
    board.append(
      el("div", { class: "roll-col" }, [
        el("div", { class: "roll-col-head" }, [
          el("span", {}, label),
          el("b", { class: "mono small" }, String(column.length)),
        ]),
        ...column.map((roll) => {
          const rollLabel = services.instanceLabel("filmRoll", roll.value);
          const progress = workflowProgressForRoll(roll, services.getStore(), services.stageLabels);
          return el("div", { class: `roll-chip${progress ? " has-workflow" : ""}`, title: rollLabel }, [
            el("span", { class: "roll-chip-label" }, rollLabel),
            progress ? progressReadout(progress) : null,
          ]);
        }),
      ]),
    );
  }
  body.append(
    el("div", { class: "card" }, [
      el("div", { class: "row between" }, [
        el("h3", { style: "margin:0" }, "Roll board"),
        el(
          "span",
          { class: "muted small" },
          `${rolls.length} roll${rolls.length === 1 ? "" : "s"}${reserveTotal ? ` · ${reserveTotal} in reserve` : ""}`,
        ),
      ]),
      el(
        "p",
        { class: "muted small" },
        "Where every roll is in the shoot → develop → scan flow. Reserve is film you own but haven't loaded yet. Load one from the Film tab to start a roll.",
      ),
      board,
    ]),
  );
}
