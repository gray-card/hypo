import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const TEMPLATE_COLLECTION = "app.graycard.workflow.template";
const RUN_COLLECTION = "app.graycard.workflow.run";
const STAGE_COLLECTION = "app.graycard.workflow.stage";

async function resetFixture(request) {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
}

async function listRecords(request, collection) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection, limit: "100" },
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

async function addStep(dialog, label) {
  await dialog.getByLabel("Stage to add to template steps").selectOption({ label });
  await dialog.getByRole("button", { name: "Add step", exact: true }).click();
}

async function connect(dialog, sourceLabel, destinationLabel) {
  await dialog.getByLabel("Connection source step and port").selectOption({ label: sourceLabel });
  await dialog.getByLabel("Connection destination step and port").selectOption({ label: destinationLabel });
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Added workflow connection" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("a rich workflow can be authored, launched, advanced, and used on mobile", async ({ page, request }) => {
  const sequenceResponse = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: {
      repo: REPO,
      collection: "app.graycard.process.developmentPlan",
      record: {
        $type: "app.graycard.process.developmentPlan",
        name: "Standard B&W sequence",
        process: "bw",
        steps: [{ name: "Developer", roles: ["film-developer"], publishedTimeSeconds: 600 }],
        createdAt: new Date().toISOString(),
      },
    },
  });
  expect(sequenceResponse.ok()).toBe(true);
  const sequenceUri = (await sequenceResponse.json()).uri;
  await login(page);

  const body = page.locator("#library-body");
  await page.goto("/library/workflows");
  await body.getByRole("button", { name: "+ Template", exact: true }).click();

  const templateDialog = page.getByRole("dialog", { name: "New workflow template" });
  await expect(templateDialog).toBeVisible();
  await templateDialog.getByLabel("Name *").fill("Branching film workflow");
  await templateDialog.getByLabel("Medium *").selectOption("film");
  await addStep(templateDialog, "Capture");
  await addStep(templateDialog, "Develop");
  await addStep(templateDialog, "Develop");
  await addStep(templateDialog, "Digitize");

  await templateDialog.getByRole("button", { name: "Configure Develop, step 2" }).click();
  const firstDevelop = page.getByRole("dialog", { name: "Configure: Develop" });
  await firstDevelop.getByLabel("Film-processing sequence").selectOption(sequenceUri);
  await firstDevelop.getByRole("button", { name: "Save", exact: true }).click();
  await expect(firstDevelop).toBeHidden();

  await templateDialog.getByRole("button", { name: "Configure Develop, step 3" }).click();
  const stepDialog = page.getByRole("dialog", { name: "Configure: Develop" });
  await stepDialog.getByLabel("Step name").fill("Second bath");
  await stepDialog.locator("#workflow-step-optional").check();
  await stepDialog.getByLabel("Maximum times").fill("2");
  await stepDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(stepDialog).toBeHidden();

  await connect(templateDialog, "1. Capture · output", "2. Develop · input");
  await connect(templateDialog, "1. Capture · output", "3. Second bath · input");
  await connect(templateDialog, "2. Develop · output", "4. Digitize · input");
  await connect(templateDialog, "3. Second bath · output", "4. Digitize · input");
  await expect(templateDialog.locator(".workflow-topology-summary")).toHaveText("1 branch · 1 join");

  await templateDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(templateDialog).toBeHidden();
  await expect(body.locator(".gear-row").filter({ hasText: "Branching film workflow" })).toContainText(
    "Capture → Develop → Develop → Digitize",
  );

  const authoredTemplate = (await listRecords(request, TEMPLATE_COLLECTION)).find(
    (record) => record.value.name === "Branching film workflow",
  );
  expect(authoredTemplate?.value.connections).toHaveLength(4);
  expect(authoredTemplate?.value.steps?.[2]).toMatchObject({
    label: "Second bath",
    optional: true,
    cardinality: { min: 0, max: 2 },
  });

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const sessions = page.locator("#sessions-body");
  const shoot = sessions.locator(".session-card[data-kind='capture']").filter({ hasText: "Fixture photo walk" });
  await shoot.getByRole("button", { name: "Edit", exact: true }).click();

  const shootDialog = page.getByRole("dialog", { name: "Edit shoot" });
  await shootDialog.getByLabel("Ended (optional)").fill("2026-08-13T12:00");
  await shootDialog.getByLabel("Start another workflow (optional)").selectOption({ label: "Branching film workflow" });
  await shootDialog.getByLabel("Second bath (0–2)").fill("1");
  await shootDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(shootDialog).toBeHidden();

  const activeRun = sessions.locator(".workflow-run-row").filter({ hasText: "Branching film workflow" });
  await expect(activeRun).toContainText("Fixture photo walk · 1/4 complete");
  await expect(activeRun.getByRole("button", { name: "Log Develop", exact: true })).toHaveCount(2);
  await expect(activeRun.getByRole("button", { name: "Skip Develop", exact: true })).toHaveCount(1);
  await expect(activeRun.getByRole("button", { name: "Log Digitize", exact: true })).toHaveCount(0);

  const runs = await listRecords(request, RUN_COLLECTION);
  const run = runs.find((record) => record.value.templateName === "Branching film workflow");
  expect(run?.value).toMatchObject({ status: "in-progress", topology: "graph" });
  expect(run?.value.branches).toHaveLength(4);
  let stages = await listRecords(request, STAGE_COLLECTION);
  expect(stages.filter((record) => record.value.status === "completed")).toHaveLength(1);
  expect(stages.filter((record) => record.value.status === "ready")).toHaveLength(2);
  expect(stages.filter((record) => record.value.status === "planned")).toHaveLength(1);

  await activeRun.getByRole("button", { name: "Skip Develop", exact: true }).click();
  await expect(activeRun).toContainText("2/4 complete");
  await expect(activeRun.getByRole("button", { name: "Log Develop", exact: true })).toHaveCount(1);
  await expect(activeRun.getByRole("button", { name: "Skip Develop", exact: true })).toHaveCount(0);
  stages = await listRecords(request, STAGE_COLLECTION);
  expect(stages.filter((record) => record.value.status === "skipped")).toHaveLength(1);

  await activeRun.getByRole("button", { name: "Log Develop", exact: true }).click();
  const developLogger = page.getByRole("dialog", { name: "Log Develop" });
  await expect(developLogger.getByLabel("Film-processing sequence")).toHaveValue(sequenceUri);
  await expect(developLogger.getByText(/Developer.*Enter the actual time/)).toBeVisible();
  await developLogger.getByRole("button", { name: "Cancel" }).click();
  await expect(developLogger).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#bottom-nav")).toBeVisible();
  await expect(page.locator("#primary-nav")).toBeHidden();
  const mobileLayout = await activeRun.evaluate((row) => ({
    clientWidth: row.clientWidth,
    scrollWidth: row.scrollWidth,
    actionHeights: [...row.querySelectorAll(".workflow-run-actions button")].map(
      (button) => button.getBoundingClientRect().height,
    ),
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  expect(mobileLayout.actionHeights.length).toBeGreaterThan(0);
  expect(mobileLayout.actionHeights.every((height) => height >= 44)).toBe(true);
  // Mobile WebKit can retain a smaller visual viewport after the layout viewport
  // resizes. The fixed navigation must sit at the bottom of the visible area.
  const bottomNav = await page.locator("#bottom-nav").evaluate((navigation) => {
    const rect = navigation.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportBottom: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
    };
  });
  expect(bottomNav.top).toBeGreaterThanOrEqual(bottomNav.viewportBottom - 64);
  expect(bottomNav.bottom).toBeCloseTo(bottomNav.viewportBottom, 0);
});
