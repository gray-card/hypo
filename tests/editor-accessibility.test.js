import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  detail: null,
  store: null,
  workflowByPhoto: new Map(),
  scrollIntoView: vi.fn(),
}));

vi.mock("../src/grain.js", async (importOriginal) => ({
  ...(await importOriginal()),
  blobUrl: vi.fn(async () => "blob:photo"),
  getGalleryDetail: vi.fn(async () => harness.detail),
}));

vi.mock("../src/ui/library.js", () => ({
  refreshStore: vi.fn(async () => harness.store),
  instanceSelect: vi.fn(() => document.createElement("select")),
  shootSelect: vi.fn(() => document.createElement("select")),
  openAddGear: vi.fn(),
}));

vi.mock("../src/graycard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolvePhotoCapture: vi.fn(() => ({})),
  matchGear: vi.fn(() => ({ camera: null, lens: null })),
}));

vi.mock("../src/ui/mapView.js", () => ({
  locationField: vi.fn(() => ({ node: document.createElement("div"), get: () => undefined })),
}));

vi.mock("../src/data/gearImage.js", () => ({
  gearThumb: vi.fn(() => ({
    thumb: Object.assign(document.createElement("div"), { ariaHidden: "true" }),
    refresh: vi.fn(),
  })),
}));

vi.mock("../src/workflow.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getRunForPhoto: vi.fn((_store, photoUri) => harness.workflowByPhoto.get(photoUri) || null),
}));

const { initEditor, openGallery } = await import("../src/ui/editor.ts");

const GALLERY = "at://did:plc:test/social.grain.gallery/gallery";

