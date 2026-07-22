<div align="center">

<img src="public/icon.svg" width="84" height="84" alt="Hypo" />

<h1>Hypo</h1>

<p><strong>Organize your photography gear, workflows, and photos on atproto.</strong></p>

<p>
 <img src="https://img.shields.io/badge/built%20on-atproto-1185FE" alt="Built on atproto" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p>
  <a href="https://hypo.graycard.app">Live app</a> ·
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

## What it manages

Everything Hypo touches is an ordinary record in your own repo. It adds `app.graycard.*`
records for your gear, workflows, provenance, and scenes, and edits the `social.grain.*`
photo records they attach to in place (grain's schema is untouched).

| Record | What Hypo does |
| --- | --- |
| `app.graycard.*` | gear catalog and owned instances, captures, workflows, darkroom and scanning sessions, scene graphs, batch rules, discovery (see `lexicons/`) |
| `social.grain.gallery` | edit `title`, `description` |
| `social.grain.photo` | replace the image blob in place; edit `alt`, `aspectRatio` |
| `social.grain.photo.exif` | make, model, lens, aperture, exposure, ISO, focal length, flash, date |
| `social.grain.gallery.item` | gallery membership and order |

Writes use `putRecord` with the **same record key**, so AT-URIs stay stable, and
`swapRecord` so a stale edit fails instead of overwriting someone else's change.

## Features

- **Library:** cameras, lenses, film stockpiles and rolls, chemistry, scanners, and a shot logger. Gear types carry manufacturer product images and datasheets, with an editable per-type override.
- **Galleries:** create from upload, edit metadata, reorder frames, batch rules, and per-gallery gear defaults.
- **Workflows:** reusable templates, per-photo runs, and stages tied to photos.
- **Scene graphs:** regions, nodes, and edges on a photo, with types grounded to Wikidata and semantic search over what's actually in each frame.
- **Profiles:** a public view of anyone's setup at `https://hypo.graycard.app/profile/<handle>`. No login.
- **Discover:** publish an `app.graycard.setup` record to list your setup network-wide; Discover enumerates every published setup in real time via [Constellation](https://constellation.microcosm.blue/), a shared backlink index, still with no Hypo backend.
- **Offline:** shot logs queue locally and flush when you're back online.

## How it works

Hypo is a pure client. There is no server holding your data or your session:

- **Auth** is atproto OAuth against your own account, the same one you use across the atmosphere (Bluesky, grain, and more). The requested scope is granular: one `repo:<collection>` grant per collection Hypo writes, plus `blob:*/*`. No broad `transition:generic`.
- **Reads** of public records need no auth at all; profiles and Discover work signed out.
- **Discovery** rides a shared, read-only backlink index rather than a Hypo-run indexer, so the "no backend" property holds even for cross-network features.

## Run locally

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

| Piece | Role |
| --- | --- |
| `vite.config.js` | `base: '/'` (custom domain is the site root) |
| `public/CNAME` | `hypo.graycard.app` |
| `public/client-metadata.json` | public atproto OAuth client (`client_id`, redirect URI, scope) |
| `.github/workflows/deploy.yml` | build on `main`, publish `dist/`, copy `index.html` to `404.html` for SPA routes |

Production OAuth uses `https://hypo.graycard.app/client-metadata.json` as `client_id`.
Changing that URL invalidates existing sessions; users must sign in again. Keep the OAuth
scope in sync with `src/oauthScope.js` (`node scripts/gen-client-metadata.mjs`).

## Catalog data

Gear autocomplete is seeded from lensfun (CC-BY-SA 3.0), Wikidata (CC0), and curated
lists. Product images and datasheets are **links** to the manufacturer's own copy, never
re-hosted. See `src/data/CATALOG_ATTRIBUTION.md`. Refresh locally with:

```bash
npm run build:catalog
```

## Layout

| Path | Contents |
| --- | --- |
| `index.html` | shell and views |
| `src/main.js` | boot, OAuth, navigation |
| `src/grain.js` | grain gallery / photo / EXIF read-write |
| `src/graycard.js` | graycard store and record helpers |
| `src/registry.js`, `src/constellation.js`, `src/hydrate.js`, `src/publish.js`, `src/discover.js` | cross-network Discover |
| `src/ui/` | library, editor, upload, profiles, scene editor, map |
| `src/data/` | catalog seeds, Wikidata resolution, tokenizer |
| `lexicons/` | `app.graycard.*` schemas (`lexicons/README.md`) |
| `public/` | OAuth metadata, icons, `CNAME` |
| `tests/` | vitest suite |

## License

[MIT](LICENSE) © Aaron Steven White
