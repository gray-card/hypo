import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSessions,
  findSession,
  renderSessionDetail,
  renderSessionsView,
} from "../apps/web/src/views/sessions/session-view.ts";

const record = (kind: string, rkey: string, value: Record<string, any>) => ({
  uri: `at://did:plc:test/app.graycard.${kind}/${rkey}`,
  rkey,
  value,
});

function store() {
  const roll = record("instance.filmRoll", "roll-a", { label: "Roll A", status: "exposed" });
  const scanner = record("instance.scanner", "scanner-a", { nickname: "V850" });
  const byUri = new Map([
    [roll.uri, { layer: "instance", kind: "filmRoll", item: roll }],
    [scanner.uri, { layer: "instance", kind: "scanner", item: scanner }],
  ]);
  return {
    catalog: {},
    instance: { filmRoll: [roll], scanner: [scanner] },
    byUri,
    workflowTemplates: [],
    workflowRuns: [],
    workflowStages: [],
    batchRules: [],
    photoCaptureByPhoto: new Map(),
    shoots: [
      record("session.capture", "shoot", {
        label: "Sunday walk",
        rolls: [roll.uri],
        startedAt: "2026-09-20T12:00:00Z",
        createdAt: "2026-09-20T12:00:00Z",
      }),
    ],
    developSessions: [
      record("process.developSession", "dev", {
        filmRolls: [roll.uri],
        process: "bw",
        finishedAt: "2026-09-20T14:00:00Z",
        createdAt: "2026-09-20T14:00:00Z",
        provenance: { source: "observed", confidence: "certain" },
      }),
    ],
    digitizeSessions: [
      record("process.digitizeSession", "scan", {
        filmRolls: [roll.uri],
        scanner: scanner.uri,
        method: "flatbed-negative",
        finishedAt: "2026-09-20T16:00:00Z",
        createdAt: "2026-09-20T16:00:00Z",
      }),
    ],
    editSessions: [
      record("process.editSession", "edit", {
        parentPhoto: "at://did:plc:test/social.grain.photo/photo",
        software: "Darktable",
        createdAt: "2026-09-19T12:00:00Z",
      }),
    ],
    printSessions: [
      record("process.printSession", "print", {
        filmRoll: roll.uri,
        printProcess: "darkroom",
        createdAt: "2026-09-18T12:00:00Z",
      }),
    ],
    renderSessions: [
      record("process.renderSession", "render", {
        sourceArtifacts: ["at://did:plc:test/app.graycard.artifact/source"],
        outputFormat: "TIFF",
        createdAt: "2026-09-17T12:00:00Z",
      }),
    ],
    maintenanceSessions: [
      record("process.maintenanceSession", "clean", {
        subject: scanner.uri,
        kind: "cleaning",
        performedAt: "2026-09-16T12:00:00Z",
        createdAt: "2026-09-16T12:00:00Z",
      }),
    ],
  };
}

function services(data = store()) {
  return {
    collections: {},
    stageLabels: {},
    mediums: [],
    getStore: () => data,
    reloadStore: vi.fn(),
    saveRecord: vi.fn(),
    deleteRecord: vi.fn(),
    saveWorkflowTemplate: vi.fn(),
    instanceLabel: (_kind: string, value: Record<string, any>) => value?.nickname || value?.label || "Item",
    catalogLabel: (_kind: string, value: Record<string, any>) => value?.name || "Catalog item",
    chemistryRoles: () => [],
    enumLabel: (value: string) => value.replaceAll("-", " "),
    kindLabelPlural: (kind: string) => `${kind}s`,
    icon: () => document.createTextNode(""),
    isAdvanced: () => true,
    inspect: vi.fn(),
    activeDevelopment: () => null,
    openDevelopmentTimer: vi.fn(),
    capturePhotos: vi.fn(),
    blobUrl: vi.fn(),
    computeLintFindings: () => [],
    reserveQuantity: () => 0,
    filmStockLabel: () => "Film",
    navigateSessions: vi.fn(),
    navigateSession: vi.fn(),
    editSession: vi.fn(),
    duplicateSession: vi.fn(),
    createSession: vi.fn(),
  } as any;
}

beforeEach(() => document.body.replaceChildren());

describe("sessions workspace", () => {
  it("collects every event family into one newest-first timeline", () => {
    const entries = collectSessions(store() as any);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "digitize",
      "develop",
      "capture",
      "edit",
      "print",
      "render",
      "maintenance",
    ]);
    expect(findSession(store() as any, "digitize", "scan")?.record.value.method).toBe("flatbed-negative");
  });

  it("renders subjects, review states, search, scope counts, and explicit pagination", () => {
    const data = store();
    data.digitizeSessions = Array.from({ length: 30 }, (_, index) =>
      record("process.digitizeSession", `scan-${index}`, {
        filmRolls: [data.instance.filmRoll[0].uri],
        method: index === 29 ? "drum-scanner" : "flatbed-negative",
        notes: index === 29 ? "special archive scan" : "contact scan",
        createdAt: new Date(Date.parse("2026-09-20T16:00:00Z") - index * 1000).toISOString(),
      }),
    );
    const body = document.createElement("main");
    renderSessionsView(body, services(data) as any);
    expect(body.querySelectorAll(".session-card")).toHaveLength(25);
    expect(body.textContent).toContain("36 sessions");
    expect(body.textContent).toContain("Roll A");
    expect(body.textContent).toContain("Missing completion time");

    (body.querySelector(".session-search") as HTMLInputElement).value = "special archive";
    body.querySelector(".session-search")?.dispatchEvent(new Event("input"));
    expect(body.querySelectorAll(".session-card")).toHaveLength(1);
    expect(body.textContent).toContain("drum scanner");
  });

  it("shows a human-readable session detail with progressive evidence", () => {
    const data = store();
    const service = services(data);
    const entry = findSession(data as any, "develop", "dev")!;
    entry.record.value.fieldProvenance = [
      {
        field: "/filmRolls",
        relationship: data.instance.filmRoll[0].uri,
        provenance: { source: "inferred", confidence: "likely" },
      },
    ];
    const body = document.createElement("main");
    renderSessionDetail(body, entry, service as any);
    expect(body.textContent).toContain("Development session");
    expect(body.textContent).toContain("Roll A");
    expect(body.textContent).toContain("Subjects and relationships");
    expect(body.textContent).toContain("Evidence and provenance");
    (body.querySelector("details.session-evidence") as HTMLDetailsElement).open = true;
    expect(body.textContent).toContain("Value and relationship evidence");
    expect(body.textContent).toContain("Inferred");
  });

  it("does not present a creation timestamp as a missing completion time", () => {
    const data = store();
    const body = document.createElement("main");
    renderSessionDetail(body, findSession(data as any, "capture", "shoot")!, services(data) as any);
    const timing = [...body.querySelectorAll(".session-detail-grid dd")].map((node) => node.textContent);

    expect(timing[0]).not.toBe("Not recorded");
    expect(timing.slice(1)).toEqual(["Not recorded", "Not recorded"]);
  });
});
