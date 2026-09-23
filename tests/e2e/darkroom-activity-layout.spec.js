import { expect, test } from "@playwright/test";

const ACTIVITY_FIXTURE = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Darkroom activity layout fixture</title>
    <link rel="stylesheet" href="/src/fonts.css" />
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <main style="width: min(760px, 100%); padding: 24px;">
      <section class="card" id="activity-card">
        <h3 style="margin: 0;">Recent darkroom activity</h3>
        <ul class="gear-list development-activity-list">
          <li>
            <button class="gear-row development-activity-row" type="button">
              <span class="development-activity-main">
                <strong>Developed</strong>
                <span class="small development-activity-subject">Roll with a long descriptive production label</span>
                <span class="muted small development-activity-summary">BW · D-76 stock · working bottle · Kodak D-76 film developer · 7:20 · Inversion · first 60s · every 60s for 10s · Developer 7:20 → Stop bath 30s → Fixer 5:00</span>
              </span>
              <time class="muted small mono development-activity-date" datetime="2026-09-20T16:20:00.000Z">9/20/2026</time>
            </button>
          </li>
        </ul>
      </section>
    </main>
  </body>
</html>`;

async function expectContained(locator) {
  const overflow = await locator.evaluate((element) => Math.ceil(element.scrollWidth - element.clientWidth));
  expect(overflow).toBeLessThanOrEqual(0);
}

test("darkroom activity rows stay neutral and contain long summaries", async ({ page }) => {
  await page.route("**/__e2e__/darkroom-activity", (route) =>
    route.fulfill({ contentType: "text/html", body: ACTIVITY_FIXTURE }),
  );
  await page.goto("/__e2e__/darkroom-activity");

  const card = page.locator("#activity-card");
  const row = page.locator(".development-activity-row");
  const summary = page.locator(".development-activity-summary");
  await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(summary).toHaveCSS("white-space", "normal");
  await expectContained(row);
  await expectContained(card);

  await page.setViewportSize({ width: 360, height: 720 });
  await expectContained(row);
  await expectContained(card);
  await expect(row.locator("time")).toBeInViewport();
});
