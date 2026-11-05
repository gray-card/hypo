import { expect, test } from "@playwright/test";

const PDS = "http://127.0.0.1:2584";
const DID = "did:plc:alice";

async function create(request, collection, record) {
  const response = await request.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    data: { repo: DID, collection, record: { $type: collection, ...record } },
  });
  expect(response.ok()).toBe(true);
  return await response.json();
}

async function records(request, collection) {
  const response = await request.get(`${PDS}/xrpc/com.atproto.repo.listRecords`, { params: { repo: DID, collection } });
  expect(response.ok()).toBe(true);
  return (await response.json()).records;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${PDS}/__fixture__/reset`)).ok()).toBe(true);
});

test("reuses a film-processing sequence while keeping actual session steps and a plan snapshot", async ({
  page,
  request,
}) => {
  const now = new Date().toISOString();
  const stock = await create(request, "app.graycard.catalog.filmStock", { name: "Fixture film", createdAt: now });
  const chemistryType = await create(request, "app.graycard.catalog.chemistryType", {
    name: "Fixture developer",
    roles: ["film-developer"],
    createdAt: now,
  });
  const chemistry = await create(request, "app.graycard.instance.chemistry", {
    type: chemistryType.uri,
    createdAt: now,
  });
  const roll = await create(request, "app.graycard.instance.filmRoll", {
    stock: stock.uri,
    status: "exposed",
    createdAt: now,
  });
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ did: DID, handle: "alice.test" }) }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.locator("#bottom-nav")).toBeHidden();
  await page.locator("#primary-nav").getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: /^Development/ }).click();
  await page.getByRole("button", { name: "New sequence" }).click();
  const planDialog = page.getByRole("dialog", { name: "New film-processing sequence" });
  await planDialog.getByLabel("Sequence name").fill("BW tank sequence");
  await planDialog.getByLabel("Primary chemistry for stage").selectOption(chemistry.uri);
  await planDialog.getByRole("button", { name: "Save sequence" }).click();
  await expect(planDialog).toBeHidden();
  const [plan] = await records(request, "app.graycard.process.developmentPlan");
  expect(plan.value.steps[0].chemistries).toEqual([chemistry.uri]);
  expect(plan.value.steps[0]).not.toHaveProperty("actualTimeSeconds");
  await page.getByText("Log past work").click();
  await page.getByRole("button", { name: "Log completed development" }).click();
  const logDialog = page.getByRole("dialog", { name: "Log completed development" });
  await logDialog.getByLabel("Film-processing sequence").selectOption(plan.uri);
  await logDialog.locator(`input[type="checkbox"][value="${roll.uri}"]`).check();
  await logDialog.getByRole("button", { name: "Log development" }).click();
  await expect(logDialog).toBeHidden();
  const [session] = await records(request, "app.graycard.process.developSession");
  expect(session.value.developmentPlan).toBe(plan.uri);
  expect(session.value.developmentPlanSnapshot.steps[0].chemistries).toEqual([chemistry.uri]);
  expect(session.value.steps[0].chemistries).toEqual([chemistry.uri]);
});
