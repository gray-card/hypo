import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as facade from "../src/ui/profileView.js";
import * as implementation from "../src/ui/profileView.ts";

const mocks = vi.hoisted(() => ({
  hasGraycard: vi.fn(async (did) => did === "did:plc:graycard"),
  loadSetup: vi.fn(),
  loadDiscover: vi.fn(),
  mountHeatmap: vi.fn(async () => undefined),
  rankScenes: vi.fn(async () => []),
}));

vi.mock("../src/profile.js", () => ({
  clearGraycardCache: vi.fn(),
  getFollows: vi.fn(async () => []),
  getGrainFollows: vi.fn(async () => []),
  hasGraycard: mocks.hasGraycard,
  loadSetup: mocks.loadSetup,
  publicBlobUrl: vi.fn(() => null),
}));

vi.mock("../src/ui/mapView.js", () => ({
  mountHeatmap: mocks.mountHeatmap,
}));

vi.mock("../src/sceneSearch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  rankScenes: mocks.rankScenes,
}));

vi.mock("../src/data/captionIdf.js", () => ({
  loadCaptionIdf: vi.fn(async () => null),
}));

vi.mock("../src/data/tokenizerModel.js", () => ({
  loadPhraseModel: vi.fn(async () => null),
}));

vi.mock("../src/discover.js", () => ({
  loadDiscover: mocks.loadDiscover,
}));

const PHOTO = "at://did:plc:graycard/social.grain.photo/photo";
const PHOTO_WITHOUT_ALT = "at://did:plc:graycard/social.grain.photo/photo-without-alt";

function setupFixture() {
  return {
    repo: {
      pds: "https://pds.example",
      did: "did:plc:graycard",
      handle: "gray.example",
      displayName: "Gray Example",
      avatar: "https://cdn.example/avatar.jpg",
    },
    store: {
      catalog: { filmStock: [] },
      instance: { camera: [], lens: [], filter: [], exposure: [] },
      byUri: new Map(),
    },
    templates: [],
    shoots: [],
    galleries: [],
    photos: [
      { uri: PHOTO, value: { alt: "A gray card" } },
      { uri: PHOTO_WITHOUT_ALT, value: { alt: "  " } },
    ],
    galleryItems: [],
    captures: [
      {
        uri: "at://did:plc:graycard/app.graycard.photo.capture/capture",
        value: {
          photo: PHOTO,
          location: {
            latitude: 430_000_000,
            longitude: -770_000_000,
            placemark: { name: "Rochester" },
          },
        },
      },
    ],
    photoWorkflows: [],
    scenes: [
      { uri: "at://did:plc:graycard/app.graycard.scene.graph/one", value: { subject: PHOTO } },
      { uri: "at://did:plc:graycard/app.graycard.scene.graph/two", value: { subject: PHOTO_WITHOUT_ALT } },
    ],
    sceneNodes: [
      {
        uri: "at://did:plc:graycard/app.graycard.scene.node/one",
        value: { scene: "at://did:plc:graycard/app.graycard.scene.graph/one", type: { label: "gray card" } },
      },
      {
        uri: "at://did:plc:graycard/app.graycard.scene.node/two",
        value: { scene: "at://did:plc:graycard/app.graycard.scene.graph/two", type: { label: "portrait" } },
      },
    ],
    sceneEdges: [],
    exif: [],
    galleryDefaults: [],
  };
}

function withCameras(data, copiesByModel) {
  const cameraTypes = [];
  const cameras = [];
  for (const [model, copies] of Object.entries(copiesByModel)) {
    const typeUri = `at://did:plc:graycard/app.graycard.catalog.cameraType/${model.toLowerCase()}`;
    const type = { uri: typeUri, value: { make: "Nikon", model } };
    cameraTypes.push(type);
    data.store.byUri.set(typeUri, { layer: "catalog", kind: "cameraType", item: type });
    for (let copy = 1; copy <= copies; copy += 1) {
      const uri = `at://did:plc:graycard/app.graycard.instance.camera/${model.toLowerCase()}-${copy}`;
      const camera = { uri, value: { type: typeUri, serialNumber: `${model}-${copy}` } };
      cameras.push(camera);
      data.store.byUri.set(uri, { layer: "instance", kind: "camera", item: camera });
    }
  }
  data.store.catalog.cameraType = cameraTypes;
  data.store.instance.camera = cameras;
  return data;
}

function withLenses(data, copiesByModel) {
  const lensTypes = [];
  const lenses = [];
  for (const [model, copies] of Object.entries(copiesByModel)) {
    const slug = model.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    const typeUri = `at://did:plc:graycard/app.graycard.catalog.lensType/${slug}`;
    const type = { uri: typeUri, value: { make: "Nikon", model } };
    lensTypes.push(type);
    data.store.byUri.set(typeUri, { layer: "catalog", kind: "lensType", item: type });
    for (let copy = 1; copy <= copies; copy += 1) {
      const uri = `at://did:plc:graycard/app.graycard.instance.lens/${slug}-${copy}`;
      const lens = { uri, value: { type: typeUri, serialNumber: `${slug}-${copy}` } };
      lenses.push(lens);
      data.store.byUri.set(uri, { layer: "instance", kind: "lens", item: lens });
    }
  }
  data.store.catalog.lensType = lensTypes;
  data.store.instance.lens = lenses;
  return data;
}

function filterGroup(title) {
  const heading = [...document.querySelectorAll("h4.stat-h")].find((candidate) => candidate.textContent === title);
  return heading?.nextElementSibling || null;
}

function chipLabels(group) {
  return [...group.querySelectorAll(".filter-chip")].map((chip) => chip.querySelector("span")?.textContent);
}

