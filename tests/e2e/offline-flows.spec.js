import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const CAMERA_COLLECTION = "app.graycard.instance.camera";
const EXPOSURE_COLLECTION = "app.graycard.instance.exposure";
const FILM_STOCK_COLLECTION = "app.graycard.catalog.filmStock";
const FILM_ROLL_COLLECTION = "app.graycard.instance.filmRoll";
const DEVELOP_COLLECTION = "app.graycard.process.developSession";
const GALLERY_COLLECTION = "social.grain.gallery";

const CAMERA = `at://${REPO}/${CAMERA_COLLECTION}/camera-a`;
const SHOOT = `at://${REPO}/app.graycard.session.capture/shoot-a`;
const STOCK = `at://${REPO}/${FILM_STOCK_COLLECTION}/offline-stock`;
const ROLL = `at://${REPO}/${FILM_ROLL_COLLECTION}/offline-roll`;
const GALLERY = `at://${REPO}/${GALLERY_COLLECTION}/offline-gallery`;

async function resetFixture(request) {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
}

async function createRecord(request, collection, rkey, record) {
  const response = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: { repo: REPO, collection, rkey, record },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).uri;
}

async function getRecord(request, collection, rkey) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.getRecord`, {
    params: { repo: REPO, collection, rkey },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function listRecords(request, collection) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).records;
}

async function seedOfflineFlows(request) {
  await createRecord(request, FILM_STOCK_COLLECTION, "offline-stock", {
    $type: FILM_STOCK_COLLECTION,
    brand: "Fujifilm",
    name: "Neopan 400",
    iso: 400,
    filmType: "bw-negative",
    process: "bw",
    format: "135",
    createdAt: "2026-01-07T00:00:00.000Z",
  });
  await createRecord(request, FILM_ROLL_COLLECTION, "offline-roll", {
    $type: FILM_ROLL_COLLECTION,
    stock: STOCK,
    camera: CAMERA,
    label: "Offline acceptance roll",
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
  await createRecord(request, GALLERY_COLLECTION, "offline-gallery", {
    $type: GALLERY_COLLECTION,
    title: "Offline metadata fixture",
    description: "Before the offline edit",
    createdAt: "2026-01-09T00:00:00.000Z",
  });
}

async function login(page) {
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ did: REPO, handle: "alice.test" }),
    }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
  await expect(page.locator("#library-body .tab-bar")).toBeVisible();
}

function trackRepoWrites(page) {
  const writes = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const match = new URL(request.url()).pathname.match(
      /^\/xrpc\/com\.atproto\.repo\.(createRecord|putRecord|deleteRecord)$/,
    );
    if (!match) return;
    writes.push({ operation: match[1], body: request.postDataJSON() });
  });
  return writes;
}

function writesFor(writes, collection) {
  return writes.filter((write) => write.body.collection === collection);
}

async function closeIfOpen(dialog) {
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
}

async function waitForDialogSave(dialog) {
  await expect
    .poll(() =>
      dialog.evaluateAll((dialogs) => {
        const node = dialogs[0];
        if (!node || !node.isConnected || getComputedStyle(node).display === "none") return "closed";
        return node.querySelector(".status")?.textContent?.trim() || "pending";
      }),
    )
    .toMatch(/^(closed|Saved ✓|Error:)/);
}

async function setBrowserOffline(page, context, offline) {
  await context.setOffline(offline);
  await page.evaluate((value) => window.dispatchEvent(new Event(value ? "offline" : "online")), offline);
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
  await seedOfflineFlows(request);
});

test("a seeded roll and shoot keep one of three shots queued until reconnection", async ({
  page,
  context,
  request,
}) => {
  const writes = trackRepoWrites(page);
  await login(page);

  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Shoots", exact: true }).click();
  const shoot = body.locator(".gear-row").filter({ hasText: "Fixture photo walk" });
  await expect(shoot).toBeVisible();
  await shoot.getByRole("button", { name: "Add frames", exact: true }).click();

  const logger = page.locator(".logger-overlay");
  await expect(logger.locator(".logger-sticky-summary")).toContainText("Offline acceptance roll");
  const logFrame = logger.getByRole("button", { name: "Log frame", exact: true });

  await logFrame.click();
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(1);
  await expect.poll(() => logger.locator(".logger-recent-row.pending").count()).toBe(0);
  expect(writesFor(writes, EXPOSURE_COLLECTION)).toHaveLength(1);

  await logFrame.click();
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(2);
  await expect.poll(() => logger.locator(".logger-recent-row.pending").count()).toBe(0);
  expect(writesFor(writes, EXPOSURE_COLLECTION)).toHaveLength(2);

  await setBrowserOffline(page, context, true);
  await logFrame.click();
  await expect(page.getByRole("status").filter({ hasText: "Logged offline — will sync" })).toBeVisible();
  await expect(logger.locator(".logger-recent-row.pending")).toHaveCount(1);
  expect(await listRecords(request, EXPOSURE_COLLECTION)).toHaveLength(2);
  expect(writesFor(writes, EXPOSURE_COLLECTION)).toHaveLength(2);

  await setBrowserOffline(page, context, false);
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(3);
  await expect(page.getByRole("status").filter({ hasText: "Synced 1 offline shot" }).first()).toBeVisible();
  await expect(logger.locator(".logger-recent-row.pending")).toHaveCount(0);

  const exposures = await listRecords(request, EXPOSURE_COLLECTION);
  expect(exposures.map((record) => record.value.frameNumber).sort((left, right) => left - right)).toEqual([1, 2, 3]);
  expect(exposures.every((record) => record.value.roll === ROLL && record.value.shoot === SHOOT)).toBe(true);
  expect(writesFor(writes, EXPOSURE_COLLECTION).map((write) => write.operation)).toEqual([
    "createRecord",
    "createRecord",
    "createRecord",
  ]);
  expect(writes).toHaveLength(3);
});

test("offline gear add and edit flush one write for each user mutation", async ({ page, context, request }) => {
  const writes = trackRepoWrites(page);
  await login(page);
  const cameraRow = page.locator("#library-body .gear-row").filter({ hasText: "black body" });
  await expect(cameraRow).toBeVisible();
  await setBrowserOffline(page, context, true);

  await page.getByRole("button", { name: "Add camera", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add camera" });
  await addDialog.getByLabel(/^Make/).fill("Fixture");
  await addDialog.getByLabel(/^Model/).fill("HTTP One");
  await addDialog.getByLabel(/^Nickname/).fill("offline added body");
  await addDialog.getByRole("button", { name: "Save", exact: true }).click();
  await waitForDialogSave(addDialog);
  await expect.poll(() => writes.length).toBe(0);
  await closeIfOpen(addDialog);

  await cameraRow.getByRole("button", { name: "Edit", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit camera" });
  await editDialog.getByLabel(/^Nickname/).fill("offline edited body");
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await waitForDialogSave(editDialog);
  await expect.poll(() => writes.length).toBe(0);
  await closeIfOpen(editDialog);

  expect(await listRecords(request, CAMERA_COLLECTION)).toHaveLength(3);
  expect((await getRecord(request, CAMERA_COLLECTION, "camera-a")).value.nickname).toBe("black body");

  await setBrowserOffline(page, context, false);
  await expect.poll(async () => (await listRecords(request, CAMERA_COLLECTION)).length).toBe(4);
  await expect
    .poll(async () => (await getRecord(request, CAMERA_COLLECTION, "camera-a")).value.nickname)
    .toBe("offline edited body");

  const cameraWrites = writesFor(writes, CAMERA_COLLECTION);
  expect(cameraWrites.map((write) => write.operation)).toEqual(["createRecord", "putRecord"]);
  expect(cameraWrites[0].body.record.nickname).toBe("offline added body");
  expect(cameraWrites[1].body.record.nickname).toBe("offline edited body");
  expect(writes).toHaveLength(2);
});

test("offline timer logging and its linked-roll milestone each flush once", async ({ page, context, request }) => {
  const writes = trackRepoWrites(page);
  await login(page);

  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Darkroom", exact: true }).click();
  await body.getByRole("button", { name: "Start development", exact: true }).click();
  const timer = page.getByRole("dialog", { name: "Development timer" });
  await timer.getByLabel("Roll to develop").selectOption(ROLL);
  const recipeList = timer.locator(".devtimer-setup > .devtimer-list").last();
  await expect(recipeList.locator("button").first()).toBeVisible();
  await recipeList.locator("button").first().click();
  const startDevelopment = timer.getByRole("button", { name: "Start development", exact: true });
  await expect(startDevelopment).toBeEnabled();
  await startDevelopment.click();
  await expect(timer.getByRole("button", { name: "Finish & log", exact: true })).toBeVisible();

  await setBrowserOffline(page, context, true);
  await timer.getByRole("button", { name: "Finish & log", exact: true }).click();
  await expect(timer).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Logged offline — will sync" })).toBeVisible();

  await expect.poll(() => writes.length).toBe(0);

  expect(await listRecords(request, DEVELOP_COLLECTION)).toHaveLength(0);
  expect((await getRecord(request, FILM_ROLL_COLLECTION, "offline-roll")).value.status).toBe("loaded");

  await setBrowserOffline(page, context, false);
  await expect.poll(async () => (await listRecords(request, DEVELOP_COLLECTION)).length).toBe(1);
  await expect
    .poll(async () => (await getRecord(request, FILM_ROLL_COLLECTION, "offline-roll")).value)
    .toMatchObject({
      status: "developed",
      developmentLocation: "home",
      developedAt: expect.any(String),
    });

  expect(writesFor(writes, DEVELOP_COLLECTION).map((write) => write.operation)).toEqual(["createRecord"]);
  expect(writesFor(writes, FILM_ROLL_COLLECTION).map((write) => write.operation)).toEqual(["putRecord"]);
  expect(writes).toHaveLength(2);
});

test("an offline gallery metadata edit flushes one swap-protected write", async ({ page, context, request }) => {
  const writes = trackRepoWrites(page);
  await login(page);

  await page.locator('nav[aria-label="Primary"]:visible [data-section="galleries"]').click();
  const galleryRow = page.locator("#gallery-list .gallery-row").filter({ hasText: "Offline metadata fixture" });
  await expect(galleryRow).toBeVisible();
  await galleryRow.click();

  const galleryCard = page
    .locator("#editor-body .card")
    .filter({ has: page.getByRole("heading", { name: "Gallery" }) });
  const title = galleryCard.getByLabel("Title");
  await expect(title).toHaveValue("Offline metadata fixture");

  await setBrowserOffline(page, context, true);
  await title.fill("Edited while offline");
  await title.press("Tab");
  await expect.poll(() => writes.length).toBe(0);
  expect((await getRecord(request, GALLERY_COLLECTION, "offline-gallery")).value.title).toBe(
    "Offline metadata fixture",
  );

  await setBrowserOffline(page, context, false);
  await expect
    .poll(async () => (await getRecord(request, GALLERY_COLLECTION, "offline-gallery")).value.title)
    .toBe("Edited while offline");

  expect(await getRecord(request, GALLERY_COLLECTION, "offline-gallery")).toMatchObject({
    uri: GALLERY,
    value: { title: "Edited while offline" },
  });

  const galleryWrites = writesFor(writes, GALLERY_COLLECTION);
  expect(galleryWrites.map((write) => write.operation)).toEqual(["putRecord"]);
  expect(galleryWrites[0].body.swapRecord).toBeTruthy();
  expect(galleryWrites[0].body.record.title).toBe("Edited while offline");
  expect(writes).toHaveLength(1);
});
