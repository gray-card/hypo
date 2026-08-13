import { expect, test } from "@playwright/test";

const PDS_ORIGIN = "http://127.0.0.1:2584";

async function login(page) {
  await page.goto("/");
  await page.getByRole("combobox").fill("alice.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${PDS_ORIGIN}/__fixture__/reset`);
  expect(response.ok()).toBe(true);
});

test("a long modal remains scrollable after browser-owned UI returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 852 });
  await login(page);

  const library = page.locator("#library-body");
  await library.getByRole("button", { name: "Darkroom", exact: true }).click();
  await library.getByRole("button", { name: "Add chemistry", exact: true }).click();

  const modal = page.getByRole("dialog", { name: "Add chemistry" });
  // The autocomplete option is appended inside the field label, so its
  // accessible name grows after typing. The schema-derived data key is stable.
  const name = modal.locator('input[data-key="name"]');
  await expect(modal).toBeVisible();
  await name.fill("D-76");
  await expect(name).toBeFocused();

  const before = await modal.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      maxHeight: Number.parseFloat(style.maxHeight),
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      touchAction: style.touchAction,
      viewportHeight: innerHeight,
    };
  });
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.maxHeight).toBeLessThanOrEqual(before.viewportHeight);
  expect(before.overflowY).toBe("auto");
  expect(before.touchAction).toBe("pan-y");

  // Browser password managers temporarily take focus outside the document.
  // Model that handoff and ensure the modal restores its last internal target.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    document.querySelector("#primary-nav button")?.focus();
    window.dispatchEvent(new Event("focus"));
  });
  await expect(name).toBeFocused();

  await modal.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => modal.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
