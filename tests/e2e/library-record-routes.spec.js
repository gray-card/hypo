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

test("rolls show processing history and open preselected completed-session forms", async ({ page, request }) => {
  const stock = await createRecord(request, "app.graycard.catalog.filmStock", "stock-processing", {
    $type: "app.graycard.catalog.filmStock",
    brand: "Fixture",
    name: "Process 400",
    iso: 400,
    format: "135",
    createdAt: "2026-01-08T00:00:00.000Z",
  });
  const chemistryType = await createRecord(request, "app.graycard.catalog.chemistryType", "chemistry-type", {
    $type: "app.graycard.catalog.chemistryType",
    name: "Fixture Developer",
    roles: ["film-developer"],
    createdAt: "2026-01-08T00:00:00.000Z",
  });
  const chemistry = await createRecord(request, "app.graycard.instance.chemistry", "chemistry-working", {
    $type: "app.graycard.instance.chemistry",
    type: chemistryType,
    nickname: "Fixture Developer 1+1",
    createdAt: "2026-01-09T00:00:00.000Z",
  });
  const scannerType = await createRecord(request, "app.graycard.catalog.scannerType", "scanner-type", {
    $type: "app.graycard.catalog.scannerType",
    make: "Fixture",
    model: "Scan 9000",
    scannerKind: "dedicated-film-scanner",
    createdAt: "2026-01-08T00:00:00.000Z",
  });
  const scanner = await createRecord(request, "app.graycard.instance.scanner", "scanner-owned", {
    $type: "app.graycard.instance.scanner",
    type: scannerType,
    nickname: "My Scan 9000",
    createdAt: "2026-01-09T00:00:00.000Z",
  });
  const roll = await createRecord(request, "app.graycard.instance.filmRoll", "roll-processing", {
    $type: "app.graycard.instance.filmRoll",
    stock,
    label: "Processed fixture roll",
    status: "scanned",
    developedAt: "2026-01-10T10:00:00.000Z",
    scannedAt: "2026-01-11T10:00:00.000Z",
    createdAt: "2026-01-09T00:00:00.000Z",
  });
  await createRecord(request, "app.graycard.process.developSession", "development-processing", {
    $type: "app.graycard.process.developSession",
    process: "bw",
    filmRolls: [roll],
    steps: [
      {
        name: "Developer",
        kind: "chemical-bath",
        roles: ["film-developer"],
        chemistries: [chemistry],
        actualTimeSeconds: 570,
        agitationMethod: "inversion",
        agitationScheme: { initialSec: 30, everySec: 60, forSec: 10, inversions: 4 },
      },
    ],
    startedAt: "2026-01-10T09:50:30.000Z",
    finishedAt: "2026-01-10T10:00:00.000Z",
    createdAt: "2026-01-10T10:00:00.000Z",
  });
  await createRecord(request, "app.graycard.process.digitizeSession", "scan-processing", {
    $type: "app.graycard.process.digitizeSession",
    method: "dedicated-film-scanner",
    scanner,
    filmRolls: [roll],
    resolution: { unit: "dpi", value: 4000, scale: 1 },
    startedAt: "2026-01-11T10:00:00.000Z",
    finishedAt: "2026-01-11T10:00:00.000Z",
    createdAt: "2026-01-11T10:00:00.000Z",
  });

  await login(page);
  await page.goto("/roll/roll-processing");

  const rollDialog = page.getByRole("dialog", { name: /Roll · Fixture Process 400/ });
  await expect(rollDialog.getByRole("heading", { name: "Processing history" })).toBeVisible();
  await expect(rollDialog).toContainText("Fixture Developer 1+1 · 9:30");
  await expect(rollDialog).toContainText("every 60s for 10s · 4 inversions");
  await expect(rollDialog).toContainText("My Scan 9000 · Dedicated film scanner · 4000 dpi");

  await rollDialog.getByRole("button", { name: "Log development" }).click();
  const developmentDialog = page.getByRole("dialog", { name: "Log completed development" });
  await expect(developmentDialog.getByText(/same session record as the timer/)).toBeVisible();
  await expect(developmentDialog.getByRole("checkbox", { name: /Processed fixture roll/ })).toBeChecked();
  await expect(developmentDialog.getByLabel("Actual minutes").first()).toBeVisible();
  await developmentDialog.getByText("Dates, targets, agitation, and bath details").click();
  await expect(developmentDialog.getByText("Inversions per cycle")).toBeVisible();
  const developmentEditor = developmentDialog.locator(".development-stage-editor");
  const overflowingDevelopmentControls = await developmentEditor.evaluate((node) => {
    const editorRight = node.getBoundingClientRect().right;
    return [...node.querySelectorAll("*")]
      .filter((child) => child.getBoundingClientRect().right > editorRight + 1)
      .map((child) => ({
        tag: child.tagName,
        className: child.className,
        right: Math.ceil(child.getBoundingClientRect().right),
        editorRight: Math.ceil(editorRight),
      }));
  });
  expect(overflowingDevelopmentControls).toEqual([]);
  await developmentDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await rollDialog.getByRole("button", { name: "Log scan" }).click();
  const scanDialog = page.getByRole("dialog", { name: "Log scan session" });
  await expect(scanDialog.getByLabel("Roll")).toHaveValue(roll);
  await expect(scanDialog.getByText(/Only the roll, scanner, method, and date are needed/)).toBeVisible();
  expect(await scanDialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await scanDialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
