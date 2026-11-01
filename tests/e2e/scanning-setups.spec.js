import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";

async function listRecords(request, collection) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection, limit: "100" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).records;
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
});

test("a saved camera-scanning assembly is linked to owned gear and snapshotted in its session", async ({
  page,
  request,
}) => {
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ did: REPO, handle: "alice.test" }) }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: /Digitization/ }).click();
  await page.getByRole("button", { name: "New setup" }).click();

  const camera = (await listRecords(request, "app.graycard.instance.camera"))[0];
  expect(camera).toBeTruthy();
  const setupDialog = page.getByRole("dialog", { name: "New scanning setup" });
  await setupDialog.getByLabel("Setup name *").fill("120 copy stand");
  await setupDialog.getByRole("button", { name: "Add component" }).click();
  await setupDialog.getByLabel("Role").nth(0).fill("capture-camera");
  await setupDialog.getByLabel("Owned equipment").nth(0).selectOption(camera.uri);
  await setupDialog.getByRole("button", { name: "Add component" }).click();
  await setupDialog.getByLabel("Role").nth(1).fill("film-carrier");
  await setupDialog.getByLabel("Name or borrowed item").nth(1).fill("Borrowed 120 carrier");
  await setupDialog.getByRole("button", { name: "Add connection" }).click();
  await setupDialog.getByLabel("From").selectOption({ index: 0 });
  await setupDialog.getByLabel("To").selectOption({ index: 1 });
  await setupDialog.getByLabel("Relation").fill("mounted-over");
  await setupDialog.getByRole("button", { name: "Create setup" }).click();
  await expect(setupDialog).toBeHidden();

  const setup = (await listRecords(request, "app.graycard.instance.scanSetup"))[0];
  expect(setup?.value.components).toHaveLength(2);
  expect(setup.value.components[0].ref).toBe(camera.uri);
  expect(setup.value.connections).toHaveLength(1);

  await page.getByText("Log past work").click();
  await page.getByRole("button", { name: "Log digitization" }).click();
  const sessionDialog = page.getByRole("dialog", { name: "Log digitization session" });
  await sessionDialog.getByText("Process details", { exact: true }).click();
  await sessionDialog.getByLabel("Reusable scanning setup").selectOption(setup.uri);
  await sessionDialog.getByRole("button", { name: "Log digitization" }).click();
  await expect(sessionDialog).toBeHidden();

  const session = (await listRecords(request, "app.graycard.process.digitizeSession"))[0];
  expect(session.value.scanSetup).toBe(setup.uri);
  expect(session.value.camera).toBe(camera.uri);
  expect(session.value.setupSnapshot.components).toHaveLength(2);
  expect(session.value.setupSnapshot.connections).toHaveLength(1);
});
