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
  await settleInspectorCapture(page);
  await expect(page).toHaveScreenshot("gallery-photo-inspector.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function settleInspectorCapture(page) {
  await expect(page.locator("#photo-inspector-title")).toBeFocused();
  // Desktop captures include the page header; mobile captures follow inspector focus.
  // Settle layout before fixing the viewport so scroll anchoring cannot change the crop.
  if (page.viewportSize().width >= 900) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  }
}

async function visualStyle(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      font: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      color: style.color,
    };
  });
}

for (const theme of ["dark", "light"]) {
  test(`${theme} theme keeps page framing, headings, and disclosures consistent across views`, async ({ page }) => {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      localStorage.setItem("hypo:theme", value);
    }, theme);
    const frame = async () =>
      page.locator("main").evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: box.left, width: box.width, gutter: parseFloat(style.paddingLeft) };
      });
    const galleryFrame = await frame();
    const headingStyle = await visualStyle(page.locator(".gallery-title"));
    const subtitleStyle = await visualStyle(page.locator(".gallery-header .view-sub"));
    const nav = page.locator('nav[aria-label="Primary"]:visible');
    for (const [section, title, view] of [
      ["setup", "Library", "#library-view"],
      ["rolls", "Rolls", "#rolls-view"],
      ["sessions", "Sessions", "#sessions-view"],
      ["galleries", "Your galleries", "#list-view"],
    ]) {
      await nav.locator(`[data-section="${section}"]`).click();
      const heading = page.getByRole("heading", { name: title, exact: true, level: 2 });
      await expect(heading).toBeVisible();
      expect(await frame()).toEqual(galleryFrame);
      expect(await visualStyle(heading)).toEqual(headingStyle);
      expect(await visualStyle(page.locator(`${view} .view-sub`).first())).toEqual(subtitleStyle);
      expect((await heading.boundingBox()).x).toBeCloseTo(galleryFrame.left + galleryFrame.gutter, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.locator("#gallery-list .gallery-row").filter({ hasText: "Contact sheet" }).click();
    if (theme === "light") await expect(page).toHaveScreenshot("gallery-contact-sheet-light.png");
    await page.getByRole("button", { name: "Edit First frame", exact: true }).click();
    const fields = page.locator(".photo-fields:not([hidden])");
    if (theme === "light") {
      await settleInspectorCapture(page);
      await expect(page).toHaveScreenshot("gallery-photo-inspector-light.png");
    }
    const summary = fields.locator('[data-photo-section="exif"] > summary');
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(fields.getByLabel("Aperture", { exact: true })).toBeVisible();
    const disclosureStyle = await visualStyle(summary);
    await fields.getByLabel("Alt text").fill("Draft for save bar alignment");
    const saveEdges = await page.locator(".save-bar > .save-bar-inner").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    expect(saveEdges.left).toBeCloseTo(galleryFrame.left + galleryFrame.gutter, 0);
    expect(saveEdges.right).toBeCloseTo(galleryFrame.left + galleryFrame.width - galleryFrame.gutter, 0);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.locator(".save-bar")).toBeHidden();

    await page.goto("/library/chemistry");
    await page.getByRole("button", { name: "Add chemistry", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add chemistry" });
    const more = dialog.locator(".resource-editor-more > summary").first();
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.locator(".resource-editor-more").first()).toHaveAttribute("open", "");
    expect(await visualStyle(more)).toEqual(disclosureStyle);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto("/session/capture/shoot-a");
    const evidence = page.locator(".session-evidence > summary");
    await evidence.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".session-evidence")).toHaveAttribute("open", "");
    expect(await visualStyle(evidence)).toEqual(disclosureStyle);
  });
}

