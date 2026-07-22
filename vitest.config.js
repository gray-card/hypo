import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // maplibre-gl is only ever dynamically imported at runtime (to keep it out of
    // the main bundle); stub it in tests so importing modules that reference it
    // doesn't require the real package or a browser WebGL context.
    alias: [
      { find: "maplibre-gl/dist/maplibre-gl.css", replacement: fileURLToPath(new URL("./tests/stubs/empty.js", import.meta.url)) },
      { find: "maplibre-gl", replacement: fileURLToPath(new URL("./tests/stubs/maplibre.js", import.meta.url)) },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js"],
  },
});
