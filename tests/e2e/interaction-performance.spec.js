import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";

const PDS = "http://127.0.0.1:2584";
const DID = "did:plc:alice";
const LIST_RECORDS = `${PDS}/xrpc/com.atproto.repo.listRecords**`;
const INTERACTION_BUDGET_MS = 750;
const PHOTO_COUNT = 48;

test("warm interactions are responsive even while the PDS is stalled", async ({ page, request }, testInfo) => {
  expect((await request.post(`${PDS}/__fixture__/reset`)).ok()).toBe(true);
  const create = async (collection, rkey, value) => {
    const response = await request.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
      data: {
        repo: DID,
        collection,
        rkey,
        record: { $type: collection, createdAt: "2026-01-01T00:00:00.000Z", ...value },
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).uri;
  };
  const stock = await create("app.graycard.catalog.filmStock", "perf-stock", {
    brand: "Fixture",
    name: "Benchmark 400",
  });
  await create("app.graycard.instance.filmRoll", "perf-roll", { stock, label: "Benchmark roll", status: "loaded" });
  const gallery = await create("social.grain.gallery", "perf-gallery", { title: "Benchmark gallery" });
  const blobResponse = await request.post(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    data: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    headers: { "content-type": "image/png" },
  });
  expect(blobResponse.ok()).toBe(true);
  const { blob } = await blobResponse.json();
  for (let position = 0; position < PHOTO_COUNT; position += 1) {
    const photo = await create("social.grain.photo", `perf-photo-${position}`, {
      photo: blob,
      alt: `Benchmark frame ${position + 1}`,
      aspectRatio: { width: 1, height: 1 },
    });
    await create("social.grain.gallery.item", `perf-photo-link-${position}`, { gallery, item: photo, position });
  }

  let followingStarted = false;
  await page.route("https://public.api.bsky.app/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("app.bsky.graph.getFollows")) {
      followingStarted = true;
      return route.fulfill({ json: { follows: [] } });
    }
    return route.fulfill({ json: { did: DID, handle: "alice.test" } });
  });
  await page.route("https://plc.directory/**", (route) =>
    route.fulfill({
      json: { service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] },
    }),
  );
  await page.route("https://constellation.microcosm.blue/**", (route) =>
    route.fulfill({ json: { total: 0, linking_records: [], linking_dids: [] } }),
  );
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  const sections = page.getByRole("navigation", { name: "Primary" });
  const navigate = (name) => sections.getByRole("button", { name, exact: true }).click();
  const library = page.locator(".library-shell");
  await expect(library).toBeVisible();
  await expect.poll(() => followingStarted).toBe(true);

  // Warm the store and the gallery collections before withholding every list response.
  const galleryRow = page.locator(".gallery-row").filter({ hasText: "Benchmark gallery" });
  await navigate("Galleries");
  await expect(galleryRow.locator(".cov-row")).toBeVisible();
  await galleryRow.click();
  const photos = page.getByRole("heading", { name: `Photos (${PHOTO_COUNT})` });
  await expect(photos).toBeVisible();
  await navigate("Discover");
  const discoverSearch = page.getByPlaceholder("View a setup by @handle");
  await expect(discoverSearch).toBeVisible();
  await navigate("Rolls");
  const row = page.locator(".roll-ledger-row").filter({ hasText: "Benchmark roll" });
  await expect(row).toBeVisible();
  await page.waitForLoadState("networkidle");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const measurements = [];
  let listRequests = 0;
  const resume = Promise.withResolvers();
  await page.route(LIST_RECORDS, async (route) => {
    listRequests += 1;
    await resume.promise;
    await route.continue();
  });
  const sample = async (label, action, ready) => {
    const count = listRequests;
    const started = performance.now();
    try {
      await action();
      await ready();
    } finally {
      measurements.push({
        action: label,
        elapsedMs: Math.round(performance.now() - started),
        listRequests: listRequests - count,
      });
    }
    expect(measurements.at(-1).elapsedMs, label).toBeLessThan(INTERACTION_BUDGET_MS);
  };
  const shown = (locator) => () => expect(locator).toBeVisible({ timeout: INTERACTION_BUDGET_MS });
  const hidden = (locator) => () => expect(locator).toBeHidden({ timeout: INTERACTION_BUDGET_MS });
  try {
    const rollEditor = page.getByRole("dialog", { name: /Roll · Fixture Benchmark 400/ });
    await sample("Open film roll", () => row.getByRole("button", { name: "Manage" }).click(), shown(rollEditor));
    await sample(
      "Edit roll label",
      () => rollEditor.getByLabel("Label", { exact: true }).fill("Unsaved label"),
      () => expect(rollEditor.getByLabel("Label", { exact: true })).toHaveValue("Unsaved label"),
    );
    await sample(
      "Cancel roll edit",
      () => rollEditor.getByRole("button", { name: "Cancel" }).click(),
      hidden(rollEditor),
    );
    expect(listRequests, "Opening and canceling a current roll should require no collection reads").toBe(0);
    await row.getByRole("button", { name: "Manage" }).click();
    await rollEditor.getByLabel("Label", { exact: true }).fill("Benchmark roll saved");
    await sample(
      "Save roll edit",
      () => rollEditor.getByRole("button", { name: "Save" }).click(),
      shown(page.getByText("Benchmark roll saved", { exact: false }).first()),
    );
    await expect(rollEditor).toBeHidden();
    expect(listRequests, "A successful roll write should use the acknowledged record").toBe(0);

    const session = page.getByRole("button", { name: "View", exact: true }).first();
    await sample("Open Sessions", () => navigate("Sessions"), shown(session));
    await sample(
      "Open session detail",
      () => session.click(),
      shown(page.getByRole("heading", { name: "Capture session" })),
    );
    await sample("Open Library", () => navigate("Library"), shown(library));
    await sample(
      "Open camera list",
      () => library.getByRole("button", { name: "Cameras", exact: true }).click(),
      shown(library.getByRole("button", { name: "Edit", exact: true }).first()),
    );
    const gearEditor = page.getByRole("dialog", { name: "Edit camera" });
    await sample(
      "Open gear editor",
      () => library.getByRole("button", { name: "Edit", exact: true }).first().click(),
      shown(gearEditor),
    );
    await sample(
      "Close gear editor",
      () => gearEditor.getByRole("button", { name: "Cancel" }).click(),
      hidden(gearEditor),
    );
    await sample("Open Galleries", () => navigate("Galleries"), shown(galleryRow));
    await sample("Open gallery editor", () => galleryRow.click(), shown(photos));
    await expect(page.locator(".photo-fields textarea")).toHaveCount(0);
    const altText = page.locator(".photo-fields:visible").getByLabel("Alt text");
    await sample(
      "Open gallery photo inspector",
      () => page.getByRole("button", { name: "Edit Benchmark frame 1", exact: true }).click(),
      shown(altText),
    );
    await sample(
      "Move to next photo",
      () => page.getByRole("button", { name: "Next photo" }).click(),
      () => expect(altText).toHaveValue("Benchmark frame 2", { timeout: INTERACTION_BUDGET_MS }),
    );
    await sample("Open Following", () => navigate("Following"), shown(page.getByText("Your following feed is empty")));
    await sample("Open Discover", () => navigate("Discover"), shown(discoverSearch));
  } finally {
    resume.resolve();
    const { profile } = await cdp.send("Profiler.stop");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const target = testInfo.outputPath("interaction-metrics.json");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ budgetMs: INTERACTION_BUDGET_MS, measurements, metrics }, null, 2));
    await writeFile(testInfo.outputPath("interaction-profile.cpuprofile"), JSON.stringify(profile));
    console.table(measurements);
  }
});
