import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";

const panprotoWasm = new URL("../../node_modules/@panproto/core/dist/panproto_wasm_bg.wasm", import.meta.url);
const panprotoSidecar = new URL("../../.panproto/", import.meta.url);

function sidecarFiles(relativeDirectory) {
  const directory = new URL(relativeDirectory, panprotoSidecar);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}${entry.name}`;
    return entry.isDirectory() ? sidecarFiles(`${relativePath}/`) : [relativePath];
  });
}

// Production uses https://hypo.graycard.app/. Development stays on a loopback
// IP because atproto's loopback OAuth client requires 127.0.0.1.
export default defineConfig(({ command, mode }) => {
  const e2ePdsOrigin = command === "serve" && mode === "e2e" ? "http://127.0.0.1:2584" : "";
  return {
    base: "/",
    plugins: [
      {
        name: "panproto-wasm-asset",
        apply: "build",
        buildStart() {
          // @panproto/core loads its wasm-bindgen glue lazily with a runtime
          // URL. Emit the sibling payload explicitly so that URL also exists
          // in production builds without putting WASM on the happy path.
          this.emitFile({
            type: "asset",
            fileName: "assets/panproto_wasm_bg.wasm",
            source: readFileSync(panprotoWasm),
          });
        },
      },
      {
        name: "panproto-static-object-store",
        apply: "build",
        buildStart() {
          // The Pages artifact is the read-only distribution endpoint for
          // content-addressed schemas and migration chains.
          for (const relativePath of [...sidecarFiles("objects/"), ...sidecarFiles("refs/")]) {
            this.emitFile({
              type: "asset",
              fileName: `.panproto/${relativePath}`,
              source: readFileSync(new URL(relativePath, panprotoSidecar)),
            });
          }
        },
      },
    ],
    define: {
      "import.meta.env.VITE_E2E_PDS_ORIGIN": JSON.stringify(e2ePdsOrigin),
    },
    optimizeDeps: {
      // Panproto resolves its wasm-bindgen glue relative to its own module.
      // Prebundling changes that base URL and breaks the first lazy load.
      exclude: ["@panproto/core", "@panproto/core/panproto_wasm.js"],
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "assets/app-[hash].js",
          manualChunks(id) {
            if (id.includes("@panproto/core")) return "panproto-runtime";
          },
        },
      },
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  };
});
