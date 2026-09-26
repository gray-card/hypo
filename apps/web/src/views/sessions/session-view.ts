import { el, field } from "@hypo/ui";
import type { ActivityServices, LibraryRecord, LibraryStore, LibraryValue } from "../library/maintenance-types.ts";
import { renderActiveWorkflowsView } from "../library/workflows-view.ts";

export const SESSION_KINDS = [
  "all",
  "capture",
  "develop",
  "digitize",
  "edit",
  "print",
  "render",
  "maintenance",
] as const;

export type SessionKind = Exclude<(typeof SESSION_KINDS)[number], "all">;
export type SessionScope = (typeof SESSION_KINDS)[number];

export interface SessionEntry {
  readonly kind: SessionKind;
  readonly record: LibraryRecord;
}

export interface SessionViewServices extends ActivityServices {
  navigateSessions(scope?: SessionScope): unknown;
  navigateSession(kind: SessionKind, rkey: string): unknown;
  editSession(kind: SessionKind, record: LibraryRecord, onDone: () => void): unknown;
  duplicateSession(kind: SessionKind, record: LibraryRecord, onDone: () => void): unknown;
  createSession(kind: "capture" | "develop" | "digitize", onDone: () => void): unknown;
  logFrames(record: LibraryRecord, onDone: () => void): unknown;
  startDevelopment(onDone: () => void): unknown;
  linkFrames(onDone: () => void): unknown;
}

const KIND_LABELS: Readonly<Record<SessionKind, string>> = {
  capture: "Capture",
  develop: "Development",
  digitize: "Digitization",
  edit: "Edit",
  print: "Print",
  render: "Render",
  maintenance: "Maintenance",
};

const SUBJECT_FIELDS: Readonly<Record<SessionKind, readonly string[]>> = {
  capture: ["rolls"],
  develop: ["filmRolls"],
  digitize: ["filmRolls", "photos"],
  edit: ["parentPhoto"],
  print: ["subject", "filmRoll", "sourcePhoto"],
  render: ["sourceArtifacts", "outputArtifacts"],
  maintenance: ["subject"],
};

const EQUIPMENT_FIELDS: Readonly<Record<SessionKind, readonly string[]>> = {
  capture: ["cameras", "lenses", "filters"],
  develop: ["lab", "labService"],
  digitize: ["scanner", "camera", "lens", "scanProfile", "labService"],
  edit: ["software", "preset", "recipe"],
  print: ["enlarger", "enlargingLens", "printer", "paper", "paperInstance", "lab"],
  render: ["software", "recipe", "outputFormat", "colorSpace"],
  maintenance: ["kind"],
};

const STORE_COLLECTIONS: Readonly<Record<SessionKind, keyof LibraryStore>> = {
  capture: "shoots",
  develop: "developSessions",
  digitize: "digitizeSessions",
  edit: "editSessions",
  print: "printSessions",
  render: "renderSessions",
  maintenance: "maintenanceSessions",
};

function values(value: LibraryValue, fields: readonly string[]): string[] {
  return fields.flatMap((field) => {
    const candidate = value[field];
    if (candidate == null || candidate === "") return [];
    return Array.isArray(candidate) ? candidate.map(String) : [String(candidate)];
  });
}

export function sessionTimestamp(entry: SessionEntry): string {
  const value = entry.record.value;
  if (entry.kind === "capture") return String(value.endedAt || value.startedAt || value.createdAt || "");
  if (entry.kind === "maintenance") return String(value.performedAt || value.createdAt || "");
  return String(value.finishedAt || value.startedAt || value.createdAt || "");
}

export function sessionSubjects(entry: SessionEntry): string[] {
  return [...new Set(values(entry.record.value, SUBJECT_FIELDS[entry.kind]))];
}

export function collectSessions(store: LibraryStore): SessionEntry[] {
  return (Object.entries(STORE_COLLECTIONS) as [SessionKind, keyof LibraryStore][])
    .flatMap(([kind, key]) => {
      const records = store[key];
      return Array.isArray(records) ? records.map((record) => ({ kind, record }) as SessionEntry) : [];
    })
    .sort((left, right) => sessionTimestamp(right).localeCompare(sessionTimestamp(left)));
}

