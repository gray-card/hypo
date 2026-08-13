import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPort = process.env.HYPO_E2E_APP_PORT || "5173";
const appUrl = `http://127.0.0.1:${appPort}`;
const fixtureUrl = "http://127.0.0.1:2584";
const releaseCriticalTests = [
  "**/hypo.spec.js",
  "**/offline-flows.spec.js",
  "**/modal-scroll.spec.js",
  "**/library-record-routes.spec.js",
  "**/workflow-flows.spec.js",
];
const sharedUse = {
  baseURL: appUrl,
  colorScheme: "dark" as const,
  locale: "en-US",
  reducedMotion: "reduce" as const,
  timezoneId: "UTC",
  trace: "retain-on-failure" as const,
  screenshot: "only-on-failure" as const,
  video: "retain-on-failure" as const,
};

export default defineConfig({
  testDir: resolve(root, "tests/e2e"),
  testMatch: releaseCriticalTests,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], ...sharedUse },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], ...sharedUse },
    },
  ],
  webServer: [
    {
      command: "node tests/fixture-pds/server.js --port 2584",
      cwd: root,
      url: `${fixtureUrl}/__fixture__/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --mode e2e --port ${appPort}`,
      cwd: root,
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
