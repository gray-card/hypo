import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import axeCore from "axe-core";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const PUBLIC_PDS_ORIGIN = "https://pds.fixture.test";
const REPO = "did:plc:alice";
const HANDLE = "alice.test";
const FIXED_TIME = new Date("2026-01-15T12:00:00.000Z");
const GALLERY = `at://${REPO}/social.grain.gallery/accessibility-gallery`;
const PHOTO = `at://${REPO}/social.grain.photo/accessibility-photo`;
const SCENE = `at://${REPO}/app.graycard.scene.graph/accessibility-scene`;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
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

async function seedPhotoViews(request) {
  const upload = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.uploadBlob`, {
    data: ONE_PIXEL_PNG,
    headers: { "content-type": "image/png" },
  });
  expect(upload.ok()).toBe(true);
  const { blob } = await upload.json();

  await Promise.all([
    createRecord(request, "social.grain.gallery", "accessibility-gallery", {
      $type: "social.grain.gallery",
      title: "Accessibility fixture gallery",
      description: "Keyboard and accessible-name coverage.",
      createdAt: "2026-01-10T12:00:00.000Z",
    }),
    createRecord(request, "social.grain.photo", "accessibility-photo", {
      $type: "social.grain.photo",
      photo: blob,
      alt: "Fixture gray card",
      aspectRatio: { width: 1, height: 1 },
      createdAt: "2026-01-10T12:00:00.000Z",
    }),
    createRecord(request, "social.grain.gallery.item", "accessibility-item", {
      $type: "social.grain.gallery.item",
      gallery: GALLERY,
      item: PHOTO,
      position: 0,
      createdAt: "2026-01-10T12:00:00.000Z",
    }),
    createRecord(request, "app.graycard.scene.graph", "accessibility-scene", {
      $type: "app.graycard.scene.graph",
      subject: PHOTO,
      createdAt: "2026-01-10T12:00:00.000Z",
    }),
    createRecord(request, "app.graycard.scene.node", "accessibility-node", {
      $type: "app.graycard.scene.node",
      scene: SCENE,
      type: { id: "fixture-gray-card", label: "gray card" },
      createdAt: "2026-01-10T12:00:00.000Z",
    }),
  ]);

  publicRecords = new Map();
  for (const collection of [
    "social.grain.gallery",
    "social.grain.photo",
    "social.grain.gallery.item",
    "app.graycard.scene.graph",
    "app.graycard.scene.node",
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
    if (path.endsWith("app.bsky.actor.searchActorsTypeahead")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ actors: [] }) });
    }
    if (path.endsWith("app.bsky.graph.getFollows")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ follows: [] }) });
    }
    if (path.endsWith("app.bsky.actor.getProfiles")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ profiles: [] }) });
    }
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
  await page.route("https://www.wikidata.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ search: [] }) }),
  );
  await page.route("https://query.wikidata.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: { bindings: [] } }) }),
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

async function openLogin(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Log in with your atmosphere account" })).toBeVisible();
}

async function login(page) {
  await openLogin(page);
  await page.getByRole("combobox").fill(HANDLE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
  await expect(page.locator("#library-body").getByRole("listitem").filter({ hasText: "black body" })).toBeVisible();
}

function formatViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary || "No failure summary"}`)
        .join("\n");
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

async function expectAccessible(page, selector) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: axeCore.source });
  const results = await page.evaluate(
    async ({ rootSelector, tags }) => {
      const root = document.querySelector(rootSelector);
      if (!root) throw new Error(`Accessibility audit scope was not found: ${rootSelector}`);
      return window.axe.run(root, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      });
    },
    { rootSelector: selector, tags: AXE_TAGS },
  );
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact));
  expect(blocking, formatViolations(blocking)).toEqual([]);
}

