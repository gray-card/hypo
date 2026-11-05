import { defineConfig, devices } from "@playwright/test";

const appPort = process.env.HYPO_E2E_APP_PORT || "5173";
const appUrl = `http://127.0.0.1:${appPort}`;
const fixtureUrl = "http://127.0.0.1:2584";
const mobileReleaseTests = [
  "**/gallery-editing.spec.js",
  "**/hypo.spec.js",
  "**/offline-flows.spec.js",
  "**/modal-scroll.spec.js",
  "**/library-record-routes.spec.js",
  "**/workflow-flows.spec.js",
  "**/responsive-library.spec.js",
];

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: appUrl,
    colorScheme: "dark",
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: mobileReleaseTests,
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-webkit",
      testMatch: mobileReleaseTests,
      // Linux WebKit spends substantially longer on page setup and rendering.
      // Budget for complete journeys while bounding each interaction separately.
      timeout: 90_000,
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
      },
    },
  ],
  webServer: [
    {
      command: "node tests/fixture-pds/server.js --port 2584",
      url: `${fixtureUrl}/__fixture__/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --mode e2e --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
