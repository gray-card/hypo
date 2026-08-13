import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const PUBLIC_PDS_ORIGIN = "https://pds.visual.fixture";
const REPO = "did:plc:alice";
const HANDLE = "alice.test";
const FIXED_TIME = new Date("2026-01-15T12:00:00.000Z");
const FILM_STOCK_COLLECTION = "app.graycard.catalog.filmStock";
const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";
const GALLERY_COLLECTION = "social.grain.gallery";
const PHOTO_COLLECTION = "social.grain.photo";
const GALLERY_ITEM_COLLECTION = "social.grain.gallery.item";
const STOCK = `at://${REPO}/${FILM_STOCK_COLLECTION}/visual-stock`;
const ROLL = `at://${REPO}/${FILM_ROLL_COLLECTION}/visual-roll`;
const GALLERY = `at://${REPO}/${GALLERY_COLLECTION}/visual-gallery`;
const PHOTO = `at://${REPO}/${PHOTO_COLLECTION}/visual-photo`;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const STABLE_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`;

const COMPONENT_STORY_HTML = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hypo component matrix</title>
    <style>
      .component-story { min-height: 100vh; padding: 24px; }
      .story-head { max-width: 1180px; margin: 0 auto 18px; }
      .story-head p { margin: 4px 0 0; color: var(--muted); }
      .story-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1180px; margin: 0 auto; }
      .specimen { min-width: 0; }
      .specimen > h2 { margin: 0 0 12px; font-size: 16px; }
      .specimen-stack { display: grid; gap: 12px; }
      .component-story .modal { width: 100%; max-height: none; box-shadow: none; }
      .component-story .palette { width: 100%; margin: 0; box-shadow: none; }
      .component-story .toast-host { position: static; align-items: stretch; padding: 0; }
      .component-story .toast { width: 100%; max-width: none; }
      .story-thumb { width: 100%; height: 118px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
      .story-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .story-caption { margin: 6px 0 0; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
      .story-dial { overflow-x: auto; }
    </style>
  </head>
  <body class="component-story">
    <header class="story-head">
      <p class="mono small">SHARED UI · VISUAL CONTRACT</p>
      <h1>Hypo component matrix</h1>
      <p>Fields, selection, feedback, dialogs, commands, and deferred media.</p>
    </header>
    <main id="story" class="story-grid"></main>
    <script type="module">
      import "/src/fonts.css";
      import "/src/style.css";
      import {
        checkList,
        createRovingDial,
        el,
        field,
        lazyThumbnail,
        openCommandPalette,
        openModal,
        toast,
      } from "/packages/ui/src/index.ts";

      const story = document.querySelector("#story");
      const specimen = (title, children) =>
        el("section", { class: "card specimen" }, [el("h2", {}, title), ...children]);

      let shutter = "1/125";
      const dial = createRovingDial(
        ["1/30", "1/60", "1/125", "1/250", "1/500"],
        () => shutter,
        (value) => { shutter = value; },
        { label: "Shutter speed", valueText: (value) => value },
      );
      dial.classList.add("story-dial");
      const checklist = checkList(
        [
          { value: "camera", label: "Camera body", locked: true, lockedLabel: "Inherited" },
          { value: "lens", label: "Normal lens" },
          { value: "meter", label: "Handheld meter" },
        ],
        { selected: ["lens"] },
      );
      story.append(
        specimen("Fields and selection", [
          el("div", { class: "specimen-stack" }, [
            field("Film speed", el("input", { type: "number", value: "400" })),
            field("Exposure mode", el("select", {}, [
              el("option", {}, "Aperture priority"),
              el("option", {}, "Manual"),
            ])),
            dial,
            checklist.node,
          ]),
        ]),
      );

      const thumb = lazyThumbnail(
        () => Promise.resolve("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='260'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23e6a24a'/%3E%3Cstop offset='.52' stop-color='%2383522d'/%3E%3Cstop offset='1' stop-color='%23191614'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='260' fill='url(%23g)'/%3E%3Ccircle cx='620' cy='70' r='42' fill='%23f3d49a' fill-opacity='.72'/%3E%3C/svg%3E"),
        { className: "story-thumb", alt: "Amber test strip", rootMargin: "1000px" },
      );
      const feedback = specimen("Deferred media and feedback", [
        thumb,
        el("p", { class: "story-caption" }, "Lazy thumbnail · resolved near viewport"),
      ]);
      story.append(feedback);
      toast("Three offline changes synced", "ok", 60_000, { label: "Review", fn: () => {} });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      feedback.append(document.querySelector("#toast-host"));

      const modalHandle = openModal(
        "Shared modal",
        [
          el("p", { class: "muted small" }, "A focused edit surface with shared fields and actions."),
          field("Label", el("input", { type: "text", value: "Morning walk" })),
          field("Notes", el("textarea", { rows: "2" }, "Metered in open shade.")),
        ],
        async () => {},
      );
      const modalOverlay = modalHandle.modal.parentElement;
      const modalSpecimen = specimen("Modal", []);
      modalSpecimen.append(modalHandle.modal);
      modalOverlay.remove();
      story.append(modalSpecimen);

      openCommandPalette(() => [
        { label: "Log a shot", hint: "L", icon: el("span", { class: "icon" }, "●"), run: () => {} },
        { label: "Start development timer", hint: "T", icon: el("span", { class: "icon" }, "◷"), run: () => {} },
        { label: "Open Fixture gallery", hint: "G", icon: el("span", { class: "icon" }, "▧"), run: () => {} },
      ]);
      const palette = document.querySelector(".palette");
      const paletteOverlay = palette.parentElement;
      const paletteSpecimen = specimen("Command palette", []);
      paletteSpecimen.append(palette);
      paletteOverlay.remove();
      story.append(paletteSpecimen);

      await thumb._loadThumbnail?.();
      document.body.dataset.ready = "true";
    </script>
  </body>
</html>`;

