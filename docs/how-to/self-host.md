---
title: Self-host Hypo
description: Build the static application, configure OAuth metadata, and provide SPA fallbacks.
---

# Self-host Hypo

Hypo is a static single-page application, but a hosted copy has its own OAuth identity. Choose the final HTTPS origin before configuring it.

## 1. Set the deployment origin

Update the production metadata URL in `src/main.js` from Hypo's public URL to:

```text
https://your.example/client-metadata.json
```

Edit `public/client-metadata.json` so `client_id` is that exact URL and `client_uri`, `logo_uri`, and every `redirect_uris` entry use your origin. Preserve the generated scope unless your fork writes a different collection set.

If the site lives below a path prefix, set Vite's `base` accordingly and include the prefix in all metadata URLs and redirects. The router honors Vite's `BASE_URL`.

Remove or replace `public/CNAME` when you are not deploying to `hypo.graycard.app`.

## 2. Build

```bash
npm install
npm run build
```

The static output is `dist/`. Serve the metadata document with JSON content type and the site over HTTPS. Loopback development is the exception and uses `http://127.0.0.1`.

## 3. Configure SPA fallback

Requests for application routes such as `/gallery/<rkey>` and `/profile/<handle>` must return `dist/index.html`. Keep actual assets, `client-metadata.json`, and `/catalog/` files addressable as files.

On GitHub Pages, copying `index.html` to `404.html` provides that fallback. Other hosts can use a rewrite from unknown paths to `/index.html`.

## 4. Verify the deployment

Check all of the following before sharing the URL:

- `https://your.example/client-metadata.json` returns the edited document;
- its `client_id` equals its own URL exactly;
- the redirect URI equals the browser origin and path used by the app;
- direct navigation to `/discover` and a nested profile route loads the application shell;
- `/catalog/manifest.json` and one referenced shard load successfully; and
- sign-in requests only the scopes listed in the [OAuth reference](../reference/oauth-scopes.md).

Changing the metadata URL later creates a different OAuth client and requires users to sign in again. A self-hosted copy still reads and writes each user's PDS directly; it does not need an application database.
