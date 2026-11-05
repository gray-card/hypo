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
  saveGallery: vi.fn(async (_agent, _did, _gallery, fields) => {
    Object.assign(harness.detail.gallery.value, fields);
  }),
  savePhotoAlt: vi.fn(async () => "saved-photo-cid"),
  saveExif: vi.fn(async () => ({ uri: "at://exif", value: {} })),
  setGalleryItemPosition: vi.fn(async () => "new-item-cid"),
}));

vi.mock("../src/ui/library.js", () => ({
  refreshStore: vi.fn(async () => harness.store),
  instanceSelect: vi.fn((_kind, value = "") => {
    const select = document.createElement("select");
    for (const item of new Set(["", "camera-a", "camera-b", "lens-a", value || ""])) select.add(new Option(item, item));
    select.value = value || "";
    return select;
  }),
  shootSelect: vi.fn(() => document.createElement("select")),
  openAddGear: vi.fn(),
}));

vi.mock("../src/graycard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  savePhotoCapture: vi.fn(async () => null),
  saveGalleryDefaults: vi.fn(async () => null),
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

const { initEditor, openGallery, saveAllDirty, hasUnsavedChanges } = await import("../src/ui/editor.ts");

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
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
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
    expect(list.getAttribute("aria-pressed")).toBe("false");
    expect(grid.getAttribute("aria-pressed")).toBe("true");

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
    expect(document.querySelector("#photos").classList.contains("grid-mode")).toBe(true);
    expect(document.querySelector("#photo-inspector").hidden).toBe(false);
    expect(document.activeElement.id).toBe("photo-inspector-title");

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

const grain = await import("../src/grain.js");
const graycard = await import("../src/graycard.js");
const button = (label, root = document) =>
  [...root.querySelectorAll("button")].find((node) => node.textContent === label);
const edit = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const openPhoto = (index) => document.querySelectorAll("[data-grid-photo-control]")[index].click();

describe("gallery editing integration", () => {
  it("stages gallery changes on blur and writes only after explicit saving", async () => {
    await openGallery(GALLERY);
    const title = document.querySelector(".gallery-header input");
    edit(title, "A new title");
    title.dispatchEvent(new Event("blur"));
    expect(grain.saveGallery).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
    await saveAllDirty();
    expect(grain.saveGallery).toHaveBeenCalledWith({}, "did:plc:test", expect.anything(), {
      title: "A new title",
      description: "",
    });
    expect(document.querySelector(".gallery-title").textContent).toBe("A new title");
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("preserves drafts across navigation and saves only edited records", async () => {
    await openGallery(GALLERY);
    openPhoto(0);
    const first = document.querySelectorAll(".photo-fields")[0];
    edit(first.querySelector("textarea"), "Revised description");
    first.querySelector('[data-photo-section="exif"]').open = true;
    button("Next photo").click();
    const second = document.querySelectorAll(".photo-fields")[1];
    expect(second.querySelector('[data-photo-section="exif"]').open).toBe(true);
    button("Previous photo").click();
    expect(first.querySelector("textarea").value).toBe("Revised description");
    expect(grain.savePhotoAlt).not.toHaveBeenCalled();
    await saveAllDirty();
    expect(grain.savePhotoAlt).toHaveBeenCalledTimes(1);
    expect(graycard.savePhotoCapture).not.toHaveBeenCalled();
    expect(grain.saveExif).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(false);
    expect(document.querySelector(".photo-fields .status.err")).toBeNull();
  });

  it("updates coverage badges when alt text is saved or removed, without presenting drafts as saved metadata", async () => {
    await openGallery(GALLERY);
    openPhoto(1);
    const card = document.querySelectorAll(".photo-card")[1];
    const alt = document.querySelectorAll(".photo-fields")[1].querySelector("textarea");
    expect(card.querySelector(".badge")).toBeNull();
    edit(alt, "A newly described photo");
    expect(card.querySelector(".badge")).toBeNull();
    await saveAllDirty();
    expect(card.querySelector(".badge").textContent).toBe("alt");
    expect(card.querySelector(".photo-caption").textContent).toBe("A newly described photo");
    expect(document.querySelector("#gallery-coverage-summary").textContent).toContain("2 with alt text");
    edit(alt, "");
    expect(card.querySelector(".badge").textContent).toBe("alt");
    await saveAllDirty();
    expect(card.querySelector(".badge")).toBeNull();
    expect(card.querySelector(".photo-caption").textContent).toBe("Missing alt text");
    expect(document.querySelector("#gallery-coverage-summary").textContent).toContain("1 with alt text");
  });

  it("reveals invalid fields in another photo and keeps failed edits available for retry", async () => {
    await openGallery(GALLERY);
    openPhoto(0);
    const first = document.querySelectorAll(".photo-fields")[0];
    const aperture = [...first.querySelectorAll("label")]
      .find((label) => label.textContent.includes("Aperture"))
      .querySelector("input");
    edit(aperture, "invalid");
    openPhoto(1);
    await saveAllDirty();
    expect(first.hidden).toBe(false);
    expect(first.querySelector('[data-photo-section="exif"]').open).toBe(true);
    expect(document.activeElement).toBe(aperture);
    expect(grain.saveExif).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
    edit(aperture, "2.8");
    await saveAllDirty();
    expect(grain.saveExif).toHaveBeenCalledTimes(1);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("keeps a failed gallery write dirty and retries without losing the draft", async () => {
    await openGallery(GALLERY);
    edit(document.querySelector(".gallery-header input"), "Keep this draft");
    grain.saveGallery.mockRejectedValueOnce(new Error("Connection failed"));
    await saveAllDirty();
    expect(hasUnsavedChanges()).toBe(true);
    expect(document.querySelector(".gallery-header details").open).toBe(true);
    expect(document.querySelector(".gallery-header input").value).toBe("Keep this draft");
    await saveAllDirty();
    expect(hasUnsavedChanges()).toBe(false);
    expect(grain.saveGallery).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".gallery-header .status").classList.contains("err")).toBe(false);
  });

  it("reveals batch tools only for selection without opening the inspector", async () => {
    await openGallery(GALLERY);
    expect(document.querySelector(".select-bar").hidden).toBe(true);
    document.querySelector(".photo-select").click();
    expect(document.querySelector(".select-bar").hidden).toBe(false);
    expect(document.querySelector("#photo-inspector").hidden).toBe(true);
    button("Use a rule…").click();
    expect(document.querySelector("#gallery-batch-rules").open).toBe(true);
    button("Clear").click();
    expect(document.querySelector("#gallery-batch-rules").hidden).toBe(true);
    expect(document.querySelector(".select-bar").hidden).toBe(true);
  });

  it("stages reordering until Save changes and updates swap CIDs for subsequent reorders", async () => {
    await openGallery(GALLERY);
    document.querySelector(".move-down").click();
    expect(grain.setGalleryItemPosition).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
    await saveAllDirty();
    expect(grain.setGalleryItemPosition).toHaveBeenCalledTimes(2);
    expect(harness.detail.photos[0].photo.uri).toContain("unlabelled");
    document.querySelector(".move-down").click();
    await saveAllDirty();
    expect(grain.setGalleryItemPosition.mock.calls[2][2].cid).toBe("new-item-cid");
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("tracks shared gear and includes it in Save changes", async () => {
    await openGallery(GALLERY);
    const shared = document.querySelector(".shared-gear");
    shared.querySelector("select").dispatchEvent(new Event("change", { bubbles: true }));
    expect(graycard.saveGalleryDefaults).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
    await saveAllDirty();
    expect(graycard.saveGalleryDefaults).toHaveBeenCalledTimes(1);
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe("gallery save boundaries", () => {
  it("does not freeze inherited fields when overriding just one piece of gear", async () => {
    harness.store.galleryDefaultsByGallery.set(GALLERY, { value: { camera: "camera-a", lens: "lens-a" } });
    await openGallery(GALLERY);
    openPhoto(0);
    const fields = document.querySelector(".photo-fields");
    const camera = [...fields.querySelectorAll("label")]
      .find((label) => label.querySelector("span")?.textContent === "Camera")
      .querySelector("select");
    expect(camera.value).toBe("camera-a");
    camera.value = "camera-b";
    camera.dispatchEvent(new Event("change"));
    await saveAllDirty();
    expect(graycard.savePhotoCapture.mock.calls[0][3]).toEqual({ camera: "camera-b" });
  });

  it("stages returning to shared gear without clearing frame or location metadata", async () => {
    await openGallery(GALLERY);
    openPhoto(0);
    button("Use shared gear", document.querySelector(".photo-fields")).click();
    expect(graycard.savePhotoCapture).not.toHaveBeenCalled();
    await saveAllDirty();
    const patch = graycard.savePhotoCapture.mock.calls[0][3];
    expect(patch).toHaveProperty("camera", undefined);
    expect(patch).toHaveProperty("filters", undefined);
    expect(patch).not.toHaveProperty("frameIndex");
    expect(patch).not.toHaveProperty("location");
  });

  it("serializes overlapping saves and locks the edited form while writing", async () => {
    let finish;
    grain.savePhotoAlt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await openGallery(GALLERY);
    openPhoto(0);
    const alt = document.querySelector(".photo-fields textarea");
    edit(alt, "Keep this edit");
    const first = saveAllDirty();
    await vi.waitFor(() => expect(grain.savePhotoAlt).toHaveBeenCalledTimes(1));
    expect(alt.disabled).toBe(true);
    await saveAllDirty();
    expect(grain.savePhotoAlt).toHaveBeenCalledTimes(1);
    finish("updated-cid");
    await first;
    expect(alt.disabled).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
  });
});

it("protects pending edits before opening gear creation", async () => {
  const library = await import("../src/ui/library.js");
  await openGallery(GALLERY);
  openPhoto(0);
  const fields = document.querySelector(".photo-fields");
  edit(fields.querySelector("textarea"), "A pending description");
  button("+ Camera", fields).click();
  expect(library.openAddGear).not.toHaveBeenCalled();
  expect(fields.querySelector("textarea").value).toBe("A pending description");
  await saveAllDirty();
  button("+ Camera", fields).click();
  expect(library.openAddGear).toHaveBeenCalledTimes(1);
});