let publicRecords = new Map();

async function resetFixture(request) {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
}

async function createRecord(request, collection, rkey, record) {
  const response = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: { repo: REPO, collection, rkey, record },
  });
  expect(response.ok(), `${collection}/${rkey} should seed successfully`).toBe(true);
}

async function seedVisualFixtures(request) {
  const upload = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.uploadBlob`, {
    data: ONE_PIXEL_PNG,
    headers: { "content-type": "image/png" },
  });
  expect(upload.ok()).toBe(true);
  const { blob } = await upload.json();

  await Promise.all([
    createRecord(request, FILM_STOCK_COLLECTION, "visual-stock", {
      $type: FILM_STOCK_COLLECTION,
      brand: "Fujifilm",
      name: "Neopan 400",
      iso: 400,
      filmType: "bw-negative",
      process: "bw",
      format: "135",
      createdAt: "2026-01-07T00:00:00.000Z",
    }),
    createRecord(request, GALLERY_COLLECTION, "visual-gallery", {
      $type: GALLERY_COLLECTION,
      title: "Winter light studies",
      description: "A compact edit surface for the visual regression fixture.",
      createdAt: "2026-01-09T00:00:00.000Z",
    }),
    createRecord(request, PHOTO_COLLECTION, "visual-photo", {
      $type: PHOTO_COLLECTION,
      photo: blob,
      alt: "Gray card in winter light",
      aspectRatio: { width: 1, height: 1 },
      createdAt: "2026-01-09T12:00:00.000Z",
    }),
    createRecord(request, GALLERY_ITEM_COLLECTION, "visual-item", {
      $type: GALLERY_ITEM_COLLECTION,
      gallery: GALLERY,
      item: PHOTO,
      position: 0,
      createdAt: "2026-01-09T12:05:00.000Z",
    }),
  ]);
  await createRecord(request, FILM_ROLL_COLLECTION, "visual-roll", {
    $type: FILM_ROLL_COLLECTION,
    stock: STOCK,
    camera: `at://${REPO}/app.graycard.instance.camera/camera-a`,
    label: "Visual fixture roll",
    status: "loaded",
    createdAt: "2026-01-08T00:00:00.000Z",
  });
  const shootMutation = await request.post(`${PDS_ORIGIN}/__fixture__/mutate`, {
    data: {
      repo: REPO,
      collection: "app.graycard.session.capture",
      rkey: "shoot-a",
      patch: { rolls: [ROLL] },
    },
  });
  expect(shootMutation.ok()).toBe(true);

  publicRecords = new Map();
  for (const collection of [
    "app.graycard.catalog.cameraType",
    "app.graycard.catalog.filmStock",
    "app.graycard.instance.camera",
    "app.graycard.instance.lens",
    "app.graycard.instance.filmRoll",
    "app.graycard.session.capture",
    "app.graycard.workflow.template",
    GALLERY_COLLECTION,
    PHOTO_COLLECTION,
    GALLERY_ITEM_COLLECTION,
  ]) {
    const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
      params: { repo: REPO, collection, limit: "100" },
    });
    expect(response.ok()).toBe(true);
    publicRecords.set(collection, (await response.json()).records);
  }
}

