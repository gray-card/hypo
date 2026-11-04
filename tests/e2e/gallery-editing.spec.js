import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const PDS = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const GALLERY = `at://${REPO}/social.grain.gallery/disclosure`;
const PHOTO = "social.grain.photo";
const ITEM = "social.grain.gallery.item";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function record(request, collection, rkey) {
  const response = await request.get(`${PDS}/xrpc/com.atproto.repo.getRecord`, {
    params: { repo: REPO, collection, rkey },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).value;
}

test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${PDS}/__fixture__/reset`)).ok()).toBe(true);
  const upload = await request.post(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    data: png,
    headers: { "content-type": "image/png" },
  });
  const { blob } = await upload.json();
  const create = async (collection, rkey, value) => {
    const response = await request.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
      data: {
        repo: REPO,
        collection,
        rkey,
        record: { $type: collection, createdAt: "2026-01-01T00:00:00.000Z", ...value },
      },
    });
    expect(response.ok()).toBe(true);
  };
  await create("social.grain.gallery", "disclosure", {
    title: "Contact sheet",
    description: "Gallery editing fixture",
  });
  for (const [index, alt] of ["First frame", "", "Third frame"].entries()) {
    await create(PHOTO, `photo-${index + 1}`, { photo: blob, alt, aspectRatio: { width: 1, height: 1 } });
    await create(ITEM, `item-${index + 1}`, {
      gallery: GALLERY,
      item: `at://${REPO}/${PHOTO}/photo-${index + 1}`,
      position: index,
    });
  }
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ did: REPO, handle: "alice.test" }) }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.locator('nav[aria-label="Primary"]:visible [data-section="galleries"]').click();
  await page.locator("#gallery-list .gallery-row").filter({ hasText: "Contact sheet" }).click();
  await expect(page.getByRole("heading", { name: "Photos (3)" })).toBeVisible();
});

test("gallery fields do not write on blur; Save changes persists the draft", async ({ page, request }) => {
  const writes = [];
  page.on("request", (req) => {
    if (/repo\.(putRecord|createRecord)$/.test(new URL(req.url()).pathname)) writes.push(req.postDataJSON());
  });
  await page.locator(".gallery-details > summary").click();
  await page.getByLabel("Title", { exact: true }).fill("Revised contact sheet");
  await page.locator(".gallery-header textarea").focus();
  expect(writes).toHaveLength(0);
  expect((await record(request, "social.grain.gallery", "disclosure")).title).toBe("Contact sheet");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".gallery-title")).toHaveText("Revised contact sheet");
  await expect
    .poll(async () => (await record(request, "social.grain.gallery", "disclosure")).title)
    .toBe("Revised contact sheet");
  expect(writes).toHaveLength(1);
  expect(writes[0].swapRecord).toBeTruthy();
  await page.reload();
  await expect(page.locator(".gallery-title")).toHaveText("Revised contact sheet");
});

