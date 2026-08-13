import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";

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
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("gear deep links preserve Library context across close, Back, Forward, and record changes", async ({ page }) => {
  await login(page);
  await page.goto("/gear/camera/camera-a");

  let dialog = page.getByRole("dialog", { name: "Edit camera" });
  await expect(dialog.getByLabel(/Nickname/)).toHaveValue("black body");
  await expect(page.locator("#library-body")).toHaveAttribute("data-tab", "cameras");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/library\/cameras$/);
  await expect(dialog).toBeHidden();
  const blackBody = page.locator("#library-body .gear-row").filter({ hasText: "black body" });
  await blackBody.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/gear\/camera\/camera-a$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/library\/cameras$/);
  await expect(dialog).toBeHidden();
  await page.goForward();
  await expect(dialog.getByLabel(/Nickname/)).toHaveValue("black body");

  await page.evaluate(() => {
    history.pushState({ libraryRecordModal: true }, "", "/gear/camera/camera-b");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  dialog = page.getByRole("dialog", { name: "Edit camera" });
  await expect(dialog.getByLabel(/Nickname/)).toHaveValue("silver body");
  await page.goBack();
  await expect(dialog.getByLabel(/Nickname/)).toHaveValue("black body");
});

test("roll deep links target the requested roll and replay through browser history", async ({ page, request }) => {
  const stock = await createRecord(request, "app.graycard.catalog.filmStock", "stock-a", {
    $type: "app.graycard.catalog.filmStock",
    brand: "Fixture",
    name: "Route 400",
    iso: 400,
    format: "135",
    createdAt: "2026-01-08T00:00:00.000Z",
  });
  await createRecord(request, "app.graycard.instance.filmRoll", "roll-a", {
    $type: "app.graycard.instance.filmRoll",
    stock,
    label: "Deep-link roll",
    status: "loaded",
    createdAt: "2026-01-09T00:00:00.000Z",
  });
  await login(page);
  await page.goto("/roll/roll-a");

  const dialog = page.getByRole("dialog", { name: /Roll · Fixture Route 400/ });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#library-body")).toHaveAttribute("data-tab", "film");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/library\/film$/);

  const rollRow = page.locator("#library-body .gear-row").filter({ hasText: "Deep-link roll" });
  await rollRow.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/roll\/roll-a$/);
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/library\/film$/);
  await page.goForward();
  await expect(dialog).toBeVisible();
});