function recordKey(record: LibraryRecord): string {
  return String(record.rkey || record.uri.split("/").filter(Boolean).at(-1) || "");
}

function compactUri(uri: string): string {
  const tail = uri.split("/").filter(Boolean).at(-1);
  if (!tail) return uri;
  try {
    return decodeURIComponent(tail).replaceAll(/[-_]+/g, " ");
  } catch {
    return tail;
  }
}

function referenceLabel(uri: string, services: SessionViewServices): string {
  const entry = services.getStore().byUri.get(uri);
  if (!entry) return compactUri(uri);
  if (entry.layer === "instance") return services.instanceLabel(entry.kind, entry.item.value);
  if (entry.layer === "catalog") return services.catalogLabel(entry.kind, entry.item.value);
  return String(entry.item.value.label || entry.item.value.name || compactUri(uri));
}

function subjectSummary(entry: SessionEntry, services: SessionViewServices): string {
  const subjects = sessionSubjects(entry);
  if (!subjects.length)
    return entry.kind === "capture" && entry.record.value.label ? entry.record.value.label : "No subjects linked";
  const labels = subjects.slice(0, 2).map((uri) => referenceLabel(uri, services));
  if (subjects.length > 2) labels.push(`+${subjects.length - 2} more`);
  return labels.join(", ");
}

function processSummary(entry: SessionEntry, services: SessionViewServices): string {
  const value = entry.record.value;
  const details = values(value, EQUIPMENT_FIELDS[entry.kind]).map((candidate) =>
    candidate.startsWith("at://") ? referenceLabel(candidate, services) : services.enumLabel(candidate),
  );
  if (entry.kind === "develop") {
    details.unshift(services.enumLabel(String(value.process || "development")));
    const steps = Array.isArray(value.steps) ? value.steps : [];
    const primary = steps.find((step) => step?.actualTimeSeconds || step?.publishedTimeSeconds);
    const seconds = Number(primary?.actualTimeSeconds || primary?.publishedTimeSeconds);
    if (Number.isFinite(seconds) && seconds > 0) details.push(formatDuration(seconds * 1000));
  } else if (entry.kind === "digitize") {
    details.unshift(services.enumLabel(String(value.method || "digitization")));
  } else if (entry.kind === "capture" && value.label) {
    details.unshift(String(value.label));
  }
  return [...new Set(details.filter(Boolean))].slice(0, 4).join(" · ") || "No process details recorded";
}

function sessionStart(entry: SessionEntry): string {
  const value = entry.record.value;
  return String(value.startedAt || value.performedAt || value.createdAt || "");
}

