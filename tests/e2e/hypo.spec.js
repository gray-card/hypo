import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const CAMERA_COLLECTION = "app.graycard.instance.camera";
const FILM_BACK_TYPE_COLLECTION = "app.graycard.catalog.filmBackType";
const FILM_BACK_COLLECTION = "app.graycard.instance.filmBack";
const EXPOSURE_COLLECTION = "app.graycard.instance.exposure";

async function resetFixture(request) {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
}

async function listRecords(request, collection) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).records;
}

async function login(page) {
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ did: REPO, handle: "alice.test" }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Log in with your atmosphere account" })).toBeVisible();
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("stubbed OAuth logs in and loads seeded gear from the HTTP fixture PDS", async ({ page, request }) => {
  await login(page);

  const body = page.locator("#library-body");
  await page.goto("/library/cameras");
  await expect(body.getByRole("heading", { name: "Cameras", exact: true })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "black body" })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "silver body" })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "backup body" })).toBeVisible();
  await expect.poll(async () => (await listRecords(request, CAMERA_COLLECTION)).length).toBe(3);
});

test("darkroom add forms load only sourced enlarger catalogs and save both gear types", async ({ page, request }) => {
  await login(page);
  await page.goto("/library/darkroom");

  await page.getByRole("button", { name: "Add enlarger", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add enlarger" });
  await expect(dialog.getByRole("status").filter({ hasText: "Catalog suggestions loaded" })).toBeVisible();
  await dialog.getByLabel("Make").fill("Omega");
  await dialog.getByLabel(/Model/).fill("B-22");
  await expect(dialog.getByLabel(/Max negative format/)).toHaveValue("6x6");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await listRecords(request, "app.graycard.instance.enlarger")).length).toBe(1);

  await page.getByRole("button", { name: "Add enlarging lens", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add enlarging lens" });
  await expect(dialog.getByRole("status").filter({ hasText: "Catalog suggestions loaded" })).toBeVisible();
  await dialog.getByLabel("Make").fill("Rodenstock");
  await dialog.getByLabel(/Model/).fill("Rodagon 80mm f/4");
  await expect(dialog.getByLabel(/Max aperture/)).toHaveValue("4");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await listRecords(request, "app.graycard.instance.enlargingLens")).length).toBe(1);
});

test("adding a film back saves its type and physical instance", async ({ page, request }) => {
  await login(page);
  await page.goto("/library/cameras");
  await page.getByRole("button", { name: "Add film back", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add film back" });
  await dialog.getByLabel(/^Make/).fill("Bronica");
  await dialog.getByLabel(/^Model/).fill("Film Back SQ 120");
  await dialog.getByLabel(/^Back interface/).selectOption("Bronica SQ");
  await dialog.getByLabel(/^Nickname/).fill("SQ back 1");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(async () => (await listRecords(request, FILM_BACK_TYPE_COLLECTION)).length).toBe(1);
  await expect.poll(async () => (await listRecords(request, FILM_BACK_COLLECTION)).length).toBe(1);
  const [back] = await listRecords(request, FILM_BACK_COLLECTION);
  expect(back.value.nickname).toBe("SQ back 1");
  expect(back.value.type).toMatch(new RegExp(`^at://${REPO}/${FILM_BACK_TYPE_COLLECTION}/`));
});

test("an offline shot stays queued and flushes after reconnect", async ({ page, context, request }) => {
  await login(page);

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const sessions = page.locator("#sessions-body");
  await expect(sessions.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  const shoot = sessions.locator(".session-card[data-kind='capture']").filter({ hasText: "Fixture photo walk" });
  await expect(shoot).toBeVisible();
  await expect(shoot).toBeVisible();

  await context.setOffline(true);
  await shoot.getByRole("button", { name: "Log frames", exact: true }).click();
  await page.getByRole("button", { name: "Log frame", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged offline — will sync" })).toBeVisible();
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(0);

  await context.setOffline(false);
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Synced 1 offline shot" })).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
});

test("a stale gear edit surfaces the fixture PDS swap conflict", async ({ page, request }) => {
  await login(page);

  await page.goto("/library/cameras");
  const cameraRow = page.locator("#library-body .gear-row").filter({ hasText: "black body" });
  await cameraRow.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit camera" });
  await expect(dialog).toBeVisible();

  const mutation = await request.post(`${PDS_ORIGIN}/__fixture__/mutate`, {
    data: {
      repo: REPO,
      collection: CAMERA_COLLECTION,
      rkey: "camera-a",
      patch: { serialNumber: "remote-write" },
    },
  });
  expect(mutation.ok()).toBe(true);

  await dialog.getByLabel(/Nickname/).fill("local stale edit");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.locator(".status.err")).toContainText(
    "This record changed on another device. Open “Needs attention” from the menu",
  );
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("menuitem", { name: "Needs attention", exact: true }).click({ force: true });
  const tray = page.getByRole("dialog", { name: "Needs attention" });
  await expect(tray).toBeVisible();
  await expect(tray).toContainText("local stale edit");
  await expect(tray).toContainText("remote-write");
  await tray.getByRole("button", { name: "Discard local change" }).click();
  await expect(tray).toContainText("Nothing needs attention");

  const current = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.getRecord`, {
    params: { repo: REPO, collection: CAMERA_COLLECTION, rkey: "camera-a" },
  });
  expect((await current.json()).value).toMatchObject({ nickname: "black body", serialNumber: "remote-write" });
});
