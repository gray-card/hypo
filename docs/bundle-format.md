# Gray Card bundle format

Hypo's **Bundle** feature (dump → diff → write) reads and writes a plain JSON
file. This is the contract the Gray Card desktop app should emit on "dump to
ATProto", and what Hypo produces on **Export**.

## Shape

```json
{
  "$type": "app.graycard.bundle",
  "exportedAt": "2026-07-04T00:00:00Z",
  "did": "did:plc:source-repo",
  "records": [
    { "collection": "app.graycard.instance.camera", "rkey": "3kabc…", "value": { "type": "at://…", "createdAt": "…" } },
    { "collection": "app.graycard.catalog.filmStock", "value": { "name": "Portra 400", "createdAt": "…" } }
  ]
}
```

- A top-level `records` array is required (a bare array is also accepted).
- Each record needs a `collection` (NSID) and a `value` (the record body).
- `rkey` is **optional**:
  - **present** → `putRecord` at that key (create-or-update, stable AT-URI).
  - **absent** → `createRecord` (a fresh `tid` key is assigned).
- `$type`, `exportedAt`, `did` are optional metadata. A `$type` inside a record
  `value` is optional too: Hypo sets it from `collection` on write.

## Diff semantics (what Hypo shows before writing)

For each record, Hypo compares against the current repo:

- **new**: no record at that `rkey` (or no `rkey`) → will be created.
- **changed**: record exists and its value differs → will be `putRecord`-ed
  with `swapRecord` (the current CID) so a concurrent edit surfaces as a
  **conflict** instead of silently overwriting.
- **unchanged**: value is identical (ignoring `$type`) → skipped.
- **delete**: only when **Prune** is enabled: a record in the repo, within a
  collection the bundle touches, whose `rkey` is not in the bundle. These are
  `deleteRecord`-ed.

## Notes for the desktop exporter

- Keep `rkey`s stable across dumps so re-imports are idempotent (diff to
  "unchanged" when nothing changed).
- Record `value`s reference other records by **AT-URI**, which embeds the source
  `did`. A same-repo round-trip (backup/restore) is safe; importing into a
  *different* repo leaves those references pointing at the source repo unless the
  exporter rewrites them. Hypo does not rewrite refs.
- Scene graphs, workflow runs, artifacts, edit recipes, and catalog/instance/process
  records (anything under `app.graycard.*`) can travel in one bundle.
