import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const CHEMISTRY_TYPE = `at://${REPO}/app.graycard.catalog.chemistryType/d76`;

async function createRecord(request, collection, rkey, record) {
  const response = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: { repo: REPO, collection, rkey, record },
  });
  expect(response.ok()).toBe(true);
}

async function seedChemistry(request) {
  await createRecord(request, "app.graycard.catalog.chemistryType", "d76", {
    $type: "app.graycard.catalog.chemistryType",
    brand: "Kodak",
    name: "D-76 film developer",
    roles: ["film-developer"],
    createdAt: "2026-08-12T20:00:00.000Z",
  });
  await createRecord(request, "app.graycard.instance.chemistry", "working", {
    $type: "app.graycard.instance.chemistry",
    type: CHEMISTRY_TYPE,
    nickname: "D-76 stock working bottle",
    status: "active",
    mixedAt: "2026-08-12T21:30:00.000Z",
    volumeMl: 1000,
    volumeRemainingMl: 625,
    rollsProcessed: 4,
    maxRollsRecommended: 10,
    createdAt: "2026-08-12T21:30:00.000Z",
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
  if (await page.getByRole("heading", { name: "Log in with your atmosphere account" }).isVisible()) {
    await page.getByRole("combobox").fill("alice.test");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
}

async function expectNoHorizontalOverflow(locator) {
  const sizes = await locator.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll - sizes.client).toBeLessThanOrEqual(1);
}

async function selectLibrarySection(page, name) {
  const mobileNavigation = page.locator(".library-navigation-mobile");
  if ((page.viewportSize()?.width ?? 0) <= 719) {
    await expect(mobileNavigation).toBeVisible();
    await mobileNavigation.locator("summary").click();
    await mobileNavigation.locator(".library-navigation-menu").getByRole("button", { name, exact: true }).click();
    return;
  }
  const desktopNavigation = page.locator(".library-shell > .library-navigation");
  await expect(desktopNavigation).toBeVisible();
  await desktopNavigation.getByRole("button", { name, exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(reset.ok()).toBe(true);
  await seedChemistry(request);
});

test("resource, roll, and session surfaces stay inside the viewport", async ({ page }) => {
  await login(page);
  await expectNoHorizontalOverflow(page.locator("body"));

  const meter = page.getByRole("progressbar", { name: "625 of 1000 mL remaining" });
  await expect(meter).toHaveAttribute("aria-valuenow", "63");

  const nav = page.viewportSize().width <= 640 ? page.locator("#bottom-nav") : page.locator("#primary-nav");
  await nav.getByRole("button", { name: "Rolls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rolls", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page.locator("#rolls-view"));

  await nav.getByRole("button", { name: "Library", exact: true }).click();
  await selectLibrarySection(page, "Chemistry");
  await page.getByRole("button", { name: "Add chemistry" }).click();
  const chemistry = page.getByRole("dialog", { name: "Add chemistry" });
  await expect(chemistry.getByText("Bottle or mixed bath", { exact: true })).toBeVisible();
  await expect(chemistry.getByText("Image and technical details", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(chemistry);
  await chemistry.getByRole("button", { name: "Cancel" }).click();

  await selectLibrarySection(page, "Batch rules");
  await page.getByRole("button", { name: "Create batch rule" }).click();
  const rule = page.getByRole("dialog", { name: "Create batch rule" });
  await expect(rule).toContainText("A batch rule is a reusable instruction");
  await expectNoHorizontalOverflow(rule);
  await rule.getByRole("button", { name: "Close" }).click();

  await nav.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.locator("#sessions-body summary").click();
  await page.getByRole("button", { name: "Log completed development" }).click();
  const development = page.getByRole("dialog", { name: "Log completed development" });
  await expectNoHorizontalOverflow(development);
  await expectNoHorizontalOverflow(development.locator(".development-role-option").first());
});

test("small-phone light mode keeps navigation, chips, and editors contained", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await login(page);
  await page.getByRole("button", { name: "Toggle light or dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectNoHorizontalOverflow(page.locator("body"));

  await selectLibrarySection(page, "Chemistry");
  await expectNoHorizontalOverflow(page.locator("#library-view"));
  await page.getByRole("button", { name: "Add chemistry" }).click();
  const chemistry = page.getByRole("dialog", { name: "Add chemistry" });
  await expectNoHorizontalOverflow(chemistry);
  await expectNoHorizontalOverflow(chemistry.locator(".enum-list-control"));
  await chemistry.getByRole("button", { name: "Cancel" }).click();

  await page.locator("#bottom-nav").getByRole("button", { name: "Sessions", exact: true }).click();
  await expectNoHorizontalOverflow(page.locator("#sessions-view"));
  await expectNoHorizontalOverflow(page.locator(".session-scopes"));
});