function sessionEnd(entry: SessionEntry): string {
  const value = entry.record.value;
  return String(value.finishedAt || value.endedAt || value.performedAt || "");
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} hr${remainder ? ` ${remainder} min` : ""}`;
}

function timeSummary(entry: SessionEntry): string {
  const start = Date.parse(sessionStart(entry));
  const end = Date.parse(sessionEnd(entry));
  const at = Number.isFinite(end) ? new Date(end) : Number.isFinite(start) ? new Date(start) : null;
  if (!at) return "Time not recorded";
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return time;
  return `${time} · ${formatDuration(end - start)}`;
}

function provenanceLabel(value: LibraryValue): string {
  const source = String(value.provenance?.source || "");
  if (!source) return "Source not recorded";
  const labels: Record<string, string> = {
    "imported-exif": "Imported",
    manual: "Manual",
    observed: "Observed",
    inferred: "Inferred",
    analysis: "Analysis",
    transformed: "Transformed",
    reconciled: "Reconciled",
    "batch-rule": "Rule",
    "workflow-template": "Workflow",
  };
  return labels[source] || source.replaceAll("-", " ");
}

function reviewStates(entry: SessionEntry): string[] {
  const value = entry.record.value;
  const states: string[] = [];
  if (!sessionSubjects(entry).length) states.push("Needs subjects");
  if (entry.kind !== "maintenance" && entry.kind !== "edit" && !value.finishedAt && !value.endedAt)
    states.push("Missing completion time");
  if (!value.provenance) states.push("Source not recorded");
  if (value.provenance?.confidence === "guess") states.push("Review confidence");
  if (entry.record.schemaRuntime?.conflict) states.push("Conflict");
  return states;
}

function provenanceChip(entry: SessionEntry): HTMLSpanElement {
  const label = provenanceLabel(entry.record.value);
  const confidence = entry.record.value.provenance?.confidence;
  const review = !entry.record.value.provenance || confidence === "guess";
  return el(
    "span",
    {
      class: `session-chip provenance-chip${review ? " review" : ""}`,
      title: confidence ? `${label}; ${confidence} confidence` : label,
    },
    confidence ? `${label} · ${confidence}` : label,
  );
}

function sessionCard(entry: SessionEntry, services: SessionViewServices, rerender: () => void): HTMLElement {
  const provenance = provenanceLabel(entry.record.value);
  const states = reviewStates(entry).filter((state) => state !== provenance);
  const rkey = recordKey(entry.record);
  const open = () => services.navigateSession(entry.kind, rkey);
  return el("article", { class: "session-card", "data-kind": entry.kind }, [
    el("button", { type: "button", class: "session-card-main", onclick: open }, [
      el(
        "span",
        { class: `session-kind-mark ${entry.kind}`, "aria-hidden": "true" },
        KIND_LABELS[entry.kind].slice(0, 3),
      ),
      el("span", { class: "session-card-copy" }, [
        el("span", { class: "session-card-heading" }, [el("strong", {}, KIND_LABELS[entry.kind])]),
        el(
          "span",
          { class: `session-subjects${sessionSubjects(entry).length ? "" : " missing"}` },
          subjectSummary(entry, services),
        ),
        el("span", { class: "session-process muted small" }, processSummary(entry, services)),
        el("span", { class: "session-chips" }, [
          provenanceChip(entry),
          ...states.map((state) => el("span", { class: "session-chip review" }, state)),
        ]),
      ]),
    ]),
    el("div", { class: "session-card-aside" }, [
      el("span", { class: "session-time mono" }, timeSummary(entry)),
      el("div", { class: "session-actions" }, [
        entry.kind === "capture"
          ? el(
              "button",
              {
                type: "button",
                class: "small-btn",
                onclick: () => services.logFrames(entry.record, rerender),
              },
              "Log frames",
            )
          : null,
        el("button", { type: "button", class: "ghost small-btn", onclick: open }, "View"),
        ["capture", "develop", "digitize"].includes(entry.kind)
          ? el(
              "button",
              {
                type: "button",
                class: "ghost small-btn",
                onclick: () => services.editSession(entry.kind, entry.record, rerender),
              },
              "Edit",
            )
          : null,
        ["develop", "digitize"].includes(entry.kind)
          ? el(
              "button",
              {
                type: "button",
                class: "ghost small-btn",
                onclick: () => services.duplicateSession(entry.kind, entry.record, rerender),
              },
              "Duplicate",
            )
          : null,
      ]),
    ]),
  ]);
}

function dayKey(entry: SessionEntry): string {
  const timestamp = sessionTimestamp(entry);
  const date = timestamp ? new Date(timestamp) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-CA") : "unknown";
}

function dayLabel(key: string): { day: string; date: string } {
  if (key === "unknown") return { day: "Date", date: "Not recorded" };
  const date = new Date(`${key}T12:00:00`);
  return {
    day: date.toLocaleDateString([], { weekday: "short" }),
    date: date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
  };
}

function searchText(entry: SessionEntry, services: SessionViewServices): string {
  const references = [
    ...sessionSubjects(entry),
    ...values(entry.record.value, EQUIPMENT_FIELDS[entry.kind]).filter((value) => value.startsWith("at://")),
  ];
  return [
    KIND_LABELS[entry.kind],
    subjectSummary(entry, services),
    processSummary(entry, services),
    ...references.map((uri) => referenceLabel(uri, services)),
    entry.record.value.notes,
    JSON.stringify(entry.record.value),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function isWithinDate(entry: SessionEntry, from: string, to: string): boolean {
  const timestamp = sessionTimestamp(entry);
  if (!timestamp) return !from && !to;
  const time = Date.parse(timestamp);
  if (from && time < Date.parse(`${from}T00:00:00`)) return false;
  if (to && time > Date.parse(`${to}T23:59:59.999`)) return false;
  return true;
}

export function renderSessionsView(
  body: HTMLElement,
  services: SessionViewServices,
  initialScope: SessionScope = "all",
): void {
  const allEntries = collectSessions(services.getStore());
  let scope: SessionScope = SESSION_KINDS.includes(initialScope) ? initialScope : "all";
  let shown = 25;

  const query = el("input", {
    type: "search",
    class: "search-input session-search",
    placeholder: "Search rolls, gear, process, software, or notes…",
    "aria-label": "Search sessions",
  });
  const from = el("input", { type: "date", "aria-label": "Sessions from date" });
  const to = el("input", { type: "date", "aria-label": "Sessions through date" });
  const reviewOnly = el("input", { type: "checkbox" });
  const scopes = el("div", { class: "library-scope-bar session-scopes", "aria-label": "Session type" });
  const activeWork = el("div", { class: "session-active-work" });
  const results = el("div", { class: "session-results", "aria-live": "polite" });
  const summary = el("p", { class: "library-result-summary muted small" });

  const setScope = (next: SessionScope) => {
    scope = next;
    shown = 25;
    services.navigateSessions(next === "all" ? undefined : next);
  };

  const render = () => {
    activeWork.replaceChildren();
    renderActiveWorkflowsView(activeWork, services, render);
    scopes.replaceChildren(
      ...SESSION_KINDS.map((kind) => {
        const count = kind === "all" ? allEntries.length : allEntries.filter((entry) => entry.kind === kind).length;
        return el(
          "button",
          {
            type: "button",
            class: `library-scope${scope === kind ? " active" : ""}`,
            "aria-pressed": String(scope === kind),
            onclick: () => setScope(kind),
          },
          [kind === "all" ? "All" : KIND_LABELS[kind], el("span", { class: "library-scope-count" }, String(count))],
        );
      }),
    );
    const needle = query.value.trim().toLocaleLowerCase();
    const filtered = allEntries.filter(
      (entry) =>
        (scope === "all" || entry.kind === scope) &&
        (!needle || searchText(entry, services).includes(needle)) &&
        isWithinDate(entry, from.value, to.value) &&
        (!reviewOnly.checked || reviewStates(entry).length > 0),
    );
    summary.textContent = `${filtered.length} session${filtered.length === 1 ? "" : "s"}${
      filtered.length !== allEntries.length ? ` in this view · ${allEntries.length} total` : ""
    }`;
    const groups = new Map<string, SessionEntry[]>();
    for (const entry of filtered.slice(0, shown)) {
      const key = dayKey(entry);
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }
    const resultNodes: Node[] = [...groups].map(([key, entries]) => {
      const label = dayLabel(key);
      return el("section", { class: "session-day", "aria-label": label.date }, [
        el("header", { class: "session-day-label" }, [
          el("span", { class: "session-day-name" }, label.day),
          el("span", { class: "session-day-date" }, label.date),
        ]),
        el(
          "div",
          { class: "session-day-list" },
          entries.map((entry) => sessionCard(entry, services, render)),
        ),
      ]);
    });
    if (!filtered.length) {
      resultNodes.push(
        el("div", { class: "empty-state session-empty" }, [
          el(
            "div",
            { class: "empty-title" },
            allEntries.length ? "No sessions match this view" : "Your session history starts here",
          ),
          el(
            "div",
            { class: "empty-hint muted small" },
            allEntries.length
              ? "Try another type, a wider date range, or fewer search terms."
              : "Log a shoot, development, or digitization to create the first event.",
          ),
        ]),
      );
    }
    if (shown < filtered.length) {
      resultNodes.push(
        el(
          "button",
          {
            type: "button",
            class: "ghost session-load-more",
            onclick: () => {
              shown += 25;
              render();
            },
          },
          `Show 25 more (${filtered.length - shown} remaining)`,
        ),
      );
    }
    results.replaceChildren(...resultNodes);
  };

  for (const input of [query, from, to, reviewOnly]) input.addEventListener("input", render);
  const pastWork = el("details", { class: "session-action-menu" }, [
    el("summary", { class: "ghost small-btn" }, "Log past work"),
    el("div", { class: "session-action-popover" }, [
      el(
        "button",
        { type: "button", onclick: () => services.createSession("develop", render) },
        "Log completed development",
      ),
      el("button", { type: "button", onclick: () => services.createSession("digitize", render) }, "Log digitization"),
      el("button", { type: "button", onclick: () => services.linkFrames(render) }, "Link frames to photos"),
    ]),
  ]);
  const activeDevelopment = services.activeDevelopment();
  body.replaceChildren(
    el("div", { class: "session-hero" }, [
      el("div", { class: "session-hero-copy" }, [
        el("h2", {}, "Sessions"),
        el(
          "p",
          { class: "muted" },
          "Start work, resume what is active, or review what you shot, developed, digitized, edited, and printed.",
        ),
      ]),
      el("div", { class: "session-create-actions" }, [
        el(
          "button",
          { type: "button", class: "small-btn", onclick: () => services.createSession("capture", render) },
          "New shoot",
        ),
        el(
          "button",
          { type: "button", class: "ghost small-btn", onclick: () => services.startDevelopment(render) },
          activeDevelopment ? `Resume development (${activeDevelopment.film || "active"})` : "Develop film",
        ),
        pastWork,
      ]),
    ]),
    activeWork,
    scopes,
    el("div", { class: "session-filter-panel" }, [
      field("Search", query),
      el("div", { class: "session-date-fields" }, [
        el("label", { class: "field" }, [el("span", {}, "From"), from]),
        el("label", { class: "field" }, [el("span", {}, "Through"), to]),
      ]),
      el("label", { class: "session-review-toggle" }, [reviewOnly, el("span", {}, "Needs review")]),
    ]),
    summary,
    results,
  );
  render();
}

function readableValue(value: unknown, services: SessionViewServices): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "string") {
    if (value.startsWith("at://")) return referenceLabel(value, services);
    const parsed = Date.parse(value);
    if (/^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(parsed)) return new Date(parsed).toLocaleString();
    return services.enumLabel(value);
  }
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => readableValue(item, services)).join(", ");
  if (typeof value === "object") {
    const measure = value as { value?: unknown; scale?: unknown; unit?: unknown };
    if (typeof measure.value === "number") {
      const scale = typeof measure.scale === "number" && measure.scale ? measure.scale : 1;
      return `${measure.value / scale}${measure.unit ? ` ${measure.unit}` : ""}`;
    }
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${readableValue(nested, services)}`)
      .join("; ");
  }
  return String(value);
}

