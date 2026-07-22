# Lensfun lens-correction database (vendored)

The `*.xml` files in this directory are the lens-calibration database of the **Lensfun**
project, vendored as a snapshot for offline lens correction.

- **Source:** <https://github.com/lensfun/lensfun> - `data/db/`
- **Snapshot:** commit `698a39e`, 2026-06-13
- **License:** **Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)**: see
  [`COPYING.CC_BY-SA_3.0`](COPYING.CC_BY-SA_3.0).

The database is a separate work, bundled here as a *collection* (mere aggregation): the
application code stays under its own license and the database stays under CC BY-SA 3.0.
Attribution to the Lensfun project and its contributors is required. Any edits to the
calibration values must be shared under CC BY-SA 3.0. The database is not merged into or
relicensed by the application source.

Lensfun's correction **library** (LGPL) is not used - Gray Card parses this database and
reimplements the correction models in pure Rust (`graycard-lens`).