function photo(rkey, alt, position) {
  const uri = `at://did:plc:test/social.grain.photo/${rkey}`;
  return {
    photo: { uri, cid: `cid-${rkey}`, value: { photo: { ref: { $link: `blob-${rkey}` } }, alt } },
    item: {
      uri: `at://did:plc:test/social.grain.gallery.item/${rkey}`,
      cid: `item-${rkey}`,
      value: { item: uri, position },
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <section id="editor-view">
      <div id="editor-hero"></div>
      <div id="editor-body"></div>
    </section>
  `;
  localStorage.clear();
  harness.scrollIntoView.mockClear();
  harness.workflowByPhoto.clear();
  HTMLElement.prototype.scrollIntoView = harness.scrollIntoView;
  harness.store = {
    batchRules: [],
    workflowTemplates: [],
    photoWorkflowByPhoto: new Map(),
    sceneGraphByPhoto: new Map(),
    photoCaptureByPhoto: new Map(),
    galleryDefaultsByGallery: new Map(),
    byUri: new Map(),
    catalog: {},
    instance: {},
    workflowRuns: [],
    workflowStages: [],
  };
  harness.detail = {
    gallery: { uri: GALLERY, cid: "gallery-cid", value: { title: "Test gallery", description: "" } },
    photos: [photo("sunset", "  Sunset over Lake Ontario  ", 0), photo("unlabelled", "", 1)],
  };
  initEditor({ agent: {}, did: "did:plc:test", store: harness.store, detail: harness.detail, galleryUri: GALLERY });
});

describe("editor photo grid accessibility", () => {
  it("names content thumbnails and exposes keyboard-operable grid controls", async () => {
    await openGallery(GALLERY);
    await vi.waitFor(() => expect(document.querySelectorAll("#photos .thumb img")).toHaveLength(2));

    expect([...document.querySelectorAll("#photos .thumb img")].map((image) => image.alt)).toEqual([
      "Sunset over Lake Ontario",
      "Photo 2",
    ]);
    expect([...document.querySelectorAll(".photo-select")].map((input) => input.getAttribute("aria-label"))).toEqual([
      "Select Sunset over Lake Ontario",
      "Select Photo 2",
    ]);

    const list = document.querySelector('button[aria-label="List view"]');
    const grid = document.querySelector('button[aria-label="Grid view"]');
    expect(grid.closest('[role="group"]').getAttribute("aria-label")).toBe("Photo layout");
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(grid.getAttribute("aria-pressed")).toBe("false");

    grid.click();
    expect(list.getAttribute("aria-pressed")).toBe("false");
    expect(grid.getAttribute("aria-pressed")).toBe("true");
    const controls = [...document.querySelectorAll("[data-grid-photo-control]")];
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Edit Sunset over Lake Ontario",
      "Edit Photo 2",
    ]);
    expect(controls.every((control) => control.getAttribute("role") === "button" && control.tabIndex === 0)).toBe(true);

    controls[1].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(document.querySelector("#photos").classList.contains("grid-mode")).toBe(false);
    expect(harness.scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    grid.click();
    const results = await axe.run(document.querySelector("#photos"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("exposes ordered workflow controls and expandable per-photo progress", async () => {
    const photoUri = harness.detail.photos[0].photo.uri;
    const developSession = { uri: "at://session/develop", value: { finishedAt: "2026-01-02T00:00:00Z" } };
    harness.store.byUri.set(developSession.uri, { layer: "other", item: developSession });
    harness.store.workflowTemplates = [
      {
        uri: "at://template/branch",
        value: {
          name: "Branch",
          connections: [
            { id: "edit", fromStep: "develop", fromPort: "output", toStep: "edit", toPort: "input" },
            { id: "publish", fromStep: "develop", fromPort: "output", toStep: "output", toPort: "input" },
          ],
        },
      },
    ];
    harness.workflowByPhoto.set(photoUri, {
      run: { uri: "at://run", value: { branches: [], template: "at://template/branch", status: "in-progress" } },
      stages: [
        {
          uri: "at://stage/capture",
          value: { $type: "app.graycard.workflow#captureStage", templateStepId: "capture" },
        },
        {
          uri: "at://stage/develop",
          value: {
            $type: "app.graycard.workflow#developStage",
            templateStepId: "develop",
            session: developSession.uri,
          },
        },
        {
          uri: "at://stage/edit",
          value: {
            $type: "app.graycard.workflow#editStage",
            templateStepId: "edit",
            status: "planned",
          },
        },
        {
          uri: "at://stage/output",
          value: {
            $type: "app.graycard.workflow#outputStage",
            templateStepId: "output",
            status: "planned",
          },
        },
      ],
    });
    await openGallery(GALLERY);
    const summary = document.querySelector(".photo-workflow-summary > summary");
    expect(summary.textContent).toContain("2/4 · Next: Edit + Output");
    summary.click();
    expect(document.querySelector(".photo-workflow-summary").open).toBe(true);
    expect([...document.querySelectorAll(".photo-workflow-stages strong")].map((node) => node.textContent)).toEqual([
      "Capture",
      "Develop",
      "Edit",
      "Output",
    ]);

    const picker = document.querySelector('[aria-label="Stage to add to gallery workflow steps"]');
    picker.value = "develop";
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Add step").click();
    document.querySelector('[aria-label="Duplicate Develop, step 1"]').click();
    expect(document.querySelectorAll('[aria-label="Gallery workflow steps in order"] .workflow-step')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Move Develop, step 2, earlier"]')).not.toBeNull();

    const results = await axe.run(document.querySelector('[data-editor-section="workflow-templates"]'), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("expands optional and repeatable template steps within their cardinality", async () => {
    harness.store.workflowTemplates = [
      {
        uri: "at://template/repeatable-print",
        value: {
          name: "Print editions",
          medium: "film",
          steps: [
            {
              id: "print-edition",
              kind: "print",
              label: "Edition print",
              optional: true,
              cardinality: { min: 0, max: 2 },
              sessionScope: "per-stage",
              inputs: [{ id: "input", artifactKinds: ["film-negative"] }],
              outputs: [{ id: "output", artifactKinds: ["physical-print"] }],
            },
          ],
        },
      },
    ];
    await openGallery(GALLERY);
    const template = [...document.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.textContent === "Print editions"),
    );
    template.value = "at://template/repeatable-print";
    template.dispatchEvent(new Event("change"));
    const chooser = document.querySelector('.modal input[type="number"]');
    expect(chooser.min).toBe("0");
    expect(chooser.max).toBe("2");
    chooser.value = "2";
    document.querySelector(".modal-actions button:not(.ghost)").click();
    expect(document.querySelectorAll('[aria-label="Gallery workflow steps in order"] .workflow-step')).toHaveLength(2);
    expect([...document.querySelectorAll(".workflow-step-summary")].map((node) => node.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("occurrence 2")]),
    );
  });
});
