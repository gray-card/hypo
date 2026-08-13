---
title: Write and apply batch rules
description: Build, preview, and safely apply the current gallery batch-rule DSL.
---

# Write and apply batch rules

Open a gallery and launch the **Batch rule builder**. A rule contains a condition under `when` and one or more typed `actions`.

## Build the condition

Add one or more field comparisons. The builder offers EXIF fields, alt text, gallery metadata, capture references, and the one-based photo `index`. Combine rows with **Match ALL** (`and`) or **Match ANY** (`or`).

Comparison operators include emptiness and existence tests, equality, substring and prefix/suffix tests, regular-expression matching, numeric comparisons, and membership. Values read through the UI are strings; numeric operators parse them as numbers.

For instance, fill only empty alt text with:

```json
{
  "when": { "field": "alt", "op": "empty" },
  "actions": [
    {
      "op": "setAlt",
      "value": "{{gallery.title}} #{{index}}",
      "mode": "ifEmpty"
    }
  ]
}
```

Templates may read `{{gallery.title}}`, `{{index}}`, and other supported field paths.

## Choose actions

The current apply path persists:

- `setAlt`;
- `setExif`;
- `projectCaptureToExif`;
- `associateCamera`; and
- `associateLens`.

Use `fill` or `ifEmpty` when existing observations should win. Use `overwrite` only after reviewing every match.

The DSL and builder also expose `setGalleryDescription`, but the current per-photo apply path does not persist that action. Edit the gallery description directly until the runner gains gallery-level application.

## Preview before applying

Select **Preview** and inspect every matching photo number and changed field. A preview reports computed differences without writing. Then select **Apply**, confirm the set, and wait for the progress counter to finish.

Give a reusable rule a name and select **Save rule**. This stores an `app.graycard.rule.batch` record; saving does not apply it. The lexicon supports recursive `not` groups and regex `pattern`/`flags`, though the current builder creates only flat `and` or `or` groups and uses its value box as the regex source.
