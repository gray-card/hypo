import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const PHOTO_COLLECTION = "social.grain.photo";

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
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("a browser gallery upload writes a canonical, Grain-sized photo record", async ({ page, request }) => {
  await login(page);
  await page.locator('nav[aria-label="Primary"]:visible [data-section="galleries"]').click();
  await expect(page.getByRole("heading", { name: "Your galleries" })).toBeVisible();
  await page.getByRole("button", { name: "New gallery", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "New gallery" });
  await dialog.getByPlaceholder("Gallery title").fill("Conformance upload");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000" viewBox="0 0 4000 3000">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f43f5e"/>
          <stop offset="0.5" stop-color="#0ea5e9"/>
          <stop offset="1" stop-color="#facc15"/>
        </linearGradient>
      </defs>
      <rect width="4000" height="3000" fill="url(#g)"/>
      <circle cx="2000" cy="1500" r="900" fill="#111827" fill-opacity="0.55"/>
    </svg>`;
  await dialog.getByLabel("Photos to upload").setInputFiles({
    name: "large-fixture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await dialog.getByRole("button", { name: "Create gallery", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await listRecords(request, PHOTO_COLLECTION)).length).toBe(1);
  const [photoView] = await listRecords(request, PHOTO_COLLECTION);
  const record = photoView.value;

  expect(record.$type).toBe(PHOTO_COLLECTION);
  expect(record.photo).toEqual({
    $type: "blob",
    ref: { $link: expect.stringMatching(/^baf/) },
    mimeType: "image/jpeg",
    size: expect.any(Number),
  });
  expect(record.photo.size).toBeLessThanOrEqual(900_000);
  expect(record.photo).not.toHaveProperty("original");
  expect(record.aspectRatio).toEqual({ width: 2000, height: 1500 });
  expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(JSON.stringify(record)).not.toContain("[object Object]");
});
