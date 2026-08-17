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
  await rollRow.getByRole("button", { name: "Manage", exact: true }).click();
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

  await rollDialog.getByTitle("Edit development session").click();
  const editDevelopmentDialog = page.getByRole("dialog", { name: "Edit development" });
  await expect(editDevelopmentDialog.getByRole("checkbox", { name: /Processed fixture roll/ })).toBeChecked();
  await expect(editDevelopmentDialog.getByLabel("Actual minutes").first()).toHaveValue("9");
  await editDevelopmentDialog.getByLabel("Actual minutes").first().fill("10");
  await editDevelopmentDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(editDevelopmentDialog).toBeHidden();
  await expect
    .poll(async () => {
      const records = await listRecords(request, "app.graycard.process.developSession");
      return records.find((record) => record.uri.endsWith("/development-processing"))?.value.steps?.[0]
        ?.actualTimeSeconds;
    })
    .toBe(630);

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

test("batch .frames import links rolls, proposes shoots, and keeps coordinates private by default", async ({
  page,
  request,
}) => {
  const stock = await createRecord(request, "app.graycard.catalog.filmStock", "stock-frames", {
    $type: "app.graycard.catalog.filmStock",
    brand: "Fixture",
    name: "Import 100",
    iso: 100,
    format: "135",
    createdAt: "2026-08-16T00:00:00.000Z",
  });
  const firstRoll = await createRecord(request, "app.graycard.instance.filmRoll", "roll-frames-a", {
    $type: "app.graycard.instance.filmRoll",
    stock,
    label: "Roll A",
    status: "exposed",
    createdAt: "2026-08-16T00:00:00.000Z",
  });
  const secondRoll = await createRecord(request, "app.graycard.instance.filmRoll", "roll-frames-b", {
    $type: "app.graycard.instance.filmRoll",
    stock,
    label: "Roll B",
    status: "exposed",
    createdAt: "2026-08-16T00:00:00.000Z",
  });
  const archive = (name, prefix, hour) => ({
    name,
    iso: 100,
    frames: [
      {
        id: `${prefix}-1`,
        number: 1,
        createdAt: `2026-08-16T${hour}:00:00.000Z`,
        latitude: 43.15,
        longitude: -77.61,
        aperture: 5.6,
        shutterSpeed: 0.008,
      },
      {
        id: `${prefix}-2`,
        number: 2,
        createdAt: `2026-08-16T${hour}:02:00.000Z`,
        latitude: 43.151,
        longitude: -77.611,
        aperture: 8,
        shutterSpeed: 0.004,
      },
    ],
  });

  await login(page);
  await page.goto("/library/film");
  const chooseFiles = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import .frames" }).click();
  await (
    await chooseFiles
  ).setFiles([
    {
      name: "Roll-A.frames",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(archive("Roll A", "a", "10"))),
    },
    {
      name: "Roll-B.frames",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(archive("Roll B", "b", "14"))),
    },
  ]);

  const dialog = page.getByRole("dialog", { name: "Import 2 .frames files" });
  await expect(dialog.getByLabel("Roll for Roll A")).toHaveValue(firstRoll);
  await expect(dialog.getByLabel("Roll for Roll B")).toHaveValue(secondRoll);
  await expect(dialog.getByText("Use location to refine shoot boundaries").first()).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Publish frame locations/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Import 4 frames" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(
      async () =>
        (await listRecords(request, "app.graycard.instance.exposure")).filter((record) =>
          record.value.sourceIdentifier?.startsWith("frames:"),
        ).length,
    )
    .toBe(4);
  const exposures = (await listRecords(request, "app.graycard.instance.exposure")).filter((record) =>
    record.value.sourceIdentifier?.startsWith("frames:"),
  );
  expect(exposures.map((record) => record.value.roll).sort()).toEqual([firstRoll, firstRoll, secondRoll, secondRoll]);
  expect(exposures.every((record) => record.value.location === undefined)).toBe(true);
  expect(await listRecords(request, "app.graycard.session.capture")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: expect.objectContaining({ label: "Roll A", rolls: [firstRoll] }) }),
      expect.objectContaining({ value: expect.objectContaining({ label: "Roll B", rolls: [secondRoll] }) }),
    ]),
  );

  const chooseDuplicate = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import .frames" }).click();
  await (
    await chooseDuplicate
  ).setFiles({
    name: "Roll-A.frames",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(archive("Roll A", "a", "10"))),
  });
  const duplicateDialog = page.getByRole("dialog", { name: "Import Roll A" });
  await expect(duplicateDialog).toContainText("2 frames already imported will be skipped");
  await duplicateDialog.getByRole("button", { name: "Import 0 frames" }).click();
  await expect(duplicateDialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await listRecords(request, "app.graycard.session.capture")).filter((record) => record.value.label === "Roll A")
          .length,
    )
    .toBe(1);
});
