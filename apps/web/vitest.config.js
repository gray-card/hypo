import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // MapLibre remains runtime-only. Tests use a DOM-safe stub instead of
    // loading the package and requiring a WebGL context.
    alias: [
      {
        find: "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url",
        replacement: fileURLToPath(new URL("../../tests/stubs/maplibre-worker-url.js", import.meta.url)),
      },
      {
        find: "maplibre-gl/dist/maplibre-gl.css",
        replacement: fileURLToPath(new URL("../../tests/stubs/empty.js", import.meta.url)),
      },
      {
        find: "maplibre-gl",
        replacement: fileURLToPath(new URL("../../tests/stubs/maplibre.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.{js,ts}"],
    testTimeout: 15_000,
  },
});