test("gallery panels respect shared density and remain contained at phone, tablet, and desktop widths", async ({
  page,
}) => {
  for (const width of [320, 768, 900, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const density of ["comfortable", "compact"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.density = value;
      }, density);
      const panelPadding = await page
        .locator(".gallery-details")
        .evaluate((element) => getComputedStyle(element).paddingLeft);
      if (density === "compact") expect(panelPadding).toBe("14px");
      const toolbar = await page.locator("#editor-body > .section-head").boundingBox();
      const gridBox = await page.locator("#photos").boundingBox();
      expect(gridBox.y - (toolbar.y + toolbar.height)).toBeGreaterThanOrEqual(16);
      const summariesContained = await page
        .locator(".gallery-tools > details, .gallery-tools > div > details")
        .evaluateAll((cards) =>
          cards.every((card) => {
            const cardBox = card.getBoundingClientRect();
            const titleBox = card.querySelector("summary h2").getBoundingClientRect();
            return titleBox.left >= cardBox.left + 12 && titleBox.right <= cardBox.right - 12;
          }),
        );
      expect(summariesContained).toBe(true);
      await page.getByRole("button", { name: "Edit First frame", exact: true }).click();
      const inspector = page.locator("#photo-inspector");
      await expect(inspector).toHaveCSS("padding-left", panelPadding);
      await inspector.locator('.photo-fields:not([hidden]) [data-photo-section="gear"] > summary').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await inspector.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      if (width >= 900) {
        const grid = await page.locator("#photos").boundingBox();
        expect(grid.x + grid.width).toBeLessThan(bounds.x);
      }
      await inspector.getByRole("button", { name: "Back to photos" }).click();
    }
  }
});

test("photo captions, optional badges, and EXIF values keep aligned rows after editing", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Third frame", exact: true }).click();
  const fields = page.locator(".photo-fields:not([hidden])");
  await fields
    .getByLabel("Alt text")
    .fill("Evening light on the hillside, with a long caption that wraps across several lines in a small photo card.");
  await fields.locator('[data-photo-section="exif"] > summary').click();
  await fields.getByLabel("Aperture", { exact: true }).fill("22");
  await fields.getByLabel("ISO", { exact: true }).fill("12800");
  await fields.getByLabel("Exposure", { exact: true }).fill("1/8000");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await page.getByRole("button", { name: "Back to photos", exact: true }).click();
  const checkAlignment = async () => {
    const geometry = await page.locator("#photos .photo-card").evaluateAll((cards) =>
      cards.map((card) => ({
        readoutOffset:
          card.querySelector(".photo-readout").getBoundingClientRect().top - card.getBoundingClientRect().top,
        captionHeight: card.querySelector(".photo-caption").getBoundingClientRect().height,
        overflow: card.scrollWidth - card.clientWidth,
        readoutHeight: card.querySelector(".exif-readout").getBoundingClientRect().height,
        readoutOverflow:
          card.querySelector(".exif-readout").scrollWidth - card.querySelector(".exif-readout").clientWidth,
      })),
    );
    // Compare raw CSS pixels: rounding each offset first can put subpixel
    // differences on opposite sides of an integer boundary in WebKit.
    for (const dimension of ["readoutOffset", "captionHeight", "readoutHeight"]) {
      const sizes = geometry.map((card) => card[dimension]);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
    for (const card of geometry) {
      expect(card.overflow).toBeLessThanOrEqual(1);
      expect(card.readoutOverflow).toBeLessThanOrEqual(1);
    }
  };
  await checkAlignment();
  await expect(page.locator('#photos .photo-card[data-frame="2"] .badge')).toHaveCount(0);
  await expect(page.locator('#photos .photo-card[data-frame="3"] .badge')).toHaveText(["exif", "alt"]);
  for (const toast of await page.locator(".toast").all()) await toast.click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator("#photos")).toHaveScreenshot("gallery-mixed-metadata.png");
  await page.getByRole("button", { name: "Edit Photo 2", exact: true }).click();
  await fields.getByLabel("Alt text").fill("Now described");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".save-bar")).toBeHidden();
  await page.getByRole("button", { name: "Back to photos", exact: true }).click();
  await expect(page.locator('#photos .photo-card[data-frame="2"] .badge')).toHaveText(["alt"]);
  await checkAlignment();
  await expect(page.locator("#gallery-coverage-summary")).toContainText("3 with alt text");
});