test("photo drafts and disclosures survive navigation, closing, saving, and reload", async ({ page, request }) => {
  const firstPhoto = page.getByRole("button", { name: "Edit First frame", exact: true });
  // Measure after Playwright's automatic click scrolling, at the user's action.
  await firstPhoto.evaluate((control) =>
    control.addEventListener(
      "click",
      () => {
        control.dataset.scrollBeforeOpen = String(window.scrollY);
      },
      { capture: true, once: true },
    ),
  );
  await firstPhoto.click();
  const gridScroll = Number(await page.locator("[data-scroll-before-open]").getAttribute("data-scroll-before-open"));
  const inspector = page.locator("#photo-inspector");
  await inspector.locator(".photo-fields:not([hidden])").getByLabel("Alt text").fill("Light across the lake");
  await inspector.locator(".photo-fields:not([hidden]) summary", { hasText: "Exposure and EXIF" }).click();
  await inspector.getByRole("button", { name: "Next photo" }).click();
  await expect(inspector.locator(".photo-fields:not([hidden])").getByLabel("Aperture", { exact: true })).toBeVisible();
  await inspector.locator(".photo-fields:not([hidden])").getByLabel("Alt text").fill("Second frame description");
  await inspector.getByRole("button", { name: "Previous photo" }).click();
  await expect(inspector.locator(".photo-fields:not([hidden])").getByLabel("Alt text")).toHaveValue(
    "Light across the lake",
  );
  expect((await record(request, PHOTO, "photo-1")).alt).toBe("First frame");
  await inspector.getByRole("button", { name: "Back to photos" }).click();
  await expect(page.getByRole("button", { name: "Edit First frame", exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(gridScroll);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await expect.poll(async () => (await record(request, PHOTO, "photo-2")).alt).toBe("Second frame description");
  await page.reload();
  await page.getByRole("button", { name: "Edit Light across the lake", exact: true }).click();
  await expect(inspector.locator(".photo-fields:not([hidden])").getByLabel("Alt text")).toHaveValue(
    "Light across the lake",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("validation reveals a different photo's collapsed invalid field", async ({ page }) => {
  await page.getByRole("button", { name: "Edit First frame", exact: true }).click();
  const inspector = page.locator("#photo-inspector");
  await inspector.locator(".photo-fields:not([hidden]) summary", { hasText: "Exposure and EXIF" }).click();
  await inspector.locator(".photo-fields:not([hidden])").getByLabel("Aperture", { exact: true }).fill("invalid");
  await inspector.locator(".photo-fields:not([hidden]) summary", { hasText: "Exposure and EXIF" }).click();
  await inspector.getByRole("button", { name: "Next photo" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("#photo-inspector-title")).toHaveText("Photo 1");
  await expect(inspector.locator(".photo-fields:not([hidden])").getByLabel("Aperture", { exact: true })).toBeFocused();
  await inspector.locator(".photo-fields:not([hidden])").getByLabel("Aperture", { exact: true }).fill("2.8");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
});

test("selection-scoped batch rules retain gallery frame numbers and require confirmation", async ({
  page,
  request,
}) => {
  await expect(page.locator(".select-bar")).toBeHidden();
  await page.getByRole("checkbox", { name: "Select Photo 2", exact: true }).check();
  await expect(page.locator("#photo-inspector")).toBeHidden();
  await page.getByRole("button", { name: "Use a rule…" }).click();
  const batch = page.locator("#gallery-batch-rules");
  await batch.getByRole("combobox", { name: /^Rule/ }).selectOption("empty-alt");
  await batch.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(batch.locator(".batch-preview")).toContainText("#2:");
  expect((await record(request, PHOTO, "photo-2")).alt).toBe("");
  await batch.getByRole("button", { name: "Apply and save", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("1 selected");
  await dialog.getByRole("button", { name: "Apply and save", exact: true }).click();
  await expect.poll(async () => (await record(request, PHOTO, "photo-2")).alt).toBe("Contact sheet #2");
  expect((await record(request, PHOTO, "photo-1")).alt).toBe("First frame");
  expect((await record(request, PHOTO, "photo-3")).alt).toBe("Third frame");
});

test("reordering is staged and can be saved repeatedly", async ({ page, request }) => {
  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  await page.locator("#photos .photo-card").first().getByRole("button", { name: "Move down", exact: true }).click();
  expect((await record(request, ITEM, "item-1")).position).toBe(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await expect.poll(async () => (await record(request, ITEM, "item-1")).position).toBe(1);
  await page.locator("#photos .photo-card").first().getByRole("button", { name: "Move down", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await expect.poll(async () => (await record(request, ITEM, "item-1")).position).toBe(0);
});

test("shared gear saves explicitly and individual overrides preserve inheritance", async ({ page, request }) => {
  const shared = page
    .locator(".gallery-tools details")
    .filter({ has: page.getByRole("heading", { name: "Shared gear", exact: true }) });
  await shared.locator("summary").click();
  const cameraA = `at://${REPO}/app.graycard.instance.camera/camera-a`;
  const cameraB = `at://${REPO}/app.graycard.instance.camera/camera-b`;
  const lens = `at://${REPO}/app.graycard.instance.lens/lens-a`;
  await shared.getByRole("combobox", { name: "Camera", exact: true }).selectOption(cameraA);
  await shared.getByRole("combobox", { name: "Lens", exact: true }).selectOption(lens);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await shared.locator("summary").click();
  await page.getByRole("button", { name: "Edit First frame", exact: true }).click();
  const fields = page.locator(".photo-fields:not([hidden])");
  await fields.locator("summary", { hasText: "Capture and gear" }).click();
  const camera = fields.getByRole("combobox", { name: "Camera", exact: true });
  await expect(camera).toHaveValue(cameraA);
  await camera.selectOption(cameraB);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  const response = await request.get(`${PDS}/xrpc/com.atproto.repo.listRecords`, {
    params: { repo: REPO, collection: "app.graycard.photo.capture" },
  });
  const [capture] = (await response.json()).records;
  expect(capture.value.camera).toBe(cameraB);
  expect(capture.value).not.toHaveProperty("lens");
  await fields.getByRole("button", { name: "Use shared gear", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await expect(camera).toHaveValue(cameraA);
  expect(await record(request, "app.graycard.photo.capture", capture.uri.split("/").at(-1))).not.toHaveProperty(
    "camera",
  );
});

test("contact sheet and inspector fit the viewport", async ({ page }) => {
  await expect(page).toHaveScreenshot("gallery-contact-sheet.png");
  await page.getByRole("button", { name: "Edit First frame", exact: true }).click();
  await expect(page).toHaveScreenshot("gallery-photo-inspector.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
