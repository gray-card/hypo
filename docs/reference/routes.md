---
title: Application routes
description: Browser route names, paths, parameters, and static-hosting requirements.
---

# Application routes

`src/router.js` is the browser URL contract. Paths are decoded on match and encoded on construction.

| Route name       | Path                        | Parameters          | View                   |
| ---------------- | --------------------------- | ------------------- | ---------------------- |
| `home`           | `/`                         | none                | Home                   |
| `galleries`      | `/galleries`                | none                | Gallery list           |
| `library`        | `/library/:tab`             | `tab`               | Library tab            |
| `gallery`        | `/gallery/:rkey`            | `rkey`              | Gallery editor         |
| `roll`           | `/roll/:rkey`               | `rkey`              | Film-roll detail       |
| `gear`           | `/gear/:kind/:rkey`         | `kind`, `rkey`      | Gear editor            |
| `timer`          | `/timer`                    | none                | Development timer      |
| `meter`          | `/meter`                    | none                | Light meter            |
| `discover`       | `/discover`                 | none                | Published setups       |
| `profile`        | `/profile/:handle`          | `handle`            | Public profile         |
| `profileSection` | `/profile/:handle/:section` | `handle`, `section` | Public profile section |

Any other path produces `notFound`. Query parameters do not participate in route matching.

Roll detail and gear editor routes are history-integrated modal routes. On a cold load, the application restores the Library beneath the modal and resolves the requested record before opening it. Closing the modal returns to the underlying Library route; Back and Forward close and reopen the corresponding record view.

## Router API

`matchRoute(pathname, {base})` returns `{name, params, pathname}`. `routePath(name, params, {base})` builds a path and throws for an unknown route or missing parameter. `createRouter()` adds history navigation, replacement, subscriptions, refresh, and teardown around those pure functions.

The optional `base` supports deployment below a path prefix. The application passes Vite's `BASE_URL`, so code should use `routePath` or the router instead of concatenating root-relative paths.

## Static hosting

These are client-side routes. A static host must return the application shell for unknown paths. The production GitHub Pages workflow copies `dist/index.html` to `dist/404.html`; another host needs an equivalent fallback or rewrite. Static files such as `client-metadata.json`, catalog shards, icons, and hashed assets must remain exempt from that rewrite.
