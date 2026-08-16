import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInsightsView } from "../apps/web/src/views/library/insights-view.ts";
import { openLabDevelopment, openManualDevelopment } from "../apps/web/src/views/library/maintenance-darkroom.ts";
import {
  createCatalogSelect,
  createChemistrySelect,
  createInstanceSelect,
  createShootSelect,
} from "../apps/web/src/views/library/maintenance-selectors.ts";
import { openFrameLinker } from "../apps/web/src/views/library/scanning-linker.ts";
import { openScanSession } from "../apps/web/src/views/library/scanning-view.ts";
import { renderRollBoard } from "../apps/web/src/views/library/workflows-board.ts";
import {
  openWorkflowTemplate,
  renderRulesView,
  renderWorkflowsView,
} from "../apps/web/src/views/library/workflows-view.ts";

const item = (uri, value) => ({ uri, value });

function emptyStore(overrides = {}) {
  return {
    catalog: {},
    instance: {},
    byUri: new Map(),
    workflowTemplates: [],
    developSessions: [],
    digitizeSessions: [],
    batchRules: [],
    photoCaptureByPhoto: new Map(),
    shoots: [],
    ...overrides,
  };
}

function createServices(store, overrides = {}) {
  return {
    collections: {
      workflowTemplate: "workflow-template",
      developSession: "develop-session",
      filmRoll: "film-roll",
      chemistry: "chemistry",
      digitizeSession: "digitize-session",
      exposure: "exposure",
    },
    stageLabels: {
      capture: "Capture",
      develop: "Develop",
      digitize: "Digitize",
      digital: "Render/export",
      print: "Print",
      edit: "Edit",
      output: "Output",
      other: "Other",
    },
    mediums: ["film", "digital"],
    getStore: () => store,
    reloadStore: vi.fn(async () => {}),
    saveRecord: vi.fn(async () => "at://saved"),
    deleteRecord: vi.fn(async () => {}),
    saveWorkflowTemplate: vi.fn(async () => "at://template"),
    instanceLabel: (_kind, value) => value?.nickname || value?.label || value?.name || "Item",
    catalogLabel: (_kind, value) => value.name || value.model || "Catalog item",
    chemistryRoles: (value) => value.roles || [],
    enumLabel: (value) => value,
    kindLabelPlural: (kind) => `${kind}s`,
    icon: (name) => document.createTextNode(name),
    isAdvanced: () => false,
    inspect: vi.fn(),
    activeDevelopment: () => null,
    openDevelopmentTimer: vi.fn(async () => {}),
    capturePhotos: vi.fn(async () => []),
    blobUrl: vi.fn(async () => "blob:photo"),
    computeLintFindings: () => [],
    reserveQuantity: (value) => Number(value.quantity) || 0,
    filmStockLabel: () => "Tri-X",
    ...overrides,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("extracted library activity views", () => {
  it("renders active workflow actions, including parallel logging and optional skipping", () => {
    const stage = item("at://stage/print", {
      $type: "app.graycard.workflow#printStage",
      optional: true,
      status: "ready",
    });
    const run = item("at://run/one", {
      templateName: "Negative to print",
      status: "ready",
      subjects: [{ kind: "film-negative", label: "Roll 12" }],
      stages: [{ stage: stage.uri, position: 0 }],
    });
    const store = emptyStore({ workflowRuns: [run], workflowStages: [stage] });
    const openWorkflowStageLogger = vi.fn();
    const skipWorkflowStage = vi.fn(async () => {});
    const services = createServices(store, {
      workflowActions: () => [stage],
      openWorkflowStageLogger,
      skipWorkflowStage,
      cancelWorkflowRun: vi.fn(async () => {}),
    });
    const body = document.createElement("main");
    renderWorkflowsView(body, services, vi.fn());
    expect(body.textContent).toContain("Active workflows");
    expect(body.textContent).toContain("Roll 12 · 0/1 complete");
    [...body.querySelectorAll("button")].find((button) => button.textContent === "Log Print").click();
    [...body.querySelectorAll("button")].find((button) => button.textContent === "Skip Print").click();
    expect(openWorkflowStageLogger).toHaveBeenCalledWith(run, stage, expect.any(Function));
    expect(skipWorkflowStage).toHaveBeenCalledWith(run, stage, expect.any(Function));
    expect([...body.querySelectorAll("button")].some((button) => button.textContent === "Cancel")).toBe(true);
  });

  it("builds catalog, instance, chemistry-role, and shoot selectors from injected store data", () => {
    const store = emptyStore({
      catalog: { lab: [item("at://lab", { name: "Praus" })] },
      instance: {
        camera: [item("at://camera", { nickname: "F3" })],
        chemistry: [item("at://fixer", { nickname: "Rapid Fixer", roles: ["fixer"] })],
      },
      shoots: [item("at://shoot", { label: "Walk" })],
    });
    const services = createServices(store);
    expect(createCatalogSelect("lab", "at://lab", services).selectedOptions[0].textContent).toBe("Praus");
    expect(createInstanceSelect("camera", "at://camera", services).selectedOptions[0].textContent).toBe("F3");
    const chemicals = createChemistrySelect("at://fixer", ["fixer"], services);
    expect(chemicals.selectedOptions[0].textContent).toBe("[fixer] Rapid Fixer");
    expect(createShootSelect("at://shoot", services).selectedOptions[0].textContent).toBe("Walk");
  });

  it("saves workflow templates with ordered stages and injected selectors", async () => {
    const store = emptyStore({
      instance: { camera: [], lens: [], filmRoll: [], chemistry: [], scanner: [] },
    });
    const services = createServices(store);
    openWorkflowTemplate(null, undefined, services);
    document.querySelector('[data-key="name"]').value = "Film workflow";
    const picker = document.querySelector('[aria-label="Stage to add to template steps"]');
    const add = [...document.querySelectorAll("button")].find((button) => button.textContent === "Add step");
    picker.value = "capture";
    add.click();
    picker.value = "develop";
    add.click();
    document.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveWorkflowTemplate).toHaveBeenCalledTimes(1));
    expect(services.saveWorkflowTemplate.mock.calls[0][0]).toMatchObject({
      name: "Film workflow",
      medium: "film",
      stageKinds: ["capture", "develop"],
    });
    expect(services.reloadStore).toHaveBeenCalled();
  });

  it("keeps repeated template steps ordered with occurrence-level defaults", async () => {
    const chemistry = item("at://chemistry", { nickname: "D-76", roles: ["film-developer"] });
    const store = emptyStore({
      instance: { camera: [], lens: [], filmRoll: [], chemistry: [chemistry], scanner: [] },
      byUri: new Map([[chemistry.uri, { layer: "instance", kind: "chemistry", item: chemistry }]]),
    });
    const services = createServices(store);
    openWorkflowTemplate(
      item("at://template", {
        name: "Two bath",
        medium: "film",
        stageKinds: ["develop"],
        stageDefaults: [{ kind: "develop", fields: { chemistry: chemistry.uri } }],
        createdAt: "2026-01-01T00:00:00Z",
      }),
      undefined,
      services,
    );
    document.querySelector('[aria-label="Duplicate Develop, step 1"]').click();
    expect(document.querySelectorAll(".workflow-step")).toHaveLength(2);
    expect(document.querySelector('[role="status"]').textContent).toMatch(/duplicated develop/i);
    document.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveWorkflowTemplate).toHaveBeenCalledTimes(1));
    expect(services.saveWorkflowTemplate.mock.calls[0][0]).toMatchObject({
      stageKinds: ["develop", "develop"],
      stageDefaults: [
        { kind: "develop", fields: { chemistry: chemistry.uri } },
        { kind: "develop", fields: { chemistry: chemistry.uri } },
      ],
      defaultChemistry: chemistry.uri,
    });
  });

  it("keeps optional step cardinality consistent while configuring a workflow", () => {
    const store = emptyStore({ instance: { camera: [], lens: [], filmRoll: [], chemistry: [], scanner: [] } });
    const services = createServices(store);
    openWorkflowTemplate(
      item("at://template", {
        name: "Optional development",
        medium: "film",
        stageKinds: ["develop"],
        createdAt: "2026-01-01T00:00:00Z",
      }),
      undefined,
      services,
    );
    document.querySelector('[aria-label="Configure Develop, step 1"]').click();
    const dialog = [...document.querySelectorAll(".modal")].find((modal) =>
      modal.querySelector("h2")?.textContent?.includes("Configure: Develop"),
    );
    const optional = dialog.querySelector("#workflow-step-optional");
    const minimum = [...dialog.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Minimum times"))
      .querySelector("input");

    expect(minimum.value).toBe("1");
    optional.click();
    expect(minimum.value).toBe("0");
    optional.click();
    expect(minimum.value).toBe("1");
  });

  it("authors an explicit branch between stable template step IDs", async () => {
    const store = emptyStore({ instance: { camera: [], lens: [], filmRoll: [], chemistry: [], scanner: [] } });
    const services = createServices(store);
    openWorkflowTemplate(null, undefined, services);
    document.querySelector('[data-key="name"]').value = "Two exports";
    const picker = document.querySelector('[aria-label="Stage to add to template steps"]');
    const add = [...document.querySelectorAll("button")].find((button) => button.textContent === "Add step");
    for (const kind of ["edit", "output", "output"]) {
      picker.value = kind;
      add.click();
    }
    const source = document.querySelector('[aria-label="Connection source step and port"]');
    const target = document.querySelector('[aria-label="Connection destination step and port"]');
    const connect = [...document.querySelectorAll("button")].find((button) => button.textContent === "Connect");
    source.selectedIndex = 0;
    target.selectedIndex = 1;
    connect.click();
    const sourceAgain = document.querySelector('[aria-label="Connection source step and port"]');
    const targetAgain = document.querySelector('[aria-label="Connection destination step and port"]');
    sourceAgain.selectedIndex = 0;
    targetAgain.selectedIndex = 2;
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Connect").click();
    document.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveWorkflowTemplate).toHaveBeenCalledTimes(1));
    const saved = services.saveWorkflowTemplate.mock.calls[0][0];
    expect(new Set(saved.steps.map((step) => step.id)).size).toBe(3);
    expect(saved.connections).toHaveLength(2);
    expect(saved.connections[0].fromStep).toBe(saved.connections[1].fromStep);
    expect(saved.connections[0].toStep).not.toBe(saved.connections[1].toStep);
  });

  it("logs lab development and advances every selected roll", async () => {
    const lab = item("at://lab-account", { nickname: "Praus" });
    const roll = item("at://roll", { label: "Roll 1", status: "exposed", createdAt: "2026-01-01T00:00:00Z" });
    const store = emptyStore({
      instance: { labAccount: [lab], filmRoll: [roll] },
      byUri: new Map([[lab.uri, { layer: "instance", kind: "labAccount", item: lab }]]),
    });
    const services = createServices(store);
    openLabDevelopment(undefined, services);
    const modal = document.querySelector(".modal");
    [...modal.querySelectorAll("label")]
      .find((label) => label.querySelector("span")?.textContent === "Lab")
      ?.querySelector("select")
      .setAttribute("data-lab", "");
    modal.querySelector('[data-lab=""]').value = lab.uri;
    modal.querySelector(`input[value="${roll.uri}"]`).checked = true;
    [...modal.querySelectorAll("label")]
      .find((label) => label.querySelector("span")?.textContent === "Push / pull")
      ?.querySelector("select")
      .setAttribute("data-push", "");
    modal.querySelector('[data-push=""]').value = "+1";
    modal.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveRecord).toHaveBeenCalledTimes(2));
    expect(services.saveRecord.mock.calls[0][0]).toBe("develop-session");
    expect(services.saveRecord.mock.calls[0][1]).toMatchObject({
      lab: lab.uri,
      labService: "Praus",
      filmRolls: [roll.uri],
      pushPull: { unit: "stop", value: 1, scale: 1 },
    });
    expect(services.saveRecord.mock.calls[1]).toEqual([
      "film-roll",
      expect.objectContaining({
        status: "developed",
        lab: lab.uri,
        finishedAt: expect.any(String),
        developedAt: expect.any(String),
        developmentLocation: "lab",
      }),
      roll,
    ]);
  });

  it("logs completed development with roll, chemistry, time, and structured agitation", async () => {
    const chemistry = item("at://chemistry", {
      nickname: "D-76 1+1",
      roles: ["film-developer"],
      rollsProcessed: 2,
      sessionsUsed: 1,
    });
    const fixer = item("at://fixer", { nickname: "Rapid Fixer", roles: ["fixer"], rollsProcessed: 4 });
    const roll = item("at://roll", { label: "Roll 1", status: "exposed", createdAt: "2026-01-01T00:00:00Z" });
    const store = emptyStore({
      instance: { chemistry: [chemistry, fixer], filmRoll: [roll] },
      byUri: new Map([
        [chemistry.uri, { layer: "instance", kind: "chemistry", item: chemistry }],
        [fixer.uri, { layer: "instance", kind: "chemistry", item: fixer }],
      ]),
    });
    const advanceWorkflowStage = vi.fn(async () => 1);
    const services = createServices(store, { advanceWorkflowStage });
    openManualDevelopment(undefined, services, { selectedRolls: [roll.uri] });
    const modal = document.querySelector(".modal");
    const fieldControl = (root, label) =>
      [...root.querySelectorAll("label.field")]
        .find((candidate) => candidate.querySelector(":scope > span")?.textContent === label)
        .querySelector("input,select,textarea");
    const developerStage = modal.querySelector(".development-stage-card");
    developerStage.querySelector('[aria-label="Primary chemistry for stage"]').value = chemistry.uri;
    fieldControl(developerStage, "Actual minutes").value = "9";
    fieldControl(developerStage, "Actual seconds").value = "30";
    fieldControl(developerStage, "Agitation method").value = "inversion";
    fieldControl(developerStage, "Initial agitation (seconds)").value = "30";
    fieldControl(developerStage, "Agitate every (seconds)").value = "60";
    fieldControl(developerStage, "Agitate for (seconds)").value = "10";
    fieldControl(developerStage, "Inversions per cycle").value = "4";

    modal.querySelector('[aria-label="Development stage to add"]').value = "fixer";
    [...modal.querySelectorAll("button")].find((button) => button.textContent === "+ Add stage").click();
    const fixerStage = modal.querySelectorAll(".development-stage-card")[1];
    fixerStage.querySelector('[aria-label="Primary chemistry for stage"]').value = fixer.uri;
    fieldControl(fixerStage, "Actual minutes").value = "5";
    modal.querySelector(".modal-actions button:not(.ghost)").click();

    await vi.waitFor(() => expect(services.saveRecord).toHaveBeenCalledTimes(4));
    expect(services.saveRecord.mock.calls[0]).toEqual([
      "develop-session",
      expect.objectContaining({
        filmRolls: [roll.uri],
        tankType: "tank",
        steps: [
          expect.objectContaining({
            roles: ["film-developer"],
            chemistries: [chemistry.uri],
            actualTimeSeconds: 570,
            agitationMethod: "inversion",
            agitationScheme: {
              initialSec: 30,
              everySec: 60,
              forSec: 10,
              inversions: 4,
              continuous: undefined,
              note: undefined,
            },
          }),
          expect.objectContaining({
            roles: ["fixer"],
            chemistries: [fixer.uri],
            actualTimeSeconds: 300,
          }),
        ],
      }),
      null,
    ]);
    expect(services.saveRecord.mock.calls[1]).toEqual([
      "film-roll",
      expect.objectContaining({
        status: "developed",
        developedWith: chemistry.uri,
        developmentLocation: "home",
        developedAt: expect.any(String),
      }),
      roll,
    ]);
    expect(services.saveRecord.mock.calls[2]).toEqual([
      "chemistry",
      expect.objectContaining({ rollsProcessed: 3, sessionsUsed: 2, lastUsedAt: expect.any(String) }),
      chemistry,
    ]);
    expect(services.saveRecord.mock.calls[3]).toEqual([
      "chemistry",
      expect.objectContaining({ rollsProcessed: 5, sessionsUsed: 1, lastUsedAt: expect.any(String) }),
      fixer,
    ]);
    expect(advanceWorkflowStage).toHaveBeenCalledWith("develop", [roll.uri], "at://saved");
  });

  it("writes schema-shaped scan sessions", async () => {
    const roll = item("at://roll", { label: "Roll 1" });
    const scanner = item("at://scanner", { nickname: "V850" });
    const store = emptyStore({ instance: { filmRoll: [roll], scanner: [scanner] } });
    const services = createServices(store);
    openScanSession(undefined, services);
    const modal = document.querySelector(".modal");
    const fields = Object.fromEntries(
      [...modal.querySelectorAll("label.field")].map((label) => [
        label.querySelector("span").textContent,
        label.querySelector("input,select"),
      ]),
    );
    fields.Roll.value = roll.uri;
    fields.Scanner.value = scanner.uri;
    fields.Software.value = "VueScan";
    fields["Resolution (dpi)"].value = "3200";
    fields["File format"].value = "TIFF";
    modal.querySelector(".modal-actions button:not(.ghost)").click();
    await vi.waitFor(() => expect(services.saveRecord).toHaveBeenCalledTimes(2));
    expect(services.saveRecord.mock.calls[0]).toEqual([
      "digitize-session",
      expect.objectContaining({
        scanner: scanner.uri,
        software: "VueScan",
        fileFormat: "TIFF",
        resolution: { unit: "dpi", value: 3200, scale: 1 },
        filmRolls: [roll.uri],
      }),
      null,
    ]);
    expect(services.saveRecord.mock.calls[1]).toEqual([
      "film-roll",
      expect.objectContaining({ status: "scanned", scannedAt: expect.any(String) }),
      roll,
    ]);
  });

  it("auto-links frame records to loaded photos through injected persistence", async () => {
    const roll = item("at://roll", { label: "Roll 1" });
    const exposure = item("at://exposure", { roll: roll.uri, frameNumber: 1 });
    const photo = item("at://photo", { alt: "Scan one", photo: { ref: { $link: "blob" } } });
    const store = emptyStore({ instance: { filmRoll: [roll], exposure: [exposure] } });
    const services = createServices(store, { capturePhotos: vi.fn(async () => [photo]) });
    openFrameLinker(undefined, services);
    const modal = document.querySelector(".modal");
    const rollSelect = modal.querySelector("select");
    rollSelect.value = roll.uri;
    rollSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(
        [...modal.querySelectorAll("button")].some(
          (button) => button.textContent === "Auto-match in order" && !button.disabled,
        ),
      ).toBe(true),
    );
    [...modal.querySelectorAll("button")].find((button) => button.textContent === "Auto-match in order").click();
    [...modal.querySelectorAll("button")].find((button) => button.textContent === "Save links").click();
    await vi.waitFor(() => expect(services.saveRecord).toHaveBeenCalledTimes(1));
    expect(services.saveRecord).toHaveBeenCalledWith(
      "exposure",
      expect.objectContaining({ photo: photo.uri }),
      exposure,
    );
  });

  it("renders rule findings, roll-board reserve totals, and insights from one store snapshot", () => {
    const camera = item("at://camera", { nickname: "F3" });
    const chemistry = item("at://chemistry", {
      nickname: "Fixer",
      volumeMl: 1000,
      volumeRemainingMl: 500,
      rollsProcessed: 2,
    });
    const roll = item("at://roll", { label: "Roll 1", status: "developed" });
    const reserve = item("at://reserve", { stock: "at://stock", quantity: 3 });
    const capture = item("at://capture", { camera: camera.uri });
    const store = emptyStore({
      catalog: { filmStock: [item("at://stock", { name: "Tri-X" })] },
      instance: { camera: [camera], lens: [], filmRoll: [roll], filmStockpile: [reserve], chemistry: [chemistry] },
      byUri: new Map([[camera.uri, { layer: "instance", kind: "camera", item: camera }]]),
      batchRules: [item("at://rule", { name: "Normalize dates" })],
      photoCaptureByPhoto: new Map([["at://photo", capture]]),
    });
    const services = createServices(store, {
      computeLintFindings: () => [{ title: "Review", detail: "One issue", severity: "info", count: 1 }],
    });
    const body = document.createElement("div");
    renderRulesView(body, services);
    renderRollBoard(body, services);
    renderInsightsView(body, services);
    expect(body.textContent).toContain("Review");
    expect(body.textContent).toContain("Normalize dates");
    expect(body.textContent).toContain("3 in reserve");
    expect(body.textContent).toContain("Chemistry status");
    expect(body.textContent).toContain("Most used");
  });

  it("renders workflow completion and next action on a roll", () => {
    const roll = item("at://roll", { label: "Roll 9", status: "developed" });
    const capture = item("at://stage/capture", {
      $type: "app.graycard.workflow#captureStage",
      filmRoll: roll.uri,
    });
    const develop = item("at://stage/develop", {
      $type: "app.graycard.workflow#developStage",
      session: "at://session/develop",
    });
    const digitize = item("at://stage/digitize", {
      $type: "app.graycard.workflow#digitizeStage",
      session: "at://session/digitize",
    });
    const developSession = item("at://session/develop", { finishedAt: "2026-01-02T00:00:00Z" });
    const digitizeSession = item("at://session/digitize", { filmRolls: [roll.uri] });
    const run = item("at://run", {
      stages: [
        { stage: capture.uri, position: 0 },
        { stage: develop.uri, position: 1 },
        { stage: digitize.uri, position: 2 },
      ],
    });
    const store = emptyStore({
      instance: { filmRoll: [roll], filmStockpile: [] },
      workflowRuns: [run],
      workflowStages: [capture, develop, digitize],
      byUri: new Map([
        [developSession.uri, { layer: "other", item: developSession }],
        [digitizeSession.uri, { layer: "other", item: digitizeSession }],
      ]),
    });
    const body = document.createElement("div");
    renderRollBoard(body, createServices(store));
    expect(body.textContent).toContain("2/3 · Next: Digitize");
    const progress = body.querySelector('[role="progressbar"]');
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuemax")).toBe("3");
  });
});