beforeEach(() => {
  document.body.innerHTML = `
    <main id="profile-view">
      <div id="profile-search"></div>
      <div id="profile-body"></div>
    </main>
  `;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mocks.loadSetup.mockResolvedValue(setupFixture());
  mocks.loadDiscover.mockResolvedValue({ setups: [], hasMore: false });
  mocks.rankScenes.mockResolvedValue([]);
  facade.setViewer(null);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("profile view TypeScript compatibility facade", () => {
  it("re-exports the strict implementation through the established JS path", () => {
    expect(facade.openProfile).toBe(implementation.openProfile);
    expect(facade.buildHandleSearch).toBe(implementation.buildHandleSearch);
    expect(facade.destroyProfileMap).toBe(implementation.destroyProfileMap);
  });

  it("renders actor suggestions and promotes profiles with graycard records", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          actors: [
            { did: "did:plc:plain", handle: "plain.example", displayName: "Plain" },
            { did: "did:plc:graycard", handle: "gray.example", displayName: "Gray" },
          ],
        }),
      })),
    );

    const search = facade.buildHandleSearch();
    document.body.append(search);
    const input = search.querySelector("input");
    input.value = "gr";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(220);
    await Promise.resolve();

    const options = [...search.querySelectorAll(".term-opt")];
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("@gray.example");
    expect(options[0].classList.contains("gc-user")).toBe(true);
    expect(options[0].querySelector(".gc-badge").classList.contains("hidden")).toBe(false);
  });

  it("keeps the profile heatmap lazy until the Refine card opens", async () => {
    await facade.openProfile("@gray.example");

    expect(document.querySelector(".profile-name").textContent).toBe("Gray Example");
    expect(mocks.mountHeatmap).not.toHaveBeenCalled();

    const refine = [...document.querySelectorAll("details")].find((card) =>
      card.querySelector("summary")?.textContent.includes("Refine"),
    );
    refine.open = true;
    refine.dispatchEvent(new Event("toggle"));

    expect(mocks.mountHeatmap).toHaveBeenCalledOnce();
    expect(mocks.mountHeatmap.mock.calls[0][2]).toEqual([
      expect.objectContaining({ key: "860,-1540", label: "Rochester", count: 1 }),
    ]);
  });

  it("keeps Discover focused on other photographers' published setups", async () => {
    mocks.loadDiscover.mockResolvedValue({
      hasMore: false,
      setups: [
        {
          uri: "at://did:plc:graycard/app.graycard.setup/self",
          did: "did:plc:graycard",
          author: { did: "did:plc:graycard", handle: "gray.example", displayName: "Gray Example" },
          value: { name: "My setup" },
        },
        {
          uri: "at://did:plc:other/app.graycard.setup/other",
          did: "did:plc:other",
          author: { did: "did:plc:other", handle: "other.example", displayName: "Other Photographer" },
          value: { name: "Other setup" },
        },
      ],
    });
    facade.setViewer("did:plc:graycard", {});

    facade.openProfileSearch();

    await vi.waitFor(() => expect(document.querySelectorAll(".setup-card")).toHaveLength(1));
    expect(document.querySelector(".setup-card").textContent).toContain("Other setup");
    expect(document.querySelector("#profile-body").textContent).not.toContain("My setup");
    expect(document.querySelector("#profile-body").textContent).not.toContain("people you follow");
  });

  it("keeps the camera-model filter hidden when every model has only one owned copy", async () => {
    mocks.loadSetup.mockResolvedValue(withCameras(setupFixture(), { F2: 1, F3: 1 }));

    await facade.openProfile("@gray.example");

    expect(filterGroup("Camera models")).toBeNull();
    expect(chipLabels(filterGroup("Cameras"))).toEqual(["Nikon F2 · F2-1", "Nikon F3 · F3-1"]);
  });

  it("shows every owned camera model once any model has multiple copies", async () => {
    mocks.loadSetup.mockResolvedValue(withCameras(setupFixture(), { F2: 2, F3: 1, F4: 1 }));

    await facade.openProfile("@gray.example");

    expect(chipLabels(filterGroup("Camera models"))).toEqual(["Nikon F2", "Nikon F3", "Nikon F4"]);
  });

  it("shows every owned lens model once any lens model has multiple copies", async () => {
    mocks.loadSetup.mockResolvedValue(withLenses(setupFixture(), { "Nikkor 50mm f/1.4": 2, "Nikkor 105mm f/2.5": 1 }));

    await facade.openProfile("@gray.example");

    expect(chipLabels(filterGroup("Lens models"))).toEqual(["Nikon Nikkor 105mm f/2.5", "Nikon Nikkor 50mm f/1.4"]);
  });

  it("names photo search links from alt text with a numbered fallback", async () => {
    mocks.rankScenes.mockResolvedValue([
      { uri: PHOTO, band: "match", score: 1, reason: "caption" },
      { uri: PHOTO_WITHOUT_ALT, band: "match", score: 0.9, reason: "scene" },
    ]);
    await facade.openProfile("@gray.example");

    const avatar = document.querySelector(".profile-avatar");
    expect(avatar.getAttribute("alt")).toBe("");

    const input = document.querySelector('input[aria-label="Search this photographer\'s photos"]');
    input.value = "gray";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(document.querySelectorAll(".search-hit")).toHaveLength(2));
    const links = [...document.querySelectorAll(".search-hit")];
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "View A gray card on Grain",
      "View Photo 2 on Grain",
    ]);
    expect(links.every((link) => link.querySelector(".search-cell").getAttribute("aria-hidden") === "true")).toBe(true);
  });
});
