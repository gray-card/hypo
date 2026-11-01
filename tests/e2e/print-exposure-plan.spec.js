import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import axeCore from "axe-core";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const PHOTO = "social.grain.photo";
const PLAN = "app.graycard.print.exposurePlan";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARMAgYKSBAQAJbQIBhQeUNQAAAABJRU5ErkJggg==",
  "base64",
);

async function records(request, collection) {
  const response = await request.get(`${PDS_ORIGIN}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).records;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${PDS_ORIGIN}/__fixture__/reset`)).ok()).toBe(true);
  const uploaded = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.uploadBlob`, {
    data: PNG,
    headers: { "content-type": "image/png" },
  });
  expect(uploaded.ok()).toBe(true);
  const { blob } = await uploaded.json();
  expect(
    (
      await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
        data: {
          repo: REPO,
          collection: PHOTO,
          rkey: "reference",
          record: { $type: PHOTO, photo: blob, alt: "Portrait reference", createdAt: new Date().toISOString() },
        },
      })
    ).ok(),
  ).toBe(true);
});

test("draws, orders, saves, and reopens a split-grade plan with polygon dodge and brush burn", async ({
  page,
  request,
}) => {
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ did: REPO, handle: "alice.test" }) }),
  );
  await page.route("**/xrpc/com.atproto.sync.getBlob**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: /^Print/ }).click();
  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New print exposure plan" });
  await dialog.getByLabel("Plan name").fill("Split-grade portrait");
  await dialog.getByRole("combobox", { name: "Reference photo" }).selectOption({ label: "Portrait reference" });
  await expect(dialog.locator(".print-plan-image")).toHaveAttribute("src", /^blob:/);
  await dialog.getByRole("button", { name: "Add dodge" }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Hold back face");
  await dialog.getByLabel("Time (seconds)").fill("3.5");
  await dialog.getByLabel("Start at (seconds)").fill("2");
  await dialog.getByLabel("Region name").fill("face");
  await dialog.getByRole("button", { name: "Polygon" }).click();
  const overlay = dialog.getByRole("img", { name: "Exposure selections" });
  await overlay.click({ position: { x: 60, y: 60 } });
  await overlay.click({ position: { x: 170, y: 60 } });
  await overlay.click({ position: { x: 150, y: 160 } });
  await dialog.locator(".print-plan-canvas").focus();
  await dialog.locator(".print-plan-canvas").press("Enter");
  await dialog.getByRole("button", { name: "Add base exposure" }).click();
  await dialog.getByLabel("Contrast grade").fill("5");
  await dialog.getByRole("button", { name: "Add burn" }).click();
  await dialog.getByLabel("Region name").fill("sky");
  await dialog.getByRole("button", { name: "Brush" }).click();
  const box = await overlay.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + 40, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 32, { steps: 10 });
  await page.mouse.up();
  await page.addScriptTag({ content: axeCore.source });
  const audit = await page.evaluate(async () =>
    window.axe.run(document.querySelector('[role="dialog"]'), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    }),
  );
  expect(
    audit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)),
    JSON.stringify(audit.violations, null, 2),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await dialog.evaluate((node) => ({
    right: node.getBoundingClientRect().right,
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(mobileLayout.right).toBeLessThanOrEqual(mobileLayout.viewport + 1);
  expect(mobileLayout.width).toBeLessThanOrEqual(mobileLayout.viewport + 1);
  await expect(dialog.getByRole("button", { name: "Save plan" })).toBeInViewport();
  await dialog.getByRole("button", { name: "Save plan" }).click();
  await expect(dialog).toBeHidden();
  const [record] = await records(request, PLAN);
  expect(record.value.exposures.map((step) => step.action)).toEqual(["base", "dodge", "base", "burn"]);
  expect(record.value.exposures[1].durationMs).toBe(3500);
  expect(record.value.exposures[1].startOffsetMs).toBe(2000);
  expect(record.value.exposures[1].selections[0].kind).toBe("polygon");
  expect(record.value.exposures[3].selections[0].kind).toBe("brush");
  await page
    .locator(".gear-row")
    .filter({ hasText: "Split-grade portrait" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const editDialog = page.getByRole("dialog", { name: "Edit print exposure plan" });
  await expect(editDialog.getByLabel("Plan name")).toHaveValue("Split-grade portrait");
  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Log past work").click();
  await page.getByRole("button", { name: "Log print", exact: true }).click();
  const printDialog = page.getByRole("dialog", { name: "Log print session" });
  await printDialog.getByLabel("Print exposure plan").selectOption(record.uri);
  await printDialog.getByRole("button", { name: "Log print", exact: true }).click();
  await expect(printDialog).toBeHidden();
  const [session] = await records(request, "app.graycard.process.printSession");
  expect(session.value.exposurePlan).toBe(record.uri);
  expect(session.value.exposurePlanSnapshot.exposures).toHaveLength(4);
  const sessionCard = page.locator('.session-card[data-kind="print"]');
  await sessionCard.getByRole("button", { name: "Edit", exact: true }).click();
  const editPrint = page.getByRole("dialog", { name: "Edit print session" });
  await expect(editPrint.getByLabel("Print exposure plan")).toHaveValue(record.uri);
  await editPrint.getByRole("button", { name: "Save changes" }).click();
  await expect(editPrint).toBeHidden();
  expect(
    (await records(request, "app.graycard.process.printSession"))[0].value.exposurePlanSnapshot.exposures,
  ).toHaveLength(4);
  await sessionCard.getByRole("button", { name: "Edit", exact: true }).click();
  const clearPrint = page.getByRole("dialog", { name: "Edit print session" });
  await clearPrint.getByLabel("Print exposure plan").selectOption("");
  await clearPrint.getByRole("button", { name: "Save changes" }).click();
  await expect(clearPrint).toBeHidden();
  const [cleared] = await records(request, "app.graycard.process.printSession");
  expect(cleared.value.exposurePlan).toBeUndefined();
  expect(cleared.value.exposurePlanSnapshot).toBeUndefined();
});

test("imports a semantic scene region without making the plan depend on later scene edits", async ({
  page,
  request,
}) => {
  const reference = `at://${REPO}/${PHOTO}/reference`;
  const regionResponse = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: {
      repo: REPO,
      collection: "app.graycard.scene.region",
      record: {
        $type: "app.graycard.scene.region",
        photo: reference,
        kind: "polygon",
        geometry: {
          points: [
            [100000, 100000],
            [600000, 100000],
            [500000, 500000],
          ],
        },
        format: "graycard-polygon",
        createdAt: new Date().toISOString(),
      },
    },
  });
  expect(regionResponse.ok()).toBe(true);
  const region = await regionResponse.json();
  const nodeResponse = await request.post(`${PDS_ORIGIN}/xrpc/com.atproto.repo.createRecord`, {
    data: {
      repo: REPO,
      collection: "app.graycard.scene.node",
      record: {
        $type: "app.graycard.scene.node",
        scene: `at://${REPO}/app.graycard.scene.graph/one`,
        type: { id: "object", label: "Object" },
        label: "Portrait face",
        region: region.uri,
        createdAt: new Date().toISOString(),
      },
    },
  });
  expect(nodeResponse.ok()).toBe(true);
  const node = await nodeResponse.json();
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ did: REPO, handle: "alice.test" }) }),
  );
  await page.route("**/xrpc/com.atproto.sync.getBlob**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: /^Print/ }).click();
  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New print exposure plan" });
  await dialog.getByLabel("Plan name").fill("Face dodge");
  await dialog.getByRole("combobox", { name: "Reference photo" }).selectOption(reference);
  await dialog.getByRole("button", { name: "Add dodge" }).click();
  await dialog.getByRole("combobox", { name: "Import scene region" }).selectOption(region.uri);
  await expect(dialog.getByLabel("Region name")).toHaveValue("Portrait face");
  await dialog.getByRole("button", { name: "Save plan" }).click();
  await expect(dialog).toBeHidden();
  const [plan] = await records(request, PLAN);
  expect(plan.value.exposures[1].targetNode).toBe(node.uri);
  expect(plan.value.exposures[1].selections[0]).toMatchObject({
    sourceRegion: region.uri,
    kind: "polygon",
    points: [
      { x: 1000, y: 1000 },
      { x: 6000, y: 1000 },
      { x: 5000, y: 5000 },
    ],
  });
});
