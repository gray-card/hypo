import { expect, test } from "@playwright/test";
import axeCore from "axe-core";

const PDS_ORIGIN = "http://127.0.0.1:2584";
const REPO = "did:plc:alice";
const FIXED_TIME = new Date("2026-01-15T12:00:00.000Z");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const STABLE_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`;

async function resetFixture(request) {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
}

async function preparePage(page) {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hypo:theme", "dark");
      localStorage.setItem("hypo:density", "comfortable");
    } catch {
      // Storage is available on the app origin; about:blank may reject it.
    }
  });
  await page.route("https://public.api.bsky.app/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ did: REPO, handle: "alice.test" }),
    }),
  );
}

async function openLogin(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Log in with your atmosphere account" })).toBeVisible();
}

async function login(page) {
  await openLogin(page);
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
  await expect(page.locator("#library-body").getByRole("listitem").filter({ hasText: "black body" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function stabilize(page) {
  await page.addStyleTag({ content: STABLE_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0);
}

function formatViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary || "No failure summary"}`)
        .join("\n");
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

async function expectAccessible(page, scope) {
  await page.addScriptTag({ content: axeCore.source });
  const results = await page.evaluate(
    async ({ selector, tags }) => {
      const root = document.querySelector(selector);
      if (!root) throw new Error(`Accessibility audit scope was not found: ${selector}`);
      return window.axe.run(root, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      });
    },
    { selector: scope, tags: AXE_TAGS },
  );
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact));
  expect(blocking, formatViolations(blocking)).toEqual([]);
}

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await preparePage(page);
});

test("logged-out entry visual and accessibility", async ({ page }) => {
  await openLogin(page);
  await stabilize(page);

  await expect(page).toHaveScreenshot("login.png");
  await expectAccessible(page, "#login-view");
});

test("seeded camera library visual and accessibility", async ({ page }) => {
  await login(page);
  await stabilize(page);

  await expect(page).toHaveScreenshot("setup-cameras.png");
  await expectAccessible(page, "#library-view");
});

test("seeded shoots list visual and accessibility", async ({ page }) => {
  await login(page);
  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Shoots", exact: true }).click();
  await expect(body.getByRole("listitem").filter({ hasText: "Fixture photo walk" })).toBeVisible();
  await stabilize(page);

  await expect(page).toHaveScreenshot("setup-shoots.png");
  await expectAccessible(page, "#library-view");
});

test("shot logger visual and accessibility", async ({ page }) => {
  await login(page);
  const body = page.locator("#library-body");
  await body.getByRole("button", { name: "Shoots", exact: true }).click();
  const shoot = body.getByRole("listitem").filter({ hasText: "Fixture photo walk" });
  await shoot.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator(".logger-overlay")).toBeVisible();
  await stabilize(page);

  await expect(page).toHaveScreenshot("shot-logger.png");
  await expectAccessible(page, ".logger-overlay");
});

test("settings dialog visual and accessibility", async ({ page }) => {
  await login(page);
  await stabilize(page);
  await page.getByRole("button", { name: "Account and settings" }).click();
  const settingsItem = page.getByRole("menuitem", { name: "Settings", exact: true });
  await expect(settingsItem).toBeVisible();
  await settingsItem.click({ force: true });
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await stabilize(page);

  await expect(page).toHaveScreenshot("settings.png");
  await expectAccessible(page, ".modal-overlay");
});