async function tabTo(page, locator, limit = 50) {
  for (let index = 0; index < limit; index++) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach ${await locator.evaluate((node) => node.outerHTML.slice(0, 160))}`);
}

async function expectVisibleKeyboardFocus(locator) {
  await expect(locator).toBeFocused();
  const hasVisibleIndicator = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const outline = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const shadow = style.boxShadow !== "none";
    return outline || shadow;
  });
  expect(hasVisibleIndicator).toBe(true);
}

async function expectLoggedInLandmarks(page, section) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  const primaryNav = page.locator('nav[aria-label="Primary"]:visible');
  await expect(primaryNav).toHaveCount(1);
  await expect(primaryNav.locator(`[data-section="${section}"]`)).toHaveAttribute("aria-current", "page");
}

function primaryNavButton(page, section) {
  return page.locator(`nav[aria-label="Primary"]:visible [data-section="${section}"]`);
}

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await seedPhotoViews(request);
  await preparePage(page);
});

test("login view has landmarks, visible keyboard focus, ordered controls, and no blocking axe findings", async ({
  page,
}) => {
  await openLogin(page);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  const handle = page.getByRole("combobox");
  await tabTo(page, handle);
  await expectVisibleKeyboardFocus(handle);
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(page.getByRole("button", { name: "Sign in" }));

  await expectAccessible(page, "#login-view");
});

test("setup view supports keyboard nav, modal focus restoration, and seeded gear/logger controls", async ({ page }) => {
  await login(page);
  await expectLoggedInLandmarks(page, "setup");

  const setupNav = primaryNavButton(page, "setup");
  await tabTo(page, setupNav);
  await expectVisibleKeyboardFocus(setupNav);
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(primaryNavButton(page, "galleries"));

  const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts" });
  await shortcuts.focus();
  await page.keyboard.press("Enter");
  const shortcutsDialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcutsDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutsDialog).toBeHidden();
  await expect(shortcuts).toBeFocused();

  const camera = page.locator("#library-body .gear-row").filter({ hasText: "black body" });
  const edit = camera.getByRole("button", { name: "Edit", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit camera" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Make *", { exact: true })).toBeFocused();
  await expectAccessible(page, ".modal-overlay");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  const shoots = page.locator("#library-body").getByRole("button", { name: "Shoots", exact: true });
  await shoots.focus();
  await page.keyboard.press("Enter");
  const shoot = page.locator("#library-body .gear-row").filter({ hasText: "Fixture photo walk" });
  const log = shoot.getByRole("button", { name: "Log", exact: true });
  await log.focus();
  await page.keyboard.press("Enter");
  const logger = page.locator(".logger-overlay");
  await expect(logger).toBeVisible();
  await expectAccessible(page, ".logger-overlay");

  const quick = logger.locator(".logger-mode-btn");
  const wasQuick = (await quick.getAttribute("aria-pressed")) === "true";
  await quick.focus();
  await page.keyboard.press("Space");
  await expect(quick).toHaveAttribute("aria-pressed", String(!wasQuick));
  await expect(quick).toHaveText(wasQuick ? "Quick mode" : "Full controls");

  const logFrame = logger.getByRole("button", { name: "Log frame", exact: true });
  await logFrame.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Logged ✓" })).toBeVisible();
  await logger.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(logger).toBeHidden();

  await expectAccessible(page, "#library-view");
});

test("galleries view exposes the current nav landmark and ordered keyboard controls", async ({ page }) => {
  await login(page);
  const galleriesNav = primaryNavButton(page, "galleries");
  await galleriesNav.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your galleries" })).toBeVisible();
  await expect(
    page.locator("#gallery-list .gallery-row").filter({ hasText: "Accessibility fixture gallery" }),
  ).toBeVisible();
  await expectLoggedInLandmarks(page, "galleries");

  const create = page.getByRole("button", { name: "New gallery", exact: true });
  await tabTo(page, create);
  await expectVisibleKeyboardFocus(create);
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(page.getByRole("button", { name: "Reload", exact: true }));

  await expectAccessible(page, "#list-view");
});

test("editor photo grid is named and keyboard-operable", async ({ page }) => {
  await login(page);
  const galleriesNav = primaryNavButton(page, "galleries");
  await galleriesNav.focus();
  await page.keyboard.press("Enter");
  const gallery = page.locator("#gallery-list .gallery-row").filter({ hasText: "Accessibility fixture gallery" });
  await expect(gallery).toBeVisible();
  await gallery.click();
  await expect(page.getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  await expect(page.locator("#photos .thumb")).toHaveAttribute("data-grid-photo-label", "Fixture gray card");

  const grid = page.getByRole("button", { name: "Grid view" });
  await grid.focus();
  await page.keyboard.press("Enter");
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  const photo = page.getByRole("button", { name: "Edit Fixture gray card" });
  await tabTo(page, photo, 10);
  await expectVisibleKeyboardFocus(photo);
  await page.keyboard.press("Space");
  await expect(page.locator("#photos")).not.toHaveClass(/grid-mode/);
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator('nav[aria-label="Primary"]:visible')).toHaveCount(1);
  await expectAccessible(page, "#editor-view");
});

test("profile search image links are named and activate from the keyboard", async ({ page }) => {
  await login(page);
  await page.goto(`/profile/${HANDLE}`);
  await expect(page.locator(".profile-name")).toHaveText("Alice Fixture");
  await expectLoggedInLandmarks(page, "discover");

  const searchSummary = page.locator("#profile-body summary").filter({ hasText: "Search" });
  await searchSummary.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("searchbox", { name: "Search this photographer's photos" });
  await search.fill("gray card");
  await page.keyboard.press("Enter");
  const photoLink = page.getByRole("link", { name: "View Fixture gray card on Grain" });
  await expect(photoLink).toBeVisible();

  await search.focus();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(photoLink);
  await photoLink.evaluate((node) => {
    node.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        node.dataset.keyboardActivated = "true";
      },
      { once: true },
    );
  });
  await page.keyboard.press("Enter");
  await expect(photoLink).toHaveAttribute("data-keyboard-activated", "true");

  await expectAccessible(page, "#profile-view");
});
