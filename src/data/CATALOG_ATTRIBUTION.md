# Catalog seed data: sources & licenses

Hypo's gear autocomplete is seeded from a few sources. Attribution and licenses:

## License boundary

Hypo's original curated datasets and database compilations are licensed under
**CC BY-SA 4.0**; see [`data/LICENSE.md`](../../data/LICENSE.md). That license
covers data only. The application and the scripts that collect, transform, and
display the data remain under the repository's **MIT License**. More specific
upstream notices continue to control third-party material, including Lensfun's
CC BY-SA 3.0 database and the per-file licenses on linked Wikimedia Commons
images. Manufacturer datasheets, pages, and product images are linked rather
than copied and are not relicensed by Hypo.

## lensfun: lenses & digital cameras
`src/data/lensfun-lenses.json` and `lensfun-cameras.json` are generated from the
**lensfun** database (<https://github.com/lensfun/lensfun>, `data/db/`), which is
licensed **CC-BY-SA 3.0** (<https://creativecommons.org/licenses/by-sa/3.0/>).

A snapshot of the database is vendored at `data/lensfun-db/` (see its `NOTICE.md`
and `COPYING.CC_BY-SA_3.0`). `npm run build:catalog` parses that local copy, while
`node scripts/build-catalog.mjs --fetch` pulls the latest from upstream (used by the
weekly CI refresh).

These files are **adaptations** of the lensfun database: parsed to specs, focal/
aperture extracted from model names, mounts normalized, and, for cameras, the raw
EXIF model codes lensfun stores (e.g. `ILCE-7M3`, `DC-S5M2`, `Z 6_2`) mapped to the
consumer names photographers use (`A7 III`, `S5 II`, `Z6 II`). The raw code is kept
on each record as `exifModel`. Per CC-BY-SA 3.0 these files are redistributed under
the **same license**, with attribution to the lensfun project and an indication that
changes were made. lensfun is the single source of truth for digital camera bodies.

## Wikidata: canonical identifiers + images
When present, `wikidata` QIDs are resolved from **Wikidata** (<https://www.wikidata.org>),
which is dedicated to the public domain under **CC0 1.0**. They are stored on
records via `app.graycard.defs#catalogLinks.externalIds` (`scheme: "wikidata"`).
`scripts/wikidata-lenses.mjs` is the reusable "fetch a maker's lenses from
Wikidata" method (SPARQL by manufacturer QID) used to seed QIDs and P18 default
images; point it at any manufacturer.

## Curated lenses not in lensfun (e.g. Nikon's manual-focus line)
`data/curated-lenses.jsonl` is a JSON Lines file (one lens per line, editable by
hand or PR) of lenses lensfun does not carry, most notably Nikon's pre-AI, AI,
AI-S, Series E, PC, and older manual-focus Nikkors. The factual fields (model
name, focal length, aperture, mount) are compiled from the English Wikipedia
**Nikon F-mount** article's lens tables; such factual specifications are not
copyrightable. Any `image` URLs point at Wikimedia **Commons** files (per-file
licenses; mostly CC-BY-SA 4.0) and `wikidata` QIDs are **CC0**. At build time
`scripts/build-catalog.mjs` loads this file, dedupes it against lensfun (so no
lens appears twice), best-effort enriches QIDs/images via the Wikidata method
above, and writes `src/data/curated-lenses.json`, which `presets.js` concatenates
onto the lensfun list. To propose a lens, add a line to the JSONL (the app's
"Suggest a lens" button opens a prefilled GitHub issue for exactly this).

## Film stock product images and datasheets (links only)

Each curated film stock may carry an `image` and a `datasheetUrl`. **Both are URLs
pointing at the manufacturer's own copy on the manufacturer's own server. No image
or datasheet file is copied into this repository or re-hosted by Hypo.** The app
renders the image by linking to it, the way a product is identified by a picture of
itself; the rights in that photograph stay with the manufacturer.

Two rules govern what may go in the `image` field:

1. **Manufacturer-hosted only.** The URL must be on a site owned by the brand
   (kodak.com, ilfordphoto.com, harmanphoto.co.uk, fujifilm.com, cinestillfilm.com,
   shop.lomography.com, rolleianalog.com / rollei.de, adox.de, foma.cz,
   filmwashi.com, orwo.shop, catlabs.info, bergger.com, kosmofoto.com). A reseller's
   product photography is that reseller's own work and is served at their bandwidth
   cost, so retailer URLs are **not** used, even when a stock consequently has no
   image at all.
2. **No image is better than a wrong one.** 16 of 101 stocks have no curated image,
   because their maker publishes no packaging photograph (Kodak Alaris shows only
   sample frames for Portra and T-Max; filmwashi.com and filmferrania.com show only
   sample photographs). Those fall back to the Wikidata/Commons image, then to no
   image. `tests/catalogImage.test.js` asserts that no retailer URL creeps in.

A record's own `image` / `datasheet` (`app.graycard.defs#assetRef`) takes precedence
over these curated defaults, so anyone may attach their own photograph or a
permissively licensed one to their own catalog records.

**Do not use `filmferrania.it`.** That domain has lapsed and now serves unrelated
casino-affiliate content. Ferrania's real site is `filmferrania.com`.

## Film stocks, developers, chemistry, papers, film + instant cameras
Compiled from general reference knowledge (factual name/attribute lists). Not
derived from any licensed database. lensfun has essentially no film or instant
bodies, so those are curated (`CURATED_CAMERAS` in `presets.js`), along with a
short, verified list of digital bodies genuinely absent from the lensfun snapshot
(e.g. Ricoh GR II / GXR, Sigma dp2 Quattro, Olympus E-M1X, Phase One IQ4/IQ3);
every other digital body is deduped in from lensfun.