async function preparePage(page) {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hypo:theme", "dark");
      localStorage.setItem("hypo:density", "comfortable");
    } catch {
      // about:blank may reject storage before the application origin loads.
    }
  });
  await page.route("https://public.api.bsky.app/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("app.bsky.actor.searchActorsTypeahead"))
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ actors: [] }) });
    if (path.endsWith("app.bsky.graph.getFollows"))
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ follows: [] }) });
    if (path.endsWith("app.bsky.actor.getProfiles"))
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ profiles: [] }) });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ did: REPO, handle: HANDLE, displayName: "Alice Fixture" }),
    });
  });
  await page.route("https://plc.directory/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: REPO,
        service: [
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: PUBLIC_PDS_ORIGIN,
          },
        ],
      }),
    }),
  );
  await page.route(`${PUBLIC_PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords**`, (route) => {
    const collection = new URL(route.request().url()).searchParams.get("collection");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ records: publicRecords.get(collection) || [] }),
    });
  });
  await page.route(`${PUBLIC_PDS_ORIGIN}/xrpc/com.atproto.sync.getBlob**`, (route) =>
    route.fulfill({ contentType: "image/png", body: ONE_PIXEL_PNG }),
  );
  await page.route(`${PDS_ORIGIN}/xrpc/com.atproto.sync.getBlob**`, (route) =>
    route.fulfill({ contentType: "image/png", body: ONE_PIXEL_PNG }),
  );
}

async function login(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Log in with your atmosphere account" })).toBeVisible();
  await page.getByRole("combobox").fill(HANDLE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
  await expect(page.locator("#library-body .tab-bar")).toBeVisible();
}

async function stabilize(page) {
  await page.addStyleTag({ content: STABLE_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0);
}

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await seedVisualFixtures(request);
  await preparePage(page);
});

test("core flow 1/5 — log a shot", async ({ page }) => {
  await login(page);
  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Shoots", exact: true }).click();
  const shoot = body.getByRole("listitem").filter({ hasText: "Fixture photo walk" });
  await shoot.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator(".logger-sticky-summary")).toContainText("Visual fixture roll");
  await stabilize(page);

  await expect(page).toHaveScreenshot("core-flow-log-shot.png");
});

test("core flow 2/5 — run the development timer", async ({ page }) => {
  await login(page);
  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Darkroom", exact: true }).click();
  await body.getByRole("button", { name: "Start development", exact: true }).click();
  const timer = page.getByRole("dialog", { name: "Development timer" });
  await timer.getByLabel("Roll to develop").selectOption(ROLL);
  const recipes = timer.locator(".devtimer-setup > .devtimer-list").last();
  await recipes.locator("button").first().click();
  await timer.getByRole("button", { name: "Start development", exact: true }).click();
  await timer.getByRole("button", { name: "Start step", exact: true }).click();
  await expect(timer.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const controlOverflow = await timer
    .locator(".devtimer-controls")
    .evaluateAll((rows) => rows.map((row) => Math.max(0, Math.ceil(row.scrollWidth - row.clientWidth))));
  expect(controlOverflow).toEqual([0, 0]);
  await stabilize(page);

  await expect(page).toHaveScreenshot("core-flow-run-timer.png");
});

test("core flow 3/5 — edit a gallery", async ({ page }) => {
  await login(page);
  await page.locator('#primary-nav [data-section="galleries"]').click();
  const gallery = page.locator("#gallery-list .gallery-row").filter({ hasText: "Winter light studies" });
  await expect(gallery).toBeVisible();
  await gallery.click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  const galleryCard = page
    .locator("#editor-body .card")
    .filter({ has: page.getByRole("heading", { name: "Gallery" }) });
  await galleryCard.getByLabel("Title").fill("Winter light studies · edited");
  await stabilize(page);

  await expect(page).toHaveScreenshot("core-flow-edit-gallery.png");
});

test("core flow 4/5 — onboard a photographer", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Guided setup", exact: true }).click();
  const wizard = page.locator(".wizard-overlay");
  await expect(wizard).toHaveAttribute("role", "dialog");
  await wizard.getByRole("button", { name: "Get started", exact: true }).click();
  await wizard.locator("label.wizard-practice").filter({ hasText: "Film · process at home" }).click();
  await expect(wizard.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute("aria-valuenow", "2");
  await stabilize(page);

  await expect(page).toHaveScreenshot("core-flow-onboard.png");
});

test("core flow 5/5 — browse a public profile", async ({ page }) => {
  await page.goto(`/profile/${HANDLE}`);
  await expect(page.locator(".profile-name")).toHaveText("Alice Fixture");
  await expect(page.locator("#profile-body")).toContainText("Winter light studies");
  await stabilize(page);

  await expect(page).toHaveScreenshot("core-flow-browse-profile.png");
});

test("design system — shared component matrix", async ({ page }) => {
  await page.route("**/__visual__/component-matrix", (route) =>
    route.fulfill({ contentType: "text/html", body: COMPONENT_STORY_HTML }),
  );
  await page.goto("/__visual__/component-matrix");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".story-thumb img")).toBeVisible();
  await stabilize(page);

  await expect(page).toHaveScreenshot("design-system-component-matrix.png", {
    fullPage: true,
  });
});