const DETAIL_OMISSIONS = new Set([
  "$type",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "endedAt",
  "performedAt",
  "notes",
  "provenance",
  "fieldProvenance",
]);

export function renderSessionDetail(body: HTMLElement, entry: SessionEntry, services: SessionViewServices): void {
  const fields = Object.entries(entry.record.value).filter(
    ([key, value]) => !DETAIL_OMISSIONS.has(key) && value != null && value !== "",
  );
  const subjects = sessionSubjects(entry);
  const states = reviewStates(entry);
  const renderAgain = () => {
    const latest = findSession(services.getStore(), entry.kind, recordKey(entry.record));
    if (latest) renderSessionDetail(body, latest, services);
  };
  body.replaceChildren(
    el("div", { class: "session-detail" }, [
      el("div", { class: "session-detail-nav" }, [
        el("button", { type: "button", class: "ghost", onclick: () => services.navigateSessions() }, "← All sessions"),
      ]),
      el("header", { class: "session-detail-head" }, [
        el(
          "span",
          { class: `session-kind-mark large ${entry.kind}`, "aria-hidden": "true" },
          KIND_LABELS[entry.kind].slice(0, 3),
        ),
        el("div", { class: "session-detail-title" }, [
          el("p", { class: "session-detail-time mono" }, readableValue(sessionTimestamp(entry), services)),
          el("h2", {}, `${KIND_LABELS[entry.kind]} session`),
          el("p", { class: "muted" }, subjectSummary(entry, services)),
        ]),
        el("div", { class: "session-actions" }, [
          entry.kind === "capture"
            ? el(
                "button",
                {
                  type: "button",
                  class: "small-btn",
                  onclick: () => services.logFrames(entry.record, renderAgain),
                },
                "Log frames",
              )
            : null,
          ["capture", "develop", "digitize"].includes(entry.kind)
            ? el(
                "button",
                {
                  type: "button",
                  class: "small-btn",
                  onclick: () => services.editSession(entry.kind, entry.record, renderAgain),
                },
                "Edit session",
              )
            : null,
          ["develop", "digitize"].includes(entry.kind)
            ? el(
                "button",
                {
                  type: "button",
                  class: "ghost small-btn",
                  onclick: () => services.duplicateSession(entry.kind, entry.record, renderAgain),
                },
                "Duplicate",
              )
            : null,
        ]),
      ]),
      states.length
        ? el("aside", { class: "session-review-callout" }, [
            el("strong", {}, "Review needed"),
            el("span", {}, states.join(" · ")),
          ])
        : null,
      el("div", { class: "session-detail-grid" }, [
        el("section", { class: "card session-detail-section" }, [
          el("h3", {}, "Subjects and relationships"),
          subjects.length
            ? el(
                "ul",
                { class: "session-relationship-list" },
                subjects.map((uri) => el("li", {}, referenceLabel(uri, services))),
              )
            : el("p", { class: "muted small" }, "No subjects are linked to this session."),
        ]),
        el("section", { class: "card session-detail-section" }, [
          el("h3", {}, "Timing"),
          el("dl", { class: "session-definition-list" }, [
            el("dt", {}, "Started"),
            el("dd", {}, readableValue(sessionStart(entry), services)),
            el("dt", {}, "Finished"),
            el("dd", {}, readableValue(sessionEnd(entry), services)),
            el("dt", {}, "Duration"),
            el("dd", {}, timeSummary(entry).split(" · ")[1] || "Not recorded"),
          ]),
        ]),
      ]),
      el("section", { class: "card session-detail-section" }, [
        el("h3", {}, "Process details"),
        fields.length
          ? el(
              "dl",
              { class: "session-definition-list process" },
              fields.flatMap(([key, value]) => [
                el(
                  "dt",
                  {},
                  key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
                ),
                el("dd", {}, readableValue(value, services)),
              ]),
            )
          : el("p", { class: "muted small" }, "No process details were recorded."),
      ]),
      entry.record.value.notes
        ? el("section", { class: "card session-detail-section" }, [
            el("h3", {}, "Notes"),
            el("p", { class: "session-notes" }, String(entry.record.value.notes)),
          ])
        : null,
      el("details", { class: "card session-evidence" }, [
        el("summary", {}, [el("span", {}, "Evidence and provenance"), provenanceChip(entry)]),
        el("dl", { class: "session-definition-list" }, [
          el("dt", {}, "Source"),
          el("dd", {}, provenanceLabel(entry.record.value)),
          el("dt", {}, "Confidence"),
          el("dd", {}, String(entry.record.value.provenance?.confidence || "Not recorded")),
          el("dt", {}, "Asserted"),
          el("dd", {}, readableValue(entry.record.value.provenance?.assertedAt, services)),
          el("dt", {}, "Evidence note"),
          el("dd", {}, String(entry.record.value.provenance?.note || "Not recorded")),
        ]),
        Array.isArray(entry.record.value.fieldProvenance) && entry.record.value.fieldProvenance.length
          ? el("div", { class: "session-field-provenance" }, [
              el("h4", {}, "Value and relationship evidence"),
              ...entry.record.value.fieldProvenance.map((item: LibraryValue) =>
                el("div", { class: "session-evidence-row" }, [
                  el("strong", {}, String(item.field || item.target?.field || "Value")),
                  el("span", {}, provenanceLabel({ provenance: item.provenance || {} })),
                  item.relationship
                    ? el("span", { class: "muted small" }, referenceLabel(String(item.relationship), services))
                    : null,
                ]),
              ),
            ])
          : null,
        services.isAdvanced()
          ? el(
              "button",
              { type: "button", class: "ghost small-btn", onclick: () => services.inspect(entry.record) },
              "View raw record",
            )
          : null,
      ]),
    ]),
  );
}

export function findSession(store: LibraryStore, kind: SessionKind, rkey: string): SessionEntry | undefined {
  return collectSessions(store).find((entry) => entry.kind === kind && recordKey(entry.record) === rkey);
}
