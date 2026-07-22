import { defineConfig } from "vite";

// production is the custom domain https://hypo.graycard.app/ (GitHub Pages),
// so assets resolve from `/`. Dev stays on a loopback IP because atproto's
// loopback OAuth client requires 127.0.0.1 (not "localhost").
export default defineConfig({
  base: "/",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
});
