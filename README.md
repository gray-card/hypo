<div align="center">

<img src="public/icon.svg" width="84" height="84" alt="Hypo" />

<h1>Hypo</h1>

<p><strong>Organize your photography gear, workflows, and photos on atproto.</strong></p>

<p>
 <img src="https://img.shields.io/badge/built%20on-atproto-1185FE" alt="Built on atproto" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-blue.svg" alt="Code license: MIT" /></a>
  <a href="data/LICENSE.md"><img src="https://img.shields.io/badge/data-CC_BY--SA_4.0-green.svg" alt="Data license: CC BY-SA 4.0" /></a>
</p>

<p>
  <a href="https://hypo.graycard.app">Live app</a> ·
  <a href="https://hypo.graycard.app/docs/">Documentation</a> ·
  <a href="lexicons/">Lexicons</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#license">License</a>
</p>

</div>

---

**Hypo** is a tool for organizing your film or digital photography in
your own atproto repo: the gear you shoot, develop, and scan with; the workflows that take
a film roll (if that's your thing) from capture to finished scan; and the provenance and scene detail behind every
frame. It layers rich `app.graycard.*` gear, workflow, and scene-graph records over your
photos on [grain.social](https://grain.social), all written straight to your PDS. Sign-in
is standard atproto OAuth with your atmosphere account, and there is **no backend**: Hypo
is a static single-page app you can host for free.

This repository contains Hypo for web. Hypo is the metadata product; Gray Card is a
separate, full-featured photo editor with a scope comparable to Lightroom. Both use the
same `app.graycard.*` metadata model, but Gray Card's editing features have separate
documentation.

## What it manages

Everything Hypo touches is an ordinary record in your own repo. It adds `app.graycard.*`
records for your gear, workflows, provenance, and scenes, and edits the `social.grain.*`
photo records they attach to in place (grain's schema is untouched).

| Record                      | What Hypo does                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.graycard.*`            | gear catalog and owned instances, captures, workflows, darkroom and scanning sessions, scene graphs, batch rules, discovery (see `lexicons/`) |
| `social.grain.gallery`      | edit `title`, `description`                                                                                                                   |
| `social.grain.photo`        | replace the image blob in place; edit `alt`, `aspectRatio`                                                                                    |
| `social.grain.photo.exif`   | make, model, lens, aperture, exposure, ISO, focal length, flash, date                                                                         |
| `social.grain.gallery.item` | gallery membership and order                                                                                                                  |

Writes use `putRecord` with the **same record key**, so AT-URIs stay stable, and
`swapRecord` so a stale edit fails instead of overwriting someone else's change.

## Features

- **Library:** cameras, lenses, film stockpiles and rolls, multi-role photographic chemistry, scanners, meters, and other working equipment. Gear types carry manufacturer product images and datasheets, with an editable per-type override.
- **Lifecycle records:** optional, chronology-checked dates for loading, unloading, lab handoff, development, mixing, discarding, and other film and chemistry milestones.
- **Development logs:** ordered, editable process stages for simple and multi-bath development, with linked chemistry, dates, planned and actual time and temperature, agitation, volume, and bath disposition. Completed sessions update every linked chemistry's usage totals.
- **Film and shoots:** searchable, sortable roll and shoot libraries, with lifecycle filters and batch `.frames` import. Imported time and optional location gaps propose any number of reviewable shoots; exact coordinates stay off the PDS unless selected for publication.
- **Shoots and metering:** a mobile-friendly shot logger, capture sessions, meter readings, calibration records, exposure calculations, and film-reciprocity support.
- **Galleries:** create from upload, edit metadata, reorder frames, batch rules, and per-gallery gear defaults.
- **Workflows:** reusable branching templates, typed inputs and outputs, repeatable steps, per-subject runs, and stages tied to photos and process records.
- **Scene graphs:** regions, nodes, and edges on a photo, with types grounded to Wikidata and semantic search over what's actually in each frame.
- **Profiles:** a public view of anyone's setup at `https://hypo.graycard.app/profile/<handle>`. No login.
- **Discover:** publish an `app.graycard.setup` record to list your setup network-wide; Discover enumerates every published setup in real time via [Constellation](https://constellation.microcosm.blue/), a shared backlink index, still with no Hypo backend.
- **Following:** a device-cached activity feed for people followed through Bluesky and Grain. Hypo shows the saved copy immediately, merges new records in place, and checks known publishers first using their record count and most recent activity.
- **Offline:** supported writes queue locally, preserve optimistic state, and surface swap conflicts instead of discarding edits.

## How it works

Hypo is a pure client. There is no server holding your data or your session:

- **Auth** is atproto OAuth against your own account, the same one you use across the atmosphere (Bluesky, grain, and more). The requested scope is granular: one `repo:<collection>` grant per collection Hypo writes, plus `blob:*/*`. No broad `transition:generic`.
- **Reads** of public records need no auth at all; profiles and Discover work signed out.
- **Discovery** rides a shared, read-only backlink index rather than a Hypo-run indexer, so the "no backend" property holds even for cross-network features.

## Run locally

Hypo requires Node.js 22 or newer and npm 10.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Use the IP, not `localhost`: atproto loopback OAuth
requires a loopback IP, and the app redirects you if needed. On loopback, Hypo uses the
built-in loopback OAuth client; a hosted `client-metadata.json` is not required.

```bash
npm test          # vitest
npm run build     # static site into dist/
npm run preview   # serve dist/ on http://127.0.0.1:5173
```

## Deploy

Hypo is a GitHub Pages project site published at `https://hypo.graycard.app/`.

| Piece                          | Role                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `vite.config.js`               | `base: '/'` (custom domain is the site root)                                                   |
| `public/CNAME`                 | `hypo.graycard.app`                                                                            |
| `public/client-metadata.json`  | public atproto OAuth client (`client_id`, redirect URI, scope)                                 |
| `.github/workflows/ci.yml`     | validate and deploy the app and `/docs/` after every fully green `main` push                   |
| `.github/workflows/deploy.yml` | validate a `v*` tag at the current `main` commit, rerun release gates, and publish the release |

Production OAuth uses `https://hypo.graycard.app/client-metadata.json` as `client_id`.
Changing that URL invalidates existing sessions; users must sign in again. Keep the OAuth
scope in sync with `src/oauthScope.js` (`node scripts/gen-client-metadata.mjs`).

## Catalog data

Gear autocomplete is seeded from lensfun (CC-BY-SA 3.0), Wikidata (CC0), and curated
lists. Product images and datasheets are **links** to the manufacturer's own copy, never
re-hosted. Hypo's original curated data and database compilations are licensed under
[CC BY-SA 4.0](data/LICENSE.md); the vendored Lensfun database remains under
[CC BY-SA 3.0](data/lensfun-db/NOTICE.md). These data licenses cover the data only,
not the application or data-processing code. See [the data README](data/README.md) and
`src/data/CATALOG_ATTRIBUTION.md`. Refresh locally with:

```bash
npm run build:catalog
```

## Layout

| Path         | Contents                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| `apps/web/`  | typed web shell, actions, routes, and library views                           |
| `packages/`  | domain, lexicon, PDS, schema runtime, store, sync, catalog, and UI boundaries |
| `src/`       | production application modules retained while the package boundaries settle   |
| `lexicons/`  | `app.graycard.*` schemas and Panproto-managed evolution                       |
| `.panproto/` | committed schema history, refs, and the `lexicons-v1` baseline                |
| `docs/`      | Hypo tutorials, how-to guides, explanation, and generated schema reference    |
| `data/`      | human-edited catalog sources and third-party attribution                      |
| `public/`    | OAuth metadata, catalog shards, icons, and `CNAME`                            |
| `fixtures/`  | schema-conformance and migration fixtures                                     |
| `tests/`     | unit, integration, fixture-PDS, desktop, and mobile browser tests             |

## License

The application and data-processing code are licensed under the [MIT License](LICENSE)
© Aaron Steven White. Data has separate terms: original curated datasets and database
compilations are [CC BY-SA 4.0](data/LICENSE.md), while the vendored Lensfun database
remains [CC BY-SA 3.0](data/lensfun-db/NOTICE.md). The Creative Commons licenses cover
data only; they do not change the code's MIT license. See [data/README.md](data/README.md)
for the full boundary and third-party exceptions.
