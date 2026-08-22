import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const CAMERA_COLLECTION = "app.graycard.instance.camera";
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
  await expect(page.locator("#library-body .tab-bar")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("stubbed OAuth logs in and loads seeded gear from the HTTP fixture PDS", async ({ page, request }) => {
  await login(page);

  const body = page.locator("#library-body");
  await expect(body.getByRole("heading", { name: "Cameras", exact: true })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "black body" })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "silver body" })).toBeVisible();
  await expect(body.getByRole("listitem").filter({ hasText: "backup body" })).toBeVisible();
  await expect.poll(async () => (await listRecords(request, CAMERA_COLLECTION)).length).toBe(3);
});

test("an offline shot stays queued and flushes after reconnect", async ({ page, context, request }) => {
  await login(page);

  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Shoots", exact: true }).click();
  const shoot = body.locator(".gear-row").filter({ hasText: "Fixture photo walk" });
  await expect(shoot).toBeVisible();

  await context.setOffline(true);
  await shoot.getByRole("button", { name: "Add frames", exact: true }).click();
  await page.getByRole("button", { name: "Log frame", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged offline — will sync" })).toBeVisible();
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(0);

  await context.setOffline(false);
  await expect.poll(async () => (await listRecords(request, EXPOSURE_COLLECTION)).length).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Synced 1 offline shot" })).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  const updatedShoot = body.getByRole("listitem").filter({ hasText: "Fixture photo walk" });
  await expect(updatedShoot).toContainText("1 shot");
});

test("a stale gear edit surfaces the fixture PDS swap conflict", async ({ page, request }) => {
  await login(page);

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
  await expect(dialog.locator(".status.err")).toContainText("swapRecord does not match the current CID");
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
